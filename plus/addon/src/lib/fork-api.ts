// Addon API methods missing from the addon SDK 3.8.0 typings: getNetWorth exists only in our
// Wealthfolio fork, alternativeAssets.getAll — in Wealthfolio 3.9+.
// Builds without them: callers check availability and work without them.
import type { AddonContext } from '@wealthfolio/addon-sdk';

// Copy of AlternativeAssetHolding from addon SDK 3.9 (fields the addon needs).
export interface AlternativeAssetHolding {
  id: string;
  /** PROPERTY, VEHICLE, COLLECTIBLE, PRECIOUS_METAL, LIABILITY, OTHER (Rust AssetKind, SCREAMING_SNAKE_CASE) */
  kind: string;
  name: string;
  currency: string;
  /** Decimal string */
  marketValue: string;
  purchasePrice?: string;
  purchaseDate?: string;
  valuationDate: string;
  metadata?: Record<string, unknown>;
  linkedAssetId?: string;
}

type ApiWithAlternatives = AddonContext['api'] & {
  alternativeAssets: { getAll: () => Promise<AlternativeAssetHolding[]> };
};

/**
 * null — method unavailable (Wealthfolio before 3.9).
 * Availability cannot be checked in advance: the sandbox API is a Proxy that has every property,
 * and the host rejects an unknown method only when it is called.
 */
export async function getAlternativeHoldings(
  ctx: AddonContext,
): Promise<AlternativeAssetHolding[] | null> {
  try {
    return await (ctx.api as ApiWithAlternatives).alternativeAssets.getAll();
  } catch (error) {
    ctx.api.logger.warn(`alternativeAssets.getAll unavailable: ${String(error)}`);
    return null;
  }
}

// Copy of NetWorth from the fork's packages/addon-sdk. Amounts are decimal strings in base currency.
export interface NetWorth {
  date: string;
  assets: { total: string };
  liabilities: { total: string };
  netWorth: string;
  currency: string;
}

type PortfolioWithNetWorth = AddonContext['api']['portfolio'] & {
  getNetWorth: (date?: string) => Promise<NetWorth>;
};

/** Net worth as on the Net Worth page; null — method unavailable (official build). */
export async function getNetWorth(ctx: AddonContext): Promise<NetWorth | null> {
  try {
    return await (ctx.api.portfolio as PortfolioWithNetWorth).getNetWorth();
  } catch (error) {
    ctx.api.logger.warn(`getNetWorth unavailable: ${String(error)}`);
    return null;
  }
}
