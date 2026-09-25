// Net worth of the compared plans on one chart, one line per plan slot.
import {
  CartesianGrid,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
  ChartTooltip,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
  type ChartConfig,
} from '@wealthfolio/ui/chart';
import type { ReactNode } from 'react';
import type { LedgerRow } from '../engine/run-plan';
import { formatMoney, inMode, type ValueMode } from '../lib/format';
import { FOREST, OCHRE, PURPLE } from './palette';

/** Slot colors: lines cross, so only colors that pass the all-pairs check (palette.ts). */
const SLOT_COLORS = [FOREST, OCHRE, PURPLE];
export const SLOT_COUNT = SLOT_COLORS.length;

const slotKey = (i: number) => `slot${i}`;
const SLOT_CONFIG: ChartConfig = Object.fromEntries(SLOT_COLORS.map((theme, i) => [slotKey(i), { theme }]));

/** Defines the slot colors for everything inside, so marks outside the chart match its lines. */
export function SlotColorScope({ children }: { children: ReactNode }) {
  return (
    <div data-chart="compare-slots">
      <ChartStyle id="compare-slots" config={SLOT_CONFIG} />
      {children}
    </div>
  );
}

export function SlotSwatch({ slot }: { slot: number }) {
  return <span className="inline-block h-2 w-2 rounded-sm" style={{ background: `var(--color-${slotKey(slot)})` }} />;
}

export interface ComparedRun {
  name: string;
  rows: LedgerRow[];
}

interface Props {
  /** By slot; null — empty slot */
  runs: (ComparedRun | null)[];
  currency: string;
  mode: ValueMode;
}

export function CompareChart({ runs, currency, mode }: Props) {
  const config: ChartConfig = {};
  runs.forEach((run, i) => {
    if (run) config[slotKey(i)] = { label: run.name, theme: SLOT_COLORS[i] };
  });
  const years = [...new Set(runs.flatMap((run) => run?.rows.map((r) => r.year) ?? []))].sort((a, b) => a - b);
  const data = years.map((year) => {
    const point: Record<string, number> = { year };
    runs.forEach((run, i) => {
      const r = run?.rows.find((x) => x.year === year);
      if (r) point[slotKey(i)] = inMode(r.netWorth, r.deflator, mode);
    });
    return point;
  });

  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: 340 }}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
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
            const d = payload[0].payload as Record<string, number>;
            return (
              <div className="bg-background min-w-48 rounded-md border px-3 py-2 text-xs shadow-sm">
                <div className="font-medium">{d.year} · net worth</div>
                {runs.map(
                  (run, i) =>
                    run &&
                    d[slotKey(i)] !== undefined && (
                      <div key={i} className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-2">
                          <SlotSwatch slot={i} />
                          {run.name}
                        </span>
                        <span className="tabular-nums">{formatMoney(d[slotKey(i)], currency)}</span>
                      </div>
                    ),
                )}
              </div>
            );
          }}
        />
        {runs.map(
          (run, i) =>
            run && (
              <Line
                key={i}
                dataKey={slotKey(i)}
                type="monotone"
                stroke={`var(--color-${slotKey(i)})`}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ),
        )}
        <ChartLegend content={<ChartLegendContent />} />
      </LineChart>
    </ChartContainer>
  );
}
