// Phase 5: letting a home out — rendimiento del capital inmobiliario, no imputación while let,
// costs of the property, and the sale of a former vivienda habitual.
import { describe, expect, it } from 'vitest';
import {
  amortizacionInmueble,
  imputacionRenta,
  irpfAnual,
  minimoPersonalFamiliar,
  rendimientoArrendamiento,
  rulesForYear,
  total,
} from '../es-tax';
import { defaultPlan, type Plan, type PropertyPurchase, type Rental } from '../model/plan';
import type { Property } from './real-estate';
import { runPlan, type StartingPoint } from './run-plan';
import { cashAccount, ZERO_RETURNS } from './test-helpers';

const flat = (overrides: Partial<Property> = {}): Property => ({
  id: 'flat',
  name: 'Flat',
  value: 200_000,
  use: 'second',
  owner: 0,
  valorCatastral: 80_000,
  catastroRevisado: false,
  ibi: 400,
  acquisitionValue: 150_000,
  ...overrides,
});

function start(properties: Property[]): StartingPoint {
  const cash = 500_000;
  return { netWorth: cash + properties.reduce((s, p) => s + p.value, 0), accounts: [cashAccount(cash)], properties };
}

/** One person of 40, no income, 10 000 € of expenses, zero returns and inflation. */
function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    ...defaultPlan(2026),
    returns: ZERO_RETURNS,
    inflation: 0,
    milestones: [],
    people: [{ name: 'P', birthYear: 1986, disability: 'ninguna', autonomo: null, pension: null }],
    expenses: [{ name: 'Living', amount: 10_000, kind: 'essential', start: null, end: null }],
    ...overrides,
  };
}

const rental = (overrides: Partial<Rental> = {}): Rental => ({
  propertyId: 'flat',
  amount: 900,
  per: 'month',
  occupancy: 1,
  repairs: 600,
  reduction: 'general',
  start: { kind: 'year', year: 2027 },
  end: null,
  ...overrides,
});

const persona = { edad: 40, discapacidad: 'ninguna', asistencia: false } as const;

