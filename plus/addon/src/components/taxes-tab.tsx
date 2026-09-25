// "Taxes" tab: IRPF by half and RETA by year; individual vs conjunta comparison for a couple.
import { Card, CardContent, CardHeader, CardTitle } from '@wealthfolio/ui';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  XAxis,
  YAxis,
  type ChartConfig,
} from '@wealthfolio/ui/chart';
import type { LedgerRow, PlanResult } from '../engine/run-plan';
import { formatMoney, formatPercent, inMode, type ValueMode } from '../lib/format';

// Stack order is bottom to top; adjacent colors checked for distinguishability (CVD, normal vision).
const config = {
  irpfAutonomica: { label: 'IRPF autonómica', color: 'var(--chart-2)' },
  irpfEstatal: { label: 'IRPF estatal', color: 'var(--chart-1)' },
  reta: { label: 'RETA', color: 'var(--chart-4)' },
} satisfies ChartConfig;
const KEYS = Object.keys(config) as (keyof typeof config)[];

interface Props {
  result: PlanResult;
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

export function TaxesTab({ result, alternative, currency, mode }: Props) {
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
    </div>
  );
}
