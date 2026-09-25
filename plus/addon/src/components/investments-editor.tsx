// Plan editor section: returns by account type, surplus flows and withdrawal order.
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@wealthfolio/ui';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { Account } from '../engine/portfolio';
import { withdrawalOrder } from '../engine/run-plan';
import { isPension, KIND_LABEL } from '../model/accounts';
import type { Flow, Plan, Returns } from '../model/plan';
import { Field, NumberInput, PercentInput } from './form-fields';

interface Props {
  draft: Plan;
  set: (patch: Partial<Plan>) => void;
  accounts: Account[];
}

const RETURN_FIELDS: [keyof Returns, string][] = [
  ['cashInterest', 'Cash interest'],
  ['fundGrowth', 'Fondos growth'],
  ['brokerageGrowth', 'Brokerage price growth'],
  ['brokerageYield', 'Brokerage dividends'],
  ['pensionGrowth', 'Pension plans growth'],
];

export const MODE_LABEL: Record<Flow['mode'], string> = {
  max: 'Max (pension: deductible limit)',
  fixed: 'Fixed per year',
  percent: '% of the rest',
  untilBalance: 'Up to a balance',
};

function move<T>(xs: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= xs.length) return xs;
  const next = [...xs];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function ReorderButtons({ onMove, onRemove }: { onMove: (d: -1 | 1) => void; onRemove: () => void }) {
  return (
    <div className="flex">
      <Button variant="ghost" size="icon" aria-label="Move up" onClick={() => onMove(-1)}>
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Move down" onClick={() => onMove(1)}>
        <ArrowDown className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Remove" onClick={onRemove}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function AccountSelect({
  value,
  accounts,
  onChange,
}: {
  value: string;
  accounts: Account[];
  onChange: (id: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
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
  );
}

export function InvestmentsEditor({ draft, set, accounts }: Props) {
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Missing account';
  const sink = accounts.find((a) => a.kind === 'cash');
  const setFlow = (i: number, patch: Partial<Flow>) =>
    set({ flows: draft.flows.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const order = draft.withdrawalOrder;
  const notInOrder = accounts.filter((a) => !order.includes(a.id));

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="font-medium">Returns</h3>
        <p className="text-muted-foreground text-xs">Nominal, % per year. Mapping of accounts is on the Accounts tab.</p>
        <div className="grid grid-cols-3 gap-3">
          {RETURN_FIELDS.map(([k, label]) => (
            <Field key={k} label={label}>
              <PercentInput
                value={draft.returns[k]}
                onChange={(v) => set({ returns: { ...draft.returns, [k]: v } })}
              />
            </Field>
          ))}
          <Field label="Pension plans accessible from age">
            <NumberInput
              value={draft.pensionAccessAge}
              onChange={(v) => set({ pensionAccessAge: v ?? 0 })}
            />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">Where the surplus goes</h3>
        <p className="text-muted-foreground text-xs">
          In order, each year. Whatever is left goes to {sink ? sink.name : 'cash'}. Amounts are in
          euros of the first year.
        </p>
        {draft.flows.map((f, i) => (
          <div
            key={i}
            className="grid items-end gap-2"
            style={{ gridTemplateColumns: '1fr 11rem 6rem auto' }}
          >
            <Field label="Account">
              <AccountSelect value={f.accountId} accounts={accounts} onChange={(id) => setFlow(i, { accountId: id })} />
            </Field>
            <Field label="Rule">
              <Select value={f.mode} onValueChange={(v) => setFlow(i, { mode: v as Flow['mode'] })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(MODE_LABEL) as Flow['mode'][]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {MODE_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={f.mode === 'percent' ? '%' : 'Amount'}>
              {f.mode === 'percent' ? (
                <PercentInput value={f.amount} onChange={(v) => setFlow(i, { amount: v })} />
              ) : (
                <NumberInput
                  value={f.mode === 'max' ? null : f.amount}
                  step={500}
                  onChange={(v) => setFlow(i, { amount: v ?? 0 })}
                />
              )}
            </Field>
            <ReorderButtons
              onMove={(d) => set({ flows: move(draft.flows, i, d) })}
              onRemove={() => set({ flows: draft.flows.filter((_, j) => j !== i) })}
            />
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={!accounts.length}
          onClick={() => {
            const a = accounts.find((x) => isPension(x.kind)) ?? accounts[0];
            set({ flows: [...draft.flows, { accountId: a.id, mode: 'max', amount: 0 }] });
          }}
        >
          <Plus className="h-4 w-4" /> Add flow
        </Button>
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">Withdrawal order</h3>
        <p className="text-muted-foreground text-xs">
          When spending and taxes exceed income, money comes from these accounts in order; the tax on
          the sale is covered too. Pension plans are used only from the access age.
          {order.length > 0 && ' Accounts not in the list are never touched.'}
        </p>
        {order.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm">
              Default: {withdrawalOrder(draft, accounts).map((a) => a.name).join(' → ') || 'no accounts'}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={!accounts.length}
              onClick={() => set({ withdrawalOrder: withdrawalOrder(draft, accounts).map((a) => a.id) })}
            >
              Customize
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            {order.map((id, i) => (
              <div key={id} className="flex items-center justify-between rounded-md border px-3 py-1 text-sm">
                <span>
                  {i + 1}. {name(id)}
                </span>
                <ReorderButtons
                  onMove={(d) => set({ withdrawalOrder: move(order, i, d) })}
                  onRemove={() => set({ withdrawalOrder: order.filter((x) => x !== id) })}
                />
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              {notInOrder.length > 0 && (
                <div className="w-64">
                  <AccountSelect
                    value=""
                    accounts={notInOrder}
                    onChange={(id) => set({ withdrawalOrder: [...order, id] })}
                  />
                </div>
              )}
              <Button variant="ghost" size="sm" onClick={() => set({ withdrawalOrder: [] })}>
                Reset to default
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
