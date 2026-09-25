// Стартовая точка плана из Wealthfolio: net worth как на странице Net Worth и сумма CASH-счетов.
import type { AddonContext } from '@wealthfolio/addon-sdk';
import type { StartingPoint } from '../engine/run-plan';
import { getNetWorth } from './fork-api';

export interface LoadedStartingPoint extends StartingPoint {
  currency: string | null;
  /** true — net worth из get_net_worth форка; false — сумма оценок счетов (официальная сборка) */
  exact: boolean;
}

export async function loadStartingPoint(ctx: AddonContext): Promise<LoadedStartingPoint> {
  const accounts = (await ctx.api.accounts.getAll()).filter((a) => a.isActive && !a.isArchived);
  const valuations = accounts.length
    ? await ctx.api.portfolio.getLatestValuations(accounts.map((a) => a.id))
    : [];
  const cashIds = new Set(accounts.filter((a) => a.accountType === 'CASH').map((a) => a.id));
  const cash = valuations
    .filter((v) => cashIds.has(v.accountId))
    .reduce((s, v) => s + v.totalValueBase, 0);

  const nw = await getNetWorth(ctx);
  if (nw) {
    return { netWorth: Number(nw.netWorth), cash, currency: nw.currency, exact: true };
  }
  return {
    netWorth: valuations.reduce((s, v) => s + v.totalValueBase, 0),
    cash,
    currency: valuations[0]?.baseCurrency ?? null,
    exact: false,
  };
}
