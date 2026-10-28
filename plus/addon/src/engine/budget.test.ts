// Short-term budget: the queue, envelope caps and targets, quarterly prepayment with reducir cuota.
import { describe, expect, it } from 'vitest';
import { addMonths, BudgetSchema, type Budget } from '../model/budget';
import { runBudget, type BudgetMonth } from './budget';
import { annuityMonthly, monthsToRepay } from './real-estate';

/** 3 000 € free a month before the loan; a 6 000 € loan at 6 % paying 300 €. */
function budget(overrides: Partial<Budget> = {}): Budget {
  return {
    name: 'Test',
    start: '2026-11',
    months: 24,
    incomes: [{ name: 'Salary', amount: 5_000, from: null, to: null }],
    expenses: [{ name: 'Living', amount: 2_000, from: null, to: null }],
    oneTime: [],
    envelopes: [
      { id: 'safety', name: 'Safety', balance: 1_000, accountId: null },
      { id: 'prepay', name: 'Prepay', balance: 0, accountId: null },
      { id: 'fun', name: 'Fun', balance: 0, accountId: null },
      { id: 'long', name: 'Long term', balance: 0, accountId: null },
    ],
    loans: [{ id: 'car', name: 'Car', balance: 6_000, rate: 0.06, payment: 300, liabilityId: null }],
    steps: [
      { kind: 'fixed', envelopeId: 'fun', amount: 500, cap: 2_000, whileLoan: null },
      { kind: 'fixed', envelopeId: 'safety', amount: 200, cap: null, whileLoan: 'car' },
      { kind: 'rest', envelopeId: 'prepay', whileLoan: 'car' },
      { kind: 'fill', envelopeId: 'safety', target: 10_000 },
      { kind: 'rest', envelopeId: 'long', whileLoan: null },
    ],
    prepayments: [{ envelopeId: 'prepay', loanId: 'car', months: [3, 6, 9, 12], effect: 'payment' }],
    ...overrides,
  };
}

const sum = (r: Record<string, number>) => Object.values(r).reduce((s, v) => s + v, 0);
const row = (rows: BudgetMonth[], m: string) => rows.find((r) => r.month === m)!;

/** Envelopes and unallocated money account for every euro that came in and went out. */
function expectBalanced(b: Budget, rows: BudgetMonth[]) {
  const flows = rows.reduce(
    (s, r) => s + r.income + r.oneTimeIncome - r.expenses - r.oneTimeExpenses - r.loanPayments,
    0,
  );
  const start = b.envelopes.reduce((s, e) => s + e.balance, 0);
  const end = sum(rows.at(-1)!.balances);
  const prepaid = rows.reduce((s, r) => s + sum(r.prepaid), 0);
  const unallocated = rows.reduce((s, r) => s + r.unallocated, 0);
  expect(end + prepaid + unallocated).toBeCloseTo(start + flows, 6);
}

