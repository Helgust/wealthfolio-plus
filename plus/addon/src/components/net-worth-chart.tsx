// График net worth по годам: одна серия, площадь от нуля. Старт — значение из Wealthfolio.
import { ChartContainer, ChartTooltip, type ChartConfig } from '@wealthfolio/ui/chart';
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from '@wealthfolio/ui/chart';
import type { LedgerRow } from '../engine/run-plan';
import { formatMoney, inMode, type ValueMode } from '../lib/format';

const config = {
  netWorth: { label: 'Net worth', color: 'var(--chart-1)' },
} satisfies ChartConfig;

interface Props {
  rows: LedgerRow[];
  currency: string;
  mode: ValueMode;
}

export function NetWorthChart({ rows, currency, mode }: Props) {
  const data = rows.map((r) => ({
    year: r.year,
    age: r.people.map((p) => p.age).join(' / '),
    netWorth: inMode(r.netWorth, r.deflator, mode),
    cash: inMode(r.cash, r.deflator, mode),
  }));
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: 320 }}>
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
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
            return (
              <div className="bg-background rounded-md border px-3 py-2 text-xs shadow-sm">
                <div className="font-medium">
                  {d.year} · age {d.age}
                </div>
                <div>Net worth: {formatMoney(d.netWorth, currency)}</div>
                <div className="text-muted-foreground">Cash: {formatMoney(d.cash, currency)}</div>
              </div>
            );
          }}
        />
        <Area
          dataKey="netWorth"
          type="monotone"
          stroke="var(--color-netWorth)"
          strokeWidth={2}
          fill="var(--color-netWorth)"
          fillOpacity={0.15}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
