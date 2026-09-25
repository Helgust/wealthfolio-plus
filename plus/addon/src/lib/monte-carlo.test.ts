// Monte Carlo: the engine on a market path, success rate and percentiles of a run.
import { describe, expect, it } from 'vitest';
import { constantPath } from '../engine/market';
import { endYear, runPlan, type StartingPoint } from '../engine/run-plan';
import { IGNIDASH_MODEL, type MarketModel } from '../engine/stochastic-market';
import { cashAccount, investAccount } from '../engine/test-helpers';
import { defaultPlan, type Plan } from '../model/plan';
import { PERCENTILES, runMonteCarlo, succeeded } from './monte-carlo';

const start: StartingPoint = {
  netWorth: 150_000,
  accounts: [cashAccount(30_000), investAccount('fund', 'fund', 10, 6_000, 40_000), investAccount('ppi', 'ppi', 1, 60_000, 50_000)],
};
const plan: Plan = {
  ...defaultPlan(2026),
  flows: [{ accountId: 'fund', mode: 'percent', amount: 0.5 }],
  monteCarlo: { trials: 200, seed: 5 },
};
const ZERO_VOLATILITY: MarketModel = {
  volatility: { stocks: 0, bonds: 0, cash: 0, inflation: 0 },
  correlation: IGNIDASH_MODEL.correlation,
};
const years = endYear(plan) - plan.startYear + 1;

describe('the engine on a market path', () => {
  it('the plan’s constant path is the deterministic plan', () => {
    expect(runPlan(plan, start, plan.filing, constantPath(plan, years))).toEqual(runPlan(plan, start));
  });

  it('prices follow the path’s inflation; autónomo income keeps its real growth', () => {
    const path = constantPath(plan, years).map((y, t) => (t === 1 ? { ...y, inflation: 0.1 } : y));
    const rows = runPlan(plan, start, plan.filing, path).rows;
    expect(rows[1].deflator).toBeCloseTo(1.1, 12);
    expect(rows[2].deflator).toBeCloseTo(1.1 * 1.02, 12);
    expect(rows[2].essentialExpenses).toBeCloseTo(20_000 * 1.1 * 1.02, 6);
    const real = (1 + plan.people[0].autonomo!.growth) / (1 + plan.inflation);
    expect(rows[2].revenue / rows[2].deflator).toBeCloseTo(40_000 * real ** 2, 6);
  });

  it('a path shorter than the plan is an error', () => {
    expect(() => runPlan(plan, start, plan.filing, constantPath(plan, years - 1))).toThrow('Market path');
  });
});

describe('Monte Carlo', () => {
  it('without volatility every trial is the deterministic plan', async () => {
    const res = await runMonteCarlo(plan, start, { model: ZERO_VOLATILITY });
    const rows = runPlan(plan, start).rows;
    expect(res.years).toEqual(rows.map((r) => r.year));
    expect(res.successRate).toBe(succeeded(rows) ? 1 : 0);
    for (const p of PERCENTILES) {
      res.nominal[p].forEach((v, t) => expect(v).toBeCloseTo(rows[t].netWorth, 4));
      res.real[p].forEach((v, t) => expect(v).toBeCloseTo(rows[t].netWorth / rows[t].deflator, 4));
    }
  });

  it('is reproducible from the seed; percentiles are ordered', async () => {
    const a = await runMonteCarlo(plan, start);
    expect(await runMonteCarlo(plan, start)).toEqual(a);
    expect(await runMonteCarlo({ ...plan, monteCarlo: { trials: 200, seed: 6 } }, start)).not.toEqual(a);
    expect(a.trials).toBe(200);
    a.years.forEach((_, t) => {
      for (let k = 1; k < PERCENTILES.length; k++) {
        expect(a.nominal[PERCENTILES[k]][t]).toBeGreaterThanOrEqual(a.nominal[PERCENTILES[k - 1]][t]);
      }
    });
    // Random returns spread the outcomes.
    expect(a.real[90].at(-1)! - a.real[10].at(-1)!).toBeGreaterThan(0);
  });

  it('success is 0 % when money always runs out and 100 % when it never does', async () => {
    const broke: Plan = {
      ...plan,
      people: [{ ...plan.people[0], autonomo: null, pension: null }],
      expenses: [{ name: 'Living', amount: 30_000, kind: 'essential', start: null, end: null }],
    };
    expect((await runMonteCarlo(broke, { netWorth: 10_000, accounts: [cashAccount(10_000)] })).successRate).toBe(0);
    const rich = { netWorth: 50_000_000, accounts: [cashAccount(50_000_000)] };
    expect((await runMonteCarlo(broke, rich)).successRate).toBe(1);
  });

  it('reports progress and stops when aborted', async () => {
    const done: number[] = [];
    await runMonteCarlo(plan, start, { sliceMs: 0, onProgress: (d) => done.push(d) });
    expect(done.at(-1)).toBe(200);
    expect(done.length).toBeGreaterThan(1);
    const ac = new AbortController();
    const run = runMonteCarlo(plan, start, { signal: ac.signal, sliceMs: 0 });
    ac.abort();
    await expect(run).rejects.toThrow();
  });
});
