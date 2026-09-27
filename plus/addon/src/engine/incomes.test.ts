// Phase 5: incomes besides the activity — salaries, gains, tax-free — and one-time events.
import { describe, expect, it } from 'vitest';
import { cotizacionTrabajador, irpfAnual, minimoPersonalFamiliar, rulesForYear, total } from '../es-tax';
import { defaultPlan, type Income, type OneTime, type Plan } from '../model/plan';
import { runPlan, type StartingPoint } from './run-plan';
import { cashAccount, investAccount, ZERO_RETURNS } from './test-helpers';

const START: StartingPoint = { netWorth: 100_000, accounts: [cashAccount(100_000)] };
const persona = (edad: number) => ({ edad, discapacidad: 'ninguna', asistencia: false }) as const;

/** One person of 40 with no autónomo income or pension, expenses 20 000 € a year. */
function employee(overrides: Partial<Plan> = {}): Plan {
  const p = defaultPlan(2026);
  return {
    ...p,
    returns: ZERO_RETURNS,
    people: [{ ...p.people[0], autonomo: null, pension: null }],
    ...overrides,
  };
}

const salary = (overrides: Partial<Income> = {}): Income => ({
  name: 'Salary',
  person: 0,
  tax: 'trabajo',
  amount: 35_000,
  start: null,
  end: null,
  ...overrides,
});

const once = (overrides: Partial<OneTime> = {}): OneTime =>
  ({
    type: 'expense',
    name: 'Car',
    kind: 'essential',
    amount: 10_000,
    nominal: false,
    at: { kind: 'year', year: 2028 },
    repeat: null,
    ...overrides,
  }) as OneTime;

describe('salaries', () => {
  it('pay IRPF on the rendimiento del trabajo after the employee’s cotizaciones', () => {
    const [row] = runPlan(employee({ incomes: [salary()] }), START).rows;
    const rules = rulesForYear(2026);
    const cot = cotizacionTrabajador(35_000, rules.cotizacion);
    const irpf = irpfAnual(rules, minimoPersonalFamiliar(persona(40), rules), {
      trabajo_integro: 35_000,
      cotizaciones_trabajo: cot,
    });
    expect(row.wages).toBe(35_000);
    expect(row.employeeContributions).toBeCloseTo(cot, 6);
    expect(row.people[0]).toMatchObject({ wages: 35_000, employeeContributions: cot });
    expect(row.irpf).toBeCloseTo(total(irpf.cuota_liquida), 6);
    expect(row.netCashFlow).toBeCloseTo(35_000 - cot - row.irpf - 20_000, 6);
  });

  it('change from autónomo to a salary in the same year', () => {
    const p = defaultPlan(2026);
    const switchYear = { kind: 'year', year: 2030 } as const;
    const plan: Plan = {
      ...p,
      returns: ZERO_RETURNS,
      people: [{ ...p.people[0], autonomo: { ...p.people[0].autonomo!, end: switchYear } }],
      incomes: [salary({ start: switchYear })],
    };
    const rows = runPlan(plan, START).rows;
    const at = (y: number) => rows.find((r) => r.year === y)!;
    expect(at(2029)).toMatchObject({ wages: 0 });
    expect(at(2029).reta).toBeGreaterThan(0);
    expect(at(2030)).toMatchObject({ revenue: 0, reta: 0 });
    expect(at(2030).wages).toBeCloseTo(35_000 * at(2030).deflator, 6);
  });

  it('count for the 30 % pension plan limit', () => {
    // A 6 000 € salary and a 7 000 € gain (no art. 20 reducción with other rentas above 6 500 €):
    // the limit is 30 % of the rendimiento neto del trabajo, below the general 1 500 €.
    const start: StartingPoint = {
      netWorth: 100_000,
      accounts: [cashAccount(100_000), investAccount('ppi', 'ppi', 1, 0, 0)],
    };
    const plan = employee({
      expenses: [],
      incomes: [salary({ amount: 6_000 }), salary({ name: 'Shares', tax: 'ganancia', amount: 7_000 })],
      flows: [{ accountId: 'ppi', mode: 'max', amount: 0 }],
    });
    const [row] = runPlan(plan, start).rows;
    const net = 6_000 - cotizacionTrabajador(6_000, rulesForYear(2026).cotizacion) - 2_000;
    expect(row.pensionContributions).toBeCloseTo(0.3 * net, 6);
  });

  it('of a person no longer in the plan are ignored', () => {
    const rows = runPlan(employee({ incomes: [salary({ person: 1 })] }), START).rows;
    expect(rows.every((r) => r.wages === 0)).toBe(true);
  });
});

