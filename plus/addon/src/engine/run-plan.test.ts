import { describe, expect, it } from 'vitest';
import {
  actividad,
  irpfAnual,
  irpfConjunta,
  minimoConjunta,
  minimoPersonalFamiliar,
  rulesForYear,
  total,
} from '../es-tax';
import { defaultPlan, type Plan } from '../model/plan';
import { parsePlan } from '../model/plan-storage';
import { endYear, runPlan, type StartingPoint } from './run-plan';
import { cashAccount, ZERO_RETURNS } from './test-helpers';

const START: StartingPoint = { netWorth: 100_000, accounts: [cashAccount(30_000)] };

/** Phase 1 plan: no returns, all cash flow goes to cash. */
function plan(overrides: Partial<Plan> = {}): Plan {
  return { ...defaultPlan(2026), returns: ZERO_RETURNS, ...overrides };
}

const persona = (edad: number) => ({ edad, discapacidad: 'ninguna', asistencia: false }) as const;

describe('runPlan', () => {
  it('first year matches direct tax calls', () => {
    const p = plan();
    const [row] = runPlan(p, START).rows;
    const rules = rulesForYear(2026);
    const act = actividad(40_000, 5_000, rules);
    const irpf = irpfAnual(rules, minimoPersonalFamiliar(persona(40), rules), {
      rendimiento_actividad: act.rendimiento_neto,
    });
    expect(row.year).toBe(2026);
    expect(row.reta).toBeCloseTo(act.cuota_reta, 6);
    expect(row.irpf).toBeCloseTo(total(irpf.cuota_liquida), 6);
    expect(row.irpfEstatal + row.irpfAutonomica).toBeCloseTo(row.irpf, 6);
    expect(row.netCashFlow).toBeCloseTo(40_000 - 5_000 - act.cuota_reta - row.irpf - 20_000, 6);
    expect(row.cash).toBeCloseTo(30_000 + row.netCashFlow, 6);
    expect(row.netWorth).toBeCloseTo(START.netWorth + row.netCashFlow, 6);
  });

  it('runs until the oldest person reaches endAge', () => {
    const rows = runPlan(plan(), START).rows;
    expect(rows[0].year).toBe(2026);
    expect(rows.at(-1)!.year).toBe(endYear(plan()));
    expect(rows.at(-1)!.people[0].age).toBe(90);
  });

  it('grows expenses with inflation and stops income at untilAge', () => {
    const rows = runPlan(plan(), START).rows;
    const at = (age: number) => rows.find((r) => r.people[0].age === age)!;
    expect(at(41).essentialExpenses).toBeCloseTo(20_000 * 1.02, 6);
    expect(at(41).deflator).toBeCloseTo(1.02, 12);
    expect(at(64).revenue).toBeGreaterThan(0);
    expect(at(65).revenue).toBe(0);
    expect(at(65).reta).toBe(0);
    expect(at(65).irpf).toBe(0);
    expect(at(65).people[0].retaTramo).toBeNull();
    // Cumulative flow adds up to the balance.
    const flows = rows.reduce((s, r) => s + r.netCashFlow, 0);
    expect(rows.at(-1)!.cash).toBeCloseTo(30_000 + flows, 4);
  });

  it('respects expense start and end years', () => {
    const p = plan({
      expenses: [
        { name: 'School', amount: 1_000, kind: 'discretionary', startYear: 2027, endYear: 2028 },
      ],
    });
    const rows = runPlan(p, START).rows;
    expect(rows.map((r) => r.discretionaryExpenses > 0).slice(0, 4)).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it('carries a loss forward to the next years', () => {
    const p = plan();
    // Margin grows 50 % a year while the RETA cuota stays nearly flat: a loss, then a profit.
    p.people[0].autonomo = { revenue: 20_000, expenses: 18_000, growth: 0.5, untilAge: 65 };
    const rows = runPlan(p, START).rows;
    let prev: ReturnType<typeof irpfAnual> | undefined;
    let compensado = 0;
    for (let t = 0; t < 6; t++) {
      const rules = rulesForYear(2026 + t);
      const g = 1.5 ** t;
      const act = actividad(20_000 * g, 18_000 * g, rules);
      prev = irpfAnual(
        rules,
        minimoPersonalFamiliar(persona(40 + t), rules),
        { rendimiento_actividad: act.rendimiento_neto },
        { pendientes_general: prev?.pendientes_general },
      );
      expect(rows[t].baseLiquidableGeneral).toBeCloseTo(prev.base_liquidable_general, 6);
      compensado += prev.compensado_general_anteriores;
    }
    expect(compensado).toBeGreaterThan(0);
  });

  it('children count for mínimos from birth, split between two individual filers', () => {
    const two = plan({
      people: [
        { ...defaultPlan(2026).people[0], name: 'A' },
        { ...defaultPlan(2026).people[0], name: 'B', autonomo: null },
      ],
      children: [{ birthYear: 2027 }],
    });
    const rows = runPlan(two, START).rows;
    const rules = rulesForYear(2027);
    const act = actividad(40_000 * 1.02, 5_000 * 1.02, rules);
    const minimo = minimoPersonalFamiliar(persona(41), rules, [
      { ...persona(0), renta_anual: 0, share: 0.5 },
    ]);
    const expected = irpfAnual(rules, minimo, { rendimiento_actividad: act.rendimiento_neto });
    expect(rows[1].irpf).toBeCloseTo(total(expected.cuota_liquida), 6);
    expect(rows[0].irpf).toBeGreaterThan(rows[1].irpf);
  });

  it('joint filing equals irpfConjunta for the couple', () => {
    const p = plan({
      filing: 'joint',
      people: [
        { ...defaultPlan(2026).people[0], name: 'A' },
        { ...defaultPlan(2026).people[0], name: 'B', birthYear: 1990, autonomo: null },
      ],
    });
    const row = runPlan(p, START).rows[0];
    const rules = rulesForYear(2026);
    const act = actividad(40_000, 5_000, rules);
    const res = irpfConjunta(rules, minimoConjunta([persona(40), persona(36)], rules), [
      { rendimiento_actividad: act.rendimiento_neto },
      { rendimiento_actividad: 0 },
    ]);
    expect(row.irpf).toBeCloseTo(total(res.cuota_liquida), 6);
    // Spouse without income: conjunta beats two individual returns.
    expect(row.irpf).toBeLessThan(runPlan(p, START, 'individual').rows[0].irpf);
  });

  it('rejects joint filing for one person', () => {
    expect(() => runPlan(plan(), START, 'joint')).toThrow();
  });

  it('computes 40 years in well under a frame budget', () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) runPlan(plan(), START);
    expect((performance.now() - t0) / 20).toBeLessThan(16);
  });
});

describe('parsePlan', () => {
  it('round-trips a valid plan', () => {
    const p = plan();
    expect(parsePlan(JSON.stringify(p), 2026)).toEqual({ plan: p, isDefault: false });
  });

  it('falls back to the template on missing, broken or invalid JSON', () => {
    expect(parsePlan(null, 2026).isDefault).toBe(true);
    expect(parsePlan('{', 2026).error).toMatch(/Invalid JSON/);
    const bad = { ...plan(), inflation: 'x' };
    expect(parsePlan(JSON.stringify(bad), 2026).error).toBeDefined();
    const joint1 = { ...plan(), filing: 'joint' };
    expect(parsePlan(JSON.stringify(joint1), 2026).isDefault).toBe(true);
  });

  it('reads a phase 1 plan: new fields get defaults', () => {
    const v1: Record<string, unknown> = { ...defaultPlan(2026) };
    for (const k of ['returns', 'flows', 'withdrawalOrder', 'pensionAccessAge']) delete v1[k];
    expect(parsePlan(JSON.stringify(v1), 2026)).toEqual({ plan: defaultPlan(2026), isDefault: false });
  });
});