describe('runBudget', () => {
  it('goes by the queue while the loan is open', () => {
    const rows = runBudget(budget());
    const nov = row(rows, '2026-11');
    expect(nov.free).toBeCloseTo(2_700, 9);
    expect(nov.deposits).toEqual({ fun: 500, safety: 200, prepay: 2_000 });
    expect(nov.interest).toBeCloseTo(30, 9);
    expect(nov.loans.car.balance).toBeCloseTo(5_730, 9);
    expect(nov.unallocated).toBe(0);
    expectBalanced(budget(), rows);
  });

  it('sweeps the envelope in the given month with reducir cuota', () => {
    const b = budget({ months: 2 });
    const rows = runBudget({ ...b, loans: [{ ...b.loans[0], balance: 20_000, payment: 500 }] });
    const dec = row(rows, '2026-12');
    // November: 20 000 + 100 − 500; December: + interest − 500, then the envelope (2 × (3 000 − 500 − 500 − 200)).
    const beforePrepay = 19_600 * (1 + 0.005) - 500;
    const months = Math.ceil(monthsToRepay(beforePrepay, 0.06, 500));
    expect(dec.prepaid.prepay).toBeCloseTo(3_600, 9);
    expect(dec.balances.prepay).toBe(0);
    expect(dec.loans.car.balance).toBeCloseTo(beforePrepay - 3_600, 9);
    expect(dec.loans.car.payment).toBeCloseTo(annuityMonthly(beforePrepay - 3_600, 0.06, months), 9);
  });

  it('repays at once when the envelope covers the balance, before the sweep month', () => {
    const rows = runBudget(budget());
    // November: 2 000 in the envelope, 5 730 owed. December sweeps 4 000 (a sweep month).
    // January: the envelope covers the rest — repaid before the March sweep.
    const repaid = rows.find((r) => r.loans.car.balance === 0)!;
    expect(repaid.month).toBe('2027-01');
    expect(sum(repaid.prepaid)).toBeGreaterThan(0);
    expect(repaid.loans.car.payment).toBe(0);
  });

  it('returns the envelope to the free money the month after the loan is repaid', () => {
    const rows = runBudget(budget());
    const jan = row(rows, '2027-01');
    const feb = row(rows, '2027-02');
    expect(jan.balances.prepay).toBeGreaterThan(0);
    expect(feb.withdrawn.prepay).toBeCloseTo(jan.balances.prepay, 9);
    expect(feb.loanPayments).toBe(0);
    // No loan: fixed safety and rest-to-prepay are skipped; fill takes the returned money.
    expect(feb.deposits.prepay).toBeUndefined();
    expect(feb.free).toBeCloseTo(3_000 + jan.balances.prepay, 9);
  });

  it('stops a fixed step at its cap and passes the excess down the queue', () => {
    const rows = runBudget(budget());
    expect(row(rows, '2027-02').balances.fun).toBe(2_000);
    expect(row(rows, '2027-03').deposits.fun).toBeUndefined();
  });

  it('fills to the target, then the rest goes to the last envelope', () => {
    const rows = runBudget(budget());
    const full = rows.find((r) => r.balances.safety >= 10_000 - 1e-9)!;
    expect(full.balances.safety).toBeCloseTo(10_000, 9);
    const next = row(rows, addMonths(full.month, 1));
    expect(next.deposits.safety).toBeUndefined();
    expect(next.deposits.long).toBeCloseTo(3_000, 9);
    expectBalanced(budget(), rows);
  });

  it('pays a one-time expense from its envelope after the deposit, the rest from what is left', () => {
    const b = budget({
      oneTime: [
        { name: 'Trip', month: '2027-02', amount: 3_000, kind: 'expense', envelopeId: 'fun' },
        { name: 'Bonus', month: '2027-02', amount: 1_000, kind: 'income', envelopeId: null },
      ],
    });
    const rows = runBudget(b);
    const feb = row(rows, '2027-02');
    // Fun has 1 500 at the end of January and gets 500 before the trip.
    expect(feb.withdrawn.fun).toBeCloseTo(2_000, 9);
    expect(feb.balances.fun).toBe(0);
    expect(feb.oneTimeExpenses).toBe(3_000);
    expectBalanced(b, rows);
  });

  it('leaves a shortfall unallocated without touching the envelopes', () => {
    const b = budget({
      months: 1,
      expenses: [{ name: 'Living', amount: 6_000, from: null, to: null }],
    });
    const [nov] = runBudget(b);
    expect(nov.unallocated).toBeCloseTo(-1_300, 9);
    expect(nov.deposits).toEqual({});
    expectBalanced(b, [nov]);
  });

  it('counts a line from its first month up to, not including, its last', () => {
    const b = budget({
      months: 4,
      incomes: [{ name: 'Salary', amount: 5_000, from: '2026-12', to: '2027-02' }],
    });
    expect(runBudget(b).map((r) => r.income)).toEqual([0, 5_000, 5_000, 0]);
  });
});

describe('BudgetSchema', () => {
  it('accepts a valid budget', () => {
    expect(BudgetSchema.safeParse(budget()).success).toBe(true);
  });

  it('rejects references to missing envelopes and loans', () => {
    const b = budget();
    const bad = {
      ...b,
      steps: [{ kind: 'rest', envelopeId: 'nope', whileLoan: 'nope' }],
      prepayments: [{ envelopeId: 'prepay', loanId: 'nope', months: [3], effect: 'term' }],
    };
    const r = BudgetSchema.safeParse(bad);
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path.join('.'))).toEqual([
      'steps.0.envelopeId',
      'steps.0.whileLoan',
      'prepayments.0.loanId',
    ]);
  });

  it('rejects a bad month', () => {
    expect(BudgetSchema.safeParse(budget({ start: '2026-13' })).success).toBe(false);
  });
});

describe('addMonths', () => {
  it('crosses years', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', 35)).toBe('2028-12');
  });
});
