// "Taxes" tab: IRPF by half and RETA by year; marginal and effective IRPF rates; individual vs
// conjunta comparison for a couple.
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@wealthfolio/ui';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  Line,
  LineChart,
  XAxis,
  YAxis,
  type ChartConfig,
} from '@wealthfolio/ui/chart';
import { useState } from 'react';
import type { LedgerRow, PlanResult } from '../engine/run-plan';
import { formatMoney, formatPercent, inMode, type ValueMode } from '../lib/format';
import { FOREST, OCHRE, PURPLE } from './palette';

// Stack order is bottom to top; adjacent colors checked for distinguishability (CVD, normal vision).
const config = {
  irpfAutonomica: { label: 'IRPF autonómica', color: 'var(--chart-2)' },
  irpfEstatal: { label: 'IRPF estatal', color: 'var(--chart-1)' },
  reta: { label: 'RETA', color: 'var(--chart-4)' },
} satisfies ChartConfig;
const KEYS = Object.keys(config) as (keyof typeof config)[];

/** Rate lines cross: only the colors that pass the all-pairs check (palette.ts). */
const rateConfig = {
  effective: { label: 'Effective IRPF', theme: FOREST },
  marginalGeneral: { label: 'Marginal, base general', theme: OCHRE },
  marginalAhorro: { label: 'Marginal, base del ahorro', theme: PURPLE },
} satisfies ChartConfig;
const RATE_KEYS = Object.keys(rateConfig) as (keyof typeof rateConfig)[];

interface Props {
  result: PlanResult;
  /** Names of the people, for their marginal rates */
  people: string[];
  /** The same plan with the other filing type; null — the plan has one person */
  alternative: PlanResult | null;
  currency: string;
  mode: ValueMode;
}

function totals(rows: LedgerRow[], mode: ValueMode) {
  const sum = (f: (r: LedgerRow) => number) =>
    rows.reduce((s, r) => s + inMode(f(r), r.deflator, mode), 0);
  const irpf = sum((r) => r.irpf);
  const reta = sum((r) => r.reta);
  const revenue = sum((r) => r.revenue);
  return { irpf, reta, revenue };
}

const FILING_LABEL = { individual: 'Individual', joint: 'Joint (conjunta)' } as const;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
    </div>
  );
}

