// "Plan" tab: the plan's events as cards — milestones, income, expenses, where the surplus goes and
// where shortfalls come from. Each card opens its section of the plan editor.
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@wealthfolio/ui';
import { Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Account } from '../engine/portfolio';
import type { Loan, Property } from '../engine/real-estate';
import { withdrawalOrder, type PlanResult } from '../engine/run-plan';
import { formatMoney, formatPercent } from '../lib/format';
import { KIND_LABEL } from '../model/accounts';
import {
  autonomoGrowth,
  isPrepay,
  WITH_INFLATION,
  type AutonomoIncome,
  type Growth,
  type Milestone,
  type OneTime,
  type Period,
  type Plan,
  type PropertyPurchase,
} from '../model/plan';
import { USE_LABEL } from '../model/properties';
import { amountLabel, growthLabel } from './amount-input';
import { TAX_LABEL } from './income-editor';
import { REDUCTION_LABEL, rentableHomes } from './real-estate-editor';
import { EFFECT_LABEL, loanOptions, MODE_LABEL, PREPAY_MODE_LABEL } from './investments-editor';
import type { EditorSection } from './plan-editor';
import { spanLabel, timingLabel } from './timing-input';

interface Props {
  plan: Plan;
  result: PlanResult;
  accounts: Account[];
  properties: Property[];
  loans: Loan[];
  currency: string;
  onEdit: (section: EditorSection) => void;
}

function PlanCard({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="h-4 w-4" /> Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">{children}</CardContent>
    </Card>
  );
}

function Line({ main, detail }: { main: ReactNode; detail: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <div>{main}</div>
      <div className="text-muted-foreground text-right text-xs">{detail}</div>
    </div>
  );
}

const Empty = ({ children }: { children: string }) => <p className="text-muted-foreground">{children}</p>;

/** "at 3%", "at Euríbor + 1%", "at 2.5% for 10 years, then Euríbor + 1%". */
function mortgageRate(m: NonNullable<PropertyPurchase['mortgage']>): string {
  const v = m.variable;
  if (!v) return `at ${formatPercent(m.rate)}`;
  const variable = `Euríbor ${v.diferencial >= 0 ? '+' : '−'} ${formatPercent(Math.abs(v.diferencial))}`;
  return v.fixedYears === 0 ? `at ${variable}` : `at ${formatPercent(m.rate)} for ${v.fixedYears} years, then ${variable}`;
}

/** A growth worth mentioning: anything but "with inflation". */
const unusual = (g: Growth | undefined): g is Growth => !!g && (g.kind !== 'inflation' || g.real !== 0);

/** "change: with inflation" or "revenue: inflation + 1%; expenses: fixed nominal". */
function autonomoGrowthLabel(inc: AutonomoIncome, inflation: number): string {
  const revenue = growthLabel(autonomoGrowth(inc, 'revenue', inflation));
  const expenses = growthLabel(autonomoGrowth(inc, 'expenses', inflation));
  return revenue === expenses ? `change: ${revenue}` : `revenue: ${revenue}; expenses: ${expenses}`;
}

