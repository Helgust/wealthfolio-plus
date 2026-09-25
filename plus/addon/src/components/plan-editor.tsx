// Выезжающая панель редактирования плана. Черновик живёт в локальном состоянии и проверяется
// схемой Zod при сохранении.
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
import { PlanSchema, type Expense, type Person, type Plan } from '../model/plan';
import { Field, NumberInput, PercentInput } from './form-fields';
import { InvestmentsEditor } from './investments-editor';

interface Props {
  plan: Plan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (plan: Plan) => Promise<void>;
  /** Счета в модели — для flows и порядка изъятий */
  accounts: Account[];
}

export function PlanEditor({ plan, open, onOpenChange, onSave, accounts }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto" style={{ width: 600, maxWidth: 600 }}>
        <SheetHeader>
          <SheetTitle>Edit plan</SheetTitle>
          <SheetDescription>
            Amounts are per year, in euros of the plan's first year.
          </SheetDescription>
        </SheetHeader>
        {/* Форма монтируется при открытии, поэтому черновик всегда начинается с плана. */}
        {open && (
          <PlanForm
            plan={plan}
            accounts={accounts}
            onSave={onSave}
            onCancel={() => onOpenChange(false)}
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
});

const newExpense = (): Expense => ({
  name: 'Expense',
  amount: 0,
  kind: 'discretionary',
  startYear: null,
  endYear: null,
});

function PlanForm({
  plan,
  accounts,
  onSave,
  onCancel,
}: {
  plan: Plan;
  accounts: Account[];
  onSave: (plan: Plan) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Plan>(plan);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<Plan>) => setDraft((d) => ({ ...d, ...patch }));
  const setPerson = (i: number, patch: Partial<Person>) =>
    set({ people: draft.people.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const setExpense = (i: number, patch: Partial<Expense>) =>
    set({ expenses: draft.expenses.map((e, j) => (j === i ? { ...e, ...patch } : e)) });

  async function save() {
    const parsed = PlanSchema.safeParse(draft);
    if (!parsed.success) {
      setError(
        parsed.error.issues.map((i) => `${i.path.join('.') || 'plan'}: ${i.message}`).join('; '),
      );
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

  return (
    <div className="space-y-6 px-4 py-4">
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
      </section>

      <Separator />
      {draft.people.map((p, i) => (
        <section key={i} className="space-y-3">
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
                    ? { revenue: 0, expenses: 0, growth: draft.inflation, untilAge: 65 }
                    : null,
                })
              }
            />
            <Label className="text-sm">Autónomo income</Label>
          </div>
          {p.autonomo && (
            <div className="grid grid-cols-4 gap-3">
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
              <Field label="Stops at age">
                <NumberInput
                  value={p.autonomo.untilAge}
                  onChange={(v) => setPerson(i, { autonomo: { ...p.autonomo!, untilAge: v ?? 0 } })}
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
        <p className="text-muted-foreground text-xs">
          Used for the mínimo por descendientes (under 25, no own income).
        </p>
        {draft.children.map((c, i) => (
          <div key={i} className="flex items-end gap-2">
            <Field label="Birth year">
              <NumberInput
                value={c.birthYear}
                onChange={(v) =>
                  set({
                    children: draft.children.map((x, j) => (j === i ? { birthYear: v ?? 0 } : x)),
                  })
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

      <Separator />
      <section className="space-y-3">
        <h3 className="font-medium">Household expenses</h3>
        {draft.expenses.map((e, i) => (
          <div
            key={i}
            className="grid items-end gap-2"
            style={{ gridTemplateColumns: '1fr 7rem 8rem 5rem 5rem auto' }}
          >
            <Field label="Name">
              <Input value={e.name} onChange={(ev) => setExpense(i, { name: ev.target.value })} />
            </Field>
            <Field label="Per year">
              <NumberInput
                value={e.amount}
                step={500}
                onChange={(v) => setExpense(i, { amount: v ?? 0 })}
              />
            </Field>
            <Field label="Kind">
              <Select
                value={e.kind}
                onValueChange={(v) => setExpense(i, { kind: v as Expense['kind'] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="essential">Essential</SelectItem>
                  <SelectItem value="discretionary">Discretionary</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="From">
              <NumberInput value={e.startYear} onChange={(v) => setExpense(i, { startYear: v })} />
            </Field>
            <Field label="Until">
              <NumberInput value={e.endYear} onChange={(v) => setExpense(i, { endYear: v })} />
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
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => set({ expenses: [...draft.expenses, newExpense()] })}
        >
          <Plus className="h-4 w-4" /> Add expense
        </Button>
      </section>

      <Separator />
      <InvestmentsEditor draft={draft} set={set} accounts={accounts} />

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
