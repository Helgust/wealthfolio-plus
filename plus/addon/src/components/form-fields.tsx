// Form fields of the plan editor.
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wealthfolio/ui';
import type { ReactNode } from 'react';
import { MONTH_NAMES } from '../lib/format';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  step = 1,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
}) {
  return (
    <Input
      type="number"
      step={step}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}

const OVER_THE_YEAR = 'year';

/** A month of the year (1 — January), or none: spread over the year. */
export function MonthSelect({
  value,
  onChange,
  noneLabel = 'Over the year',
}: {
  value: number | undefined;
  onChange: (month: number | undefined) => void;
  noneLabel?: string;
}) {
  return (
    <Select value={value ? String(value) : OVER_THE_YEAR} onValueChange={(v) => onChange(v === OVER_THE_YEAR ? undefined : Number(v))}>
      <SelectTrigger style={{ minWidth: 0 }}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={OVER_THE_YEAR}>{noneLabel}</SelectItem>
        {MONTH_NAMES.map((name, i) => (
          <SelectItem key={name} value={String(i + 1)}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Percent in the field, fraction in the model. */
export function PercentInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <NumberInput
      value={Math.round(value * 10000) / 100}
      step={0.1}
      onChange={(v) => onChange((v ?? 0) / 100)}
    />
  );
}
