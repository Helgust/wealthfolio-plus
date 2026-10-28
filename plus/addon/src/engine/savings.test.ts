// Phase 6: savings by goals, month by month inside the yearly engine.
import { describe, expect, it } from 'vitest';
import { rulesForYear } from '../es-tax';
import {
  defaultPlan,
  PlanSchema,
  type AccountGoal,
  type LoanGoal,
  type Plan,
  type PropertyPurchase,
  type SavingsStep,
} from '../model/plan';
import { annuityPayment, downPayment, purchaseAmounts, type Loan } from './real-estate';
import { runPlan, totalOf, type StartingPoint } from './run-plan';
import { allocate, type Reached } from './savings';
import { cashAccount, investAccount, ZERO_RETURNS } from './test-helpers';

const start = (): StartingPoint => ({
  netWorth: 10_000 + 10_000,
  accounts: [cashAccount(10_000), cashAccount(0, 'cushion'), investAccount('fund', 'fund', 1, 10_000, 10_000), investAccount('ppi', 'ppi', 1, 0.0001, 0.0001)],
});

/** One person of 40 with a salary of 60 000 € and expenses of 20 000 € a year: about 1 900 € free a month. */
function plan(overrides: Partial<Plan> = {}): Plan {
  const d = defaultPlan(2026);
  return {
    ...d,
    returns: ZERO_RETURNS,
    inflation: 0,
    milestones: [],
    people: [{ ...d.people[0], autonomo: null, pension: null }],
    incomes: [{ name: 'Salary', person: 0, tax: 'trabajo', amount: 60_000, start: null, end: null }],
    ...overrides,
  };
}

const goal = (id: string, target: number | null, overrides: Partial<AccountGoal> = {}): AccountGoal => ({
  kind: 'account',
  id,
  name: id,
  accountId: id,
  target: target === null ? null : { kind: 'amount', amount: target },
  end: null,
  ...overrides,
});

const step = (year: number, month: number, amounts: Record<string, number>): SavingsStep => ({ from: { year, month }, amounts });

describe('allocate', () => {
  it('splits in proportion and passes what a full part cannot take to the others', () => {
    expect(allocate(1_000, [3, 1], [Infinity, Infinity])).toEqual([750, 250]);
    const [a, b, c] = allocate(1_000, [1, 1, 2], [100, Infinity, Infinity]);
    expect(a).toBe(100);
    expect(b).toBeCloseTo(300, 9);
    expect(c).toBeCloseTo(600, 9);
  });

  it('gives nothing to zero weights and leaves what nobody can take', () => {
    expect(allocate(1_000, [0, 1], [Infinity, 200])).toEqual([0, 200]);
  });
});

