// Budget against Wealthfolio: balances at the end of past months, budget lines from the spending
// report, fill targets from goals.
import type { AddonContext } from '@wealthfolio/addon-sdk';
import { addMonths, type Budget, type BudgetLine } from '../model/budget';
import type { SpendingReport } from './fork-api';

/** Last day of a month: "2026-11" → "2026-11-30". */
export function monthEnd(m: string): string {
  const [y, mm] = m.split('-').map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** A dated value: a valuation or a quote; date starts with YYYY-MM-DD. */
export interface Point {
  date: string;
  value: number;
}

/**
 * The value at the end of each month up to `today` (for this month — the latest one): the last
 * point on or before the month's end. A month before the first point has none.
 */
export function valuesByMonth(points: Point[], months: string[], today: string): Record<string, number> {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const out: Record<string, number> = {};
  for (const m of months) {
    if (m > today) break;
    const end = monthEnd(m);
    const last = sorted.filter((p) => p.date.slice(0, 10) <= end).at(-1);
    if (last) out[m] = last.value;
  }
  return out;
}

/** The `n` full months before `today`, as an inclusive RFC3339 range. */
export function lastMonths(today: string, n: number): { startDate: string; endDate: string } {
  return {
    startDate: `${addMonths(today, -n)}-01T00:00:00Z`,
    endDate: `${monthEnd(addMonths(today, -1))}T23:59:59Z`,
  };
}

/**
 * Monthly averages over `months` months by category, largest first and at most `max` lines each:
 * a draft of budget lines. names — category id → name.
 */
export function spendingLines(
  report: SpendingReport,
  names: Map<string, string>,
  months: number,
  max: { incomes: number; expenses: number },
): { incomes: BudgetLine[]; expenses: BudgetLine[] } {
  const lines = (rows: SpendingReport['spendingBreakdown'], fallback: string, n: number) =>
    rows
      .map((r) => ({
        name: (names.get(r.categoryId) ?? fallback).slice(0, 60),
        amount: Math.round(r.amount / months),
        from: null,
        to: null,
      }))
      .filter((l) => l.amount > 0)
      .slice(0, Math.max(n, 0));
  return {
    incomes: lines(report.incomeBreakdown, 'Other income', max.incomes),
    expenses: lines(report.spendingBreakdown, 'Uncategorized', max.expenses),
  };
}

/** Fill targets of steps linked to a goal replaced by the goal's target; an unknown goal keeps the saved one. */
export function withGoalTargets(b: Budget, goals: { id: string; targetAmount: number }[]): Budget {
  if (!b.steps.some((s) => s.kind === 'fill' && s.goalId)) return b;
  return {
    ...b,
    steps: b.steps.map((s) => {
      const g = s.kind === 'fill' && goals.find((x) => x.id === s.goalId);
      return g ? { ...s, target: g.targetAmount } : s;
    }),
  };
}

/** Per envelope and per loan: month → the Wealthfolio balance at its end (a loan — what is owed). */
export interface BudgetFact {
  envelopes: Record<string, Record<string, number>>;
  loans: Record<string, Record<string, number>>;
}

/**
 * The fact for envelopes linked to accounts (valuation history, base currency) and loans linked to
 * liabilities (valuation quotes). One that cannot be read is left out.
 */
export async function loadBudgetFact(ctx: AddonContext, b: Budget, today: string): Promise<BudgetFact> {
  const months = Array.from({ length: b.months }, (_, i) => addMonths(b.start, i));
  const byMonth = async (what: string, load: () => Promise<Point[]>) => {
    try {
      return valuesByMonth(await load(), months, today);
    } catch (e) {
      ctx.api.logger.warn(`${what} history unavailable: ${String(e)}`);
      return {};
    }
  };
  if (b.start > today) return { envelopes: {}, loans: {} };
  const envelopes = await Promise.all(
    b.envelopes.flatMap((e) =>
      e.accountId === null
        ? []
        : [
            byMonth('Account', async () =>
              (await ctx.api.portfolio.getHistoricalValuations(e.accountId!, `${b.start}-01`, monthEnd(today))).map(
                (v) => ({ date: v.valuationDate, value: v.totalValueBase }),
              ),
            ).then((v) => [e.id, v] as const),
          ],
    ),
  );
  const loans = await Promise.all(
    b.loans.flatMap((l) =>
      l.liabilityId === null
        ? []
        : [
            byMonth('Liability', async () =>
              (await ctx.api.quotes.getHistory(l.liabilityId!)).map((q) => ({
                date: q.timestamp,
                value: Math.abs(q.close),
              })),
            ).then((v) => [l.id, v] as const),
          ],
    ),
  );
  return { envelopes: Object.fromEntries(envelopes), loans: Object.fromEntries(loans) };
}
