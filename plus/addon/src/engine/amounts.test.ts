// Phase 5: amounts entered per period and their change over time.
import { describe, expect, it } from 'vitest';
import { autonomoGrowth, defaultPlan, PlanSchema, type Expense, type Plan } from '../model/plan';
import { amountInYear, growthFactor } from './amounts';
import { constantPath } from './market';
import { endYear, runPlan, type StartingPoint } from './run-plan';
import { cashAccount, ZERO_RETURNS } from './test-helpers';

const START: StartingPoint = { netWorth: 100_000, accounts: [cashAccount(100_000)] };

function plan(overrides: Partial<Plan> = {}): Plan {
  return { ...defaultPlan(2026), returns: ZERO_RETURNS, ...overrides };
}

const living = (overrides: Partial<Expense> = {}): Expense => ({
  name: 'Living',
  amount: 12_000,
  kind: 'essential',
  start: null,
  end: null,
  ...overrides,
});

describe('amounts per period', () => {
  it('1 000 a month is the same ledger as 12 000 a year, and stays monthly in the plan', () => {
    const monthly = plan({ expenses: [living({ amount: 1_000, per: 'month' })] });
    const yearly = plan({ expenses: [living({ amount: 12_000, per: 'year' })] });
    expect(runPlan(monthly, START)).toEqual(runPlan(yearly, START));

    const stored = PlanSchema.parse(JSON.parse(JSON.stringify(monthly)));
    expect(stored.expenses[0]).toMatchObject({ amount: 1_000, per: 'month' });
  });

  it('a quarter is a fourth of the year; no period is per year', () => {
    const quarterly = plan({ expenses: [living({ amount: 3_000, per: 'quarter' })] });
    expect(runPlan(quarterly, START)).toEqual(runPlan(plan({ expenses: [living()] }), START));
  });

  it('autónomo revenue and expenses and the SS pension take their period', () => {
    const p = plan();
    const monthly = plan({
      people: [
        {
          ...p.people[0],
          autonomo: { ...p.people[0].autonomo!, revenue: 40_000 / 12, expenses: 5_000 / 12, per: 'month' },
          pension: { ...p.people[0].pension!, amount: 15_000 / 12, per: 'month' },
        },
      ],
    });
    const a = runPlan(monthly, START).rows;
    const b = runPlan(p, START).rows;
    for (const [i, row] of a.entries()) {
      expect(row.revenue).toBeCloseTo(b[i].revenue, 6);
      expect(row.businessExpenses).toBeCloseTo(b[i].businessExpenses, 6);
      expect(row.publicPension).toBeCloseTo(b[i].publicPension, 6);
      expect(row.netWorth).toBeCloseTo(b[i].netWorth, 4);
    }
  });
});

describe('change over time', () => {
  it('nominal 0 stays the same nominal amount every year', () => {
    const rows = runPlan(plan({ expenses: [living({ growth: { kind: 'nominal', rate: 0 } })] }), START).rows;
    expect(rows.every((r) => r.essentialExpenses === 12_000)).toBe(true);
    expect(rows.at(-1)!.deflator).toBeGreaterThan(2);
  });

  it('nominal growth ignores inflation; inflation growth adds the real growth to it', () => {
    expect(growthFactor({ kind: 'nominal', rate: 0.03 }, 2, 1.5)).toBeCloseTo(1.03 ** 2, 12);
    expect(growthFactor({ kind: 'inflation', real: 0.01 }, 2, 1.5)).toBeCloseTo(1.5 * 1.01 ** 2, 12);
    expect(amountInYear(100, 'month', undefined, 3, 1.1)).toBeCloseTo(1_200 * 1.1, 12);
  });

  it('in a year of its own inflation an expense grows by that inflation plus its real growth', () => {
    const p = plan({ expenses: [living({ growth: { kind: 'inflation', real: 0.01 } })] });
    const years = endYear(p) - p.startYear + 1;
    const inflation = [0.02, 0.1, -0.03, 0.05];
    const path = constantPath(p, years).map((y, t) => (t < inflation.length ? { ...y, inflation: inflation[t] } : y));
    const rows = runPlan(p, START, p.filing, path).rows;
    for (let t = 1; t < inflation.length; t++) {
      expect(rows[t].essentialExpenses / rows[t - 1].essentialExpenses).toBeCloseTo((1 + inflation[t]) * 1.01, 12);
    }
  });

  it('autónomo expenses can grow apart from revenue', () => {
    const p = plan();
    const inc = {
      ...p.people[0].autonomo!,
      revenueGrowth: { kind: 'inflation', real: 0.01 } as const,
      expensesGrowth: { kind: 'nominal', rate: 0 } as const,
    };
    const rows = runPlan(plan({ people: [{ ...p.people[0], autonomo: inc }] }), START).rows;
    const working = rows.filter((r) => r.revenue > 0);
    expect(working.length).toBeGreaterThan(20);
    for (const [t, row] of working.entries()) {
      expect(row.businessExpenses).toBe(5_000);
      expect(row.revenue).toBeCloseTo(40_000 * row.deflator * 1.01 ** t, 6);
    }
  });

  it('the phases 1–4 autónomo growth is inflation plus its real growth over the plan’s inflation', () => {
    const p = plan({ inflation: 0.025 });
    const inc = { ...p.people[0].autonomo!, growth: 0.04 };
    const real = 1.04 / 1.025 - 1;
    expect(autonomoGrowth(inc, 'revenue', 0.025)).toEqual({ kind: 'inflation', real });
    expect(autonomoGrowth(inc, 'expenses', 0.025)).toEqual({ kind: 'inflation', real });

    const legacy = runPlan({ ...p, people: [{ ...p.people[0], autonomo: inc }] }, START).rows;
    const growth = { kind: 'inflation', real } as const;
    const explicit = { ...inc, growth: 0, revenueGrowth: growth, expensesGrowth: growth };
    const rows = runPlan({ ...p, people: [{ ...p.people[0], autonomo: explicit }] }, START).rows;
    for (const [i, row] of rows.entries()) {
      expect(row.revenue).toBeCloseTo(legacy[i].revenue, 6);
      expect(row.businessExpenses).toBeCloseTo(legacy[i].businessExpenses, 6);
    }
  });

  it('the SS pension can be fixed in nominal terms', () => {
    const p = plan();
    const pension = { ...p.people[0].pension!, growth: { kind: 'nominal', rate: 0 } as const };
    const rows = runPlan(plan({ people: [{ ...p.people[0], pension }] }), START).rows;
    const paid = rows.filter((r) => r.publicPension > 0);
    expect(paid.length).toBeGreaterThan(10);
    expect(paid.every((r) => r.publicPension === 15_000)).toBe(true);
  });
});

describe('plans of phases 1–4', () => {
  it('read without new fields: amounts per year, growing with inflation', () => {
    const p = { ...defaultPlan(2026), expenses: [living()] };
    const stored = PlanSchema.parse(JSON.parse(JSON.stringify(p)));
    expect(stored).toEqual(p);
    expect(stored.expenses[0]).not.toHaveProperty('per');
    expect(stored.people[0].pension).not.toHaveProperty('growth');
  });

  it('a broken period or growth fails validation', () => {
    const valid = (e: unknown) => PlanSchema.safeParse({ ...defaultPlan(2026), expenses: [e] }).success;
    expect(valid(living({ per: 'week' as never }))).toBe(false);
    expect(valid(living({ growth: { kind: 'nominal' } as never }))).toBe(false);
    expect(valid(living({ growth: { kind: 'inflation', real: 0.01 } }))).toBe(true);
  });
});