describe('savings by goals', () => {
  it('pay the planned savings into the goal and show the month its target is reached', () => {
    const p = plan({ goals: [goal('cushion', 5_000)], savings: [step(2026, 1, { cushion: 1_000 })] });
    const r = runPlan(p, start(), p.filing, undefined, 1);
    expect(r.months).toHaveLength(12);
    expect(r.months.slice(0, 5).map((m) => m.goals.cushion.saved)).toEqual([1_000, 1_000, 1_000, 1_000, 1_000]);
    expect(r.months[4].goals.cushion.balance).toBeCloseTo(5_000, 9);
    expect(r.goalsReached.cushion).toEqual({ year: 2026, month: 5 });
    // Full: the savings go to cash.
    expect(r.months[5]).toMatchObject({ saved: 1_000, toCash: 1_000, deficit: 0 });
    expect(r.months[5].goals.cushion.saved).toBe(0);
  });

  it('a goal that cannot take its amount leaves it to the others in proportion', () => {
    const p = plan({
      goals: [goal('cushion', 3_000), goal('fund', null)],
      savings: [step(2026, 1, { cushion: 600, fund: 400 })],
    });
    const r = runPlan(p, start(), p.filing, undefined, 1);
    expect(r.goalsReached.cushion).toEqual({ year: 2026, month: 5 });
    expect(r.months[0].goals.fund.saved).toBe(400);
    expect(r.months[5].goals.fund.saved).toBe(1_000);
    expect(r.rows[0].balances.fund).toBeCloseTo(10_000 + 5 * 400 + 7 * 1_000, 6);
  });

  it('short of free money: the goals get what there is, the rest is the savings deficit', () => {
    const p = plan({ goals: [goal('fund', null)], savings: [step(2026, 1, { fund: 5_000 })] });
    const r = runPlan(p, start(), p.filing, undefined, 1);
    const [m] = r.months;
    expect(m.freeMoney).toBeGreaterThan(1_000);
    expect(m.saved).toBeCloseTo(m.freeMoney, 9);
    expect(m.deficit).toBeCloseTo(5_000 - m.freeMoney, 9);
    expect(m.rest).toBeCloseTo(0, 9);
    expect(r.rows[0].savings!.deficit).toBeCloseTo(12 * m.deficit, 6);
  });

  it('the months add up to the year', () => {
    const p = plan({
      goals: [goal('cushion', 8_000), goal('fund', null)],
      savings: [step(2026, 3, { cushion: 700, fund: 300 }), step(2027, 1, { fund: 1_500 })],
    });
    const r = runPlan(p, start(), p.filing, undefined, 2);
    expect(r.months).toHaveLength(24);
    r.rows.slice(0, 2).forEach((row, y) => {
      const ms = r.months.slice(12 * y, 12 * y + 12);
      const sum = (f: (m: (typeof ms)[number]) => number) => ms.reduce((s, m) => s + f(m), 0);
      expect(sum((m) => m.freeMoney)).toBeCloseTo(row.netCashFlow, 6);
      expect(sum((m) => m.saved)).toBeCloseTo(row.savings!.saved, 6);
      expect(sum((m) => m.planned)).toBeCloseTo(row.savings!.planned, 6);
      expect(sum((m) => m.goals.fund.saved)).toBeCloseTo(row.savings!.goals.fund.saved, 6);
      // Everything free went into accounts: to the goals, the rest to cash.
      expect(totalOf(row.deposits)).toBeCloseTo(row.netCashFlow, 6);
    });
    expect(r.months[0].planned).toBe(0);
    expect(r.months[2].planned).toBe(1_000);
  });

  it('a goal below its target again is topped up', () => {
    const s = start();
    s.accounts[1].cash = 5_000;
    s.netWorth += 5_000;
    const p = plan({
      goals: [goal('cushion', 5_000)],
      savings: [step(2026, 1, { cushion: 1_000 })],
      withdrawalOrder: ['cushion', 'cash'],
      oneTime: [
        { type: 'expense', name: 'Roof', kind: 'essential', amount: 30_000, nominal: false, at: { kind: 'year', year: 2027 }, repeat: null },
      ],
    });
    const r = runPlan(p, s, p.filing, undefined, 3);
    expect(r.goalsReached.cushion).toEqual({ year: 2026, month: 1 });
    expect(r.rows[0].savings!.goals.cushion.saved).toBe(0);
    // 2027 has no free money: no savings, and the minus comes out of the cushion first.
    expect(r.rows[1].savings!.saved).toBe(0);
    expect(r.rows[1].withdrawals.cash).toBeGreaterThan(0);
    expect(r.rows[1].savings!.goals.cushion.balance).toBeLessThan(5_000);
    expect(r.rows[2].savings!.goals.cushion.saved).toBeGreaterThan(0);
  });

  it('a goal stops at its end', () => {
    const p = plan({
      goals: [goal('fund', null, { end: { kind: 'year', year: 2027 } })],
      savings: [step(2026, 1, { fund: 500 })],
    });
    const [y1, y2] = runPlan(p, start()).rows;
    expect(y1.savings!.goals.fund.saved).toBe(6_000);
    expect(y2.savings!.goals.fund.saved).toBe(0);
    expect(y2.savings!.toCash).toBe(6_000);
  });

  it('a pension plan takes no more than the deductible room and lowers the IRPF', () => {
    const without = runPlan(plan(), start()).rows[0];
    const p = plan({
      goals: [goal('ppi', null)],
      savings: [step(2026, 1, { ppi: 500 })],
      flows: [{ accountId: 'ppi', mode: 'max', amount: 0 }],
    });
    const r = runPlan(p, start(), p.filing, undefined, 1);
    expect(r.months.slice(0, 4).map((m) => m.goals.ppi.saved)).toEqual([500, 500, 500, 0]);
    expect(r.months[3].toCash).toBe(500);
    const [row] = r.rows;
    // The flow finds the room used up.
    expect(row.pensionContributions).toBeCloseTo(1_500, 9);
    expect(row.deposits.pension).toBeCloseTo(1_500, 9);
    expect(row.irpf).toBeLessThan(without.irpf - 300);
  });

  it('a fund goal earns the year’s growth month by month', () => {
    const p = plan({
      returns: { ...ZERO_RETURNS, fundGrowth: 0.12 },
      goals: [goal('fund', null)],
      savings: [step(2026, 1, { fund: 100 })],
    });
    const r = runPlan(p, start(), p.filing, undefined, 1);
    expect(r.months[5].goals.fund.balance).toBeCloseTo(10_000 + 600 + 600, 6);
    expect(r.months[11].goals.fund.balance).toBeCloseTo(11_200 + 1_200, 6);
  });

  it('a plan without goals keeps months only when asked for, with no savings', () => {
    const p = plan();
    expect(runPlan(p, start()).months).toEqual([]);
    const r = runPlan(p, start(), p.filing, undefined, 2);
    expect(r.months).toHaveLength(24);
    expect(r.rows[0].savings).toBeNull();
    expect(r.months.every((m) => m.saved === 0 && m.planned === 0)).toBe(true);
    expect(r.months.slice(0, 12).reduce((s, m) => s + m.freeMoney, 0)).toBeCloseTo(r.rows[0].netCashFlow, 6);
  });
});

