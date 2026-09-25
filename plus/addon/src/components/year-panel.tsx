// Side panel with one year of the plan, opened by a click on the net worth chart.
import { Separator, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@wealthfolio/ui';
import type { LedgerRow } from '../engine/run-plan';
import { formatMoney, inMode, type ValueMode } from '../lib/format';
import type { Plan } from '../model/plan';

interface Props {
  row: LedgerRow | null;
  plan: Plan;
  currency: string;
  mode: ValueMode;
  onClose: () => void;
}

type Item = [label: string, value: number];

export function YearPanel({ row, plan, currency, mode, onClose }: Props) {
  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="overflow-y-auto" style={{ width: 420, maxWidth: 420 }}>
        {row && <YearDetails row={row} plan={plan} currency={currency} mode={mode} />}
      </SheetContent>
    </Sheet>
  );
}

function YearDetails({ row, plan, currency, mode }: { row: LedgerRow; plan: Plan; currency: string; mode: ValueMode }) {
  const v = (x: number) => formatMoney(inMode(x, row.deflator, mode), currency);
  const reached = plan.milestones.filter((m) => row.milestones.includes(m.id)).map((m) => m.name);

  const groups: [title: string, items: Item[]][] = [
    [
      'Income',
      [
        ['Autónomo revenue', row.revenue],
        ['Seguridad Social pension', row.publicPension],
        ['Interest & dividends', row.investmentIncome],
        ['Pension plan payouts', row.pensionWithdrawals],
      ],
    ],
    [
      'Costs',
      [
        ['Business expenses', row.businessExpenses],
        ['RETA', row.reta],
        ['IRPF estatal', row.irpfEstatal],
        ['IRPF autonómica', row.irpfAutonomica],
        ['Essential expenses', row.essentialExpenses],
        ['Discretionary expenses', row.discretionaryExpenses],
      ],
    ],
    [
      'Result',
      [
        ['Net cash flow', row.netCashFlow],
        ['Pension plan contributions', row.pensionContributions],
        ['Realized gains', row.realizedGains],
      ],
    ],
    [
      'End of year',
      [
        ['Cash', row.balances.cash],
        ['Fondos', row.balances.fund],
        ['Brokerage', row.balances.brokerage],
        ['Pension plans', row.balances.pension],
        ['Outside the model', row.otherAssets],
      ],
    ],
  ];

  return (
    <div className="space-y-4">
      <SheetHeader>
        <SheetTitle>{row.year}</SheetTitle>
        <SheetDescription>
          {plan.people.map((p, i) => `${p.name} ${row.people[i]?.age ?? ''}`).join(' · ')}
          {mode === 'today' ? ' · euros of the first year' : ' · nominal euros'}
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-4 px-4 text-sm">
        {reached.length > 0 && <p>Milestone reached: {reached.join(', ')}</p>}
        {groups.map(([title, items]) => (
          <section key={title} className="space-y-1">
            <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
            {items
              .filter(([, x]) => x !== 0)
              .map(([label, x]) => (
                <div key={label} className="flex justify-between gap-4">
                  <span>{label}</span>
                  <span className="tabular-nums">{v(x)}</span>
                </div>
              ))}
          </section>
        ))}
        <Separator />
        <div className="flex justify-between gap-4 font-medium">
          <span>Net worth</span>
          <span className="tabular-nums">{v(row.netWorth)}</span>
        </div>
        {row.people.some((p) => p.retaTramo) && (
          <p className="text-muted-foreground text-xs">
            RETA tramo: {row.people.map((p, i) => `${plan.people[i]?.name}: ${p.retaTramo ?? '—'}`).join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}
