// Plan editor sections: incomes besides the activity and the SS pension, and one-time events.
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
import { WITH_INFLATION, type Income, type IncomeTax, type OneTime, type Plan } from '../model/plan';
import { AmountInput, GrowthInput } from './amount-input';
import { Field, NumberInput } from './form-fields';
import { TimingInput } from './timing-input';

interface SectionProps {
  draft: Plan;
  set: (patch: Partial<Plan>) => void;
  titled?: boolean;
}

export const TAX_LABEL: Record<IncomeTax, string> = {
  trabajo: 'Salary (trabajo)',
  ganancia: 'Gain (savings base)',
  exento: 'Tax-free',
};

const newIncome = (): Income => ({
  name: 'Salary',
  person: 0,
  tax: 'trabajo',
  amount: 0,
  per: 'year',
  growth: WITH_INFLATION,
  start: null,
  end: null,
});

function PersonSelect({ draft, value, onChange }: { draft: Plan; value: number; onChange: (i: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger style={{ minWidth: 0 }}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {draft.people.map((p, i) => (
          <SelectItem key={i} value={String(i)}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" aria-label={label} onClick={onClick}>
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

export function IncomesEditor({ draft, set }: SectionProps) {
  const setIncome = (i: number, patch: Partial<Income>) =>
    set({ incomes: draft.incomes.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const couple = draft.people.length > 1;

  return (
    <section className="space-y-3">
      <h3 className="font-medium">Other income</h3>
      <p className="text-muted-foreground text-xs">
        Salary: the salario bruto anual from the contract; per month counts 12 payments, and the employee's Social
        Security is subtracted. Gain: enter the gain, not the proceeds. Tax-free: herencia, donación.
      </p>
      {draft.incomes.map((inc, i) => (
        <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-md border p-3">
          <Field label="Name">
            <Input value={inc.name} onChange={(e) => setIncome(i, { name: e.target.value })} />
          </Field>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field label="Taxed as">
                <Select value={inc.tax} onValueChange={(v) => setIncome(i, { tax: v as IncomeTax })}>
                  <SelectTrigger style={{ minWidth: 0 }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TAX_LABEL) as IncomeTax[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TAX_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {couple && (
              <div style={{ width: 110, flex: 'none' }}>
                <Field label="Whose">
                  <PersonSelect draft={draft} value={inc.person} onChange={(person) => setIncome(i, { person })} />
                </Field>
              </div>
            )}
            <RemoveButton
              label="Remove income"
              onClick={() => set({ incomes: draft.incomes.filter((_, j) => j !== i) })}
            />
          </div>
          <Field label="Amount">
            <AmountInput value={inc.amount} per={inc.per} onChange={(amount, per) => setIncome(i, { amount, per })} />
          </Field>
          <Field label="Change per year, %">
            <GrowthInput value={inc.growth ?? WITH_INFLATION} onChange={(growth) => setIncome(i, { growth })} />
          </Field>
          <Field label="Starts">
            <TimingInput value={inc.start} plan={draft} noneLabel="Plan start" onChange={(t) => setIncome(i, { start: t })} />
          </Field>
          <Field label="Stops">
            <TimingInput value={inc.end} plan={draft} noneLabel="Never" onChange={(t) => setIncome(i, { end: t })} />
          </Field>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        disabled={draft.incomes.length >= 30}
        onClick={() => set({ incomes: [...draft.incomes, newIncome()] })}
      >
        <Plus className="h-4 w-4" /> Add income
      </Button>
    </section>
  );
}

/** What a one-time event is: "expense:essential", "income:trabajo" and so on. */
const WHAT_LABEL: Record<string, string> = {
  'expense:essential': 'Expense, essential',
  'expense:discretionary': 'Expense, discretionary',
  'income:trabajo': 'Income, salary (trabajo)',
  'income:ganancia': 'Income, gain (savings base)',
  'income:exento': 'Income, tax-free',
};

const whatOf = (e: OneTime) => (e.type === 'expense' ? `expense:${e.kind}` : `income:${e.tax}`);

function withWhat(e: OneTime, what: string): OneTime {
  const { name, amount, nominal, at, repeat } = e;
  const [type, sub] = what.split(':');
  if (type === 'expense') {
    return { type: 'expense', name, amount, nominal, at, repeat, kind: sub as 'essential' | 'discretionary' };
  }
  return { type: 'income', name, amount, nominal, at, repeat, person: e.type === 'income' ? e.person : 0, tax: sub as IncomeTax };
}

const newOneTime = (plan: Plan): OneTime => ({
  type: 'expense',
  name: 'One-time',
  kind: 'discretionary',
  amount: 0,
  nominal: false,
  at: { kind: 'year', year: plan.startYear + 1 },
  repeat: null,
});

export function OneTimeEditor({ draft, set, titled }: SectionProps) {
  const setEvent = (i: number, e: OneTime) => set({ oneTime: draft.oneTime.map((x, j) => (j === i ? e : x)) });
  const couple = draft.people.length > 1;

  return (
    <section className="space-y-3">
      {titled && <h3 className="font-medium">One-time events</h3>}
      <p className="text-muted-foreground text-xs">
        An expense or an income in one year, maybe again every few years: a car, a renovation, an inheritance. In
        first-year euros it grows with inflation up to its year; nominal euros are the amount of that year.
      </p>
      {draft.oneTime.map((e, i) => (
        <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-md border p-3">
          <Field label="Name">
            <Input value={e.name} onChange={(ev) => setEvent(i, { ...e, name: ev.target.value })} />
          </Field>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field label="What">
                <Select value={whatOf(e)} onValueChange={(v) => setEvent(i, withWhat(e, v))}>
                  <SelectTrigger style={{ minWidth: 0 }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(WHAT_LABEL).map(([k, label]) => (
                      <SelectItem key={k} value={k}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <RemoveButton
              label="Remove event"
              onClick={() => set({ oneTime: draft.oneTime.filter((_, j) => j !== i) })}
            />
          </div>
          <Field label="Amount">
            <div className="flex gap-2">
              <NumberInput value={e.amount} step={100} onChange={(v) => setEvent(i, { ...e, amount: v ?? 0 })} />
              <div style={{ width: 150, flex: 'none' }}>
                <Select
                  value={e.nominal ? 'nominal' : 'firstYear'}
                  onValueChange={(v) => setEvent(i, { ...e, nominal: v === 'nominal' })}
                >
                  <SelectTrigger style={{ minWidth: 0 }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="firstYear">first-year €</SelectItem>
                    <SelectItem value="nominal">nominal €</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Field>
          {e.type === 'income' && couple ? (
            <Field label="Whose">
              <PersonSelect draft={draft} value={e.person} onChange={(person) => setEvent(i, { ...e, person })} />
            </Field>
          ) : (
            <div />
          )}
          <Field label="When">
            <TimingInput value={e.at} plan={draft} onChange={(t) => t && setEvent(i, { ...e, at: t })} />
          </Field>
          <Field label="Repeats every, years (empty — once)">
            <NumberInput
              value={e.repeat?.every ?? null}
              onChange={(v) =>
                setEvent(i, { ...e, repeat: v && v > 0 ? { every: v, until: e.repeat?.until ?? null } : null })
              }
            />
          </Field>
          {e.repeat && (
            <Field label="Repeats until">
              <TimingInput
                value={e.repeat.until}
                plan={draft}
                noneLabel="Plan end"
                onChange={(t) => setEvent(i, { ...e, repeat: { ...e.repeat!, until: t } })}
              />
            </Field>
          )}
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        disabled={draft.oneTime.length >= 50}
        onClick={() => set({ oneTime: [...draft.oneTime, newOneTime(draft)] })}
      >
        <Plus className="h-4 w-4" /> Add event
      </Button>
    </section>
  );
}
