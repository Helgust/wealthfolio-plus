// Phase 3: real estate and loans — growth, IBI, imputación, loan annuities, sales with the
// vivienda habitual exemption, purchases with ITP or IVA + AJD.
import { describe, expect, it } from 'vitest';
import { irpfAnual, minimoPersonalFamiliar, rulesForYear, total } from '../es-tax';
import { defaultPlan, type Plan, type PropertyPurchase } from '../model/plan';
import { annuityPayment, type Loan, type Property } from './real-estate';
import { runPlan, type StartingPoint } from './run-plan';
import { cashAccount, ZERO_RETURNS } from './test-helpers';

const property = (overrides: Partial<Property> = {}): Property => ({
  id: 'home',
  name: 'Home',
  value: 300_000,
  use: 'habitual',
  owner: 0,
  valorCatastral: null,
  catastroRevisado: false,
  ibi: 0,
  acquisitionValue: 150_000,
  ...overrides,
});

const loan = (overrides: Partial<Loan> = {}): Loan => ({
  id: 'mortgage',
  name: 'Mortgage',
  balance: 50_000,
  rate: 0.03,
  monthlyPayment: 1_000,
  propertyId: 'home',
  ...overrides,
});

function start(properties: Property[], loans: Loan[] = []): StartingPoint {
  const cash = 1_000_000;
  return {
    netWorth: cash + properties.reduce((s, p) => s + p.value, 0) - loans.reduce((s, l) => s + l.balance, 0),
    accounts: [cashAccount(cash)],
    properties,
    loans,
  };
}

/** One person with no income, zero returns and inflation; born in birthYear. */
function person(birthYear: number, overrides: Partial<Plan> = {}): Plan {
  return {
    ...defaultPlan(2026),
    returns: ZERO_RETURNS,
    inflation: 0,
    milestones: [],
    people: [{ name: 'P', birthYear, disability: 'ninguna', autonomo: null, pension: null }],
    expenses: [{ name: 'Living', amount: 10_000, kind: 'essential', start: null, end: null }],
    ...overrides,
  };
}

const newHome = (overrides: Partial<PropertyPurchase> = {}): PropertyPurchase => ({
  id: 'new',
  name: 'New home',
  timing: { kind: 'year', year: 2026 },
  price: 400_000,
  newBuild: false,
  habitual: true,
  owner: 0,
  ibi: 600,
  mortgage: null,
  ...overrides,
});

const sellHome = (year = 2026) => ({ propertyId: 'home', timing: { kind: 'year', year } as const, costs: 0 });

describe('real estate over the years', () => {
  it('grows, pays IBI, and a second home imputes 2 % of its valor catastral to the general base', () => {
    const p = person(1956, { returns: { ...ZERO_RETURNS, propertyGrowth: 0.03 } });
    const second = property({ id: 'flat', use: 'second', valorCatastral: 100_000, ibi: 500, value: 200_000 });
    const [row] = runPlan(p, start([second])).rows;
    expect(row.propertyValue).toBeCloseTo(206_000, 6);
    expect(row.realEstate.growth).toBeCloseTo(6_000, 6);
    expect(row.realEstate.ibi).toBeCloseTo(500, 6);
    expect(row.realEstate.imputedRent).toEqual([2_000]);
    const rules = rulesForYear(2026);
    const irpf = irpfAnual(rules, minimoPersonalFamiliar({ edad: 70, discapacidad: 'ninguna', asistencia: false }, rules), {
      otras_rentas_general: 2_000,
    });
    expect(row.irpf).toBeCloseTo(total(irpf.cuota_liquida), 6);
    // The vivienda habitual imputes nothing.
    const [home] = runPlan(p, start([property({ ibi: 500 })])).rows;
    expect(home.realEstate.imputedRent).toEqual([0]);
  });

  it('pays a loan as an annuity', () => {
    const payment = annuityPayment(100_000, 0.03, 20);
    const l = loan({ balance: 100_000, monthlyPayment: payment });
    const [row] = runPlan(person(1976), start([property()], [l])).rows;
    let balance = 100_000;
    for (let m = 0; m < 12; m++) balance -= payment - (balance * 0.03) / 12;
    expect(row.loanBalance).toBeCloseTo(balance, 6);
    expect(row.realEstate.loanInterest + row.realEstate.loanPrincipal).toBeCloseTo(12 * payment, 6);
    // Principal moves money from cash to equity; only the interest and the expenses cost net worth.
    expect(row.netWorth).toBeCloseTo(1_000_000 + 300_000 - 100_000 - 10_000 - row.realEstate.loanInterest, 6);
  });
});