describe('savings in the plan schema', () => {
  const parse = (overrides: Partial<Plan>) => PlanSchema.safeParse({ ...defaultPlan(2026), ...overrides });

  it('reads plans without goals', () => {
    const { goals, savings, ...old } = defaultPlan(2026);
    const parsed = PlanSchema.parse(old);
    expect(parsed.goals).toEqual([]);
    expect(parsed.savings).toEqual([]);
    expect(goals.length + savings.length).toBe(0);
  });

  it('checks goals and steps', () => {
    expect(parse({ goals: [goal('a', null)], savings: [step(2026, 1, { a: 100 })] }).success).toBe(true);
    expect(parse({ goals: [goal('a', null)], savings: [step(2026, 1, { b: 100 })] }).success).toBe(false);
    expect(parse({ goals: [goal('a', null), goal('b', null, { accountId: 'a' })] }).success).toBe(false);
    expect(parse({ goals: [goal('a', null), goal('a', null, { accountId: 'x' })] }).success).toBe(false);
    expect(parse({ goals: [goal('a', null)], savings: [step(2026, 5, { a: 1 }), step(2026, 5, { a: 2 })] }).success).toBe(false);
  });
});

describe('loan goals', () => {
  const loan = (rate = 0): Loan => ({
    id: 'm',
    name: 'Mortgage',
    balance: 100_000,
    rate,
    monthlyPayment: annuityPayment(100_000, rate, 20),
    propertyId: null,
  });
  const loanStart = (rate = 0): StartingPoint => ({ netWorth: 10_000 - 100_000, accounts: [cashAccount(10_000)], loans: [loan(rate)] });
  const loanGoal = (overrides: Partial<LoanGoal> = {}): LoanGoal => ({
    kind: 'loan',
    id: 'loan',
    name: 'Mortgage',
    loanId: 'm',
    effect: 'term',
    fee: 0,
    prepay: { kind: 'monthly' },
    end: null,
    ...overrides,
  });
  const withGoal = (g: LoanGoal, amount = 1_000) => plan({ goals: [g], savings: [step(2026, 1, { loan: amount })] });

  it('monthly prepayments with reducir plazo: the month it is repaid is the hand-computed one', () => {
    // At 0 %: 416.67 € of payment and 1 000 € of prepayment a month; 70 months leave 416.67 €,
    // which the 71st payment repays — November 2031.
    const r = runPlan(withGoal(loanGoal()), loanStart(), 'individual', undefined, 1);
    expect(r.goalsReached.loan).toEqual({ year: 2031, month: 11 });
    const [jan, feb] = r.months;
    expect(jan.goals.loan).toMatchObject({ saved: 1_000, prepaid: 1_000, interest: 0 });
    expect(jan.goals.loan.payment).toBeCloseTo(100_000 / 240, 9);
    expect(feb.goals.loan.payment).toBeCloseTo(100_000 / 240, 9);
    expect(jan.goals.loan.balance).toBeCloseTo(100_000 - 100_000 / 240 - 1_000, 6);
    const y2031 = r.rows.find((x) => x.year === 2031)!;
    expect(y2031.loanBalance).toBe(0);
    // Once repaid, the goal's amount goes to cash.
    expect(r.rows.find((x) => x.year === 2032)!.savings!.toCash).toBe(12_000);
  });

  it('reducir cuota lowers the payment from the next month and pays more interest than plazo', () => {
    const cuota = runPlan(withGoal(loanGoal({ effect: 'payment' })), loanStart(0.03), 'individual', undefined, 1);
    const plazo = runPlan(withGoal(loanGoal()), loanStart(0.03), 'individual', undefined, 1);
    const [jan, feb, mar] = cuota.months.map((m) => m.goals.loan.payment!);
    expect(feb).toBeLessThan(jan - 3);
    expect(mar).toBeLessThan(feb);
    expect(plazo.months[1].goals.loan.payment).toBeCloseTo(plazo.months[0].goals.loan.payment!, 9);
    const interest = (r: typeof cuota) => r.rows.reduce((s, x) => s + (x.savings!.goals.loan.interest ?? 0), 0);
    expect(interest(cuota)).toBeGreaterThan(interest(plazo));
    const month = (x: Reached) => x.year * 12 + x.month;
    expect(month(cuota.goalsReached.loan)).toBeGreaterThan(month(plazo.goalsReached.loan));
  });

  it('prepays what it holds once it reaches the threshold', () => {
    const r = runPlan(withGoal(loanGoal({ prepay: { kind: 'threshold', amount: 5_000 } })), loanStart(), 'individual', undefined, 1);
    expect(r.months.map((m) => m.goals.loan.prepaid)).toEqual([0, 0, 0, 0, 5_000, 0, 0, 0, 0, 5_000, 0, 0]);
    expect(r.months.map((m) => m.goals.loan.held)).toEqual([1_000, 2_000, 3_000, 4_000, 0, 1_000, 2_000, 3_000, 4_000, 0, 1_000, 2_000]);
    // The held money is cash in the balances.
    expect(r.rows[0].realEstate.loanPrepaid).toBe(10_000);
    expect(r.rows[0].withdrawals.cash).toBe(10_000);
  });

  it('prepays in the chosen months of every year', () => {
    const r = runPlan(withGoal(loanGoal({ prepay: { kind: 'months', months: [6, 12] } })), loanStart(), 'individual', undefined, 2);
    const prepaid = r.months.map((m) => m.goals.loan.prepaid);
    expect(prepaid.filter((x) => x! > 0)).toEqual([6_000, 6_000, 6_000, 6_000]);
    expect(prepaid[5]).toBe(6_000);
    expect(prepaid[11]).toBe(6_000);
  });

  it('the fee is paid on top out of the goal’s money', () => {
    const r = runPlan(withGoal(loanGoal({ fee: 0.01 })), loanStart(), 'individual', undefined, 1);
    expect(r.months[0].goals.loan.prepaid).toBeCloseTo(1_000 / 1.01, 9);
    expect(r.rows[0].realEstate.prepaymentFees).toBeCloseTo((12 * 1_000 * 0.01) / 1.01, 6);
  });

  it('paid month by month with no savings, a loan follows its schedule', () => {
    const without = runPlan(plan(), loanStart(0.03)).rows;
    const r = runPlan(withGoal(loanGoal(), 0), loanStart(0.03)).rows;
    r.forEach((row, i) => {
      expect(row.loanBalance).toBeCloseTo(without[i].loanBalance, 6);
      expect(row.realEstate.loanInterest).toBeCloseTo(without[i].realEstate.loanInterest, 6);
      expect(row.netWorth).toBeCloseTo(without[i].netWorth, 4);
    });
    expect(r[0].savings!.goals.loan.interest).toBeCloseTo(r[0].realEstate.loanInterest, 9);
  });

  it('a mortgage of a later purchase is prepaid only once it exists', () => {
    const p = plan({
      propertyPurchases: [
        {
          id: 'flat',
          name: 'Flat',
          timing: { kind: 'year', year: 2027 },
          price: 100_000,
          newBuild: false,
          habitual: true,
          owner: 0,
          ibi: 0,
          mortgage: { amount: 80_000, rate: 0.03, years: 25 },
        },
      ],
      goals: [loanGoal({ loanId: 'mortgage:flat' }), goal('fund', null)],
      savings: [step(2026, 1, { loan: 500, fund: 500 })],
    });
    const r = runPlan(p, start(), 'individual', undefined, 3);
    expect(r.rows[0].savings!.goals.fund.saved).toBe(12_000);
    expect(r.rows[1].savings!.goals.loan.saved).toBe(0);
    expect(r.rows[2].savings!.goals.loan.saved).toBe(6_000);
    expect(r.rows[2].realEstate.loanPrepaid).toBe(6_000);
  });
});

