// График net worth по годам: площади по испанским типам счетов стопкой, net worth — линией
// (включает то, что вне модели). Старт — значения из Wealthfolio.
import {
  Area,
  CartesianGrid,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
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

// Своя палитра в тонах Wealthfolio (хвоя, охра, терракота, лиловый), но насыщеннее: цвета хоста
// --chart-1…4 не различаются в стопке. Порядок — снизу вверх; обе темы проверены валидатором
// dataviz на фонах хоста (#fffcf0 и #100f0f): полоса светлоты, насыщенность, соседние пары при
// дальтонизме (ΔE ≥ 8) и обычном зрении (ΔE ≥ 15), контраст ≥ 3:1.
const config = {
  cash: { label: 'Cash', theme: { light: '#1d7a58', dark: '#2a9168' } },
  fund: { label: 'Fondos', theme: { light: '#b08a14', dark: '#b78f1b' } },
  brokerage: { label: 'Brokerage', theme: { light: '#a9403a', dark: '#c24c46' } },
  pension: { label: 'Pension plans', theme: { light: '#7462b8', dark: '#8f7ed2' } },
  netWorth: { label: 'Net worth', color: 'var(--foreground)' },
} satisfies ChartConfig;
const STACK = ['cash', 'fund', 'brokerage', 'pension'] as const;

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
    other: inMode(r.otherAssets, r.deflator, mode),
    // Отрицательный cash (деньги кончились) в стопку не кладём: он виден по линии net worth.
    cash: inMode(Math.max(r.balances.cash, 0), r.deflator, mode),
    debt: inMode(Math.min(r.balances.cash, 0), r.deflator, mode),
    fund: inMode(r.balances.fund, r.deflator, mode),
    brokerage: inMode(r.balances.brokerage, r.deflator, mode),
    pension: inMode(r.balances.pension, r.deflator, mode),
  }));
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: 340 }}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
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
                <div className="flex justify-between gap-4 font-medium">
                  <span>Net worth</span>
                  <span className="tabular-nums">{formatMoney(d.netWorth, currency)}</span>
                </div>
                {[...STACK].reverse().map((k) => line(config[k].label, d[k]))}
                {line('Cash shortfall', d.debt)}
                {line('Outside the model', d.other)}
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
        <ChartLegend content={<ChartLegendContent />} />
      </ComposedChart>
    </ChartContainer>
  );
}
