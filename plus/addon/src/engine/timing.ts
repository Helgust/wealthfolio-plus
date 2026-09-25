// When plan events happen: timings resolve to years, milestones are reached year by year.
import type { Milestone, Plan, Timing } from '../model/plan';

/** Year a timing falls on; null — not known (yet): a milestone not reached or a missing person. */
export function timingYear(t: Timing, plan: Plan, reached: ReadonlyMap<string, number>): number | null {
  switch (t.kind) {
    case 'year':
      return t.year;
    case 'age':
      return t.person < plan.people.length ? plan.people[t.person].birthYear + t.age : null;
    case 'milestone':
      return reached.get(t.id) ?? null;
  }
}

/**
 * Whether an event is active in year: from its start year up to, not including, its end year.
 * An unknown start has not happened yet; an unknown end has not come yet.
 */
export function isActive(
  start: Timing | null,
  end: Timing | null,
  year: number,
  plan: Plan,
  reached: ReadonlyMap<string, number>,
): boolean {
  const s = start ? timingYear(start, plan, reached) : -Infinity;
  if (s === null || year < s) return false;
  const e = end ? timingYear(end, plan, reached) : null;
  return e === null || year < e;
}

/**
 * Marks the milestones reached by year (in place) and returns the ones reached in it. A year or
 * age milestone before the plan start counts as reached in its own, earlier year.
 * @param startNetWorth net worth at the start of year (end of the previous one), first-year euros
 */
export function reachMilestones(
  plan: Plan,
  year: number,
  startNetWorth: number,
  reached: Map<string, number>,
): Milestone[] {
  const now: Milestone[] = [];
  for (const m of plan.milestones) {
    if (reached.has(m.id)) continue;
    const t = m.trigger;
    const at = t.kind === 'netWorth' ? (startNetWorth >= t.amount ? year : null) : timingYear(t, plan, reached);
    if (at === null || at > year) continue;
    reached.set(m.id, at);
    if (at === year) now.push(m);
  }
  return now;
}
