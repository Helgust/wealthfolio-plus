// Key metrics of a plan run for side-by-side comparison of plans.
import type { LedgerRow } from '../engine/run-plan';
import { inMode, type ValueMode } from './format';

export interface PlanMetrics {
  endYear: number;
  endNetWorth: number;
  /** Net worth in the last year all compared plans reach; null — this plan ends earlier */
  netWorthAtCommon: number | null;
  /** IRPF + RETA over the plan */
  taxes: number;
  /** Household expenses over the plan */
  spending: number;
  /** First year with negative cash; null — cash lasts the whole plan */
  cashRunsOut: number | null;
}

/** The last year every run reaches — the earliest end year. */
export function commonEndYear(runs: LedgerRow[][]): number {
  return Math.min(...runs.map((rows) => rows[rows.length - 1].year));
}

export function planMetrics(rows: LedgerRow[], mode: ValueMode, commonYear: number): PlanMetrics {
  const sum = (f: (r: LedgerRow) => number) => rows.reduce((s, r) => s + inMode(f(r), r.deflator, mode), 0);
  const last = rows[rows.length - 1];
  const atCommon = rows.find((r) => r.year === commonYear);
  return {
    endYear: last.year,
    endNetWorth: inMode(last.netWorth, last.deflator, mode),
    netWorthAtCommon: atCommon ? inMode(atCommon.netWorth, atCommon.deflator, mode) : null,
    taxes: sum((r) => r.irpf + r.reta),
    spending: sum((r) => r.essentialExpenses + r.discretionaryExpenses),
    cashRunsOut: rows.find((r) => r.cash < 0)?.year ?? null,
  };
}