describe('gains and tax-free income', () => {
  it('a gain goes to the savings base', () => {
    const plan = employee({ incomes: [salary(), salary({ name: 'Crypto', tax: 'ganancia', amount: 5_000 })] });
    const [row] = runPlan(plan, START).rows;
    const rules = rulesForYear(2026);
    const irpf = irpfAnual(rules, minimoPersonalFamiliar(persona(40), rules), {
      trabajo_integro: 35_000,
      cotizaciones_trabajo: cotizacionTrabajador(35_000, rules.cotizacion),
      ganancias: 5_000,
    });
    expect(row.gainIncome).toBe(5_000);
    expect(row.baseLiquidableAhorro).toBeCloseTo(5_000, 6);
    expect(row.irpf).toBeCloseTo(total(irpf.cuota_liquida), 6);
  });

  it('a one-time inheritance does not change IRPF and adds to cash only in its year', () => {
    const inheritance = once({ type: 'income', name: 'Herencia', person: 0, tax: 'exento', amount: 50_000 } as OneTime);
    const without = runPlan(employee({ incomes: [salary()] }), START).rows;
    const rows = runPlan(employee({ incomes: [salary()], oneTime: [inheritance] }), START).rows;
    rows.forEach((r, i) => {
      expect(r.irpf).toBe(without[i].irpf);
      expect(r.exemptIncome).toBe(r.year === 2028 ? 50_000 * r.deflator : 0);
    });
    const at2028 = rows.findIndex((r) => r.year === 2028);
    expect(rows[at2028].cash - without[at2028].cash).toBeCloseTo(50_000 * rows[at2028].deflator, 6);
  });
});

describe('one-time events', () => {
  it('an expense of year N is only in year N', () => {
    const base = runPlan(employee(), START).rows;
    const rows = runPlan(employee({ oneTime: [once()] }), START).rows;
    rows.forEach((r, i) => {
      const extra = r.essentialExpenses - base[i].essentialExpenses;
      expect(extra).toBeCloseTo(r.year === 2028 ? 10_000 * r.deflator : 0, 6);
    });
  });

  it('repeats every N years until its end; a nominal amount does not grow', () => {
    const car = once({ kind: 'discretionary', nominal: true, repeat: { every: 3, until: { kind: 'year', year: 2037 } } });
    const rows = runPlan(employee({ oneTime: [car] }), START).rows;
    const years = rows.filter((r) => r.discretionaryExpenses > 0);
    expect(years.map((r) => r.year)).toEqual([2028, 2031, 2034]);
    expect(years.every((r) => r.discretionaryExpenses === 10_000)).toBe(true);
  });

  it('a one-time discretionary expense gives way to a spending rule', () => {
    const rule = { kind: 'percent', start: { kind: 'year', year: 2026 }, rate: 0 } as const;
    const rows = runPlan(employee({ spending: rule, oneTime: [once({ kind: 'discretionary' })] }), START).rows;
    expect(rows.every((r) => r.discretionaryExpenses === 0)).toBe(true);
  });

  it('starting at a milestone', () => {
    const plan = employee({ oneTime: [once({ at: { kind: 'milestone', id: 'retirement' } })] });
    const rows = runPlan(plan, START).rows;
    const extra = rows.filter((r) => r.essentialExpenses > 20_000 * r.deflator + 1e-6).map((r) => r.year);
    expect(extra).toEqual([1986 + 65]);
  });
});
