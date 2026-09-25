// Port of planner.tax.scale: progressive scale.
import type { Scale } from './rules';

/** Tax on base (euros) under a progressive scale. A negative base gives 0. */
export function applyScale(scale: Scale, base: number): number {
  let tax = 0;
  let lower = 0;
  for (const { upto, rate } of scale.brackets) {
    const upper = upto ?? Infinity;
    tax += (Math.min(Math.max(base, lower), upper) - lower) * rate;
    lower = upper;
  }
  return tax;
}

/** Rate of the bracket the next euro above base falls into. */
export function marginalRate(scale: Scale, base: number): number {
  const b = scale.brackets.find((x) => x.upto === null || base < x.upto);
  return b!.rate;
}
