// Phase 5: loans by term, prepayments (reducir plazo / cuota) and variable or mixed rates.
import { describe, expect, it } from 'vitest';
import { buildStart, type LoadedPortfolio } from '../lib/starting-point';
import { defaultPlan, type Plan, type PrepayFlow, type PropertyPurchase } from '../model/plan';
import { constantPath } from './market';
import { annuityPayment, monthsToRepay, type Loan } from './real-estate';
import { endYear, runPlan, type LedgerRow, type StartingPoint } from './run-plan';
import { cashAccount, ZERO_RETURNS } from './test-helpers';

const loan = (overrides: Partial<Loan> = {}): Loan => ({
  id: 'm',
  name: 'Mortgage',
  balance: 100_000,
  rate: 0.03,
  monthlyPayment: annuityPayment(100_000, 0.03, 20),
  propertyId: null,
  ...overrides,
});

const start = (loans: Loan[]): StartingPoint => {
  const cash = 1_000_000;
  return { netWorth: cash - loans.reduce((s, l) => s + l.balance, 0), accounts: [cashAccount(cash)], loans };
};

/** One person earning 60 000 € a year with no expenses: every year has a surplus. */
function plan(overrides: Partial<Plan> = {}): Plan {
  const d = defaultPlan(2026);
  return {
    ...d,
    returns: ZERO_RETURNS,
    inflation: 0,
    milestones: [],
    people: [{ name: 'P', birthYear: 1980, disability: 'ninguna', autonomo: null, pension: null }],
    incomes: [{ name: 'Salary', person: 0, tax: 'trabajo', amount: 60_000, start: null, end: null }],
    expenses: [],
    ...overrides,
  };
}

const prepay = (overrides: Partial<PrepayFlow> = {}): PrepayFlow => ({
  loanId: 'm',
  mode: 'fixed',
  amount: 10_000,
  effect: 'term',
  until: { kind: 'year', year: 2029 },
  fee: 0,
  ...overrides,
});

const payments = (r: LedgerRow) => r.realEstate.loanInterest + r.realEstate.loanPrincipal;
/** First year that ends with the loan repaid. */
const repaidIn = (rows: LedgerRow[]) => rows.find((r) => r.loanBalance < 1e-6)?.year;

describe('term instead of payment', () => {
  it('a Wealthfolio loan with the years left is an annuity over them', () => {
    const portfolio: LoadedPortfolio = {
      netWorth: 0,
      currency: 'EUR',
      exact: true,
      accounts: [],
      alternatives: [
        { id: 'L', kind: 'LIABILITY', name: 'Mortgage', marketValue: '100000', metadata: { interest_rate: '3' } },
      ] as unknown as LoadedPortfolio['alternatives'],
    };
    const s = buildStart(portfolio, {}, { properties: {}, loans: { L: { monthlyPayment: 0, years: 20 } } });
    expect(s.loans![0].monthlyPayment).toBeCloseTo(annuityPayment(100_000, 0.03, 20), 9);
    const rows = runPlan(plan(), { ...s, accounts: [cashAccount(0)] }).rows;
    expect(repaidIn(rows)).toBe(2045);
  });

  it('months to repay inverts the annuity', () => {
    expect(monthsToRepay(100_000, 0.03, annuityPayment(100_000, 0.03, 20))).toBeCloseTo(240, 9);
    expect(monthsToRepay(100_000, 0, 1_000)).toBe(100);
    expect(monthsToRepay(100_000, 0.12, 900)).toBe(Infinity);
  });
});

