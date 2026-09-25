// Методы API аддонов, которые есть только в нашем форке Wealthfolio.
// В официальной сборке их нет: вызывающий код проверяет наличие и работает без них.
import type { AddonContext } from '@wealthfolio/addon-sdk';

// Копия AlternativeAssetHolding из packages/addon-sdk форка (поля, которые нужны аддону).
export interface AlternativeAssetHolding {
  id: string;
  /** property, vehicle, collectible, precious, liability, other */
  kind: string;
  name: string;
  currency: string;
  /** Десятичная строка */
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
 * null — метод недоступен (официальная сборка Wealthfolio).
 * Проверить наличие заранее нельзя: API в песочнице — Proxy, у него есть любое свойство,
 * а неизвестный метод отклоняется хостом только при вызове.
 */
export async function getAlternativeHoldings(
  ctx: AddonContext,
): Promise<AlternativeAssetHolding[] | null> {
  try {
    return await (ctx.api.portfolio as PortfolioWithAlternatives).getAlternativeHoldings();
  } catch (error) {
    ctx.api.logger.warn(`getAlternativeHoldings недоступен: ${String(error)}`);
    return null;
  }
}

// Копия NetWorth из packages/addon-sdk форка. Суммы — десятичные строки в базовой валюте.
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

/** Net worth как на странице Net Worth; null — метод недоступен (официальная сборка). */
export async function getNetWorth(ctx: AddonContext): Promise<NetWorth | null> {
  try {
    return await (ctx.api.portfolio as PortfolioWithNetWorth).getNetWorth();
  } catch (error) {
    ctx.api.logger.warn(`getNetWorth недоступен: ${String(error)}`);
    return null;
  }
}
