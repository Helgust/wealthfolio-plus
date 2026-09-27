// Inputs and labels for event amounts: the value per period and its change over time.
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wealthfolio/ui';
import { formatMoney, formatPercent } from '../lib/format';
import type { Growth, Period } from '../model/plan';
import { NumberInput, PercentInput } from './form-fields';

const PERIOD_LABEL: Record<Period, string> = { year: 'per year', quarter: 'per quarter', month: 'per month' };

export function PeriodSelect({ value, onChange }: { value: Period | undefined; onChange: (p: Period) => void }) {
  return (
    <Select value={value ?? 'year'} onValueChange={(v) => onChange(v as Period)}>
      <SelectTrigger style={{ minWidth: 0 }}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
          <SelectItem key={p} value={p}>
            {PERIOD_LABEL[p]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Value and its period side by side. */
export function AmountInput({
  value,
  per,
  step = 100,
  onChange,
}: {
  value: number;
  per: Period | undefined;
  step?: number;
  onChange: (value: number, per: Period) => void;
}) {
  return (
    <div className="flex gap-2">
      <NumberInput value={value} step={step} onChange={(v) => onChange(v ?? 0, per ?? 'year')} />
      <div style={{ width: 120, flex: 'none' }}>
        <PeriodSelect value={per} onChange={(p) => onChange(value, p)} />
      </div>
    </div>
  );
}

/** Inflation plus a real growth, or a nominal growth; the percent is per year. */
export function GrowthInput({ value, onChange }: { value: Growth; onChange: (g: Growth) => void }) {
  const percent = value.kind === 'inflation' ? value.real : value.rate;
  return (
    <div className="flex gap-2">
      <Select
        value={value.kind}
        onValueChange={(k) =>
          onChange(k === 'inflation' ? { kind: 'inflation', real: percent } : { kind: 'nominal', rate: percent })
        }
      >
        <SelectTrigger style={{ minWidth: 0 }}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="inflation">Inflation +</SelectItem>
          <SelectItem value="nominal">Nominal</SelectItem>
        </SelectContent>
      </Select>
      <div style={{ width: 72, flex: 'none' }}>
        <PercentInput
          value={percent}
          onChange={(v) => onChange(value.kind === 'inflation' ? { ...value, real: v } : { ...value, rate: v })}
        />
      </div>
    </div>
  );
}

const PERIOD_SUFFIX: Record<Period, string> = { year: '/year', quarter: '/quarter', month: '/month' };

/** "€1,200/month" — the amount as entered. */
export function amountLabel(value: number, per: Period | undefined, currency: string): string {
  return `${formatMoney(value, currency)}${PERIOD_SUFFIX[per ?? 'year']}`;
}

/** "with inflation", "inflation + 1%", "fixed nominal", "nominal +2%/year". */
export function growthLabel(g: Growth): string {
  if (g.kind === 'inflation') {
    if (g.real === 0) return 'with inflation';
    return `inflation ${g.real > 0 ? '+' : '−'} ${formatPercent(Math.abs(g.real))}`;
  }
  if (g.rate === 0) return 'fixed nominal';
  return `nominal ${g.rate > 0 ? '+' : '−'}${formatPercent(Math.abs(g.rate))}/year`;
}
