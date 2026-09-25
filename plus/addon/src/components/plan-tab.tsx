// "Plan" tab: the plan's events as cards — milestones, income, expenses, where the surplus goes and
// where shortfalls come from. Each card opens its section of the plan editor.
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@wealthfolio/ui';
import { Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Account } from '../engine/portfolio';
import { withdrawalOrder, type PlanResult } from '../engine/run-plan';
import { formatMoney, formatPercent } from '../lib/format';
import { KIND_LABEL } from '../model/accounts';
import type { Milestone, Plan } from '../model/plan';
import { MODE_LABEL } from './investments-editor';
import type { EditorSection } from './plan-editor';
import { spanLabel, timingLabel } from './timing-input';

interface Props {
  plan: Plan;
  result: PlanResult;
  accounts: Account[];
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

export function PlanTab({ plan, result, accounts, currency, onEdit }: Props) {
  const years = result.milestoneYears;
  const money = (v: number) => formatMoney(v, currency);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Missing account';
  const sink = accounts.find((a) => a.kind === 'cash');

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
        {plan.people.every((p) => !p.autonomo && !p.pension) && <Empty>No income.</Empty>}
        {plan.people.map((p, i) => (
          <div key={i} className="space-y-2">
            {p.autonomo && (
              <Line
                main={
                  <>
                    <span className="font-medium">{p.name} · autónomo</span>
                    <div className="text-muted-foreground text-xs">
                      revenue {money(p.autonomo.revenue)}, expenses {money(p.autonomo.expenses)}, growth{' '}
                      {formatPercent(p.autonomo.growth)}
                    </div>
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
                    <div className="text-muted-foreground text-xs">{money(p.pension.amount)} gross, grows with inflation</div>
                  </>
                }
                detail={`from ${timingLabel(p.pension.start, plan, years)}`}
              />
            )}
          </div>
        ))}
      </PlanCard>

      <PlanCard title="Household expenses" onEdit={() => onEdit('expenses')}>
        {plan.expenses.length === 0 && <Empty>No expenses.</Empty>}
        {plan.expenses.map((e, i) => (
          <Line
            key={i}
            main={
              <span className="flex items-center gap-2">
                <span className="font-medium">{e.name}</span>
                <Badge variant="outline">{e.kind}</Badge>
                <span className="tabular-nums">{money(e.amount)}</span>
              </span>
            }
            detail={spanLabel(e.start, e.end, plan, years)}
          />
        ))}
      </PlanCard>

      <PlanCard title="Cash-flow priorities" onEdit={() => onEdit('investments')}>
        <div className="text-muted-foreground text-xs">Surplus, in order</div>
        {plan.flows.map((f, i) => (
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
        ))}
        <Line main={`${plan.flows.length + 1}. ${sink?.name ?? 'Cash'}`} detail="the rest" />
        <div className="text-muted-foreground pt-2 text-xs">Shortfalls, in order</div>
        <div>
          {withdrawalOrder(plan, accounts)
            .map((a) => `${a.name} (${KIND_LABEL[a.kind]})`)
            .join(' → ') || 'No accounts'}
        </div>
        <div className="text-muted-foreground text-xs">Pension plans from age {plan.pensionAccessAge}.</div>
      </PlanCard>
    </div>
  );
}
