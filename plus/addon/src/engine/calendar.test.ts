// Phase 6: the calendar of a year's money — when salaries, pensions, taxes and one-time events fall.
import { describe, expect, it } from 'vitest';
import { rulesForYear } from '../es-tax';
import { defaultPlan, type Plan } from '../model/plan';
import { EVEN, fourteenPagas, inMonth, MODELO_130, PUBLIC_PENSION, renta, salary } from './calendar';
import type { Property } from './real-estate';
import { runPlan, type StartingPoint } from './run-plan';
import { cashAccount, investAccount, ZERO_RETURNS } from './test-helpers';

const START: StartingPoint = { netWorth: 50_000, accounts: [cashAccount(50_000)] };
const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

/** One person of 40, no autónomo income, no expenses, zero returns and inflation. */
function plan(overrides: Partial<Plan> = {}): Plan {
  const d = defaultPlan(2026);
  return {
    ...d,
    returns: ZERO_RETURNS,
    inflation: 0,
    milestones: [],
    people: [{ ...d.people[0], autonomo: null, pension: null }],
    expenses: [],
    ...overrides,
  };
}

/** Free money of the months of the first year. */
const months = (p: Plan, start = START) => runPlan(p, start, p.filing, undefined, 1).months.map((m) => m.freeMoney);

describe('calendars', () => {
  it('add up to the year', () => {
    for (const c of [EVEN, fourteenPagas([6, 12]), PUBLIC_PENSION, MODELO_130, renta(false), renta(true), inMonth(3), salary(14)]) {
      expect(sum(c)).toBeCloseTo(1, 12);
      expect(c).toHaveLength(12);
    }
  });
});

