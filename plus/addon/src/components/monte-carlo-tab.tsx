// "Monte Carlo" tab: runs the plan on random market years on request; success rate, the fan of
// net worth percentiles and the same numbers as a table.
import {
  Button,
  Card,
  CardContent,
  Progress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@wealthfolio/ui';
import { Play, Settings2 } from 'lucide-react';
import type { LedgerRow, StartingPoint } from '../engine/run-plan';
import { useMonteCarloRun, type MonteCarloStore } from '../hooks/use-monte-carlo';
import { formatMoney, formatPercent, type ValueMode } from '../lib/format';
import { PERCENTILES, type MonteCarloResult } from '../lib/monte-carlo';
import type { Plan } from '../model/plan';
import { MonteCarloChart } from './monte-carlo-chart';

interface Props {
  plan: Plan;
  start: StartingPoint;
  /** The deterministic plan */
  rows: LedgerRow[];
  store: MonteCarloStore;
  currency: string;
  mode: ValueMode;
  onSettings: () => void;
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
    </div>
  );
}

/** Every fifth year and the last one. */
function tableYears(result: MonteCarloResult): number[] {
  const n = result.years.length;
  return result.years.map((_, t) => t).filter((t) => t % 5 === 0 || t === n - 1);
}

function Results({
  result,
  ms,
  rows,
  currency,
  mode,
}: { result: MonteCarloResult; ms: number | null } & Pick<Props, 'rows' | 'currency' | 'mode'>) {
  const b = mode === 'today' ? result.real : result.nominal;
  const last = result.years.length - 1;
  const lastYear = result.years[last];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-6">
        <Metric
          label="Success rate"
          value={formatPercent(result.successRate)}
          hint={`of ${result.trials.toLocaleString('en-GB')} trials cover every year${ms === null ? '' : ` · run in ${(ms / 1000).toFixed(2)} s`}`}
        />
        <Metric label={`Median net worth in ${lastYear}`} value={formatMoney(b[50][last], currency)} />
        <Metric
          label={`Bad case in ${lastYear}`}
          value={formatMoney(b[10][last], currency)}
          hint="10th percentile"
        />
        <Metric
          label={`Good case in ${lastYear}`}
          value={formatMoney(b[90][last], currency)}
          hint="90th percentile"
        />
      </div>
      <MonteCarloChart result={result} rows={rows} currency={currency} mode={mode} />
      <div className="overflow-x-auto rounded-md border">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              {PERCENTILES.map((p) => (
                <TableHead key={p} className="text-right">
                  {p === 50 ? 'Median' : `${p}th`}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableYears(result).map((t) => (
              <TableRow key={t}>
                <TableCell>{result.years[t]}</TableCell>
                {PERCENTILES.map((p) => (
                  <TableCell key={p} className="text-right tabular-nums">
                    {formatMoney(b[p][t], currency)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function MonteCarloTab({ plan, start, rows, store, currency, mode, onSettings }: Props) {
  const run = useMonteCarloRun(store, plan, start);
  const running = run !== null && run.result === null && run.error === null;
  const share = plan.equityShare;
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start justify-between gap-4">
          <p className="text-muted-foreground text-sm">
            {plan.monteCarlo.trials.toLocaleString('en-GB')} trials of the plan, each on its own random market
            years around the expected returns. Stocks share: fondos {formatPercent(share.fund)}, brokerage{' '}
            {formatPercent(share.brokerage)}, pension plans {formatPercent(share.pension)}.
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={onSettings}>
              <Settings2 className="h-4 w-4" /> Settings
            </Button>
            <Button size="sm" onClick={() => store.run(plan, start)} disabled={running}>
              <Play className="h-4 w-4" /> {run?.result ? 'Run again' : 'Run'}
            </Button>
          </div>
        </div>
        {running && (
          <div className="space-y-1">
            <Progress value={(100 * run.done) / plan.monteCarlo.trials} />
            <div className="text-muted-foreground text-xs tabular-nums">
              {run.done.toLocaleString('en-GB')} of {plan.monteCarlo.trials.toLocaleString('en-GB')} trials
            </div>
          </div>
        )}
        {run?.error && <p className="text-destructive text-sm">{run.error}</p>}
        {run?.result && <Results result={run.result} ms={run.ms} rows={rows} currency={currency} mode={mode} />}
        <p className="text-muted-foreground text-xs">
          A trial succeeds when the accounts cover every year without a shortfall. Volatility and
          correlations are ignidash's defaults from US data (NYU Stern) until the calibration on euro
          data.
        </p>
      </CardContent>
    </Card>
  );
}
