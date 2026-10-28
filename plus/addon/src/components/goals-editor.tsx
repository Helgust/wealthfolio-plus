// Plan editor section: savings goals — accounts to save into, loans to prepay — and the monthly
// savings schedule: from a month, so many euros a month for each goal.
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@wealthfolio/ui';
import { Plus, Trash2 } from 'lucide-react';
import type { Account } from '../engine/portfolio';
import type { Loan } from '../engine/real-estate';
import { formatMoney, MONTH_NAMES } from '../lib/format';
import { KIND_LABEL } from '../model/accounts';
import {
  monthIndex,
  type AccountGoal,
  type Goal,
  type LoanGoal,
  type LoanPrepay,
  type Plan,
  type SavingsStep,
  type YearMonth,
} from '../model/plan';
import { Field, NumberInput, PercentInput } from './form-fields';
import { EFFECT_LABEL, loanOptions } from './investments-editor';
import { TimingInput } from './timing-input';

interface Props {
  draft: Plan;
  set: (patch: Partial<Plan>) => void;
  /** Modelled accounts: the ones a goal can save into */
  accounts: Account[];
  /** Modelled loans: with the mortgages of the plan's purchases, the ones a goal can prepay */
  loans: Loan[];
}

export function YearMonthInput({ value, onChange }: { value: YearMonth; onChange: (m: YearMonth) => void }) {
  return (
    <div className="flex gap-2">
      <div style={{ width: 80, flex: 'none' }}>
        <Select value={String(value.month)} onValueChange={(v) => onChange({ ...value, month: Number(v) })}>
          <SelectTrigger style={{ minWidth: 0 }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTH_NAMES.map((name, i) => (
              <SelectItem key={name} value={String(i + 1)}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div style={{ width: 80, flex: 'none' }}>
        <NumberInput value={value.year} onChange={(v) => onChange({ ...value, year: v ?? value.year })} />
      </div>
    </div>
  );
}

/** The month after m. */
const nextMonth = (m: YearMonth): YearMonth => (m.month === 12 ? { year: m.year + 1, month: 1 } : { ...m, month: m.month + 1 });

/** Now, or the plan's first January when the plan starts later. */
function firstMonth(plan: Plan): YearMonth {
  const now = new Date();
  const today = { year: now.getFullYear(), month: now.getMonth() + 1 };
  return monthIndex(today) >= monthIndex({ year: plan.startYear, month: 1 }) ? today : { year: plan.startYear, month: 1 };
}

/** How a loan goal's money reaches the loan. */
const PREPAY_LABEL: Record<LoanPrepay['kind'], string> = {
  monthly: 'Every month',
  threshold: 'Once it holds',
  months: 'In chosen months',
};

function RemoveGoal({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" aria-label="Remove goal" onClick={onClick}>
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

function AccountGoalCard({
  goal: g,
  draft,
  accounts,
  onChange,
  onRemove,
}: {
  goal: AccountGoal;
  draft: Plan;
  /** Accounts it can save into: its own and the ones no goal uses */
  accounts: Account[];
  onChange: (patch: Partial<AccountGoal>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-2 items-end gap-2 rounded-md border p-3">
      <Field label="Name">
        <Input value={g.name} onChange={(e) => onChange({ name: e.target.value })} />
      </Field>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label="Save into">
            <Select value={g.accountId} onValueChange={(v) => onChange({ accountId: v })}>
              <SelectTrigger style={{ minWidth: 0 }}>
                <SelectValue placeholder="Account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} · {KIND_LABEL[a.kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <RemoveGoal onClick={onRemove} />
      </div>
      <Field label="Target balance">
        <div className="flex gap-2">
          <Select
            value={!g.target ? 'none' : g.target.kind === 'amount' ? 'amount' : `purchase:${g.target.purchaseId}`}
            onValueChange={(v) =>
              onChange({
                target:
                  v === 'amount'
                    ? { kind: 'amount', amount: 10_000 }
                    : v.startsWith('purchase:')
                      ? { kind: 'purchase', purchaseId: v.slice('purchase:'.length) }
                      : null,
              })
            }
          >
            <SelectTrigger style={{ minWidth: 0 }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No target</SelectItem>
              <SelectItem value="amount">Up to</SelectItem>
              {draft.propertyPurchases.map((p) => (
                <SelectItem key={p.id} value={`purchase:${p.id}`}>
                  Down payment · {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {g.target?.kind === 'amount' && (
            <div style={{ width: 110, flex: 'none' }}>
              <NumberInput
                value={g.target.amount}
                step={500}
                onChange={(v) => onChange({ target: { kind: 'amount', amount: v ?? 0 } })}
              />
            </div>
          )}
        </div>
      </Field>
      <Field label="Stops">
        <TimingInput value={g.end} plan={draft} noneLabel="Never" onChange={(end) => onChange({ end })} />
      </Field>
    </div>
  );
}

function LoanGoalCard({
  goal: g,
  draft,
  loans,
  onChange,
  onRemove,
}: {
  goal: LoanGoal;
  draft: Plan;
  /** Loans it can prepay: its own and the ones no goal uses */
  loans: { id: string; name: string }[];
  onChange: (patch: Partial<LoanGoal>) => void;
  onRemove: () => void;
}) {
  const p = g.prepay;
  function choose(kind: LoanPrepay['kind']) {
    if (kind === 'monthly') onChange({ prepay: { kind } });
    else if (kind === 'threshold') onChange({ prepay: { kind, amount: 5_000 } });
    else onChange({ prepay: { kind, months: [6, 12] } });
  }
  function toggle(month: number) {
    if (p.kind !== 'months') return;
    const months = p.months.includes(month) ? p.months.filter((m) => m !== month) : [...p.months, month].sort((a, b) => a - b);
    if (months.length) onChange({ prepay: { kind: 'months', months } });
  }

  return (
    <div className="grid grid-cols-2 items-end gap-2 rounded-md border p-3">
      <Field label="Name">
        <Input value={g.name} onChange={(e) => onChange({ name: e.target.value })} />
      </Field>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label="Prepay loan">
            <Select value={g.loanId} onValueChange={(v) => onChange({ loanId: v })}>
              <SelectTrigger style={{ minWidth: 0 }}>
                <SelectValue placeholder="Loan" />
              </SelectTrigger>
              <SelectContent>
                {loans.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <RemoveGoal onClick={onRemove} />
      </div>
      <Field label="Effect">
        <Select value={g.effect} onValueChange={(v) => onChange({ effect: v as LoanGoal['effect'] })}>
          <SelectTrigger style={{ minWidth: 0 }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(EFFECT_LABEL) as LoanGoal['effect'][]).map((e) => (
              <SelectItem key={e} value={e}>
                {EFFECT_LABEL[e]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Fee, %">
          <PercentInput value={g.fee} onChange={(fee) => onChange({ fee })} />
        </Field>
        <Field label="Stops">
          <TimingInput value={g.end} plan={draft} noneLabel="Repaid" onChange={(end) => onChange({ end })} />
        </Field>
      </div>
      <Field label="Prepay">
        <div className="flex gap-2">
          <Select value={p.kind} onValueChange={(v) => choose(v as LoanPrepay['kind'])}>
            <SelectTrigger style={{ minWidth: 0 }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PREPAY_LABEL) as LoanPrepay['kind'][]).map((k) => (
                <SelectItem key={k} value={k}>
                  {PREPAY_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {p.kind === 'threshold' && (
            <div style={{ width: 110, flex: 'none' }}>
              <NumberInput value={p.amount} step={500} onChange={(v) => onChange({ prepay: { kind: 'threshold', amount: v ?? 0 } })} />
            </div>
          )}
        </div>
      </Field>
      <div />
      {p.kind === 'months' && (
        <div className="col-span-2 flex flex-wrap gap-1">
          {MONTH_NAMES.map((name, k) => (
            <Button
              key={name}
              size="sm"
              variant={p.months.includes(k + 1) ? 'default' : 'outline'}
              aria-pressed={p.months.includes(k + 1)}
              onClick={() => toggle(k + 1)}
            >
              {name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function GoalsEditor({ draft, set, accounts, loans }: Props) {
  const goals = draft.goals;
  const steps = draft.savings;
  const usedAccounts = new Set(goals.flatMap((g) => (g.kind === 'account' ? [g.accountId] : [])));
  const usedLoans = new Set(goals.flatMap((g) => (g.kind === 'loan' ? [g.loanId] : [])));
  const freeAccounts = accounts.filter((a) => !usedAccounts.has(a.id));
  const allLoans = loanOptions(draft, loans);
  const freeLoans = allLoans.filter((l) => !usedLoans.has(l.id));
  const setGoal = (i: number, patch: Partial<AccountGoal> | Partial<LoanGoal>) =>
    set({ goals: goals.map((g, j) => (j === i ? ({ ...g, ...patch } as Goal) : g)) });
  const setStep = (i: number, patch: Partial<SavingsStep>) =>
    set({ savings: steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const newId = () => `g${Date.now().toString(36)}`;

  function addAccountGoal() {
    const a = freeAccounts[0];
    set({ goals: [...goals, { kind: 'account', id: newId(), name: a.name, accountId: a.id, target: null, end: null }] });
  }

  function addLoanGoal() {
    const l = freeLoans[0];
    const goal: LoanGoal = {
      kind: 'loan',
      id: newId(),
      name: l.name,
      loanId: l.id,
      effect: 'term',
      fee: 0,
      prepay: { kind: 'monthly' },
      end: null,
    };
    set({ goals: [...goals, goal] });
  }

  /** A goal leaves the schedule with it. */
  function removeGoal(i: number) {
    const id = goals[i].id;
    set({
      goals: goals.filter((_, j) => j !== i),
      savings: steps.map((s) => ({ ...s, amounts: Object.fromEntries(Object.entries(s.amounts).filter(([k]) => k !== id)) })),
    });
  }

  /** A new step starts the month after the last one, with its amounts. */
  function addStep() {
    const last = steps.at(-1);
    set({ savings: [...steps, { from: last ? nextMonth(last.from) : firstMonth(draft), amounts: { ...(last?.amounts ?? {}) } }] });
  }

  const columns = `10.5rem repeat(${Math.max(goals.length, 1)}, minmax(5rem, 1fr)) 5.5rem auto`;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="font-medium">Goals</h3>
        <p className="text-muted-foreground text-xs">
          Where the monthly savings go. With a target, a goal takes money while its account is below the target, and
          again if the account falls below it; without one — as long as the schedule gives it an amount. A pension plan
          takes no more than the year's deductible room. A down payment goal saves up to what a purchase in the plan
          takes beyond its mortgage — with the purchase tax and costs, at that year's prices — and pays it in the
          purchase month. A loan goal prepays the loan after the month's payment — every
          month, or what it holds once it reaches an amount or in chosen months; until then the money is kept apart. What
          a goal cannot take goes to the other goals, then to cash.
        </p>
        {goals.map((g, i) =>
          g.kind === 'account' ? (
            <AccountGoalCard
              key={g.id}
              goal={g}
              draft={draft}
              accounts={accounts.filter((a) => a.id === g.accountId || !usedAccounts.has(a.id))}
              onChange={(patch) => setGoal(i, patch)}
              onRemove={() => removeGoal(i)}
            />
          ) : (
            <LoanGoalCard
              key={g.id}
              goal={g}
              draft={draft}
              loans={allLoans.filter((l) => l.id === g.loanId || !usedLoans.has(l.id))}
              onChange={(patch) => setGoal(i, patch)}
              onRemove={() => removeGoal(i)}
            />
          ),
        )}
        {!accounts.length && (
          <p className="text-muted-foreground text-xs">No modelled accounts: set account types on the Accounts tab.</p>
        )}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={!freeAccounts.length || goals.length >= 20} onClick={addAccountGoal}>
            <Plus className="h-4 w-4" /> Add savings goal
          </Button>
          <Button variant="outline" size="sm" disabled={!freeLoans.length || goals.length >= 20} onClick={addLoanGoal}>
            <Plus className="h-4 w-4" /> Add loan goal
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">Monthly savings</h3>
        <p className="text-muted-foreground text-xs">
          From a month on, so many euros a month for each goal, until the next step; nominal euros, like a bank
          transfer. Each month the free money — income less spending and the taxes paid — pays the savings, up to them;
          what it cannot pay is the savings deficit and is not caught up later. What the month has beyond the savings
          stays in cash, and at the end of the year goes through the flows.
        </p>
        {steps.length > 0 && (
          <div className="overflow-x-auto">
            <div className="space-y-2" style={{ minWidth: 'min-content' }}>
              <div className="text-muted-foreground grid items-end gap-2 text-xs" style={{ gridTemplateColumns: columns }}>
                <div>From</div>
                {goals.length ? goals.map((g) => <div key={g.id} className="truncate">{g.name}</div>) : <div>—</div>}
                <div className="text-right">Total</div>
                <div />
              </div>
              {steps.map((s, i) => (
                <div key={i} className="grid items-center gap-2" style={{ gridTemplateColumns: columns }}>
                  <YearMonthInput value={s.from} onChange={(from) => setStep(i, { from })} />
                  {goals.length ? (
                    goals.map((g) => (
                      <NumberInput
                        key={g.id}
                        value={s.amounts[g.id] ?? 0}
                        step={50}
                        onChange={(v) => setStep(i, { amounts: { ...s.amounts, [g.id]: v ?? 0 } })}
                      />
                    ))
                  ) : (
                    <div className="text-muted-foreground text-xs">Add a goal first</div>
                  )}
                  <div className="text-right text-sm tabular-nums">
                    {formatMoney(Object.values(s.amounts).reduce((sum, x) => sum + x, 0), 'EUR')}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove step"
                    onClick={() => set({ savings: steps.filter((_, j) => j !== i) })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
        <Button variant="outline" size="sm" disabled={!goals.length || steps.length >= 60} onClick={addStep}>
          <Plus className="h-4 w-4" /> {steps.length ? 'Change from a month' : 'Start saving'}
        </Button>
      </section>
    </div>
  );
}
