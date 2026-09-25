// Slide-out plan editing panel: the whole plan or one section of it (opened from the Plan tab
// cards). The draft lives in local state and is validated by the Zod schema on save.
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Switch,
} from '@wealthfolio/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Account } from '../engine/portfolio';
import type { Property } from '../engine/real-estate';
import { availableYears } from '../es-tax';
import {
  PlanSchema,
  type Expense,
  type Milestone,
  type Person,
  type Plan,
  type SpendingRule,
} from '../model/plan';
import { Field, NumberInput, PercentInput } from './form-fields';
import { InvestmentsEditor } from './investments-editor';
import { RealEstateEditor } from './real-estate-editor';
import { milestoneUses, TimingInput } from './timing-input';

export type EditorSection =
  | 'all'
  | 'household'
  | 'milestones'
  | 'expenses'
  | 'investments'
  | 'realEstate'
  | 'monteCarlo';

const TITLES: Record<EditorSection, string> = {
  all: 'Edit plan',
  household: 'Household and income',
  milestones: 'Milestones',
  expenses: 'Household expenses',
  investments: 'Returns, flows and withdrawals',
  realEstate: 'Real estate: sales and purchases',
  monteCarlo: 'Monte Carlo',
};

interface Props {
  plan: Plan;
  /** null — closed */
  section: EditorSection | null;
  onClose: () => void;
  onSave: (plan: Plan) => Promise<void>;
  /** Modelled accounts — for flows and the withdrawal order */
  accounts: Account[];
  /** Modelled properties — the ones a plan can sell */
  properties: Property[];
}