describe('a home let', () => {
  it('pays IRPF on its rendimiento neto reducido and imputes no rent', () => {
    const p = flat({ community: 600, insurance: 200, constructionShare: 0.5 });
    const rows = runPlan(plan({ rentals: [rental()] }), start([p])).rows;
    const rules = rulesForYear(2026);
    // 2026: not let yet — imputación.
    expect(rows[0].realEstate.imputedRent[0]).toBeCloseTo(imputacionRenta(80_000, rules.inmuebles), 6);
    expect(rows[0].realEstate.rent).toBe(0);
    // 2027: let — rent, no imputación.
    const r = rows[1];
    expect(r.realEstate.imputedRent[0]).toBe(0);
    expect(r.realEstate.rent).toBe(10_800);
    const expected = rendimientoArrendamiento(10_800, rules.inmuebles, {
      financiacionReparacion: 600,
      otrosGastos: 400 + 600 + 200,
      amortizacion: amortizacionInmueble(150_000, 80_000, 0.5, rules.inmuebles),
    });
    expect(r.realEstate.rentalIncome[0]).toBeCloseTo(expected.rendimiento_neto_reducido, 6);
    const irpf = irpfAnual(rules, minimoPersonalFamiliar(persona, rules), {
      otras_rentas_general: expected.rendimiento_neto_reducido,
    });
    expect(r.irpf).toBeCloseTo(total(irpf.cuota_liquida), 6);
    expect(r.netCashFlow).toBeCloseTo(10_800 - 600 - 400 - 800 - 10_000 - r.irpf, 6);
  });

  it('occupancy scales the rent; the reducción follows the contract', () => {
    const [, half] = runPlan(plan({ rentals: [rental({ occupancy: 0.5 })] }), start([flat()])).rows;
    expect(half.realEstate.rent).toBe(5_400);
    const [, general] = runPlan(plan({ rentals: [rental()] }), start([flat()])).rows;
    const [, reduced] = runPlan(plan({ rentals: [rental({ reduction: 'rebaja_tensionada' })] }), start([flat()])).rows;
    // Rendimiento neto 10 800 − 600 − 400: 50 % against 90 % of it.
    expect(general.realEstate.rentalIncome[0]).toBeCloseTo(9_800 * 0.5, 6);
    expect(reduced.realEstate.rentalIncome[0]).toBeCloseTo(9_800 * 0.1, 6);
  });

  it('bought in the plan with a mortgage deducts the interest', () => {
    const purchase: PropertyPurchase = {
      id: 'toLet',
      name: 'To let',
      timing: { kind: 'year', year: 2026 },
      price: 200_000,
      newBuild: false,
      habitual: false,
      owner: 0,
      ibi: 500,
      community: 480,
      constructionShare: 0.6,
      mortgage: { amount: 150_000, rate: 0.03, years: 25 },
    };
    const p = plan({
      propertyPurchases: [purchase],
      rentals: [rental({ propertyId: 'purchase:toLet', amount: 1_000, repairs: 0, start: null })],
    });
    const rows = runPlan(p, start([])).rows;
    expect(rows[0].realEstate.rent).toBe(0); // bought this year, let from the next
    const r = rows[1];
    const rules = rulesForYear(2027);
    const acquisition = rows[0].realEstate.purchaseCost + rows[0].realEstate.purchaseTax;
    const expected = rendimientoArrendamiento(12_000, rules.inmuebles, {
      financiacionReparacion: r.realEstate.loanInterest,
      otrosGastos: 500 + 480,
      amortizacion: amortizacionInmueble(acquisition, null, 0.6, rules.inmuebles),
    });
    expect(r.realEstate.loanInterest).toBeGreaterThan(4_000);
    expect(r.realEstate.rentalIncome[0]).toBeCloseTo(expected.rendimiento_neto_reducido, 6);
    expect(r.realEstate.imputedRent[0]).toBe(0);
  });

  it('carries the excess of interest and repairs over the rent to the next years', () => {
    const rows = runPlan(plan({ rentals: [rental({ amount: 100, repairs: 3_000 })] }), start([flat()])).rows;
    // 1 200 € of rent, 3 000 € of repairs: 1 800 € carry over, the rendimiento is 1 200 − 1 200 − 400.
    expect(rows[1].realEstate.rentalIncome[0]).toBeCloseTo(-400, 6);
  });
});

describe('costs of a property', () => {
  it('comunidad and insurance are paid every year', () => {
    const rows = runPlan(plan(), start([flat({ community: 600, insurance: 200 })])).rows;
    expect(rows.every((r) => r.realEstate.ownershipCosts === 800)).toBe(true);
  });
});

describe('selling a former vivienda habitual', () => {
  const home = flat({ id: 'home', use: 'habitual', value: 300_000, acquisitionValue: 150_000 });
  const sale = (year: number): Partial<Plan> => ({
    propertySales: [{ propertyId: 'home', timing: { kind: 'year', year }, costs: 0 }],
    // Reinvested in full in a new vivienda habitual the same year.
    propertyPurchases: [
      {
        id: 'new',
        name: 'New',
        timing: { kind: 'year', year },
        price: 400_000,
        newBuild: false,
        habitual: true,
        owner: 0,
        ibi: 0,
        mortgage: null,
      },
    ],
    rentals: [rental({ propertyId: 'home', start: { kind: 'year', year: 2030 } })],
  });
  const gainIn = (rows: ReturnType<typeof runPlan>['rows'], year: number) =>
    rows.find((r) => r.year === year)!.realEstate.gains[0];

  it('is exempt when sold the year after the rental started', () => {
    expect(gainIn(runPlan(plan(sale(2031)), start([home])).rows, 2031)).toBe(0);
  });

  it('is taxed when sold later', () => {
    expect(gainIn(runPlan(plan(sale(2032)), start([home])).rows, 2032)).toBeGreaterThan(100_000);
  });
});
