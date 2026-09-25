// Поля форм редактора плана.
import { Input, Label } from '@wealthfolio/ui';
import type { ReactNode } from 'react';

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

/** Процент в поле, доля в модели. */
export function PercentInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <NumberInput
      value={Math.round(value * 10000) / 100}
      step={0.1}
      onChange={(v) => onChange((v ?? 0) / 100)}
    />
  );
}
