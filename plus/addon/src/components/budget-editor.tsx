// Slide-out budget editor. The draft lives in local state and is validated by the Zod schema on
// save. Removing an envelope or a loan removes the queue steps and prepayments that use it.
import {
  Button,
  Input,
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
  ToggleGroup,
  ToggleGroupItem,
} from '@wealthfolio/ui';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { monthsToRepay } from '../engine/real-estate';
import { formatMoney } from '../lib/format';
import { isLiability, liabilityRate, type LoadedPortfolio } from '../lib/starting-point';
import {
  BudgetSchema,
  type Budget,
  type BudgetLine,
  type BudgetLoan,
  type BudgetStep,
  type Envelope,
  type OneTimeItem,
  type Prepayment,
} from '../model/budget';
import { Field, NumberInput, PercentInput } from './form-fields';

const NONE = 'none';
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

interface Props {
  budget: Budget;
  open: boolean;
  portfolio: LoadedPortfolio;
  currency: string;
  onClose: () => void;
  onSave: (budget: Budget) => Promise<void>;
}

export function BudgetEditor({ budget, open, portfolio, currency, onClose, onSave }: Props) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="overflow-y-auto" style={{ width: 720, maxWidth: 720 }}>
        <SheetHeader>
          <SheetTitle>Edit budget</SheetTitle>
          <SheetDescription>Net euros per month. Months are YYYY-MM; an empty “to” — until the end.</SheetDescription>
        </SheetHeader>
        {/* The form mounts on open, so the draft always starts from the budget. */}
        {open && (
          <BudgetForm budget={budget} portfolio={portfolio} currency={currency} onSave={onSave} onCancel={onClose} />
        )}
      </SheetContent>
    </Sheet>
  );
}

type Set = (patch: Partial<Budget>) => void;

function BudgetForm({
  budget,
  portfolio,
  currency,
  onSave,
  onCancel,
}: Omit<Props, 'open' | 'onClose'> & { onCancel: () => void }) {
  const [draft, setDraft] = useState<Budget>(budget);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set: Set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  async function save() {
    const parsed = BudgetSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.') || 'budget'}: ${i.message}`).join('; '));
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
    <GeneralSection key="general" draft={draft} set={set} />,
    <LinesSection key="incomes" title="Incomes" field="incomes" draft={draft} set={set} />,
    <LinesSection key="expenses" title="Expenses" field="expenses" draft={draft} set={set} />,
    <EnvelopesSection key="envelopes" draft={draft} set={set} portfolio={portfolio} currency={currency} />,
    <LoansSection key="loans" draft={draft} set={set} portfolio={portfolio} currency={currency} />,
    <StepsSection key="steps" draft={draft} set={set} />,
    <PrepaymentsSection key="prepayments" draft={draft} set={set} />,
    <OneTimeSection key="oneTime" draft={draft} set={set} />,
  ];

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
          {saving ? 'Saving…' : 'Save budget'}
        </Button>
      </SheetFooter>
    </div>
  );
}

interface SectionProps {
  draft: Budget;
  set: Set;
}

