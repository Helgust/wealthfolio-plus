// Net worth by year: areas stacked by Spanish account type, net worth as a line (it includes
// what is outside the model), reached milestones as marks. The start is the Wealthfolio values.
// A click on a year opens that year's panel.
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
import { useRef } from 'react';
import type { LedgerRow } from '../engine/run-plan';
import { formatMoney, inMode, type ValueMode } from '../lib/format';
import { FOREST, OCHRE, PURPLE, STONE, TERRACOTTA } from './palette';

// Stack order is bottom to top — the palette order, validated for adjacent pairs.
const config = {
  cash: { label: 'Cash', theme: FOREST },
  fund: { label: 'Fondos', theme: OCHRE },
  brokerage: { label: 'Brokerage', theme: TERRACOTTA },
  pension: { label: 'Pension plans', theme: PURPLE },
  realEstate: { label: 'Real estate equity', theme: STONE },
  netWorth: { label: 'Net worth', color: 'var(--foreground)' },
} satisfies ChartConfig;
const STACK = ['cash', 'fund', 'brokerage', 'pension', 'realEstate'] as const;

interface Props {
  rows: LedgerRow[];
  currency: string;
  mode: ValueMode;
  /** Milestone names by id */
  milestoneNames: Record<string, string>;
  onYearClick: (year: number) => void;
}

export function NetWorthChart({ rows, currency, mode, milestoneNames, onYearClick }: Props) {
  const hovered = useRef<number | null>(null);
  const data = rows.map((r) => ({
    year: r.year,
    age: r.people.map((p) => p.age).join(' / '),
    netWorth: inMode(r.netWorth, r.deflator, mode),
    other: inMode(r.otherAssets, r.deflator, mode),
    // Negative cash (money ran out) is not stacked: it shows in the net worth line.
    cash: inMode(Math.max(r.balances.cash, 0), r.deflator, mode),
    debt: inMode(Math.min(r.balances.cash, 0), r.deflator, mode),
    fund: inMode(r.balances.fund, r.deflator, mode),
    brokerage: inMode(r.balances.brokerage, r.deflator, mode),
    pension: inMode(r.balances.pension, r.deflator, mode),
    // Property less the loans on it; negative equity shows only in the net worth line.
    realEstate: inMode(Math.max(r.propertyValue - r.loanBalance, 0), r.deflator, mode),
    milestones: r.milestones.map((id) => milestoneNames[id] ?? id).join(', '),
  }));
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: 340, cursor: 'pointer' }}>
      <ComposedChart
        data={data}
        margin={{ top: 20, right: 16, bottom: 0, left: 8 }}
        // A click carries no active index (the tooltip follows hover), so the hovered one is kept.
        onMouseMove={(s) => (hovered.current = s.activeTooltipIndex == null ? null : Number(s.activeTooltipIndex))}
        onMouseLeave={() => (hovered.current = null)}
        onClick={() => {
          const row = hovered.current === null ? undefined : rows[hovered.current];
          if (row) onYearClick(row.year);
        }}
      >
        <CartesianGrid vertical={false} strokeOpacity={0.4} />
        <XAxis dataKey="year" tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={72}
          tickFormatter={(v: number) => formatMoney(v, currency, true)}
        />
        <ReferenceLine y={0} stroke="var(--border)" />
        {rows
          .filter((r) => r.milestones.length > 0)
          .map((r) => (
            <ReferenceLine
              key={r.year}
              x={r.year}
              stroke="var(--muted-foreground)"
              strokeOpacity={0.6}
              label={{
                value: r.milestones.map((id) => milestoneNames[id] ?? id).join(', '),
                position: 'top',
                fill: 'var(--muted-foreground)',
                fontSize: 11,
              }}
            />
          ))}
        <ChartTooltip
          cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as (typeof data)[number];
            const line = (label: string, v: number) =>
              v !== 0 && (
                <div key={label} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="tabular-nums">{formatMoney(v, currency)}</span>
                </div>
              );
            return (
              <div className="bg-background min-w-48 rounded-md border px-3 py-2 text-xs shadow-sm">
                <div className="font-medium">
                  {d.year} · age {d.age}
                </div>
                {d.milestones && <div className="text-muted-foreground">{d.milestones}</div>}
                <div className="flex justify-between gap-4 font-medium">
                  <span>Net worth</span>
                  <span className="tabular-nums">{formatMoney(d.netWorth, currency)}</span>
                </div>
                {[...STACK].reverse().map((k) => line(config[k].label, d[k]))}
                {line('Cash shortfall', d.debt)}
                {line('Outside the model', d.other)}
                <div className="text-muted-foreground mt-1">Click for the year's details</div>
              </div>
            );
          }}
        />
        {STACK.map((k) => (
          <Area
            key={k}
            dataKey={k}
            stackId="kinds"
            type="monotone"
            stroke="var(--background)"
            strokeWidth={2}
            fill={`var(--color-${k})`}
            fillOpacity={0.85}
            isAnimationActive={false}
          />
        ))}
        <Line
          dataKey="netWorth"
          type="monotone"
          stroke="var(--color-netWorth)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        {/* Own legend: the host one colors swatches by the area stroke, which is the background. */}
        <ChartLegend
          content={() => (
            <div className="flex items-center justify-center gap-4 pt-3">
              {[...STACK, 'netWorth' as const].map((k) => (
                <div key={k} className="flex items-center gap-1.5">
                  <div className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: `var(--color-${k})` }} />
                  {config[k].label}
                </div>
              ))}
            </div>
          )}
        />
      </ComposedChart>
    </ChartContainer>
  );
}