export function TaxesTab({ result, alternative, people, currency, mode }: Props) {
  const t = totals(result.rows, mode);
  const alt = alternative && totals(alternative.rows, mode);
  const data = result.rows.map((r) => ({
    year: r.year,
    irpfEstatal: inMode(r.irpfEstatal, r.deflator, mode),
    irpfAutonomica: inMode(r.irpfAutonomica, r.deflator, mode),
    reta: inMode(r.reta, r.deflator, mode),
    revenue: inMode(r.revenue, r.deflator, mode),
  }));

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid grid-cols-4 gap-6 pt-6">
          <Stat label="IRPF over the plan" value={formatMoney(t.irpf, currency)} />
          <Stat label="RETA over the plan" value={formatMoney(t.reta, currency)} />
          <Stat
            label="IRPF + RETA / revenue"
            value={t.revenue > 0 ? formatPercent((t.irpf + t.reta) / t.revenue) : '—'}
          />
          {alt && alternative && (
            <Stat
              label={`${FILING_LABEL[alternative.filing]} instead`}
              value={formatMoney(alt.irpf - t.irpf, currency)}
              hint={
                alt.irpf > t.irpf
                  ? `more IRPF than ${FILING_LABEL[result.filing].toLowerCase()}`
                  : `less IRPF than ${FILING_LABEL[result.filing].toLowerCase()}`
              }
            />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Taxes by year · {FILING_LABEL[result.filing]}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={config} className="aspect-auto w-full" style={{ height: 300 }}>
            <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid vertical={false} strokeOpacity={0.4} />
              <XAxis dataKey="year" tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={72}
                tickFormatter={(v: number) => formatMoney(v, currency, true)}
              />
              <ChartTooltip
                cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as (typeof data)[number];
                  const sum = d.irpfEstatal + d.irpfAutonomica + d.reta;
                  return (
                    <div className="bg-background rounded-md border px-3 py-2 text-xs shadow-sm">
                      <div className="font-medium">{d.year}</div>
                      {[...KEYS].reverse().map((k) => (
                        <div key={k} className="flex items-center gap-2">
                          <span
                            className="inline-block h-2 w-2 rounded-sm"
                            style={{ background: config[k].color }}
                          />
                          {config[k].label}: {formatMoney(d[k], currency)}
                        </div>
                      ))}
                      <div className="text-muted-foreground mt-1">
                        Total {formatMoney(sum, currency)}
                        {d.revenue > 0 && ` · ${formatPercent(sum / d.revenue)} of revenue`}
                      </div>
                    </div>
                  );
                }}
              />
              <ChartLegend content={<ChartLegendContent />} />
              {KEYS.map((k, i) => (
                <Bar
                  key={k}
                  dataKey={k}
                  stackId="tax"
                  fill={`var(--color-${k})`}
                  stroke="var(--background)"
                  strokeWidth={1}
                  radius={i === KEYS.length - 1 ? [4, 4, 0, 0] : 0}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
      <RatesCard result={result} people={people} />
    </div>
  );
}

/**
 * Marginal rates — IRPF on the next euro of each base, both halves — of one person's return (the
 * joint one in conjunta) and the household's effective rate: IRPF ÷ the year's income.
 */
function RatesCard({ result, people }: { result: PlanResult; people: string[] }) {
  const [person, setPerson] = useState(0);
  const byPerson = result.filing === 'individual' && people.length > 1;
  const i = byPerson ? Math.min(person, people.length - 1) : 0;
  const rows = result.rows;
  const data = rows.map((r) => ({
    year: r.year,
    effective: r.effectiveRate,
    marginalGeneral: r.people[i].marginalGeneral,
    marginalAhorro: r.people[i].marginalAhorro,
  }));
  const income = rows.reduce((s, r) => s + (r.effectiveRate > 0 ? r.irpf / r.effectiveRate : 0), 0);
  // Round ticks: every 10 % up to the highest rate.
  const top = Math.max(0.1, ...data.flatMap((d) => [d.effective, d.marginalGeneral, d.marginalAhorro]));
  const ticks = Array.from({ length: Math.ceil(top * 10 - 1e-9) + 1 }, (_, k) => k / 10);
  const irpf = rows.reduce((s, r) => s + r.irpf, 0);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">IRPF rates by year</CardTitle>
          <div className="text-muted-foreground text-xs">
            Effective over the plan: {income > 0 ? formatPercent(irpf / income) : '—'} of income
          </div>
        </div>
        {byPerson && (
          <div style={{ width: 160 }}>
            <Select value={String(i)} onValueChange={(v) => setPerson(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {people.map((name, k) => (
                  <SelectItem key={k} value={String(k)}>
                    Marginal: {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <ChartContainer config={rateConfig} className="aspect-auto w-full" style={{ height: 260 }}>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} strokeOpacity={0.4} />
            <XAxis dataKey="year" tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={48}
              domain={[0, ticks.at(-1)!]}
              ticks={ticks}
              tickFormatter={(v: number) => formatPercent(v)}
            />
            <ChartTooltip
              cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof data)[number];
                return (
                  <div className="bg-background rounded-md border px-3 py-2 text-xs shadow-sm">
                    <div className="font-medium">{d.year}</div>
                    {RATE_KEYS.map((k) => (
                      <div key={k} className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-2">
                          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: `var(--color-${k})` }} />
                          {rateConfig[k].label}
                        </span>
                        <span className="tabular-nums">{formatPercent(d[k])}</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            <ChartLegend content={<ChartLegendContent />} />
            {RATE_KEYS.map((k) => (
              <Line
                key={k}
                dataKey={k}
                type={k === 'effective' ? 'linear' : 'stepAfter'}
                stroke={`var(--color-${k})`}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
