// Форматирование сумм для экранов плана. Деньги считаются float, округляются только здесь.

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

/** «nominal» — номинальные евро года; «today» — евро первого года плана. */
export type ValueMode = 'nominal' | 'today';

export function inMode(value: number, deflator: number, mode: ValueMode): number {
  return mode === 'today' ? value / deflator : value;
}
