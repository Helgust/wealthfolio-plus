import { describe, expect, it } from 'vitest';
import { runPlan, type StartingPoint } from '../engine/run-plan';
import { cashAccount, ZERO_RETURNS } from '../engine/test-helpers';
import { defaultPlan, type Plan } from '../model/plan';
import { commonEndYear, planMetrics } from './compare';

const START: StartingPoint = { netWorth: 100_000, accounts: [cashAccount(30_000)] };
const plan = (overrides: Partial<Plan> = {}): Plan => ({
  ...defaultPlan(2026),
  returns: ZERO_RETURNS,
  ...overrides,
});

describe('plan comparison', () => {
  const base = runPlan(plan(), START).rows;
  const short = runPlan(plan({ endAge: 80 }), START).rows;
  const lavish = runPlan(
    plan({ expenses: [{ name: 'All', amount: 60_000, kind: 'essential', start: null, end: null }] }),
    START,
  ).rows;

  it('compares at the earliest end year', () => {
    const common = commonEndYear([base, short]);
    expect(common).toBe(2026 - 40 + 80);
    const m = planMetrics(base, 'nominal', common);
    expect(m.endYear).toBe(2026 - 40 + 90);
    expect(m.netWorthAtCommon).toBeCloseTo(base.find((r) => r.year === common)!.netWorth, 6);
    expect(planMetrics(short, 'nominal', common).netWorthAtCommon).toBeCloseTo(short.at(-1)!.netWorth, 6);
  });

  it('sums taxes and spending, in today’s euros too', () => {
    const m = planMetrics(base, 'today', 2100);
    expect(m.netWorthAtCommon).toBeNull();
    const taxes = base.reduce((s, r) => s + (r.irpf + r.reta) / r.deflator, 0);
    expect(m.taxes).toBeCloseTo(taxes, 6);
    // Expenses are set in first-year prices, so in today's euros they are constant.
    expect(m.spending).toBeCloseTo(20_000 * base.length, 6);
    expect(m.endNetWorth).toBeCloseTo(base.at(-1)!.netWorth / base.at(-1)!.deflator, 6);
  });

  it('finds the year cash runs out', () => {
    const rich = runPlan(plan(), { netWorth: 5_000_000, accounts: [cashAccount(5_000_000)] }).rows;
    expect(planMetrics(rich, 'nominal', 2050).cashRunsOut).toBeNull();
    const out = planMetrics(lavish, 'nominal', 2050).cashRunsOut;
    expect(out).toBe(lavish.find((r) => r.cash < 0)!.year);
    expect(out).toBeLessThan(planMetrics(base, 'nominal', 2050).cashRunsOut!);
  });
});
