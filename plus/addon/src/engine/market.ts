// Market of each plan year: nominal returns by Spanish account type and inflation. The
// deterministic plan is a constant path of its expected returns; Monte Carlo and the backtest give
// every year its own.
import type { Plan, Returns } from '../model/plan';

/** Returns of the year by account type; inflation — the price change from the previous year. */
export interface MarketYear extends Returns {
  inflation: number;
}

/** The plan's expected returns and inflation in every one of years. */
export function constantPath(plan: Plan, years: number): MarketYear[] {
  const y: MarketYear = { ...plan.returns, inflation: plan.inflation };
  return Array.from({ length: years }, () => y);
}

/**
 * Price level of every plan year in first-year prices: the product of the years' inflation. The
 * first year's own inflation does not count — it is the change into the plan's first year.
 */
export function priceLevels(market: MarketYear[]): number[] {
  const levels = [1];
  for (let t = 1; t < market.length; t++) levels.push(levels[t - 1] * (1 + market[t].inflation));
  return levels;
}

/**
 * Price level of plan year t (0 — the first). Outside the path it goes on with the plan's
 * expected inflation: before the start (tax rules of an earlier year) and after the end (a purchase
 * the plan does not reach).
 */
export function priceLevelAt(levels: number[], inflation: number, t: number): number {
  if (t < 0) return (1 + inflation) ** t;
  if (t >= levels.length) return levels[levels.length - 1] * (1 + inflation) ** (t - levels.length + 1);
  return levels[t];
}
