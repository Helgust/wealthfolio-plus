// Amount formatting for plan screens. Money is computed as float and rounded only here.

export function formatMoney(value: number, currency: string, compact = false): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
    notation: compact ? 'compact' : 'standard',
  }).format(value);
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 1 }).format(
    value,
  );
}

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 2026"; month 1 — January. */
export function formatMonth(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** "nominal" — nominal euros of the year; "today" — euros of the plan's first year. */
export type ValueMode = 'nominal' | 'today';

export function inMode(value: number, deflator: number, mode: ValueMode): number {
  return mode === 'today' ? value / deflator : value;
}
