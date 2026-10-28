// Budget by month: envelope balances as lines, loans as dashed lines, the current month marked.
import {
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  LineChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
  type ChartConfig,
} from '@wealthfolio/ui/chart';
import type { BudgetMonth } from '../engine/budget';
import { formatMoney } from '../lib/format';
import type { Budget } from '../model/budget';
import { AXIS_TICK, FOREST, MUTED, OCHRE, PURPLE, REFERENCE, STONE, TERRACOTTA } from './palette';

// Lines cross, so the colors that pass for all pairs come first (palette.ts); stone is for loans.
const COLORS = [FOREST, OCHRE, PURPLE, TERRACOTTA];

interface Props {
  budget: Budget;
  rows: BudgetMonth[];
  currency: string;
  /** This month, "2026-11" */
  today: string;
}

export function BudgetChart({ budget, rows, currency, today }: Props) {
  const series = [
    ...budget.envelopes.map((e, i) => ({
      key: `e_${e.id}`,
      label: e.name,
      theme: COLORS[i % COLORS.length],
      loan: false,
    })),
    ...budget.loans.map((l) => ({
      key: `l_${l.id}`,
      label: l.name,
      theme: STONE,
      loan: true,
    })),
  ];
  const config = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label, theme: s.theme }]),
  ) satisfies ChartConfig;
  const data = rows.map((r) => ({
    month: r.month,
    ...Object.fromEntries(budget.envelopes.map((e) => [`e_${e.id}`, r.balances[e.id]])),
    ...Object.fromEntries(budget.loans.map((l) => [`l_${l.id}`, r.loans[l.id].balance])),
  }));
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: 300 }}>
      <LineChart data={data} margin={{ top: 20, right: 16, bottom: 0, left: 8 }}>
        <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={64}
          tickFormatter={(v: number) => formatMoney(v, currency, true)}
        />
        {rows.some((r) => r.month === today) && (
          <ReferenceLine
            x={today}
            stroke={REFERENCE}
            strokeDasharray="4 3"
            label={{ value: 'Today', position: 'top', fill: MUTED, fontSize: 10 }}
          />
        )}
        <ChartTooltip
          cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as Record<string, number | string>;
            return (
              <div className="bg-background min-w-48 rounded-md border px-3 py-2 text-xs shadow-sm">
                <div className="font-medium">{d.month}</div>
                {series.map((s) => (
                  <div key={s.key} className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{s.loan ? `${s.label} (owed)` : s.label}</span>
                    <span className="tabular-nums">{formatMoney(Number(d[s.key]), currency)}</span>
                  </div>
                ))}
              </div>
            );
          }}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            dataKey={s.key}
            type="monotone"
            stroke={`var(--color-${s.key})`}
            strokeWidth={1.5}
            strokeDasharray={s.loan ? '5 3' : undefined}
            dot={false}
            isAnimationActive={false}
          />
        ))}
        <ChartLegend
          content={() => (
            <div className="flex flex-wrap items-center justify-center gap-4 pt-3">
              {series.map((s) => (
                <div key={s.key} className="flex items-center gap-1.5">
                  <div
                    className="h-2 w-2 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: `var(--color-${s.key})` }}
                  />
                  {s.loan ? `${s.label} (owed)` : s.label}
                </div>
              ))}
            </div>
          )}
        />
      </LineChart>
    </ChartContainer>
  );
}