describe('down payment and purchase', () => {
  const flat = (overrides: Partial<PropertyPurchase> = {}): PropertyPurchase => ({
    id: 'flat',
    name: 'Flat',
    timing: { kind: 'year', year: 2028 },
    month: 6,
    price: 100_000,
    costs: { kind: 'percent', rate: 0.01 },
    newBuild: false,
    habitual: true,
    owner: 0,
    ibi: 0,
    mortgage: { amount: 80_000, rate: 0.03, years: 25 },
    ...overrides,
  });
  const downPaymentGoal = goal('cushion', null, { target: { kind: 'purchase', purchaseId: 'flat' } });
  const withPurchase = (pp: PropertyPurchase) =>
    plan({ propertyPurchases: [pp], goals: [downPaymentGoal], savings: [step(2026, 1, { cushion: 1_500 })] });

  it('is the price less the mortgage, plus the purchase tax and the costs', () => {
    const inmuebles = rulesForYear(2026).inmuebles;
    const a = purchaseAmounts(flat({ price: 200_000, costs: { kind: 'percent', rate: 0.015 }, mortgage: { amount: 160_000, rate: 0.03, years: 25 } }), inmuebles, 1);
    expect(a).toEqual({ price: 200_000, tax: 200_000 * inmuebles.itp.general, fees: 3_000, mortgage: 160_000 });
    expect(downPayment(a)).toBeCloseTo(200_000 + 200_000 * inmuebles.itp.general + 3_000 - 160_000, 9);
    const b = purchaseAmounts(flat({ costs: { kind: 'amount', amount: 2_500 }, mortgage: null }), inmuebles, 1.05);
    expect(b.fees).toBeCloseTo(2_625, 9);
    expect(b.mortgage).toBe(0);
  });

  it('a goal saves up to it, pays it in the purchase month and ends', () => {
    // 100 000 + 9 % ITP + 1 % costs − 80 000 = 30 000: twenty months of 1 500 € — August 2027.
    const r = runPlan(withPurchase(flat()), start(), 'individual', undefined, 3);
    expect(r.goalsReached.cushion).toEqual({ year: 2027, month: 8 });
    expect(r.downPayments).toEqual([{ goalId: 'cushion', year: 2028, month: 6, needed: 30_000, paid: 30_000 }]);
    const june = r.months.find((m) => m.year === 2028 && m.month === 6)!;
    expect(june.fromGoals).toBe(30_000);
    expect(june.goals.cushion.balance).toBeCloseTo(0, 9);
    // Ended with the purchase: its savings go to cash.
    expect(june.toCash).toBe(1_500);
    const [, , y2028] = r.rows;
    expect(y2028.withdrawals.cash).toBe(30_000);
    expect(y2028.realEstate.purchaseFees).toBe(1_000);
  });

  it('bought before the goal is ready, the goal pays what it has and the rest comes from cash', () => {
    const r = runPlan(withPurchase(flat({ timing: { kind: 'year', year: 2027 }, month: 3 })), start(), 'individual', undefined, 2);
    // Fourteen months of 1 500 €, the purchase month's savings come after it.
    expect(r.downPayments).toEqual([{ goalId: 'cushion', year: 2027, month: 3, needed: 30_000, paid: 21_000 }]);
    expect(r.goalsReached.cushion).toBeUndefined();
  });

  it('a mortgage bought in a month is paid from the next one; without a month — from the next year', () => {
    const inMonth = runPlan(plan({ propertyPurchases: [flat()] }), start()).rows;
    const atEnd = runPlan(plan({ propertyPurchases: [flat({ month: undefined })] }), start()).rows;
    const payment = annuityPayment(80_000, 0.03, 25);
    const y2028 = (rows: typeof inMonth) => rows.find((r) => r.year === 2028)!.realEstate;
    expect(y2028(inMonth).loanInterest + y2028(inMonth).loanPrincipal).toBeCloseTo(6 * payment, 6);
    expect(y2028(atEnd).loanInterest).toBe(0);
    expect(y2028(atEnd).loanPrincipal).toBe(0);
  });

  it('the plan names the purchase a goal saves for', () => {
    const p = { ...defaultPlan(2026), goals: [downPaymentGoal] };
    expect(PlanSchema.safeParse(p).success).toBe(false);
    expect(PlanSchema.safeParse({ ...p, propertyPurchases: [flat()] }).success).toBe(true);
  });
});
