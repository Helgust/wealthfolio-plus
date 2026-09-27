// When the goals of a plan run are reached, and what a loan goal's loan costs: shared by the Goals
// tab, Compare and Monte Carlo.
import type { PlanResult } from '../engine/run-plan';
import type { Goal } from '../model/plan';
import { formatMonth } from './format';

/** Months since year 0: orders months. */
export const monthIndexOf = (year: number, month: number) => year * 12 + month - 1;

/** "Aug 2027" of a month index. */
export const formatMonthIndex = (i: number) => formatMonth(Math.floor(i / 12), (i % 12) + 1);

/**
 * The year a loan goal's loan is gone otherwise than by the goal: by its last scheduled payment, a
 * prepayment flow at the end of a year or the sale of its home. null — still owed at the end.
 */
function loanGoneIn(r: PlanResult, g: Goal): { year: number; sale: boolean } | null {
  const owed = (i: number) => r.rows[i]?.savings?.goals[g.id]?.balance ?? 0;
  const gone = r.rows.findIndex((_, i) => i > 0 && owed(i - 1) > 0.005 && owed(i) <= 0.005);
  if (gone < 0) return null;
  const row = r.rows[gone];
  return { year: row.year, sale: row.realEstate.loanRepaidAtSale > 0 };
}

/**
 * Month a goal is reached, as a month index: its target, or its loan repaid. A loan gone otherwise
 * counts at the end of its year. null — not reached in the plan, or a goal with no target.
 */
export function goalMonth(r: PlanResult, g: Goal): number | null {
  const reached = r.goalsReached[g.id];
  if (reached) return monthIndexOf(reached.year, reached.month);
  if (g.kind !== 'loan') return null;
  const gone = loanGoneIn(r, g);
  return gone ? monthIndexOf(gone.year, 12) : null;
}

/**
 * "Aug 2027"; a loan gone otherwise: "2040", "2040, with the sale"; a down payment bought before it
 * was ready: "bought Mar 2030, not ready". null — not reached.
 */
export function goalLabel(r: PlanResult, g: Goal): string | null {
  const reached = r.goalsReached[g.id];
  if (reached) return formatMonth(reached.year, reached.month);
  if (g.kind !== 'loan') {
    const bought = r.downPayments.find((d) => d.goalId === g.id);
    return bought ? `bought ${formatMonth(bought.year, bought.month)}, not ready` : null;
  }
  const gone = loanGoneIn(r, g);
  return gone ? `${gone.year}${gone.sale ? ', with the sale' : ''}` : null;
}

/** Interest paid on a loan goal's loan over the plan. */
export const loanInterest = (r: PlanResult, g: Goal) =>
  r.rows.reduce((s, row) => s + (row.savings?.goals[g.id]?.interest ?? 0), 0);

/** A loan goal's payment in a month kept in the run; null — the month is not kept. */
export function loanPayment(r: PlanResult, g: Goal, year: number, month: number): number | null {
  const m = r.months.find((x) => x.year === year && x.month === month);
  return m ? (m.goals[g.id]?.payment ?? 0) : null;
}
