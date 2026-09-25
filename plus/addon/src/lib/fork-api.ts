// Addon API methods that exist only in our Wealthfolio fork.
// The official build does not have them: callers check availability and work without them.
import type { AddonContext } from '@wealthfolio/addon-sdk';

// Copy of AlternativeAssetHolding from the fork's packages/addon-sdk (fields the addon needs).
export interface AlternativeAssetHolding {
  id: string;
  /** property, vehicle, collectible, precious, liability, other */
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

type PortfolioWithAlternatives = AddonContext['api']['portfolio'] & {
  getAlternativeHoldings: () => Promise<AlternativeAssetHolding[]>;
};

/**
 * null — method unavailable (official Wealthfolio build).
 * Availability cannot be checked in advance: the sandbox API is a Proxy that has every property,
 * and the host rejects an unknown method only when it is called.
 */
export async function getAlternativeHoldings(
  ctx: AddonContext,
): Promise<AlternativeAssetHolding[] | null> {
  try {
    return await (ctx.api.portfolio as PortfolioWithAlternatives).getAlternativeHoldings();
  } catch (error) {
    ctx.api.logger.warn(`getAlternativeHoldings unavailable: ${String(error)}`);
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
