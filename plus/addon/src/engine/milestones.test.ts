// Phase 3: milestones, event timing, Seguridad Social pension.
import { describe, expect, it } from 'vitest';
import { irpfAnual, minimoPersonalFamiliar, rulesForYear, total } from '../es-tax';
import { defaultPlan, type Expense, type Plan } from '../model/plan';
import { parsePlan } from '../model/plan-storage';
import { runPlan, type StartingPoint } from './run-plan';
import { cashAccount, ZERO_RETURNS } from './test-helpers';

const START: StartingPoint = { netWorth: 100_000, accounts: [cashAccount(100_000)] };

function plan(overrides: Partial<Plan> = {}): Plan {
  return { ...defaultPlan(2026), returns: ZERO_RETURNS, ...overrides };
}

const expense = (overrides: Partial<Expense>): Expense => ({
  name: 'Travel',
  amount: 5_000,
  kind: 'discretionary',
  start: null,
  end: null,
  ...overrides,
});

describe('milestones', () => {
  it('a net worth milestone is reached once, the year after net worth gets there', () => {
    const p = plan({
      milestones: [{ id: 'fi', name: 'FI', trigger: { kind: 'netWorth', amount: 200_000 } }],
      expenses: [
        { ...defaultPlan(2026).expenses[0] },
        expense({ start: { kind: 'milestone', id: 'fi' } }),
      ],
    });
    p.people[0].autonomo!.end = { kind: 'milestone', id: 'fi' };
    const res = runPlan(p, START);
    const rows = res.rows;
    const startReal = (k: number) => (k === 0 ? START.netWorth : rows[k - 1].netWorth / rows[k - 1].deflator);
    const k = rows.findIndex((_, i) => startReal(i) >= 200_000);
    expect(k).toBeGreaterThan(0);
    expect(res.milestoneYears.fi).toBe(rows[k].year);
    expect(rows.filter((r) => r.milestones.includes('fi')).map((r) => r.year)).toEqual([rows[k].year]);
    // Events tied to it: the expense starts and the income stops in that year.
    expect(rows.slice(0, k).every((r) => r.discretionaryExpenses === 0 && r.revenue > 0)).toBe(true);
    expect(rows[k].discretionaryExpenses).toBeCloseTo(5_000 * rows[k].deflator, 6);
    expect(rows.slice(k).every((r) => r.revenue === 0)).toBe(true);
    // Net worth falls after the income stops, but the milestone stays reached.
    expect(rows.at(-1)!.discretionaryExpenses).toBeGreaterThan(0);
  });

  it('an age milestone before the plan start counts from the first year', () => {
    const p = plan({
      milestones: [{ id: 'm30', name: '30', trigger: { kind: 'age', person: 0, age: 30 } }],
      expenses: [expense({ start: { kind: 'milestone', id: 'm30' } })],
    });
    const res = runPlan(p, START);
    expect(res.milestoneYears.m30).toBe(1986 + 30);
    expect(res.rows[0].milestones).toEqual([]);
    expect(res.rows[0].discretionaryExpenses).toBeCloseTo(5_000, 6);
  });

  it('a missing milestone never starts an event and never ends one', () => {
    const p = plan({
      expenses: [
        expense({ name: 'A', start: { kind: 'milestone', id: 'gone' } }),
        expense({ name: 'B', kind: 'essential', amount: 1_000, end: { kind: 'milestone', id: 'gone' } }),
      ],
    });
    const rows = runPlan(p, START).rows;
    expect(rows.every((r) => r.discretionaryExpenses === 0)).toBe(true);
    expect(rows.every((r) => r.essentialExpenses > 0)).toBe(true);
  });

  it('age timings follow the right person', () => {
    const p = plan({
      people: [
        { ...defaultPlan(2026).people[0], birthYear: 1986 },
        { name: 'B', birthYear: 1990, disability: 'ninguna', autonomo: null, pension: null },
      ],
      expenses: [expense({ start: { kind: 'age', person: 1, age: 40 }, end: { kind: 'age', person: 1, age: 42 } })],
    });
    const active = runPlan(p, START)
      .rows.filter((r) => r.discretionaryExpenses > 0)
      .map((r) => r.year);
    expect(active).toEqual([2030, 2031]);
  });
});

describe('Seguridad Social pension', () => {
  it('starts at its timing, grows with inflation and is taxed as trabajo', () => {
    const p = plan({
      inflation: 0.02,
      people: [
        {
          name: 'R',
          birthYear: 1960,
          disability: 'ninguna',
          autonomo: null,
          pension: { amount: 12_000, start: { kind: 'age', person: 0, age: 67 } },
        },
      ],
      milestones: [],
    });
    const rows = runPlan(p, START).rows;
    expect(rows[0].publicPension).toBe(0);
    expect(rows[1].publicPension).toBeCloseTo(12_000 * 1.02, 6);
    expect(rows[1].people[0].publicPension).toBeCloseTo(rows[1].publicPension, 12);
    const rules = rulesForYear(2027);
    const irpf = irpfAnual(
      rules,
      minimoPersonalFamiliar({ edad: 67, discapacidad: 'ninguna', asistencia: false }, rules),
      { trabajo_integro: 12_000 * 1.02 },
    );
    expect(rows[1].irpf).toBeCloseTo(total(irpf.cuota_liquida), 6);
    expect(rows[1].netCashFlow).toBeCloseTo(12_000 * 1.02 - 20_000 * 1.02 - rows[1].irpf, 6);
  });
});

describe('plans of phases 1–2', () => {
  // As stored before phase 3: autónomo untilAge, expense years inclusive, no milestones or pension.
  const legacy = {
    version: 1,
    name: 'Old',
    startYear: 2026,
    endAge: 90,
    inflation: 0.02,
    filing: 'individual',
    people: [
      {
        name: 'Me',
        birthYear: 1986,
        disability: 'ninguna',
        autonomo: { revenue: 40_000, expenses: 5_000, growth: 0.02, untilAge: 65 },
      },
    ],
    children: [],
    expenses: [
      { name: 'Living', amount: 20_000, kind: 'essential', startYear: null, endYear: null },
      { name: 'School', amount: 1_000, kind: 'discretionary', startYear: 2027, endYear: 2028 },
    ],
  };

  it('upgrade to timings with the same active years', () => {
    const { plan: p, isDefault } = parsePlan(JSON.stringify(legacy), 2026);
    expect(isDefault).toBe(false);
    expect(p.people[0].autonomo).toMatchObject({ start: null, end: { kind: 'age', person: 0, age: 65 } });
    expect(p.people[0].pension).toBeNull();
    expect(p.milestones).toEqual([]);
    expect(p.expenses[1]).toMatchObject({ start: { kind: 'year', year: 2027 }, end: { kind: 'year', year: 2029 } });

    const rows = runPlan({ ...p, returns: ZERO_RETURNS }, START).rows;
    expect(rows.filter((r) => r.discretionaryExpenses > 0).map((r) => r.year)).toEqual([2027, 2028]);
    expect(rows.find((r) => r.people[0].age === 64)!.revenue).toBeGreaterThan(0);
    expect(rows.find((r) => r.people[0].age === 65)!.revenue).toBe(0);
  });

  it('a broken legacy field still fails validation', () => {
    const bad = { ...legacy, expenses: [{ ...legacy.expenses[1], endYear: 'soon' }] };
    expect(parsePlan(JSON.stringify(bad), 2026).isDefault).toBe(true);
  });
});
