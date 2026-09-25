// Input and label for a timing: a year, a person's age or a milestone.
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wealthfolio/ui';
import type { Milestone, Plan, Timing } from '../model/plan';
import { NumberInput } from './form-fields';

const NONE = 'none';

interface Props {
  value: Timing | null;
  onChange: (t: Timing | null) => void;
  plan: Plan;
  /** Label of the empty choice, e.g. "Plan start"; absent — a timing is required */
  noneLabel?: string;
}

/** Select value: "year", "age:<person>" or "milestone:<id>". */
function choiceOf(t: Timing | null): string {
  if (!t) return NONE;
  if (t.kind === 'age') return `age:${t.person}`;
  if (t.kind === 'milestone') return `milestone:${t.id}`;
  return 'year';
}

export function TimingInput({ value, onChange, plan, noneLabel }: Props) {
  function choose(choice: string) {
    if (choice === NONE) return onChange(null);
    if (choice === 'year') return onChange({ kind: 'year', year: plan.startYear });
    const [kind, arg] = choice.split(':');
    if (kind === 'age') {
      const person = Number(arg);
      return onChange({ kind: 'age', person, age: plan.startYear - plan.people[person].birthYear });
    }
    onChange({ kind: 'milestone', id: arg });
  }

  return (
    <div className="flex gap-2">
      <Select value={choiceOf(value)} onValueChange={choose}>
        <SelectTrigger style={{ minWidth: 0 }}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {noneLabel && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
          <SelectItem value="year">Year</SelectItem>
          {plan.people.map((p, i) => (
            <SelectItem key={i} value={`age:${i}`}>
              {p.name}'s age
            </SelectItem>
          ))}
          {plan.milestones.map((m) => (
            <SelectItem key={m.id} value={`milestone:${m.id}`}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value?.kind === 'year' && (
        <div style={{ width: 88, flex: 'none' }}>
          <NumberInput value={value.year} onChange={(v) => onChange({ ...value, year: v ?? plan.startYear })} />
        </div>
      )}
      {value?.kind === 'age' && (
        <div style={{ width: 72, flex: 'none' }}>
          <NumberInput value={value.age} onChange={(v) => onChange({ ...value, age: v ?? 0 })} />
        </div>
      )}
    </div>
  );
}

/** "2030", "Ana 65 (2051)", "Retirement (2051)", "Retirement (not reached)". */
export function timingLabel(t: Timing, plan: Plan, milestoneYears: Record<string, number>): string {
  switch (t.kind) {
    case 'year':
      return String(t.year);
    case 'age': {
      const p = plan.people[t.person];
      return p ? `${p.name} ${t.age} (${p.birthYear + t.age})` : `age ${t.age} (no such person)`;
    }
    case 'milestone': {
      const m = plan.milestones.find((x) => x.id === t.id);
      if (!m) return 'deleted milestone';
      const y = milestoneYears[t.id];
      return `${m.name} (${y === undefined ? 'not reached' : y})`;
    }
  }
}

/** "2026 – Retirement (2051)" for an event active from start up to, not including, end. */
export function spanLabel(
  start: Timing | null,
  end: Timing | null,
  plan: Plan,
  milestoneYears: Record<string, number>,
): string {
  const from = start ? timingLabel(start, plan, milestoneYears) : 'plan start';
  const to = end ? `stops ${timingLabel(end, plan, milestoneYears)}` : 'plan end';
  return `${from} → ${to}`;
}

/** Where a milestone is used: names of the events that start or stop at it. */
export function milestoneUses(plan: Plan, m: Milestone): string[] {
  const at = (t: Timing | null) => t?.kind === 'milestone' && t.id === m.id;
  const uses: string[] = [];
  plan.people.forEach((p) => {
    if (p.autonomo && (at(p.autonomo.start) || at(p.autonomo.end))) uses.push(`${p.name}'s autónomo income`);
    if (p.pension && at(p.pension.start)) uses.push(`${p.name}'s pension`);
  });
  plan.expenses.forEach((e) => (at(e.start) || at(e.end)) && uses.push(e.name));
  return uses;
}