export function PlanTab({ plan, result, accounts, properties, loans, currency, onEdit }: Props) {
  const years = result.milestoneYears;
  const money = (v: number) => formatMoney(v, currency);
  const amount = (v: number, per: Period | undefined) => amountLabel(v, per, currency);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Missing account';
  const loanName = (id: string) => loanOptions(plan, loans).find((l) => l.id === id)?.name ?? 'a missing loan';
  const sink = accounts.find((a) => a.kind === 'cash');

  function oneTimeWhen(e: OneTime): string {
    const at = timingLabel(e.at, plan, years);
    if (!e.repeat) return at;
    const until = e.repeat.until ? `, until ${timingLabel(e.repeat.until, plan, years)}` : '';
    return `${at}, every ${e.repeat.every} years${until}`;
  }

  function trigger(m: Milestone): string {
    const t = m.trigger;
    if (t.kind === 'netWorth') return `net worth at least ${money(t.amount)} (first-year euros)`;
    if (t.kind === 'age') return `${plan.people[t.person]?.name ?? 'missing person'} ${t.age}`;
    return `year ${t.year}`;
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <PlanCard title="Milestones" onEdit={() => onEdit('milestones')}>
        {plan.milestones.length === 0 && <Empty>No milestones. Add one to start or stop events at it.</Empty>}
        {plan.milestones.map((m) => (
          <Line
            key={m.id}
            main={
              <>
                <span className="font-medium">{m.name}</span>
                <span className="text-muted-foreground"> · {trigger(m)}</span>
              </>
            }
            detail={years[m.id] === undefined ? 'not reached' : `reached ${years[m.id]}`}
          />
        ))}
      </PlanCard>

      <PlanCard title="Income" onEdit={() => onEdit('household')}>
        {plan.people.every((p) => !p.autonomo && !p.pension) && plan.incomes.length === 0 && <Empty>No income.</Empty>}
        {plan.people.map((p, i) => (
          <div key={i} className="space-y-2">
            {p.autonomo && (
              <Line
                main={
                  <>
                    <span className="font-medium">{p.name} · autónomo</span>
                    <div className="text-muted-foreground text-xs">
                      revenue {amount(p.autonomo.revenue, p.autonomo.per)}, expenses{' '}
                      {amount(p.autonomo.expenses, p.autonomo.per)}
                    </div>
                    <div className="text-muted-foreground text-xs">{autonomoGrowthLabel(p.autonomo, plan.inflation)}</div>
                  </>
                }
                detail={spanLabel(p.autonomo.start, p.autonomo.end, plan, years)}
              />
            )}
            {p.pension && (
              <Line
                main={
                  <>
                    <span className="font-medium">{p.name} · Seguridad Social pension</span>
                    <div className="text-muted-foreground text-xs">
                      {amount(p.pension.amount, p.pension.per)} gross, {growthLabel(p.pension.growth ?? WITH_INFLATION)}
                    </div>
                  </>
                }
                detail={`from ${timingLabel(p.pension.start, plan, years)}`}
              />
            )}
          </div>
        ))}
        {plan.incomes.map((inc, i) => (
          <Line
            key={`income${i}`}
            main={
              <>
                <span className="flex items-center gap-2">
                  <span className="font-medium">
                    {plan.people.length > 1 ? `${plan.people[inc.person]?.name ?? 'Missing person'} · ` : ''}
                    {inc.name}
                  </span>
                  <Badge variant="outline">{TAX_LABEL[inc.tax]}</Badge>
                  <span className="tabular-nums">{amount(inc.amount, inc.per)}</span>
                </span>
                {unusual(inc.growth) && <div className="text-muted-foreground text-xs">{growthLabel(inc.growth)}</div>}
              </>
            }
            detail={spanLabel(inc.start, inc.end, plan, years)}
          />
        ))}
      </PlanCard>

      <PlanCard title="Household expenses" onEdit={() => onEdit('expenses')}>
        {plan.expenses.length === 0 && <Empty>No expenses.</Empty>}
        {plan.spending.kind !== 'planned' && (
          <Line
            main={
              <span className="font-medium">
                {plan.spending.kind === 'percent'
                  ? `Spending rule: ${formatPercent(plan.spending.rate)} of the portfolio`
                  : `Spending rule: Guyton–Klinger from ${formatPercent(plan.spending.rate)}, ±${formatPercent(plan.spending.guardrail)} guardrails`}
              </span>
            }
            detail={`from ${timingLabel(plan.spending.start, plan, years)}; replaces discretionary`}
          />
        )}
        {plan.expenses.map((e, i) => (
          <Line
            key={i}
            main={
              <span className="flex items-center gap-2">
                <span className="font-medium">{e.name}</span>
                <Badge variant="outline">{e.kind}</Badge>
                <span className="tabular-nums">{amount(e.amount, e.per)}</span>
                {unusual(e.growth) && <span className="text-muted-foreground text-xs">{growthLabel(e.growth)}</span>}
              </span>
            }
            detail={spanLabel(e.start, e.end, plan, years)}
          />
        ))}
      </PlanCard>

      <PlanCard title="One-time events" onEdit={() => onEdit('oneTime')}>
        {plan.oneTime.length === 0 && <Empty>No one-time events: a car, a renovation, an inheritance.</Empty>}
        {plan.oneTime.map((e, i) => (
          <Line
            key={i}
            main={
              <span className="flex items-center gap-2">
                <span className="font-medium">{e.name}</span>
                <Badge variant="outline">{e.type === 'expense' ? e.kind : TAX_LABEL[e.tax]}</Badge>
                <span className="tabular-nums">
                  {e.type === 'income' ? '+' : '−'}
                  {money(e.amount)}
                </span>
                {e.nominal && <span className="text-muted-foreground text-xs">nominal</span>}
              </span>
            }
            detail={oneTimeWhen(e)}
          />
        ))}
      </PlanCard>

      <PlanCard title="Cash-flow priorities" onEdit={() => onEdit('investments')}>
        <div className="text-muted-foreground text-xs">Surplus, in order</div>
        {plan.flows.map((f, i) =>
          isPrepay(f) ? (
            <Line
              key={i}
              main={`${i + 1}. Prepay ${loanName(f.loanId)}`}
              detail={`${
                f.mode === 'max'
                  ? PREPAY_MODE_LABEL.max
                  : f.mode === 'percent'
                    ? `${formatPercent(f.amount)} of the rest`
                    : `${money(f.amount)} a year`
              } · ${EFFECT_LABEL[f.effect].toLowerCase()}${f.until ? ` · until ${timingLabel(f.until, plan, years)}` : ''}`}
            />
          ) : (
            <Line
              key={i}
              main={`${i + 1}. ${accountName(f.accountId)}`}
              detail={
                f.mode === 'max'
                  ? MODE_LABEL.max
                  : f.mode === 'percent'
                    ? `${formatPercent(f.amount)} of the rest`
                    : `${MODE_LABEL[f.mode]}: ${money(f.amount)}`
              }
            />
          ),
        )}
        <Line main={`${plan.flows.length + 1}. ${sink?.name ?? 'Cash'}`} detail="the rest" />
        <div className="text-muted-foreground pt-2 text-xs">Shortfalls, in order</div>
        <div>
          {withdrawalOrder(plan, accounts)
            .map((a) => `${a.name} (${KIND_LABEL[a.kind]})`)
            .join(' → ') || 'No accounts'}
        </div>
        <div className="text-muted-foreground text-xs">Pension plans from age {plan.pensionAccessAge}.</div>
      </PlanCard>

      <PlanCard title="Real estate" onEdit={() => onEdit('realEstate')}>
        {properties.length + loans.length + plan.propertyPurchases.length + plan.rentals.length === 0 && (
          <Empty>No modelled real estate. Set a use for Wealthfolio properties on the Accounts tab, or plan a purchase.</Empty>
        )}
        {properties.map((p) => (
          <Line
            key={p.id}
            main={
              <span className="flex items-center gap-2">
                <span className="font-medium">{p.name}</span>
                <Badge variant="outline">{USE_LABEL[p.use]}</Badge>
              </span>
            }
            detail={`${money(p.value)} today`}
          />
        ))}
        {loans.map((l) => (
          <Line
            key={l.id}
            main={<span className="font-medium">{l.name}</span>}
            detail={`${money(l.balance)} owed · ${money(l.monthlyPayment)} a month · ${formatPercent(l.rate)}${
              l.variable
                ? `, then Euríbor ${l.variable.diferencial >= 0 ? '+' : '−'} ${formatPercent(Math.abs(l.variable.diferencial))}`
                : ''
            }`}
          />
        ))}
        {plan.propertySales.map((s, i) => (
          <Line
            key={`sale${i}`}
            main={`Sell ${properties.find((p) => p.id === s.propertyId)?.name ?? 'a missing property'}`}
            detail={timingLabel(s.timing, plan, years)}
          />
        ))}
        {plan.rentals.map((r, i) => (
          <Line
            key={`rental${i}`}
            main={
              <span>
                Let {rentableHomes(plan, properties).find((h) => h.id === r.propertyId)?.name ?? 'a missing home'} ·{' '}
                {amountLabel(r.amount, r.per, currency)}
                {r.occupancy < 1 ? `, ${formatPercent(r.occupancy)} of the year` : ''}
              </span>
            }
            detail={`${spanLabel(r.start, r.end, plan, years)} · reducción ${REDUCTION_LABEL[r.reduction]}`}
          />
        ))}
        {plan.propertyPurchases.map((p) => (
          <Line
            key={p.id}
            main={`Buy ${p.name} · ${money(p.price)}${p.mortgage ? `, mortgage ${money(p.mortgage.amount)} ${mortgageRate(p.mortgage)}` : ''}`}
            detail={`${timingLabel(p.timing, plan, years)} · ${p.newBuild ? 'new' : 'second-hand'}${p.habitual ? ', vivienda habitual' : ''}`}
          />
        ))}
      </PlanCard>
    </div>
  );
}