describe('the months of a year', () => {
  it('a salary in 14 pagas pays extra in June and December', () => {
    const m = months(plan({ incomes: [{ name: 'Job', person: 0, tax: 'trabajo', amount: 28_000, pagas: 14, start: null, end: null }] }));
    expect(m[5] - m[4]).toBeCloseTo(2_000, 9);
    expect(m[11] - m[10]).toBeCloseTo(2_000, 9);
    expect(m[0]).toBeCloseTo(m[4], 9);
  });

  it('a Seguridad Social pension pays extra in June and November', () => {
    const d = defaultPlan(2026);
    const p = plan({ people: [{ ...d.people[0], autonomo: null, pension: { amount: 14_000, start: { kind: 'year', year: 2026 } } }] });
    const m = months(p);
    expect(m[5] - m[4]).toBeCloseTo(1_000, 9);
    expect(m[10] - m[9]).toBeCloseTo(1_000, 9);
    expect(m[11]).toBeCloseTo(m[0], 9);
  });

  it('modelo 130 is paid in April, July, October and December; the renta in June or 60/40 with November', () => {
    const d = defaultPlan(2026);
    const autonomo = plan({ people: [d.people[0]], taxPayment: 'nextYear', priorYearTax: 2_000 });
    const [row] = runPlan(autonomo, START).rows;
    const pagos130 = rulesForYear(2026).actividad.pago_fraccionado * row.people[0].rendimientoNeto;
    const m = months(autonomo);
    expect(m[2] - m[3]).toBeCloseTo(pagos130 / 4, 6);
    expect(m[5] - m[4]).toBeCloseTo(-2_000, 6);
    expect(m[11] - m[10]).toBeCloseTo(-pagos130 / 4, 6);
    const split = months({ ...autonomo, renta: 'split' });
    expect(split[5] - split[4]).toBeCloseTo(-1_200, 6);
    expect(split[10] - split[8]).toBeCloseTo(-800, 6);
    // A refund comes in June.
    const refund = months({ ...autonomo, priorYearTax: -500 });
    expect(refund[5] - refund[4]).toBeCloseTo(500, 6);
  });

  it('one-time events fall in their month, or over the year without one', () => {
    const p = plan({
      incomes: [{ name: 'Job', person: 0, tax: 'trabajo', amount: 36_000, start: null, end: null }],
      oneTime: [
        { type: 'expense', name: 'Car', kind: 'essential', amount: 9_000, nominal: true, at: { kind: 'year', year: 2026 }, month: 3, repeat: null },
        { type: 'income', name: 'Gift', person: 0, tax: 'exento', amount: 1_200, nominal: true, at: { kind: 'year', year: 2026 }, repeat: null },
      ],
    });
    const m = months(p);
    expect(m[1] - m[2]).toBeCloseTo(9_000, 9);
    expect(m[0]).toBeCloseTo(m[1], 9);
  });

  it('IBI and insurance fall in their months, the purchase of the year in December', () => {
    const home: Property = {
      id: 'home',
      name: 'Home',
      value: 200_000,
      use: 'habitual',
      owner: 0,
      valorCatastral: 80_000,
      catastroRevisado: false,
      ibi: 600,
      acquisitionValue: 150_000,
      community: 1_200,
      insurance: 300,
      ibiMonth: 9,
      insuranceMonth: 2,
    };
    const p = plan({
      propertyPurchases: [
        { id: 'flat', name: 'Flat', timing: { kind: 'year', year: 2026 }, price: 100_000, newBuild: false, habitual: false, owner: 0, ibi: 0, mortgage: { amount: 70_000, rate: 0.03, years: 20 } },
      ],
    });
    const m = months(p, { netWorth: 250_000, accounts: [cashAccount(50_000)], properties: [home] });
    expect(m[7] - m[8]).toBeCloseTo(600, 9);
    expect(m[0] - m[1]).toBeCloseTo(300, 9);
    expect(m[0]).toBeCloseTo(-100, 9);
    expect(m[10] - m[11]).toBeCloseTo(100_000 * 1.09 - 70_000, 6);
  });

  it('every year the months add up to it: salaries, pensions, renta, real estate, sales, deficits', () => {
    const d = defaultPlan(2026);
    const home: Property = {
      id: 'home',
      name: 'Home',
      value: 300_000,
      use: 'second',
      owner: 'joint',
      valorCatastral: 90_000,
      catastroRevisado: false,
      ibi: 700,
      acquisitionValue: 120_000,
      community: 900,
      insurance: 250,
      ibiMonth: 10,
      insuranceMonth: 4,
      constructionShare: 0.5,
    };
    const start: StartingPoint = {
      netWorth: 10_000 + 300_000 + 40_000 - 100_000,
      accounts: [cashAccount(10_000), investAccount('fund', 'fund', 10, 4_000, 30_000)],
      properties: [home],
      loans: [{ id: 'm', name: 'M', balance: 100_000, rate: 0.03, monthlyPayment: 650, propertyId: 'home' }],
    };
    const p: Plan = {
      ...d,
      returns: { ...ZERO_RETURNS, cashInterest: 0.01, fundGrowth: 0.05, propertyGrowth: 0.02 },
      filing: 'joint',
      taxPayment: 'nextYear',
      renta: 'split',
      priorYearTax: 800,
      people: [d.people[0], { name: 'P', birthYear: 1985, disability: 'ninguna', autonomo: null, pension: { amount: 12_000, start: { kind: 'age', person: 1, age: 67 } } }],
      incomes: [{ name: 'Job', person: 1, tax: 'trabajo', amount: 30_000, pagas: 14, start: null, end: { kind: 'year', year: 2045 } }],
      oneTime: [
        { type: 'expense', name: 'Roof', kind: 'essential', amount: 90_000, nominal: false, at: { kind: 'year', year: 2030 }, month: 5, repeat: { every: 10, until: null } },
      ],
      rentals: [{ propertyId: 'home', amount: 900, per: 'month', occupancy: 0.9, repairs: 500, reduction: 'general', start: { kind: 'year', year: 2028 }, end: null }],
      propertySales: [{ propertyId: 'home', timing: { kind: 'year', year: 2040 }, costs: 0.05 }],
      flows: [{ accountId: 'fund', mode: 'percent', amount: 0.5 }],
    };
    const r = runPlan(p, start, p.filing, undefined, 70);
    // Keeping the months does not change the plan.
    expect(r.rows).toEqual(runPlan(p, start).rows);
    r.rows.forEach((row, y) => {
      const year = r.months.slice(12 * y, 12 * y + 12);
      expect(year.every((m) => m.year === row.year)).toBe(true);
      expect(sum(year.map((m) => m.freeMoney))).toBeCloseTo(row.netCashFlow, 6);
    });
    expect(r.rows.some((row) => row.withdrawals.fund > 0)).toBe(true);
  });
});
