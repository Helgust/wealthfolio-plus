// Mapping "Wealthfolio account → Spanish type" and the account owner. This is a fact about
// accounts, not about a plan: one record for all plans, key accounts.v1 in ctx.api.storage.
import type { AddonContext } from '@wealthfolio/addon-sdk';
import { z } from 'zod';

/**
 * cash — interest in the savings base; fund — fondos de inversión (traspaso without tax);
 * brokerage — ETFs and stocks; ppi, ppes — plan de pensiones individual and de empleo
 * simplificado (for autónomos); other — outside the model: value stays constant.
 */
export const SpanishKindSchema = z.enum(['cash', 'fund', 'brokerage', 'ppi', 'ppes', 'other']);

/** Index of a person in the plan, or a joint account (income split equally). */
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

/** Default type for an account without a setting — by the Wealthfolio account type. */
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

/** A broken record does not break the page: accounts get default types. */
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