describe('selling the vivienda habitual', () => {
  it('with reinvestment the gain does not reach the savings base', () => {
    const p = person(1976, { propertySales: [sellHome()], propertyPurchases: [newHome()] });
    const [row] = runPlan(p, start([property()], [loan()])).rows;
    const re = row.realEstate;
    expect(re.saleProceeds).toBe(300_000);
    expect(re.loanRepaidAtSale).toBeGreaterThan(0);
    expect(re.exemptGains).toBeCloseTo(150_000, 6);
    expect(re.gains).toEqual([0]);
    expect(row.baseLiquidableAhorro).toBe(0);
    // Second-hand home in 2026: ITP 9 %.
    expect(re.purchaseTax).toBeCloseTo(36_000, 6);
    expect(row.propertyValue).toBe(400_000);
    expect(row.loanBalance).toBe(0);
  });

  it('partial reinvestment leaves the proportional gain taxable', () => {
    const p = person(1976, { propertySales: [sellHome()], propertyPurchases: [newHome({ price: 150_000 })] });
    const [row] = runPlan(p, start([property()])).rows;
    // 150,000 of the 300,000 obtained reinvested: half of the 150,000 gain is exempt.
    expect(row.realEstate.exemptGains).toBeCloseTo(75_000, 6);
    expect(row.realEstate.gains[0]).toBeCloseTo(75_000, 6);
    expect(row.baseLiquidableAhorro).toBeCloseTo(75_000, 6);
  });

  it('a purchase up to two years later counts; three years later does not', () => {
    const later = (year: number) =>
      runPlan(
        person(1976, {
          propertySales: [sellHome()],
          propertyPurchases: [newHome({ timing: { kind: 'year', year } })],
        }),
        start([property()]),
      ).rows[0].realEstate.gains[0];
    expect(later(2028)).toBe(0);
    expect(later(2029)).toBeCloseTo(150_000, 6);
  });

  it('from 65 the gain is exempt without reinvestment', () => {
    const p = person(1956, { propertySales: [sellHome()] });
    const [row] = runPlan(p, start([property()])).rows;
    expect(row.realEstate.gains).toEqual([0]);
    expect(row.realEstate.exemptGains).toBeCloseTo(150_000, 6);
  });

  it('a second home pays tax on the whole gain', () => {
    const p = person(1956, { propertySales: [{ ...sellHome(), propertyId: 'flat' }] });
    const flat = property({ id: 'flat', use: 'second', valorCatastral: 100_000 });
    const [row] = runPlan(p, start([flat])).rows;
    expect(row.realEstate.gains[0]).toBeCloseTo(150_000, 6);
    expect(row.baseLiquidableAhorro).toBeCloseTo(150_000, 6);
  });
});

describe('buying a home', () => {
  it('a new one pays IVA and AJD; the mortgage is paid from the next year', () => {
    const p = person(1976, {
      propertyPurchases: [newHome({ newBuild: true, mortgage: { amount: 300_000, rate: 0.03, years: 25 } })],
    });
    const rows = runPlan(p, start([])).rows;
    expect(rows[0].realEstate.purchaseTax).toBeCloseTo(400_000 * (0.1 + 0.001), 6);
    expect(rows[0].realEstate.newLoans).toBe(300_000);
    expect(rows[0].loanBalance).toBe(300_000);
    expect(rows[0].realEstate.loanInterest).toBe(0);
    expect(rows[1].realEstate.loanInterest + rows[1].realEstate.loanPrincipal).toBeCloseTo(
      12 * annuityPayment(300_000, 0.03, 25),
      6,
    );
    expect(rows[1].realEstate.ibi).toBe(600);
  });
});
