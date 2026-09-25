// Стартовая точка плана из Wealthfolio: net worth как на странице Net Worth и счета с позициями
// и лотами. Испанский тип счёта накладывается отдельно (buildStart), чтобы смена типа не
// перечитывала портфель.
import type { AddonContext, Holding } from '@wealthfolio/addon-sdk';
import { positionValue, type Account, type Position } from '../engine/portfolio';
import type { StartingPoint } from '../engine/run-plan';
import { defaultSetting, type AccountSetting, type AccountSettings } from '../model/accounts';
import { getNetWorth } from './fork-api';

export interface WfAccount {
  id: string;
  name: string;
  /** Тип счёта Wealthfolio: CASH, SECURITIES, … */
  accountType: string;
  /** Оценка Wealthfolio на последнюю дату */
  wfValue: number;
  /** Деньги без лотов */
  cash: number;
  positions: Position[];
}

export interface LoadedPortfolio {
  netWorth: number;
  currency: string | null;
  /** true — net worth из get_net_worth форка; false — сумма оценок счетов (официальная сборка) */
  exact: boolean;
  accounts: WfAccount[];
}

export const settingFor = (settings: AccountSettings, a: WfAccount): AccountSetting =>
  settings[a.id] ?? defaultSetting(a.accountType);

/**
 * Позиция из holding Wealthfolio. Стоимость приобретения лотов — в валюте актива; масштабируем
 * их к исторической стоимости в базовой валюте (costBasis.base), чтобы прирост был в евро.
 */
function toPosition(h: Holding, lots: Holding['lots']): Position {
  const units = h.quantity;
  const costBase = h.costBasis?.base ?? h.marketValue.base;
  const price = units > 0 ? h.marketValue.base / units : 0;
  const name = h.instrument?.symbol ?? h.id;
  const localCost = (lots ?? []).reduce((s, l) => s + l.costBasis, 0);
  if (!lots?.length || localCost <= 0) {
    const date = String(h.openDate ?? h.asOfDate).slice(0, 10);
    return { name, price, lots: [{ date, units, cost: costBase }] };
  }
  const k = costBase / localCost;
  return {
    name,
    price,
    lots: lots
      .map((l) => ({ date: l.acquisitionDate.slice(0, 10), units: l.quantity, cost: l.costBasis * k }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

async function loadAccount(
  ctx: AddonContext,
  id: string,
): Promise<Pick<WfAccount, 'cash' | 'positions'>> {
  const holdings = await ctx.api.portfolio.getHoldings(id);
  let cash = 0;
  const positions: Position[] = [];
  for (const h of holdings) {
    if (h.holdingType === 'cash') {
      cash += h.marketValue.base;
      continue;
    }
    if (h.quantity <= 0) continue;
    // getHoldings лоты не отдаёт: они есть только в getHolding по одному активу.
    const full = h.instrument ? await ctx.api.portfolio.getHolding(id, h.instrument.id) : null;
    positions.push(toPosition(h, full?.lots));
  }
  return { cash, positions };
}

export async function loadPortfolio(ctx: AddonContext): Promise<LoadedPortfolio> {
  const active = (await ctx.api.accounts.getAll()).filter((a) => a.isActive && !a.isArchived);
  const valuations = active.length
    ? await ctx.api.portfolio.getLatestValuations(active.map((a) => a.id))
    : [];
  const accounts: WfAccount[] = await Promise.all(
    active.map(async (a) => ({
      id: a.id,
      name: a.name,
      accountType: a.accountType,
      wfValue: valuations.find((v) => v.accountId === a.id)?.totalValueBase ?? 0,
      ...(await loadAccount(ctx, a.id)),
    })),
  );

  const nw = await getNetWorth(ctx);
  if (nw) {
    return { netWorth: Number(nw.netWorth), currency: nw.currency, exact: true, accounts };
  }
  return {
    netWorth: valuations.reduce((s, v) => s + v.totalValueBase, 0),
    currency: valuations[0]?.baseCurrency ?? null,
    exact: false,
    accounts,
  };
}

/** Стартовая точка движка: счета с испанским типом; other остаётся в net worth как есть. */
export function buildStart(portfolio: LoadedPortfolio, settings: AccountSettings): StartingPoint {
  return {
    netWorth: portfolio.netWorth,
    accounts: portfolio.accounts.flatMap((a): Account[] => {
      const { kind, owner } = settingFor(settings, a);
      if (kind === 'other') return [];
      // CASH-счёт в модели — только остаток; позиции на нём (если есть) считаем деньгами.
      if (kind === 'cash') {
        const value = a.cash + a.positions.reduce((s, p) => s + positionValue(p), 0);
        return [{ id: a.id, name: a.name, kind, owner, cash: value, positions: [] }];
      }
      return [{ id: a.id, name: a.name, kind, owner, cash: a.cash, positions: a.positions }];
    }),
  };
}