export function PlanEditor({ plan, section, onClose, onSave, accounts, properties }: Props) {
  return (
    <Sheet open={section !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="overflow-y-auto" style={{ width: 640, maxWidth: 640 }}>
        <SheetHeader>
          <SheetTitle>{TITLES[section ?? 'all']}</SheetTitle>
          <SheetDescription>Amounts are per year, in euros of the plan's first year.</SheetDescription>
        </SheetHeader>
        {/* The form mounts on open, so the draft always starts from the plan. */}
        {section && (
          <PlanForm
            plan={plan}
            section={section}
            accounts={accounts}
            properties={properties}
            onSave={onSave}
            onCancel={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

const newPerson = (plan: Plan): Person => ({
  name: 'Partner',
  birthYear: plan.people[0].birthYear,
  disability: 'ninguna',
  autonomo: null,
  pension: null,
});

const newExpense = (): Expense => ({
  name: 'Expense',
  amount: 0,
  kind: 'discretionary',
  start: null,
  end: null,
});

const newMilestone = (plan: Plan): Milestone => ({
  id: `m${Date.now().toString(36)}`,
  name: 'Milestone',
  trigger: { kind: 'year', year: plan.startYear + 10 },
});

function PlanForm({
  plan,
  section,
  accounts,
  properties,
  onSave,
  onCancel,
}: {
  plan: Plan;
  section: EditorSection;
  accounts: Account[];
  properties: Property[];
  onSave: (plan: Plan) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Plan>(plan);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const show = (s: EditorSection) => section === 'all' || section === s;

  const set = (patch: Partial<Plan>) => setDraft((d) => ({ ...d, ...patch }));

  async function save() {
    const parsed = PlanSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.') || 'plan'}: ${i.message}`).join('; '));
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed.data);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  const parts = [
    show('household') && <HouseholdSection key="household" draft={draft} set={set} />,
    show('milestones') && <MilestonesSection key="milestones" draft={draft} set={set} titled={section === 'all'} />,
    show('expenses') && <ExpensesSection key="expenses" draft={draft} set={set} titled={section === 'all'} />,
    show('investments') && <InvestmentsEditor key="investments" draft={draft} set={set} accounts={accounts} />,
    show('realEstate') && <RealEstateEditor key="realEstate" draft={draft} set={set} properties={properties} />,
    show('monteCarlo') && <MonteCarloSection key="monteCarlo" draft={draft} set={set} titled={section === 'all'} />,
  ].filter(Boolean);

  return (
    <div className="space-y-6 px-4 py-4">
      {parts.map((part, i) => (
        <div key={i} className="space-y-6">
          {i > 0 && <Separator />}
          {part}
        </div>
      ))}
      {error && <p className="text-destructive text-sm">{error}</p>}
      <SheetFooter className="flex-row justify-end gap-2 px-0">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save plan'}
        </Button>
      </SheetFooter>
    </div>
  );
}

interface SectionProps {
  draft: Plan;
  set: (patch: Partial<Plan>) => void;
  /** Show the section heading: false when the sheet title already names the section */
  titled?: boolean;
}

function HouseholdSection({ draft, set }: SectionProps) {
  const setPerson = (i: number, patch: Partial<Person>) =>
    set({ people: draft.people.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3">
        <Field label="Plan name">
          <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="First year">
          <NumberInput value={draft.startYear} onChange={(v) => set({ startYear: v ?? 0 })} />
        </Field>
        <Field label="Until the oldest person is (age)">
          <NumberInput value={draft.endAge} onChange={(v) => set({ endAge: v ?? 0 })} />
        </Field>
        <Field label="Inflation, % per year">
          <PercentInput value={draft.inflation} onChange={(v) => set({ inflation: v })} />
        </Field>
        <Field label="IRPF filing">
          <Select
            value={draft.filing}
            onValueChange={(v) => set({ filing: v as Plan['filing'] })}
            disabled={draft.people.length < 2}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="individual">Individual</SelectItem>
              <SelectItem value="joint">Joint (tributación conjunta)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={`Tax thresholds after ${availableYears().at(-1)}`}>
          <Select value={draft.taxRules} onValueChange={(v) => set({ taxRules: v as Plan['taxRules'] })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="frozen">Frozen (as the law stands)</SelectItem>
              <SelectItem value="indexed">Indexed to inflation</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </section>

      {draft.people.map((p, i) => (
        <section key={i} className="space-y-3">
          <Separator />
          <div className="flex items-center justify-between">
            <h3 className="font-medium">{i === 0 ? 'You' : 'Partner'}</h3>
            {i === 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => set({ people: draft.people.slice(0, 1), filing: 'individual' })}
              >
                <Trash2 className="h-4 w-4" /> Remove
              </Button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Name">
              <Input value={p.name} onChange={(e) => setPerson(i, { name: e.target.value })} />
            </Field>
            <Field label="Birth year">
              <NumberInput value={p.birthYear} onChange={(v) => setPerson(i, { birthYear: v ?? 0 })} />
            </Field>
            <Field label="Disability">
              <Select
                value={p.disability}
                onValueChange={(v) => setPerson(i, { disability: v as Person['disability'] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ninguna">None</SelectItem>
                  <SelectItem value="grado_33">33–64 %</SelectItem>
                  <SelectItem value="grado_65">65 % or more</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={p.autonomo !== null}
              onCheckedChange={(on) =>
                setPerson(i, {
                  autonomo: on
                    ? { revenue: 0, expenses: 0, growth: draft.inflation, start: null, end: null }
                    : null,
                })
              }
            />
            <Label className="text-sm">Autónomo income</Label>
          </div>
          {p.autonomo && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Revenue (facturación)">
                  <NumberInput
                    value={p.autonomo.revenue}
                    step={1000}
                    onChange={(v) => setPerson(i, { autonomo: { ...p.autonomo!, revenue: v ?? 0 } })}
                  />
                </Field>
                <Field label="Expenses, excl. RETA">
                  <NumberInput
                    value={p.autonomo.expenses}
                    step={500}
                    onChange={(v) => setPerson(i, { autonomo: { ...p.autonomo!, expenses: v ?? 0 } })}
                  />
                </Field>
                <Field label="Growth, % per year">
                  <PercentInput
                    value={p.autonomo.growth}
                    onChange={(v) => setPerson(i, { autonomo: { ...p.autonomo!, growth: v } })}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Starts">
                  <TimingInput
                    value={p.autonomo.start}
                    plan={draft}
                    noneLabel="Plan start"
                    onChange={(t) => setPerson(i, { autonomo: { ...p.autonomo!, start: t } })}
                  />
                </Field>
                <Field label="Stops">
                  <TimingInput
                    value={p.autonomo.end}
                    plan={draft}
                    noneLabel="Never"
                    onChange={(t) => setPerson(i, { autonomo: { ...p.autonomo!, end: t } })}
                  />
                </Field>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Switch
              checked={p.pension !== null}
              onCheckedChange={(on) =>
                setPerson(i, {
                  pension: on ? { amount: 0, start: { kind: 'age', person: i, age: 67 } } : null,
                })
              }
            />
            <Label className="text-sm">Seguridad Social pension</Label>
          </div>
          {p.pension && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Gross per year (from the SS report)">
                <NumberInput
                  value={p.pension.amount}
                  step={500}
                  onChange={(v) => setPerson(i, { pension: { ...p.pension!, amount: v ?? 0 } })}
                />
              </Field>
              <Field label="Starts">
                <TimingInput
                  value={p.pension.start}
                  plan={draft}
                  onChange={(t) => t && setPerson(i, { pension: { ...p.pension!, start: t } })}
                />
              </Field>
            </div>
          )}
        </section>
      ))}
      {draft.people.length < 2 && (
        <Button variant="outline" size="sm" onClick={() => set({ people: [...draft.people, newPerson(draft)] })}>
          <Plus className="h-4 w-4" /> Add partner
        </Button>
      )}

      <Separator />
      <section className="space-y-3">
        <h3 className="font-medium">Children</h3>
        <p className="text-muted-foreground text-xs">Used for the mínimo por descendientes (under 25, no own income).</p>
        {draft.children.map((c, i) => (
          <div key={i} className="flex items-end gap-2">
            <Field label="Birth year">
              <NumberInput
                value={c.birthYear}
                onChange={(v) =>
                  set({ children: draft.children.map((x, j) => (j === i ? { birthYear: v ?? 0 } : x)) })
                }
              />
            </Field>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove child"
              onClick={() => set({ children: draft.children.filter((_, j) => j !== i) })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => set({ children: [...draft.children, { birthYear: draft.startYear }] })}
        >
          <Plus className="h-4 w-4" /> Add child
        </Button>
      </section>
    </div>
  );
}

function MilestonesSection({ draft, set, titled }: SectionProps) {
  const setMilestone = (i: number, patch: Partial<Milestone>) =>
    set({ milestones: draft.milestones.map((m, j) => (j === i ? { ...m, ...patch } : m)) });

  function setTrigger(i: number, choice: string) {
    const m = draft.milestones[i];
    if (choice === 'year') return setMilestone(i, { trigger: { kind: 'year', year: draft.startYear + 10 } });
    if (choice === 'netWorth') return setMilestone(i, { trigger: { kind: 'netWorth', amount: 1_000_000 } });
    const person = Number(choice.split(':')[1]);
    const age = m.trigger.kind === 'age' ? m.trigger.age : 65;
    setMilestone(i, { trigger: { kind: 'age', person, age } });
  }

  return (
    <section className="space-y-3">
      {titled && <h3 className="font-medium">Milestones</h3>}
      <p className="text-muted-foreground text-xs">
        Points that income and expenses start or stop at. A net worth milestone is reached in the year that
        starts with at least that net worth, in euros of the first year.
      </p>
      {draft.milestones.map((m, i) => {
        const uses = milestoneUses(draft, m);
        const t = m.trigger;
        return (
          <div key={m.id} className="space-y-1">
            <div className="grid items-end gap-2" style={{ gridTemplateColumns: '1fr 11rem 8rem auto' }}>
              <Field label="Name">
                <Input value={m.name} onChange={(e) => setMilestone(i, { name: e.target.value })} />
              </Field>
              <Field label="Reached at">
                <Select
                  value={t.kind === 'age' ? `age:${t.person}` : t.kind}
                  onValueChange={(v) => setTrigger(i, v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="year">Year</SelectItem>
                    {draft.people.map((p, j) => (
                      <SelectItem key={j} value={`age:${j}`}>
                        {p.name}'s age
                      </SelectItem>
                    ))}
                    <SelectItem value="netWorth">Net worth at least</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t.kind === 'netWorth' ? 'Amount' : t.kind === 'age' ? 'Age' : 'Year'}>
                <NumberInput
                  value={t.kind === 'netWorth' ? t.amount : t.kind === 'age' ? t.age : t.year}
                  step={t.kind === 'netWorth' ? 10_000 : 1}
                  onChange={(v) =>
                    setMilestone(i, {
                      trigger:
                        t.kind === 'netWorth'
                          ? { ...t, amount: v ?? 0 }
                          : t.kind === 'age'
                            ? { ...t, age: v ?? 0 }
                            : { ...t, year: v ?? draft.startYear },
                    })
                  }
                />
              </Field>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove milestone"
                disabled={uses.length > 0}
                onClick={() => set({ milestones: draft.milestones.filter((_, j) => j !== i) })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {uses.length > 0 && (
              <p className="text-muted-foreground text-xs">Used by {uses.join(', ')} — change those to remove it.</p>
            )}
          </div>
        );
      })}
      <Button
        variant="outline"
        size="sm"
        disabled={draft.milestones.length >= 20}
        onClick={() => set({ milestones: [...draft.milestones, newMilestone(draft)] })}
      >
        <Plus className="h-4 w-4" /> Add milestone
      </Button>
    </section>
  );
}

function ExpensesSection({ draft, set, titled }: SectionProps) {
  const setExpense = (i: number, patch: Partial<Expense>) =>
    set({ expenses: draft.expenses.map((e, j) => (j === i ? { ...e, ...patch } : e)) });

  return (
    <section className="space-y-3">
      {titled && <h3 className="font-medium">Household expenses</h3>}
      {draft.expenses.map((e, i) => (
        <div key={i} className="space-y-2 rounded-md border p-3">
          <div className="grid items-end gap-2" style={{ gridTemplateColumns: '1fr 7rem 9rem auto' }}>
            <Field label="Name">
              <Input value={e.name} onChange={(ev) => setExpense(i, { name: ev.target.value })} />
            </Field>
            <Field label="Per year">
              <NumberInput value={e.amount} step={500} onChange={(v) => setExpense(i, { amount: v ?? 0 })} />
            </Field>
            <Field label="Kind">
              <Select value={e.kind} onValueChange={(v) => setExpense(i, { kind: v as Expense['kind'] })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="essential">Essential</SelectItem>
                  <SelectItem value="discretionary">Discretionary</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove expense"
              onClick={() => set({ expenses: draft.expenses.filter((_, j) => j !== i) })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Starts">
              <TimingInput
                value={e.start}
                plan={draft}
                noneLabel="Plan start"
                onChange={(t) => setExpense(i, { start: t })}
              />
            </Field>
            <Field label="Stops">
              <TimingInput value={e.end} plan={draft} noneLabel="Never" onChange={(t) => setExpense(i, { end: t })} />
            </Field>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => set({ expenses: [...draft.expenses, newExpense()] })}>
        <Plus className="h-4 w-4" /> Add expense
      </Button>
      <SpendingRuleEditor draft={draft} set={set} />
    </section>
  );
}

const RULE_LABEL: Record<SpendingRule['kind'], string> = {
  planned: 'As planned',
  percent: '% of portfolio',
  guytonKlinger: 'Guyton–Klinger guardrails',
};

function SpendingRuleEditor({ draft, set }: SectionProps) {
  const rule = draft.spending;
  const start = rule.kind === 'planned' ? null : rule.start;

  function choose(kind: SpendingRule['kind']) {
    const from = start ?? (draft.milestones[0] ? { kind: 'milestone' as const, id: draft.milestones[0].id } : { kind: 'year' as const, year: draft.startYear });
    if (kind === 'planned') set({ spending: { kind } });
    else if (kind === 'percent') set({ spending: { kind, start: from, rate: 0.04 } });
    else set({ spending: { kind, start: from, rate: 0.05, guardrail: 0.2, adjustment: 0.1 } });
  }

  return (
    <div className="space-y-3 pt-3">
      <h3 className="font-medium">Spending rule</h3>
      <p className="text-muted-foreground text-xs">
        From its start, the rule sets how much the accounts give each year. Discretionary spending is what income and
        that amount leave after essential expenses and taxes; the planned discretionary expenses no longer apply.
        Essential expenses are always paid.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Rule">
          <Select value={rule.kind} onValueChange={(v) => choose(v as SpendingRule['kind'])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(RULE_LABEL) as SpendingRule['kind'][]).map((k) => (
                <SelectItem key={k} value={k}>
                  {RULE_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {rule.kind !== 'planned' && (
          <Field label="Starts">
            <TimingInput value={rule.start} plan={draft} onChange={(t) => t && set({ spending: { ...rule, start: t } })} />
          </Field>
        )}
      </div>
      {rule.kind !== 'planned' && (
        <div className="grid grid-cols-3 gap-3">
          <Field label={rule.kind === 'percent' ? '% of the portfolio a year' : 'Initial % of the portfolio'}>
            <PercentInput value={rule.rate} onChange={(v) => set({ spending: { ...rule, rate: v } })} />
          </Field>
          {rule.kind === 'guytonKlinger' && (
            <>
              <Field label="Guardrail, ± % of the initial rate">
                <PercentInput value={rule.guardrail} onChange={(v) => set({ spending: { ...rule, guardrail: v } })} />
              </Field>
              <Field label="Cut or raise by, %">
                <PercentInput value={rule.adjustment} onChange={(v) => set({ spending: { ...rule, adjustment: v } })} />
              </Field>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const EQUITY_FIELDS: [keyof Plan['equityShare'], string][] = [
  ['fund', 'Fondos'],
  ['brokerage', 'Brokerage'],
  ['pension', 'Pension plans'],
];

function MonteCarloSection({ draft, set, titled }: SectionProps) {
  return (
    <div className="space-y-3">
      {titled && <h3 className="font-medium">Monte Carlo</h3>}
      <p className="text-muted-foreground text-xs">
        Stocks share of each account type, the rest is bonds: random years move its returns around the
        expected ones. The deterministic plan does not use it.
      </p>
      <div className="grid grid-cols-3 gap-3">
        {EQUITY_FIELDS.map(([k, label]) => (
          <Field key={k} label={`${label}: stocks, %`}>
            <PercentInput
              value={draft.equityShare[k]}
              onChange={(v) => set({ equityShare: { ...draft.equityShare, [k]: v } })}
            />
          </Field>
        ))}
        <Field label="Trials">
          <NumberInput
            value={draft.monteCarlo.trials}
            step={100}
            onChange={(v) => set({ monteCarlo: { ...draft.monteCarlo, trials: v ?? 0 } })}
          />
        </Field>
        <Field label="Seed">
          <NumberInput
            value={draft.monteCarlo.seed}
            onChange={(v) => set({ monteCarlo: { ...draft.monteCarlo, seed: v ?? 0 } })}
          />
        </Field>
      </div>
    </div>
  );
}