describe('prepayment', () => {
  const without = runPlan(plan(), start([loan()])).rows;

  it('reducir plazo keeps the payment and ends the loan sooner', () => {
    const rows = runPlan(plan({ flows: [prepay()] }), start([loan()])).rows;
    expect(rows.slice(0, 3).map((r) => r.realEstate.loanPrepaid)).toEqual([10_000, 10_000, 10_000]);
    expect(rows[3].realEstate.loanPrepaid).toBe(0);
    expect(payments(rows[5])).toBeCloseTo(payments(without[5]), 6);
    expect(repaidIn(without)).toBe(2045);
    expect(repaidIn(rows)!).toBeLessThan(2042);
  });

  it('reducir cuota lowers the payment and keeps the end', () => {
    const rows = runPlan(plan({ flows: [prepay({ effect: 'payment' })] }), start([loan()])).rows;
    expect(payments(rows[5])).toBeLessThan(payments(without[5]) - 1_000);
    expect(repaidIn(rows)).toBe(2045);
  });

  it('max repays the whole loan from the surplus; the fee is spending', () => {
    const rows = runPlan(plan({ flows: [prepay({ mode: 'max', until: null, fee: 0.01 })] }), start([loan()])).rows;
    const [first] = rows;
    const prepaid = first.realEstate.loanPrepaid;
    expect(prepaid).toBeGreaterThan(0);
    expect(first.realEstate.prepaymentFees).toBeCloseTo(prepaid * 0.01, 9);
    // The whole surplus goes to the loan and its fee; nothing is left for cash.
    expect(prepaid * 1.01).toBeCloseTo(first.netCashFlow, 6);
    expect(first.deposits.cash).toBeCloseTo(0, 6);
    expect(repaidIn(rows)).toBe(2028);
  });

  it('of a purchase mortgage starts once it exists', () => {
    const purchase: PropertyPurchase = {
      id: 'flat',
      name: 'Flat',
      timing: { kind: 'year', year: 2030 },
      price: 200_000,
      newBuild: false,
      habitual: true,
      owner: 0,
      ibi: 0,
      mortgage: { amount: 150_000, rate: 0.03, years: 25 },
    };
    const p = plan({ propertyPurchases: [purchase], flows: [prepay({ loanId: 'mortgage:flat', until: null })] });
    const rows = runPlan(p, start([])).rows;
    // The down payment and ITP of 2030 leave no surplus that year: the first prepayment is in 2031.
    expect(rows.find((r) => r.year === 2030)!.shortfall + rows.find((r) => r.year === 2030)!.withdrawals.cash).toBeGreaterThan(0);
    expect(rows.filter((r) => r.realEstate.loanPrepaid > 0)[0].year).toBe(2031);
  });
});

describe('variable and mixed rates', () => {
  it('Euríbor + diferencial equal to the fixed rate gives the same schedule', () => {
    const fixed = runPlan(plan(), start([loan()])).rows;
    const variable = runPlan(
      plan({ euribor: 0.02 }),
      start([loan({ variable: { diferencial: 0.01, fromYear: null } })]),
    ).rows;
    variable.forEach((r, i) => expect(r.loanBalance).toBeCloseTo(fixed[i].loanBalance, 4));
  });

  it('a revision keeps the months left: the loan still ends on time', () => {
    const p = plan({ euribor: 0.04 });
    const years = endYear(p) - p.startYear + 1;
    // Monte Carlo: Euríbor moves with the cash return of the year.
    const path = constantPath(p, years).map((y, t) => ({ ...y, cashInterest: [0, 0.03, -0.02, 0.05][t % 4] }));
    const rows = runPlan(p, start([loan({ variable: { diferencial: 0.01, fromYear: null } })]), p.filing, path).rows;
    expect(payments(rows[0])).toBeCloseTo(12 * annuityPayment(100_000, 0.03, 20), 6);
    expect(payments(rows[1])).not.toBeCloseTo(payments(rows[0]), 0);
    expect(repaidIn(rows)).toBe(2045);
  });

  it('the rate is never negative', () => {
    const rows = runPlan(
      plan({ euribor: -0.03 }),
      start([loan({ variable: { diferencial: 0.01, fromYear: 2027 } })]),
    ).rows;
    expect(rows[1].realEstate.loanInterest).toBe(0);
  });

  it('a mixed mortgage pays the fixed rate first, then Euríbor + diferencial', () => {
    const mortgage = (variable?: { diferencial: number; fixedYears: number }) => ({
      id: 'flat',
      name: 'Flat',
      timing: { kind: 'year', year: 2026 },
      price: 200_000,
      newBuild: false,
      habitual: true,
      owner: 0,
      ibi: 0,
      mortgage: { amount: 150_000, rate: 0.02, years: 25, ...(variable ? { variable } : {}) },
    }) as PropertyPurchase;
    const fixed = runPlan(plan({ euribor: 0.03, propertyPurchases: [mortgage()] }), start([])).rows;
    const mixed = runPlan(
      plan({ euribor: 0.03, propertyPurchases: [mortgage({ diferencial: 0.01, fixedYears: 5 })] }),
      start([]),
    ).rows;
    const variable = runPlan(
      plan({ euribor: 0.03, propertyPurchases: [mortgage({ diferencial: 0.01, fixedYears: 0 })] }),
      start([]),
    ).rows;
    // Payments from 2027: five fixed years, then at 4 %.
    for (let t = 1; t <= 5; t++) expect(payments(mixed[t])).toBeCloseTo(payments(fixed[t]), 6);
    expect(payments(mixed[6])).toBeGreaterThan(payments(fixed[6]) + 100);
    expect(payments(variable[1])).toBeCloseTo(12 * annuityPayment(150_000, 0.04, 25), 6);
    expect(repaidIn(mixed)).toBe(2051);
  });
});
