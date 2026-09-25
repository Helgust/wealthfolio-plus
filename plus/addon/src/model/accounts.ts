// Соответствие «счёт Wealthfolio → испанский тип» и владелец счёта. Это факт о счетах, а не
// о плане: одна запись на все планы, ключ accounts.v1 в ctx.api.storage.
import type { AddonContext } from '@wealthfolio/addon-sdk';
import { z } from 'zod';

/**
 * cash — проценты в базе сбережений; fund — fondos de inversión (traspaso без налога);
 * brokerage — ETF и акции; ppi, ppes — plan de pensiones individual и de empleo simplificado
 * (для autónomo); other — вне модели: стоимость остаётся постоянной.
 */
export const SpanishKindSchema = z.enum(['cash', 'fund', 'brokerage', 'ppi', 'ppes', 'other']);

/** Индекс человека в плане или совместный счёт (доходы делятся поровну). */
export const OwnerSchema = z.union([z.literal(0), z.literal(1), z.literal('joint')]);

export const AccountSettingSchema = z.object({
  kind: SpanishKindSchema,
  owner: OwnerSchema,
});

export const AccountSettingsSchema = z.record(z.string(), AccountSettingSchema);

export type SpanishKind = z.infer<typeof SpanishKindSchema>;
export type Owner = z.infer<typeof OwnerSchema>;
export type AccountSetting = z.infer<typeof AccountSettingSchema>;
export type AccountSettings = z.infer<typeof AccountSettingsSchema>;

export const KIND_LABEL: Record<SpanishKind, string> = {
  cash: 'Cash',
  fund: 'Fondos de inversión',
  brokerage: 'Brokerage (ETF, stocks)',
  ppi: 'Plan de pensiones (PPI)',
  ppes: 'Plan de empleo simplificado (PPES)',
  other: 'Not modelled',
};

export const isPension = (k: SpanishKind) => k === 'ppi' || k === 'ppes';

/** Тип по умолчанию для счёта без настройки — по типу счёта Wealthfolio. */
export function defaultSetting(accountType: string): AccountSetting {
  const kind: SpanishKind =
    accountType === 'CASH'
      ? 'cash'
      : accountType === 'SECURITIES' || accountType === 'CRYPTOCURRENCY'
        ? 'brokerage'
        : 'other';
  return { kind, owner: 'joint' };
}

const KEY = 'accounts.v1';

/** Испорченная запись не валит страницу: счета получают типы по умолчанию. */
export function parseAccountSettings(json: string | null): AccountSettings {
  if (json === null) return {};
  try {
    const parsed = AccountSettingsSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export async function loadAccountSettings(ctx: AddonContext): Promise<AccountSettings> {
  return parseAccountSettings(await ctx.api.storage.get(KEY));
}

export async function saveAccountSettings(
  ctx: AddonContext,
  settings: AccountSettings,
): Promise<void> {
  await ctx.api.storage.set(KEY, JSON.stringify(AccountSettingsSchema.parse(settings)));
}
