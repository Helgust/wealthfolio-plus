// Порт planner.tax.scale: прогрессивная шкала.
import type { Scale } from './rules';

/** Налог по прогрессивной шкале на base (евро). Отрицательная база — 0. */
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

/** Ставка ступени, в которую попадает следующий евро сверх base. */
export function marginalRate(scale: Scale, base: number): number {
  const b = scale.brackets.find((x) => x.upto === null || base < x.upto);
  return b!.rate;
}
