// Monte Carlo over a plan: every trial runs the yearly engine on its own random market path. The
// run goes in slices of time and yields to the page between them: the addon sandbox has no Web
// Workers, and a thousand trials take about a second.
import { endYear, runPlan, type LedgerRow, type PlanResult, type StartingPoint } from '../engine/run-plan';
import { mulberry32, trialSeed } from '../engine/random';
import { IGNIDASH_MODEL, stochasticPath, type MarketModel } from '../engine/stochastic-market';
import type { Plan } from '../model/plan';

export const PERCENTILES = [10, 25, 50, 75, 90] as const;
export type Percentile = (typeof PERCENTILES)[number];

/** Net worth by plan year at each percentile across trials */
export type Bands = Record<Percentile, number[]>;

export interface MonteCarloResult {
  trials: number;
  /** Share of trials in which no year has a shortfall */
  successRate: number;
  years: number[];
  nominal: Bands;
  /** In first-year euros: each trial by its own deflator */
  real: Bands;
}

export interface RunOptions {
  signal?: AbortSignal;
  /** Trials done so far */
  onProgress?: (done: number) => void;
  /** Time to compute before yielding to the page */
  sliceMs?: number;
  model?: MarketModel;
}

/** A trial succeeds when the accounts cover every year: no shortfall. */
export const succeeded = (rows: LedgerRow[]) => rows.every((r) => r.shortfall === 0);

/** Trial i of the plan's run: reproducible from the plan's seed. */
export function runTrial(plan: Plan, start: StartingPoint, i: number, model = IGNIDASH_MODEL): PlanResult {
  const years = endYear(plan) - plan.startYear + 1;
  const path = stochasticPath(plan, years, mulberry32(trialSeed(plan.monteCarlo.seed, i)), model);
  return runPlan(plan, start, plan.filing, path);
}

/** Value at percentile p of sorted values: the nearest rank below, as in ignidash StatsUtils. */
function percentileOf(sorted: Float64Array, p: number): number {
  return sorted[Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1)];
}

function bands(byYear: Float64Array[]): Bands {
  for (const values of byYear) values.sort();
  const out = {} as Bands;
  for (const p of PERCENTILES) out[p] = byYear.map((values) => percentileOf(values, p));
  return out;
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Runs plan.monteCarlo.trials trials. Rejects with the signal's reason when aborted. */
export async function runMonteCarlo(
  plan: Plan,
  start: StartingPoint,
  { signal, onProgress, sliceMs = 40, model }: RunOptions = {},
): Promise<MonteCarloResult> {
  const n = plan.monteCarlo.trials;
  const years = endYear(plan) - plan.startYear + 1;
  const nominal = Array.from({ length: years }, () => new Float64Array(n));
  const real = Array.from({ length: years }, () => new Float64Array(n));
  let successes = 0;
  for (let i = 0; i < n; ) {
    signal?.throwIfAborted();
    const began = performance.now();
    do {
      const rows = runTrial(plan, start, i, model).rows;
      rows.forEach((r, t) => {
        nominal[t][i] = r.netWorth;
        real[t][i] = r.netWorth / r.deflator;
      });
      if (succeeded(rows)) successes++;
      i++;
    } while (i < n && performance.now() - began < sliceMs);
    onProgress?.(i);
    await nextTask();
  }
  signal?.throwIfAborted();
  return {
    trials: n,
    successRate: successes / n,
    years: Array.from({ length: years }, (_, t) => plan.startYear + t),
    nominal: bands(nominal),
    real: bands(real),
  };
}
