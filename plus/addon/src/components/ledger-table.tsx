// "Table" tab: ledger by year.
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@wealthfolio/ui';
import type { LedgerRow } from '../engine/run-plan';
import { formatMoney, inMode, type ValueMode } from '../lib/format';

interface Column {
  label: string;
  value: (r: LedgerRow) => number;
}

const COLUMNS: Column[] = [
  { label: 'Revenue', value: (r) => r.revenue },
  { label: 'Business expenses', value: (r) => r.businessExpenses },
  { label: 'RETA', value: (r) => r.reta },
  { label: 'SS pension', value: (r) => r.publicPension },
  { label: 'Interest & dividends', value: (r) => r.investmentIncome },
  { label: 'Realized gains', value: (r) => r.realizedGains },
  { label: 'Pension payouts', value: (r) => r.pensionWithdrawals },
  { label: 'Base liq. general', value: (r) => r.baseLiquidableGeneral },
  { label: 'Base liq. ahorro', value: (r) => r.baseLiquidableAhorro },
  { label: 'IRPF estatal', value: (r) => r.irpfEstatal },
  { label: 'IRPF autonómica', value: (r) => r.irpfAutonomica },
  { label: 'Essential', value: (r) => r.essentialExpenses },
  { label: 'Discretionary', value: (r) => r.discretionaryExpenses },
  { label: 'Net cash flow', value: (r) => r.netCashFlow },
  { label: 'Pension contributions', value: (r) => r.pensionContributions },
  { label: 'Cash', value: (r) => r.balances.cash },
  { label: 'Fondos', value: (r) => r.balances.fund },
  { label: 'Brokerage', value: (r) => r.balances.brokerage },
  { label: 'Pension plans', value: (r) => r.balances.pension },
  { label: 'Outside the model', value: (r) => r.otherAssets },
  { label: 'Net worth', value: (r) => r.netWorth },
];

interface Props {
  rows: LedgerRow[];
  currency: string;
  mode: ValueMode;
}

export function LedgerTable({ rows, currency, mode }: Props) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>Year</TableHead>
            <TableHead>Age</TableHead>
            <TableHead>RETA tramo</TableHead>
            {COLUMNS.map((c) => (
              <TableHead key={c.label} className="text-right whitespace-nowrap">
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.year}>
              <TableCell>{r.year}</TableCell>
              <TableCell className="whitespace-nowrap">{r.people.map((p) => p.age).join(' / ')}</TableCell>
              <TableCell className="whitespace-nowrap">
                {r.people.map((p) => p.retaTramo ?? '—').join(' / ')}
              </TableCell>
              {COLUMNS.map((c) => (
                <TableCell key={c.label} className="text-right tabular-nums">
                  {formatMoney(inMode(c.value(r), r.deflator, mode), currency)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
