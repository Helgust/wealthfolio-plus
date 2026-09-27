// Amounts of recurring plan events: entered per period in first-year prices, they change over time
// by their growth. One rule for every event instead of multipliers in place.
import { PERIODS_PER_YEAR, WITH_INFLATION, type Growth, type Period } from '../model/plan';

/**
 * How much an amount of the plan's first year has changed by plan year t.
 * @param level price level of plan year t in first-year prices (the deflator)
 */
export function growthFactor(growth: Growth, t: number, level: number): number {
  return growth.kind === 'inflation' ? level * (1 + growth.real) ** t : (1 + growth.rate) ** t;
}

/**
 * Nominal amount per year in plan year t of an amount entered per period in first-year prices.
 * No period — per year; no growth — with inflation.
 */
export function amountInYear(
  value: number,
  per: Period | undefined,
  growth: Growth | undefined,
  t: number,
  level: number,
): number {
  return value * PERIODS_PER_YEAR[per ?? 'year'] * growthFactor(growth ?? WITH_INFLATION, t, level);
}
