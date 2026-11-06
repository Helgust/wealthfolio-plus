// constraint: portfolio.getNetWorth exists only in this fork's host; the published SDK does not type it.
import type { AddonContext } from '@wealthfolio/addon-sdk';

/** Amounts are decimal strings in base currency. */
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

/** Net worth as on the Net Worth page; null on a host without the method (official build). */
export async function getNetWorth(ctx: AddonContext): Promise<NetWorth | null> {
  try {
    return await (ctx.api.portfolio as PortfolioWithNetWorth).getNetWorth();
  } catch (error) {
    ctx.api.logger.warn(`getNetWorth unavailable: ${String(error)}`);
    return null;
  }
}
