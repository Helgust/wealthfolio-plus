// Real estate and loans from Wealthfolio alternative assets: what the planner needs to know about
// them beyond Wealthfolio's value, price and interest rate. Like the account types, this is a
// fact about the assets, not about a plan: one record for all plans, key properties.v1.
import type { AddonContext } from '@wealthfolio/addon-sdk';
import { z } from 'zod';
import { OwnerSchema } from './accounts';

const money = z.number().finite().min(0);

/**
 * habitual — vivienda habitual (no imputación; exempt gain on reinvestment or from 65);
 * second — not rented and not used in an activity: imputación de rentas (art. 85 LIRPF);
 * rented — rented out: no imputación; the rent is modelled by a rental in the plan;
 * other — outside the model: value stays constant.
 */
export const PropertyUseSchema = z.enum(['habitual', 'second', 'rented', 'other']);

export const PropertySettingSchema = z.object({
  use: PropertyUseSchema,
  owner: OwnerSchema,
  /** From the IBI bill; null — unknown: imputación uses half the acquisition price */
  valorCatastral: money.nullable(),
  /** The municipality's valores catastrales were revised in the last ten years (imputación 1.1 %) */
  catastroRevisado: z.boolean(),
  /** IBI per year in first-year prices, from the bill */
  ibi: money,
  /** Taxes and costs paid at purchase (ITP or IVA, notary, registry): part of the valor de adquisición */
  acquisitionCosts: money,
  /** Comunidad and insurance per year in first-year prices */
  community: money.optional(),
  insurance: money.optional(),
  /**
   * Share of the building in the valor catastral (IBI receipt: valor de la construcción ÷ valor
   * catastral) — for the amortización of a rental; absent — none is deducted
   */
  constructionShare: z.number().finite().min(0).max(1).optional(),
});

/**
 * A loan is modelled once its monthly payment or the years left are known; until then it stays
 * constant. The rate is Wealthfolio's interest rate.
 */
export const LoanSettingSchema = z.object({
  monthlyPayment: money,
  /** Years left: the payment is the annuity over them; absent — monthlyPayment */
  years: z.number().int().min(1).max(40).optional(),
  /**
   * Absent — fixed. Otherwise Euríbor + diferencial, revised once a year from variableFrom
   * (null — from the plan's second year: Wealthfolio's rate is this year's).
   */
  variable: z
    .object({
      diferencial: z.number().finite().min(-0.05).max(0.1),
      variableFrom: z.number().int().min(1900).max(2200).nullable(),
    })
    .optional(),
});

export const RealEstateSettingsSchema = z.object({
  properties: z.record(z.string(), PropertySettingSchema).default({}),
  loans: z.record(z.string(), LoanSettingSchema).default({}),
});

export type PropertyUse = z.infer<typeof PropertyUseSchema>;
export type PropertySetting = z.infer<typeof PropertySettingSchema>;
export type LoanSetting = z.infer<typeof LoanSettingSchema>;
export type RealEstateSettings = z.infer<typeof RealEstateSettingsSchema>;

export const USE_LABEL: Record<PropertyUse, string> = {
  habitual: 'Vivienda habitual',
  second: 'Second home (imputación)',
  rented: 'Rented out',
  other: 'Not modelled',
};

/** Default for a property without a setting — by the Wealthfolio property sub type. */
export function defaultPropertySetting(subType: string | undefined): PropertySetting {
  const use: PropertyUse = subType === 'residence' ? 'habitual' : subType === 'rental' ? 'rented' : 'other';
  return { use, owner: 'joint', valorCatastral: null, catastroRevisado: false, ibi: 0, acquisitionCosts: 0 };
}

const KEY = 'properties.v1';

/** A broken record does not break the page: assets get default settings. */
export function parseRealEstateSettings(json: string | null): RealEstateSettings {
  const empty = { properties: {}, loans: {} };
  if (json === null) return empty;
  try {
    const parsed = RealEstateSettingsSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : empty;
  } catch {
    return empty;
  }
}

export async function loadRealEstateSettings(ctx: AddonContext): Promise<RealEstateSettings> {
  return parseRealEstateSettings(await ctx.api.storage.get(KEY));
}

export async function saveRealEstateSettings(ctx: AddonContext, settings: RealEstateSettings): Promise<void> {
  await ctx.api.storage.set(KEY, JSON.stringify(RealEstateSettingsSchema.parse(settings)));
}