function Section({
  title,
  hint,
  onAdd,
  children,
}: {
  title: string;
  hint?: string;
  onAdd?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{title}</h3>
        {onAdd && (
          <Button variant="outline" size="sm" onClick={onAdd}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        )}
      </div>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      {children}
    </section>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" aria-label="Remove" onClick={onClick}>
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

/** A month as YYYY-MM; WebKit has no month picker and shows a text field, hence the placeholder. */
function MonthInput({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <Input
      type="month"
      placeholder="YYYY-MM"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
    />
  );
}

function Choice({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, label]) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const replace = <T,>(list: T[], i: number, patch: Partial<T>) => list.map((x, j) => (j === i ? { ...x, ...patch } : x));
const without = <T,>(list: T[], i: number) => list.filter((_, j) => j !== i);

function GeneralSection({ draft, set }: SectionProps) {
  return (
    <section className="grid grid-cols-3 gap-3">
      <Field label="Name">
        <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label="First month">
        <MonthInput value={draft.start} onChange={(v) => v && set({ start: v })} />
      </Field>
      <Field label="Months (up to 36)">
        <NumberInput value={draft.months} onChange={(v) => set({ months: v ?? 0 })} />
      </Field>
    </section>
  );
}

function LinesSection({ title, field, draft, set }: SectionProps & { title: string; field: 'incomes' | 'expenses' }) {
  const lines = draft[field];
  const setLines = (next: BudgetLine[]) => set({ [field]: next });
  return (
    <Section
      title={title}
      hint={
        field === 'incomes'
          ? 'Net, per month. A raise is a new line from its month.'
          : 'Per month: taxes set aside, living, …'
      }
      onAdd={() =>
        setLines([...lines, { name: field === 'incomes' ? 'Income' : 'Expense', amount: 0, from: null, to: null }])
      }
    >
      {lines.map((l, i) => (
        <div key={i} className="grid items-end gap-2" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr auto' }}>
          <Field label="Name">
            <Input value={l.name} onChange={(e) => setLines(replace(lines, i, { name: e.target.value }))} />
          </Field>
          <Field label="€ / month">
            <NumberInput value={l.amount} step={10} onChange={(v) => setLines(replace(lines, i, { amount: v ?? 0 }))} />
          </Field>
          <Field label="From">
            <MonthInput value={l.from} onChange={(v) => setLines(replace(lines, i, { from: v }))} />
          </Field>
          <Field label="To (not incl.)">
            <MonthInput value={l.to} onChange={(v) => setLines(replace(lines, i, { to: v }))} />
          </Field>
          <RemoveButton onClick={() => setLines(without(lines, i))} />
        </div>
      ))}
    </Section>
  );
}

function EnvelopesSection({
  draft,
  set,
  portfolio,
  currency,
}: SectionProps & { portfolio: LoadedPortfolio; currency: string }) {
  const envelopes = draft.envelopes;
  const setEnvelopes = (next: Envelope[]) => set({ envelopes: next });
  const remove = (id: string) =>
    set({
      envelopes: envelopes.filter((e) => e.id !== id),
      steps: draft.steps.filter((s) => s.envelopeId !== id),
      prepayments: draft.prepayments.filter((p) => p.envelopeId !== id),
      oneTime: draft.oneTime.map((o) => (o.envelopeId === id ? { ...o, envelopeId: null } : o)),
    });
  const accounts: [string, string][] = [
    [NONE, 'Not linked'],
    ...portfolio.accounts.map((a): [string, string] => [a.id, a.name]),
  ];
  return (
    <Section
      title="Envelopes"
      hint="Savings pockets: safety fund, prepayment pot, spending fund, investments. Link one to its Wealthfolio account to compare the plan with the fact."
      onAdd={() => setEnvelopes([...envelopes, { id: newId('e'), name: 'Envelope', balance: 0, accountId: null }])}
    >
      {envelopes.map((e, i) => {
        const account = portfolio.accounts.find((a) => a.id === e.accountId);
        return (
          <div key={e.id} className="grid items-end gap-2" style={{ gridTemplateColumns: '2fr 1fr 2fr auto' }}>
            <Field label="Name">
              <Input value={e.name} onChange={(ev) => setEnvelopes(replace(envelopes, i, { name: ev.target.value }))} />
            </Field>
            <Field label="Balance at start">
              <NumberInput
                value={e.balance}
                step={10}
                onChange={(v) => setEnvelopes(replace(envelopes, i, { balance: v ?? 0 }))}
              />
            </Field>
            <Field label={account ? `Account (now ${formatMoney(account.wfValue, currency)})` : 'Account'}>
              <Choice
                value={e.accountId ?? NONE}
                options={accounts}
                onChange={(v) => setEnvelopes(replace(envelopes, i, { accountId: v === NONE ? null : v }))}
              />
            </Field>
            <div className="flex">
              {account && (
                <Button
                  variant="ghost"
                  size="sm"
                  title="Balance at start = the account's balance now"
                  onClick={() => setEnvelopes(replace(envelopes, i, { balance: Math.max(account.wfValue, 0) }))}
                >
                  Use now
                </Button>
              )}
              <RemoveButton onClick={() => remove(e.id)} />
            </div>
          </div>
        );
      })}
    </Section>
  );
}

function LoansSection({
  draft,
  set,
  portfolio,
  currency,
}: SectionProps & { portfolio: LoadedPortfolio; currency: string }) {
  const loans = draft.loans;
  const setLoans = (next: BudgetLoan[]) => set({ loans: next });
  const remove = (id: string) =>
    set({
      loans: loans.filter((l) => l.id !== id),
      prepayments: draft.prepayments.filter((p) => p.loanId !== id),
      steps: draft.steps.map((s) => (s.kind !== 'fill' && s.whileLoan === id ? { ...s, whileLoan: null } : s)),
    });
  const liabilities = (portfolio.alternatives ?? []).filter(isLiability);
  const options: [string, string][] = [
    [NONE, 'Not linked'],
    ...liabilities.map((h): [string, string] => [h.id, h.name]),
  ];
  return (
    <Section
      title="Loans"
      hint="Annuity loans. Linking a Wealthfolio liability fills the balance and the rate (TIN); the payment is from your bank."
      onAdd={() =>
        setLoans([...loans, { id: newId('l'), name: 'Loan', balance: 0, rate: 0, payment: 0, liabilityId: null }])
      }
    >
      {loans.map((l, i) => {
        const months = monthsToRepay(l.balance, l.rate, l.payment);
        return (
          <div key={l.id} className="space-y-1">
            <div className="grid items-end gap-2" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 2fr auto' }}>
              <Field label="Name">
                <Input value={l.name} onChange={(e) => setLoans(replace(loans, i, { name: e.target.value }))} />
              </Field>
              <Field label="Balance">
                <NumberInput
                  value={l.balance}
                  step={10}
                  onChange={(v) => setLoans(replace(loans, i, { balance: v ?? 0 }))}
                />
              </Field>
              <Field label="TIN, %">
                <PercentInput value={l.rate} onChange={(v) => setLoans(replace(loans, i, { rate: v }))} />
              </Field>
              <Field label="€ / month">
                <NumberInput
                  value={l.payment}
                  step={5}
                  onChange={(v) => setLoans(replace(loans, i, { payment: v ?? 0 }))}
                />
              </Field>
              <Field label="Wealthfolio liability">
                <Choice
                  value={l.liabilityId ?? NONE}
                  options={options}
                  onChange={(v) => {
                    const h = liabilities.find((x) => x.id === v);
                    setLoans(
                      replace(
                        loans,
                        i,
                        h
                          ? {
                              liabilityId: h.id,
                              balance: Math.abs(Number(h.marketValue)),
                              rate: liabilityRate(h),
                            }
                          : { liabilityId: null },
                      ),
                    );
                  }}
                />
              </Field>
              <RemoveButton onClick={() => remove(l.id)} />
            </div>
            <p className="text-muted-foreground text-xs">
              {l.balance <= 0
                ? 'Repaid.'
                : Number.isFinite(months)
                  ? `${Math.ceil(months)} payments left; interest ${formatMoney(l.payment * months - l.balance, currency)} without prepayments.`
                  : 'The payment does not cover the interest.'}
            </p>
          </div>
        );
      })}
    </Section>
  );
}

const STEP_KINDS: [BudgetStep['kind'], string][] = [
  ['fixed', 'Fixed a month'],
  ['fill', 'Fill to a target'],
  ['rest', 'Everything left'],
];

function newStep(kind: BudgetStep['kind'], envelopeId: string): BudgetStep {
  if (kind === 'fixed') return { kind, envelopeId, amount: 0, cap: null, whileLoan: null };
  if (kind === 'fill') return { kind, envelopeId, target: 0 };
  return { kind, envelopeId, whileLoan: null };
}

function StepsSection({ draft, set }: SectionProps) {
  const steps = draft.steps;
  const setSteps = (next: BudgetStep[]) => set({ steps: next });
  const move = (i: number, by: number) => {
    const next = [...steps];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setSteps(next);
  };
  const envelopes: [string, string][] = draft.envelopes.map((e) => [e.id, e.name]);
  const loans: [string, string][] = [
    [NONE, 'Always'],
    ...draft.loans.map((l): [string, string] => [l.id, `While ${l.name} is open`]),
  ];
  return (
    <Section
      title="Queue"
      hint="The month's free money goes down the queue in order. What is left after the last step stays unallocated."
      onAdd={draft.envelopes.length ? () => setSteps([...steps, newStep('fixed', draft.envelopes[0].id)]) : undefined}
    >
      {!draft.envelopes.length && <p className="text-muted-foreground text-xs">Add an envelope first.</p>}
      {steps.map((s, i) => (
        <div key={i} className="grid items-end gap-2" style={{ gridTemplateColumns: '1.3fr 1.5fr 1fr 1fr 1.6fr auto' }}>
          <Field label={`${i + 1}. Step`}>
            <Choice
              value={s.kind}
              options={STEP_KINDS}
              onChange={(k) =>
                setSteps(steps.map((x, j) => (j === i ? newStep(k as BudgetStep['kind'], s.envelopeId) : x)))
              }
            />
          </Field>
          <Field label="Envelope">
            <Choice
              value={s.envelopeId}
              options={envelopes}
              onChange={(v) => setSteps(replace(steps, i, { envelopeId: v }))}
            />
          </Field>
          {s.kind === 'fixed' && (
            <>
              <Field label="€ / month">
                <NumberInput
                  value={s.amount}
                  step={10}
                  onChange={(v) => setSteps(replace(steps, i, { amount: v ?? 0 }))}
                />
              </Field>
              <Field label="Cap (empty — none)">
                <NumberInput value={s.cap} step={100} onChange={(v) => setSteps(replace(steps, i, { cap: v }))} />
              </Field>
            </>
          )}
          {s.kind === 'fill' && (
            <>
              <Field label="Target">
                <NumberInput
                  value={s.target}
                  step={100}
                  onChange={(v) => setSteps(replace(steps, i, { target: v ?? 0 }))}
                />
              </Field>
              <div />
            </>
          )}
          {s.kind === 'rest' && (
            <>
              <div />
              <div />
            </>
          )}
          {s.kind === 'fill' ? (
            <div />
          ) : (
            <Field label="Runs">
              <Choice
                value={s.whileLoan ?? NONE}
                options={loans}
                onChange={(v) => setSteps(replace(steps, i, { whileLoan: v === NONE ? null : v }))}
              />
            </Field>
          )}
          <div className="flex">
            <Button variant="ghost" size="icon" aria-label="Up" disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Down"
              disabled={i === steps.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
            <RemoveButton onClick={() => setSteps(without(steps, i))} />
          </div>
        </div>
      ))}
    </Section>
  );
}

function PrepaymentsSection({ draft, set }: SectionProps) {
  const list = draft.prepayments;
  const setList = (next: Prepayment[]) => set({ prepayments: next });
  const envelopes: [string, string][] = draft.envelopes.map((e) => [e.id, e.name]);
  const loans: [string, string][] = draft.loans.map((l) => [l.id, l.name]);
  const canAdd = envelopes.length > 0 && loans.length > 0;
  return (
    <Section
      title="Prepayments"
      hint="The envelope goes into the loan at the end of the chosen months, and at once when it covers the balance. Once the loan is repaid, what is left returns to the free money."
      onAdd={
        canAdd
          ? () =>
              setList([
                ...list,
                {
                  envelopeId: envelopes[0][0],
                  loanId: loans[0][0],
                  months: [3, 6, 9, 12],
                  effect: 'payment',
                },
              ])
          : undefined
      }
    >
      {list.map((p, i) => (
        <div key={i} className="space-y-2">
          <div className="grid items-end gap-2" style={{ gridTemplateColumns: '1fr 1fr 1.4fr auto' }}>
            <Field label="From envelope">
              <Choice
                value={p.envelopeId}
                options={envelopes}
                onChange={(v) => setList(replace(list, i, { envelopeId: v }))}
              />
            </Field>
            <Field label="Into loan">
              <Choice value={p.loanId} options={loans} onChange={(v) => setList(replace(list, i, { loanId: v }))} />
            </Field>
            <Field label="Effect">
              <Choice
                value={p.effect}
                options={[
                  ['payment', 'Reducir cuota (lower payment)'],
                  ['term', 'Reducir plazo (shorter term)'],
                ]}
                onChange={(v) => setList(replace(list, i, { effect: v as Prepayment['effect'] }))}
              />
            </Field>
            <RemoveButton onClick={() => setList(without(list, i))} />
          </div>
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            value={p.months.map(String)}
            onValueChange={(v) => setList(replace(list, i, { months: v.map(Number).sort((a, b) => a - b) }))}
          >
            {MONTH_NAMES.map((m, k) => (
              <ToggleGroupItem key={m} value={String(k + 1)}>
                {m}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      ))}
    </Section>
  );
}

function OneTimeSection({ draft, set }: SectionProps) {
  const items = draft.oneTime;
  const setItems = (next: OneTimeItem[]) => set({ oneTime: next });
  const envelopes: [string, string][] = [
    [NONE, 'Free money'],
    ...draft.envelopes.map((e): [string, string] => [e.id, e.name]),
  ];
  return (
    <Section
      title="One-time"
      hint="Trips, repairs, bonuses. An expense from an envelope is paid after the month's deposit; what it lacks comes from the free money."
      onAdd={() =>
        setItems([...items, { name: 'Trip', month: draft.start, amount: 0, kind: 'expense', envelopeId: null }])
      }
    >
      {items.map((o, i) => (
        <div key={i} className="grid items-end gap-2" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1.4fr auto' }}>
          <Field label="Name">
            <Input value={o.name} onChange={(e) => setItems(replace(items, i, { name: e.target.value }))} />
          </Field>
          <Field label="Month">
            <MonthInput value={o.month} onChange={(v) => v && setItems(replace(items, i, { month: v }))} />
          </Field>
          <Field label="Amount">
            <NumberInput value={o.amount} step={50} onChange={(v) => setItems(replace(items, i, { amount: v ?? 0 }))} />
          </Field>
          <Field label="Type">
            <Choice
              value={o.kind}
              options={[
                ['expense', 'Expense'],
                ['income', 'Income'],
              ]}
              onChange={(v) =>
                setItems(
                  replace(items, i, {
                    kind: v as OneTimeItem['kind'],
                    ...(v === 'income' ? { envelopeId: null } : {}),
                  }),
                )
              }
            />
          </Field>
          {o.kind === 'expense' ? (
            <Field label="Paid from">
              <Choice
                value={o.envelopeId ?? NONE}
                options={envelopes}
                onChange={(v) => setItems(replace(items, i, { envelopeId: v === NONE ? null : v }))}
              />
            </Field>
          ) : (
            <div />
          )}
          <RemoveButton onClick={() => setItems(without(items, i))} />
        </div>
      ))}
    </Section>
  );
}
