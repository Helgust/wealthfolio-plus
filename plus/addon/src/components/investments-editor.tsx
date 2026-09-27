// Plan editor section: returns by account type, surplus flows (into accounts or loan prepayments)
// and withdrawal order.
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
import type { Loan } from '../engine/real-estate';
import { withdrawalOrder } from '../engine/run-plan';
import { isPension, KIND_LABEL } from '../model/accounts';
import { isPrepay, type AccountFlow, type Flow, type Plan, type PrepayFlow, type Returns } from '../model/plan';
import { Field, NumberInput, PercentInput } from './form-fields';
import { TimingInput } from './timing-input';

interface Props {
  draft: Plan;
  set: (patch: Partial<Plan>) => void;
  accounts: Account[];
  loans: Loan[];
}

/** Loans a plan can prepay: modelled Wealthfolio loans and the mortgages of its purchases. */
export function loanOptions(plan: Plan, loans: Loan[]): { id: string; name: string }[] {
  return [
    ...loans.map((l) => ({ id: l.id, name: l.name })),
    ...plan.propertyPurchases
      .filter((p) => p.mortgage)
      .map((p) => ({ id: `mortgage:${p.id}`, name: `Mortgage · ${p.name}` })),
  ];
}

export const PREPAY_MODE_LABEL: Record<PrepayFlow['mode'], string> = {
  max: 'All the rest until repaid',
  fixed: 'Fixed per year',
  percent: '% of the rest',
};

export const EFFECT_LABEL: Record<PrepayFlow['effect'], string> = {
  term: 'Reduce the term (plazo)',
  payment: 'Reduce the payment (cuota)',
};

const RETURN_FIELDS: [keyof Returns, string][] = [
  ['cashInterest', 'Cash interest'],
  ['fundGrowth', 'Fondos growth'],
  ['brokerageGrowth', 'Brokerage price growth'],
  ['brokerageYield', 'Brokerage dividends'],
  ['pensionGrowth', 'Pension plans growth'],
  ['propertyGrowth', 'Real estate growth'],
];

export const MODE_LABEL: Record<AccountFlow['mode'], string> = {
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

function FlowAmount({ f, onChange }: { f: Flow; onChange: (amount: number) => void }) {
  return (
    <Field label={f.mode === 'percent' ? '%' : 'Amount'}>
      {f.mode === 'percent' ? (
        <PercentInput value={f.amount} onChange={onChange} />
      ) : (
        <NumberInput value={f.mode === 'max' ? null : f.amount} step={500} onChange={(v) => onChange(v ?? 0)} />
      )}
    </Field>
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

export function InvestmentsEditor({ draft, set, accounts, loans }: Props) {
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Missing account';
  const sink = accounts.find((a) => a.kind === 'cash');
  const setFlow = (i: number, f: Flow) => set({ flows: draft.flows.map((x, j) => (j === i ? f : x)) });
  const loanList = loanOptions(draft, loans);
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
          <Field label="Euríbor for variable loans (assumption)">
            <PercentInput value={draft.euribor} onChange={(v) => set({ euribor: v })} />
          </Field>
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
        {draft.flows.map((f, i) => {
          const buttons = (
            <ReorderButtons
              onMove={(d) => set({ flows: move(draft.flows, i, d) })}
              onRemove={() => set({ flows: draft.flows.filter((_, j) => j !== i) })}
            />
          );
          if (isPrepay(f)) {
            return (
              <div key={i} className="space-y-2 rounded-md border p-2">
                <div className="grid items-end gap-2" style={{ gridTemplateColumns: '1fr 11rem 6rem auto' }}>
                  <Field label="Prepay loan">
                    <Select value={f.loanId} onValueChange={(v) => setFlow(i, { ...f, loanId: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Loan" />
                      </SelectTrigger>
                      <SelectContent>
                        {loanList.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Rule">
                    <Select value={f.mode} onValueChange={(v) => setFlow(i, { ...f, mode: v as PrepayFlow['mode'] })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(PREPAY_MODE_LABEL) as PrepayFlow['mode'][]).map((m) => (
                          <SelectItem key={m} value={m}>
                            {PREPAY_MODE_LABEL[m]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <FlowAmount f={f} onChange={(amount) => setFlow(i, { ...f, amount })} />
                  {buttons}
                </div>
                <div className="grid items-end gap-2" style={{ gridTemplateColumns: '1fr 1fr 6rem' }}>
                  <Field label="Effect">
                    <Select value={f.effect} onValueChange={(v) => setFlow(i, { ...f, effect: v as PrepayFlow['effect'] })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(EFFECT_LABEL) as PrepayFlow['effect'][]).map((e) => (
                          <SelectItem key={e} value={e}>
                            {EFFECT_LABEL[e]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Until">
                    <TimingInput
                      value={f.until}
                      plan={draft}
                      noneLabel="Repaid"
                      onChange={(until) => setFlow(i, { ...f, until })}
                    />
                  </Field>
                  <Field label="Fee, %">
                    <PercentInput value={f.fee} onChange={(fee) => setFlow(i, { ...f, fee })} />
                  </Field>
                </div>
              </div>
            );
          }
          return (
            <div key={i} className="grid items-end gap-2" style={{ gridTemplateColumns: '1fr 11rem 6rem auto' }}>
              <Field label="Account">
                <AccountSelect value={f.accountId} accounts={accounts} onChange={(id) => setFlow(i, { ...f, accountId: id })} />
              </Field>
              <Field label="Rule">
                <Select value={f.mode} onValueChange={(v) => setFlow(i, { ...f, mode: v as AccountFlow['mode'] })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(MODE_LABEL) as AccountFlow['mode'][]).map((m) => (
                      <SelectItem key={m} value={m}>
                        {MODE_LABEL[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <FlowAmount f={f} onChange={(amount) => setFlow(i, { ...f, amount })} />
              {buttons}
            </div>
          );
        })}
        <div className="flex gap-2">
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
          <Button
            variant="outline"
            size="sm"
            disabled={!loanList.length}
            onClick={() =>
              set({
                flows: [
                  ...draft.flows,
                  { loanId: loanList[0].id, mode: 'fixed', amount: 0, effect: 'term', until: null, fee: 0 },
                ],
              })
            }
          >
            <Plus className="h-4 w-4" /> Add loan prepayment
          </Button>
        </div>
        {draft.flows.some(isPrepay) && (
          <p className="text-muted-foreground text-xs">
            A prepayment comes out of the surplus at the end of the year; the fee is paid on top. Ley 5/2019 (art. 23)
            caps the fee: at a variable rate 0.25 % in the first 3 years or 0.15 % in the first 5, then none; at a
            fixed rate 2 % in the first 10 years, then 1.5 %.
          </p>
        )}
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
