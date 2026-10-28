// The calendar of a year's money: how an amount of the year falls into its months. Weights of the 12
// months add up to 1, so the months of a year always add up to the year.

/** Weights of January … December; they add up to 1. */
export type Calendar = readonly number[];

/** An amount spread over the year: salaries in 12 payments, expenses, RETA, loan payments. */
export const EVEN: Calendar = new Array(12).fill(1 / 12);

const IN_MONTH: Calendar[] = Array.from({ length: 12 }, (_, m) => Array.from({ length: 12 }, (_, i) => (i === m ? 1 : 0)));

/** All of it in one month; 1 — January. */
export const inMonth = (month: number): Calendar => IN_MONTH[month - 1];

/** A month, or spread over the year when none is given. */
export const monthOrEven = (month: number | undefined): Calendar => (month ? inMonth(month) : EVEN);

/** Equal parts in the given months. */
const inMonths = (months: number[]): Calendar =>
  Array.from({ length: 12 }, (_, i) => (months.includes(i + 1) ? 1 / months.length : 0));

/** 14 pagas: 12 monthly ones and an extra one in each of the extra months. */
export const fourteenPagas = (extras: [number, number]): Calendar =>
  Array.from({ length: 12 }, (_, i) => (extras.includes(i + 1) ? 2 : 1) / 14);

const FOURTEEN_SALARY = fourteenPagas([6, 12]);

/** A salary: 12 payments, or 14 with the pagas extra of June and December. */
export const salary = (pagas: 12 | 14 | undefined): Calendar => (pagas === 14 ? FOURTEEN_SALARY : EVEN);

/** Seguridad Social pensions: 14 pagas, the extra ones in June and November. */
export const PUBLIC_PENSION = fourteenPagas([6, 11]);

/**
 * Pagos fraccionados of modelo 130, a quarter each: April, July, October — and the fourth, due by
 * 30 January, in December, so that the year's pagos a cuenta stay in it as the yearly engine counts
 * them.
 */
export const MODELO_130 = inMonths([4, 7, 10, 12]);

const RENTA_SPLIT: Calendar = Array.from({ length: 12 }, (_, i) => (i === 5 ? 0.6 : i === 10 ? 0.4 : 0));

/** The renta to pay: in June, or 60 % with the return in June and 40 % in November. */
export const renta = (split: boolean): Calendar => (split ? RENTA_SPLIT : inMonth(6));

/** A property sale happens mid-year. */
export const SALE = inMonth(6);

/** Adds amount by the calendar to the months (in place). */
export function spread(months: number[], amount: number, calendar: Calendar): void {
  if (amount === 0) return;
  for (let i = 0; i < 12; i++) months[i] += amount * calendar[i];
}

/** Weights of the months from money already in them: a mix of calendars by amount; EVEN for none. */
export function weightsOf(months: number[]): Calendar {
  const total = months.reduce((s, x) => s + x, 0);
  return total > 0 ? months.map((x) => x / total) : EVEN;
}
