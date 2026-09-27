// Cash flow of every year adds up: sources = uses, and the net worth change is explained by
// money put into and taken out of accounts plus market growth.
import { describe, expect, it } from 'vitest';
import { runPlan, totalOf, type LedgerRow, type StartingPoint } from '../engine/run-plan';
import { cashAccount, investAccount, ZERO_RETURNS } from '../engine/test-helpers';
import { defaultPlan, type Plan } from '../model/plan';
import { yearFlows } from './cashflow';

const sum = (xs: { value: number }[]) => xs.reduce((s, x) => s + x.value, 0);

function expectBalanced(rows: LedgerRow[], start: StartingPoint) {
  rows.forEach((r, i) => {
    const f = yearFlows(r);
    const sources = sum(f.sources);
    // Sources = uses: income + withdrawals + shortfall = taxes + spending + deposits.
    expect(sum(f.uses)).toBeCloseTo(sources, 4);
    // Net worth change = deposits − withdrawals − shortfall + market growth, plus what real estate
    // and loans changed outside cash: appreciation, homes bought and sold, debt paid and taken.
    const before = i === 0 ? start.netWorth : rows[i - 1].netWorth;
    const owedBefore = i === 0 ? 0 : rows[i - 1].taxOwed;
    const re = r.realEstate;
    const explained =
      totalOf(r.deposits) -
      totalOf(r.withdrawals) -
      r.shortfall +
      r.marketGrowth +
      re.growth +
      re.purchaseCost -
      re.saleValue +
      re.loanPrincipal +
      re.loanPrepaid +
      re.loanRepaidAtSale -
      re.newLoans -
      (r.taxOwed - owedBefore);
    expect(r.netWorth - before).toBeCloseTo(explained, 4);
  });
}

const RETURNS: Plan['returns'] = {
  cashInterest: 0.01,
  fundGrowth: 0.05,
  brokerageGrowth: 0.04,
  brokerageYield: 0.02,
  pensionGrowth: 0.04,
  propertyGrowth: 0.03,
};

