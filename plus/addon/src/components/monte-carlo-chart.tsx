// Monte Carlo fan: net worth by year across trials — the 10th–90th and 25th–75th percentile bands
// and the median, one hue in washes of different strength; the deterministic plan as a neutral line.
// The washes are set per theme: on the dark background the same opacity nearly disappears.
import {
  Area,
  CartesianGrid,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
  type ChartConfig,
} from '@wealthfolio/ui/chart';
import type { LedgerRow } from '../engine/run-plan';
import { formatMoney, inMode, type ValueMode } from '../lib/format';
import type { MonteCarloResult } from '../lib/monte-carlo';
import { FOREST } from './palette';

const wash = (hex: string, alpha: number) =>
  `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')}, ${alpha})`;

const config = {
  outer: { label: '10th–90th percentile', theme: { light: wash(FOREST.light, 0.12), dark: wash(FOREST.dark, 0.22) } },
  inner: { label: '25th–75th percentile', theme: { light: wash(FOREST.light, 0.3), dark: wash(FOREST.dark, 0.45) } },
  median: { label: 'Median', theme: FOREST },
  plan: { label: 'Plan with expected returns', color: 'var(--muted-foreground)' },
} satisfies ChartConfig;
const LEGEND = [
  { key: 'median', height: 2 },
  { key: 'inner', height: 8 },
  { key: 'outer', height: 8 },
  { key: 'plan', height: 2 },
] as const;

interface Props {
  result: MonteCarloResult;
  /** The deterministic plan */
  rows: LedgerRow[];
  currency: string;
  mode: ValueMode;
}

export function MonteCarloChart({ result, rows, currency, mode }: Props) {
  const b = mode === 'today' ? result.real : result.nominal;
  const data = result.years.map((year, t) => ({
    year,
    outer: [b[10][t], b[90][t]],
    inner: [b[25][t], b[75][t]],
    median: b[50][t],
    plan: rows[t] ? inMode(rows[t].netWorth, rows[t].deflator, mode) : null,
  }));
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: 340 }}>
      <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.4} />
        <XAxis dataKey="year" tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={72}
          tickFormatter={(v: number) => formatMoney(v, currency, true)}
        />
        <ReferenceLine y={0} stroke="var(--border)" />
        <ChartTooltip
          cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as (typeof data)[number];
            const line = (label: string, v: number | null, strong = false) =>
              v !== null && (
                <div key={label} className={`flex justify-between gap-4 ${strong ? 'font-medium' : ''}`}>
                  <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
                  <span className="tabular-nums">{formatMoney(v, currency)}</span>
                </div>
              );
            return (
              <div className="bg-background rounded-md border px-3 py-2 text-xs shadow-sm" style={{ minWidth: 208 }}>
                <div className="font-medium">{d.year}</div>
                {line('90th percentile', d.outer[1])}
                {line('75th percentile', d.inner[1])}
                {line('Median', d.median, true)}
                {line('25th percentile', d.inner[0])}
                {line('10th percentile', d.outer[0])}
                {line('Plan with expected returns', d.plan)}
              </div>
            );
          }}
        />
        <Area
          dataKey="outer"
          type="monotone"
          stroke="none"
          fill="var(--color-outer)"
          fillOpacity={1}
          isAnimationActive={false}
        />
        <Area
          dataKey="inner"
          type="monotone"
          stroke="none"
          fill="var(--color-inner)"
          fillOpacity={1}
          isAnimationActive={false}
        />
        <Line
          dataKey="plan"
          type="monotone"
          stroke="var(--color-plan)"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="median"
          type="monotone"
          stroke="var(--color-median)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <ChartLegend
          content={() => (
            <div className="flex items-center justify-center gap-4 pt-3">
              {LEGEND.map(({ key, height }) => (
                <div key={key} className="flex items-center gap-1.5">
                  <div
                    className="w-3 shrink-0 rounded-[2px]"
                    style={{ height, backgroundColor: `var(--color-${key})` }}
                  />
                  {config[key].label}
                </div>
              ))}
            </div>
          )}
        />
      </ComposedChart>
    </ChartContainer>
  );
}