describe('cash flow of a year', () => {
  it('adds up over a whole life: saving, then drawing down with gains and pension payouts', () => {
    const start: StartingPoint = {
      netWorth: 120_000,
      accounts: [
        cashAccount(20_000),
        investAccount('fund', 'fund', 10, 3_000, 20_000),
        investAccount('broker', 'brokerage', 20, 1_000, 12_000),
        investAccount('ppi', 'ppi', 1, 30_000, 30_000),
      ],
    };
    const p: Plan = {
      ...defaultPlan(2026),
      returns: RETURNS,
      flows: [
        { accountId: 'ppi', mode: 'max', amount: 0 },
        { accountId: 'fund', mode: 'percent', amount: 0.5 },
      ],
      expenses: [
        ...defaultPlan(2026).expenses,
        {
          name: 'Travel',
          amount: 25_000,
          kind: 'discretionary',
          start: { kind: 'milestone', id: 'retirement' },
          end: null,
        },
      ],
    };
    const rows = runPlan(p, start).rows;
    expect(rows.some((r) => totalOf(r.deposits) > 0)).toBe(true);
    expect(rows.some((r) => r.withdrawals.fund > 0 && r.realizedGains > 0)).toBe(true);
    expect(rows.some((r) => r.withdrawals.pension > 0)).toBe(true);
    expectBalanced(rows, start);
  });

  it('adds up when a sale at a loss lowers the tax', () => {
    // Interest is taxed in the savings base; the fund (bought for 30,000, worth 10,000) is sold
    // first at a loss, which offsets up to 25 % of the interest — the tax falls below the
    // amount already raised for it.
    const start: StartingPoint = {
      netWorth: 510_000,
      accounts: [cashAccount(500_000), investAccount('fund', 'fund', 10, 1_000, 30_000)],
    };
    const p: Plan = {
      ...defaultPlan(2026),
      returns: { ...ZERO_RETURNS, cashInterest: 0.03 },
      milestones: [],
      people: [{ name: 'R', birthYear: 1956, disability: 'ninguna', autonomo: null, pension: null }],
      expenses: [{ name: 'Living', amount: 20_000, kind: 'essential', start: null, end: null }],
      withdrawalOrder: ['fund', 'cash'],
    };
    const rows = runPlan(p, start).rows;
    expect(rows[0].realizedGains).toBeLessThan(0);
    expect(rows[0].deposits.cash).toBeGreaterThan(0);
    expectBalanced(rows, start);
  });

  it('adds up under a Guyton–Klinger spending rule from retirement', () => {
    const start: StartingPoint = {
      netWorth: 400_000,
      accounts: [cashAccount(50_000), investAccount('broker', 'brokerage', 20, 17_500, 200_000)],
    };
    const p: Plan = {
      ...defaultPlan(2026),
      returns: RETURNS,
      spending: {
        kind: 'guytonKlinger',
        start: { kind: 'milestone', id: 'retirement' },
        rate: 0.05,
        guardrail: 0.2,
        adjustment: 0.1,
      },
    };
    const rows = runPlan(p, start).rows;
    expect(rows.some((r) => r.ruleWithdrawal !== null && r.discretionaryExpenses > 0)).toBe(true);
    expectBalanced(rows, start);
  });

  it('adds up with real estate: a second home, a loan, a home sold and a new one bought', () => {
    const home = {
      id: 'home',
      name: 'Home',
      value: 300_000,
      use: 'habitual' as const,
      owner: 'joint' as const,
      valorCatastral: 90_000,
      catastroRevisado: false,
      ibi: 700,
      acquisitionValue: 120_000,
    };
    const flat = { ...home, id: 'flat', name: 'Flat', use: 'second' as const, value: 150_000, owner: 0 as const };
    const start: StartingPoint = {
      netWorth: 60_000 + 450_000 - 80_000,
      accounts: [cashAccount(60_000)],
      properties: [home, flat],
      loans: [{ id: 'm', name: 'M', balance: 80_000, rate: 0.03, monthlyPayment: 700, propertyId: 'home' }],
    };
    const p: Plan = {
      ...defaultPlan(2026),
      returns: RETURNS,
      propertySales: [{ propertyId: 'home', timing: { kind: 'year', year: 2035 }, costs: 0.05 }],
      propertyPurchases: [
        {
          id: 'new',
          name: 'New home',
          timing: { kind: 'year', year: 2035 },
          price: 350_000,
          newBuild: true,
          habitual: true,
          owner: 'joint',
          ibi: 800,
          mortgage: { amount: 150_000, rate: 0.035, years: 20 },
        },
      ],
    };
    const rows = runPlan(p, start).rows;
    const sale = rows.find((r) => r.year === 2035)!;
    expect(sale.realEstate.saleProceeds).toBeGreaterThan(0);
    expect(sale.realEstate.newLoans).toBeGreaterThan(0);
    expect(rows.every((r) => r.realEstate.imputedRent[0] > 0)).toBe(true);
    expectBalanced(rows, start);
  });

  it('adds up when the accounts run out', () => {
    const start: StartingPoint = { netWorth: 5_000, accounts: [cashAccount(5_000)] };
    const p: Plan = {
      ...defaultPlan(2026),
      returns: ZERO_RETURNS,
      expenses: [{ name: 'Living', amount: 60_000, kind: 'essential', start: null, end: null }],
    };
    const rows = runPlan(p, start).rows;
    expect(rows[0].shortfall).toBeGreaterThan(0);
    expect(rows.at(-1)!.cash).toBeLessThan(0);
    expectBalanced(rows, start);
  });

  it('adds up with salaries, gains, tax-free income and one-time events', () => {
    const start: StartingPoint = {
      netWorth: 60_000,
      accounts: [cashAccount(20_000), investAccount('ppi', 'ppi', 1, 40_000, 40_000, 1)],
    };
    const d = defaultPlan(2026);
    const p: Plan = {
      ...d,
      returns: RETURNS,
      filing: 'joint',
      people: [
        { ...d.people[0], autonomo: { ...d.people[0].autonomo!, end: { kind: 'year', year: 2032 } } },
        { name: 'P', birthYear: 1990, disability: 'ninguna', autonomo: null, pension: null },
      ],
      incomes: [
        { name: 'Job', person: 1, tax: 'trabajo', amount: 2_500, per: 'month', start: null, end: { kind: 'age', person: 1, age: 65 } },
        { name: 'New job', person: 0, tax: 'trabajo', amount: 45_000, start: { kind: 'year', year: 2032 }, end: { kind: 'milestone', id: 'retirement' } },
        { name: 'Crypto', person: 0, tax: 'ganancia', amount: 2_000, start: null, end: { kind: 'year', year: 2030 } },
      ],
      oneTime: [
        { type: 'income', name: 'Herencia', person: 1, tax: 'exento', amount: 80_000, nominal: true, at: { kind: 'year', year: 2040 }, repeat: null },
        { type: 'expense', name: 'Car', kind: 'essential', amount: 25_000, nominal: false, at: { kind: 'year', year: 2029 }, repeat: { every: 8, until: null } },
      ],
      flows: [{ accountId: 'ppi', mode: 'max', amount: 0 }],
    };
    const rows = runPlan(p, start).rows;
    expect(rows[0].wages).toBe(30_000);
    expect(rows[0].employeeContributions).toBeGreaterThan(0);
    expect(rows.find((r) => r.year === 2040)!.exemptIncome).toBe(80_000);
    expectBalanced(rows, start);
  });

  it('adds up with loan prepayments and a variable-rate mortgage', () => {
    const start: StartingPoint = {
      netWorth: 50_000 - 120_000,
      accounts: [cashAccount(50_000)],
      loans: [
        { id: 'm', name: 'M', balance: 120_000, rate: 0.03, monthlyPayment: 700, propertyId: null, variable: { diferencial: 0.01, fromYear: null } },
      ],
    };
    const p: Plan = {
      ...defaultPlan(2026),
      returns: RETURNS,
      euribor: 0.03,
      expenses: [{ name: 'Living', amount: 10_000, kind: 'essential', start: null, end: null }],
      flows: [
        { loanId: 'm', mode: 'percent', amount: 0.5, effect: 'payment', until: { kind: 'year', year: 2035 }, fee: 0.0025 },
        { loanId: 'm', mode: 'max', amount: 0, effect: 'term', until: null, fee: 0.0015 },
      ],
    };
    const rows = runPlan(p, start).rows;
    expect(rows[0].realEstate.loanPrepaid).toBeGreaterThan(0);
    expect(rows[0].realEstate.prepaymentFees).toBeGreaterThan(0);
    expect(rows.at(-1)!.loanBalance).toBe(0);
    expectBalanced(rows, start);
  });

  it('adds up with a flat bought with a mortgage and let, and a let home sold', () => {
    const home = {
      id: 'home',
      name: 'Home',
      value: 300_000,
      use: 'habitual' as const,
      owner: 'joint' as const,
      valorCatastral: 90_000,
      catastroRevisado: false,
      ibi: 700,
      acquisitionValue: 120_000,
      community: 900,
      insurance: 250,
      constructionShare: 0.55,
    };
    const start: StartingPoint = { netWorth: 80_000 + 300_000, accounts: [cashAccount(80_000)], properties: [home] };
    const p: Plan = {
      ...defaultPlan(2026),
      returns: RETURNS,
      propertyPurchases: [
        {
          id: 'flat',
          name: 'Flat',
          timing: { kind: 'year', year: 2028 },
          price: 180_000,
          newBuild: false,
          habitual: false,
          owner: 0,
          ibi: 400,
          community: 500,
          insurance: 150,
          constructionShare: 0.6,
          mortgage: { amount: 140_000, rate: 0.03, years: 25, variable: { diferencial: 0.008, fixedYears: 5 } },
        },
      ],
      rentals: [
        { propertyId: 'purchase:flat', amount: 850, per: 'month', occupancy: 0.9, repairs: 400, reduction: 'general', start: null, end: null },
        { propertyId: 'home', amount: 1_200, per: 'month', growth: { kind: 'nominal', rate: 0 }, occupancy: 1, repairs: 800, reduction: 'joven_o_social', start: { kind: 'year', year: 2040 }, end: null },
      ],
      propertySales: [{ propertyId: 'home', timing: { kind: 'year', year: 2045 }, costs: 0.06 }],
    };
    const rows = runPlan(p, start).rows;
    expect(rows.find((r) => r.year === 2029)!.realEstate.rent).toBeGreaterThan(0);
    expect(rows.find((r) => r.year === 2045)!.realEstate.gains.some((g) => g > 0)).toBe(true);
    expectBalanced(rows, start);
  });

  it('adds up with IRPF paid the next year, a refund and a sale', () => {
    const start: StartingPoint = {
      netWorth: 70_000,
      accounts: [cashAccount(20_000), investAccount('broker', 'brokerage', 20, 2_500, 30_000)],
    };
    const p: Plan = {
      ...defaultPlan(2026),
      returns: RETURNS,
      taxPayment: 'nextYear',
      priorYearTax: -1_200,
      incomes: [{ name: 'Job', person: 0, tax: 'trabajo', amount: 12_000, start: null, end: { kind: 'year', year: 2035 } }],
      oneTime: [
        { type: 'expense', name: 'Roof', kind: 'essential', amount: 60_000, nominal: false, at: { kind: 'year', year: 2030 }, repeat: null },
      ],
    };
    const rows = runPlan(p, start).rows;
    expect(rows[0].irpfRefund).toBe(1_200);
    expect(rows.some((r) => r.taxOwed > 0)).toBe(true);
    expect(rows.some((r) => r.realizedGains !== 0)).toBe(true);
    expectBalanced(rows, start);
  });

  it('lists only non-zero flows and converts to today’s euros', () => {
    const start: StartingPoint = { netWorth: 30_000, accounts: [cashAccount(30_000)] };
    const [, second] = runPlan({ ...defaultPlan(2026), returns: ZERO_RETURNS }, start).rows;
    const f = yearFlows(second, 'today');
    expect(f.sources.map((x) => x.key)).toEqual(['revenue']);
    expect(f.uses.map((x) => x.key)).toEqual(['irpf', 'reta', 'businessExpenses', 'essential', 'toCash']);
    expect(f.sources[0].value).toBeCloseTo(second.revenue / second.deflator, 6);
  });
});
