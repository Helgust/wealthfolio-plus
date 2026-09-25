// Plan starting point from Wealthfolio: net worth as on the Net Worth page, accounts with
// positions and lots, real estate and debts (fork only). The Spanish account type and the real
// estate settings are applied separately (buildStart) so changing them does not reload the portfolio.
import type { AddonContext, Holding } from '@wealthfolio/addon-sdk';
import { positionValue, type Account, type Position } from '../engine/portfolio';
import type { Loan, Property } from '../engine/real-estate';
import type { StartingPoint } from '../engine/run-plan';
import { defaultSetting, type AccountSetting, type AccountSettings } from '../model/accounts';
import { defaultPropertySetting, type PropertySetting, type RealEstateSettings } from '../model/properties';
import { getAlternativeHoldings, getNetWorth, type AlternativeAssetHolding } from './fork-api';

export interface WfAccount {
  id: string;
  name: string;
  /** Wealthfolio account type: CASH, SECURITIES, … */
  accountType: string;
  /** Wealthfolio valuation at the latest date */
  wfValue: number;
  /** Money without lots */
  cash: number;
  positions: Position[];
}

export interface LoadedPortfolio {
  netWorth: number;
  currency: string | null;
  /** true — net worth from the fork's get_net_worth; false — sum of account valuations (official build) */
  exact: boolean;
  accounts: WfAccount[];
  /** Alternative assets (real estate, debts, …); null — unavailable in the official build */
  alternatives: AlternativeAssetHolding[] | null;
}

const isKind = (kind: string) => (h: AlternativeAssetHolding) => h.kind.toUpperCase() === kind;
export const isProperty = isKind('PROPERTY');
export const isLiability = isKind('LIABILITY');

export const propertySettingFor = (settings: RealEstateSettings, h: AlternativeAssetHolding): PropertySetting =>
  settings.properties[h.id] ?? defaultPropertySetting(h.metadata?.sub_type as string | undefined);

/** Annual rate of a liability: Wealthfolio keeps interest_rate in percent. */
export const liabilityRate = (h: AlternativeAssetHolding) => Number(h.metadata?.interest_rate ?? 0) / 100;

/** The property a liability finances, if linked. */
export const linkedProperty = (h: AlternativeAssetHolding): string | null =>
  h.linkedAssetId ?? (h.metadata?.linked_asset_id as string | undefined) ?? null;

export const settingFor = (settings: AccountSettings, a: WfAccount): AccountSetting =>
  settings[a.id] ?? defaultSetting(a.accountType);

/**
 * Position from a Wealthfolio holding. Lot cost basis is in the asset currency; it is scaled to
 * the historical cost in base currency (costBasis.base) so gains are in euros.
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
    // getHoldings does not return lots: they come only from getHolding, one asset at a time.
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

  const [nw, alternatives] = await Promise.all([getNetWorth(ctx), getAlternativeHoldings(ctx)]);
  if (nw) {
    return { netWorth: Number(nw.netWorth), currency: nw.currency, exact: true, accounts, alternatives };
  }
  return {
    netWorth: valuations.reduce((s, v) => s + v.totalValueBase, 0),
    currency: valuations[0]?.baseCurrency ?? null,
    exact: false,
    accounts,
    alternatives,
  };
}

/**
 * Engine starting point: accounts with a Spanish type, properties with a use, loans with a monthly
 * payment. Everything else stays in net worth as is.
 */
export function buildStart(
  portfolio: LoadedPortfolio,
  settings: AccountSettings,
  realEstate: RealEstateSettings = { properties: {}, loans: {} },
): StartingPoint {
  const alternatives = portfolio.alternatives ?? [];
  const properties = alternatives.filter(isProperty).flatMap((h): Property[] => {
    const s = propertySettingFor(realEstate, h);
    if (s.use === 'other') return [];
    const value = Number(h.marketValue);
    // Without a purchase price the gain counts from today's value.
    const price = h.purchasePrice ? Number(h.purchasePrice) : value;
    return [
      {
        id: h.id,
        name: h.name,
        value,
        use: s.use,
        owner: s.owner,
        valorCatastral: s.valorCatastral,
        catastroRevisado: s.catastroRevisado,
        ibi: s.ibi,
        acquisitionValue: price + s.acquisitionCosts,
      },
    ];
  });
  const loans = alternatives.filter(isLiability).flatMap((h): Loan[] => {
    const payment = realEstate.loans[h.id]?.monthlyPayment ?? 0;
    if (payment <= 0) return [];
    return [
      {
        id: h.id,
        name: h.name,
        balance: Math.abs(Number(h.marketValue)),
        rate: liabilityRate(h),
        monthlyPayment: payment,
        propertyId: linkedProperty(h),
      },
    ];
  });
  return {
    netWorth: portfolio.netWorth,
    properties,
    loans,
    accounts: portfolio.accounts.flatMap((a): Account[] => {
      const { kind, owner } = settingFor(settings, a);
      if (kind === 'other') return [];
      // A CASH account in the model is only a balance; positions on it (if any) count as money.
      if (kind === 'cash') {
        const value = a.cash + a.positions.reduce((s, p) => s + positionValue(p), 0);
        return [{ id: a.id, name: a.name, kind, owner, cash: value, positions: [] }];
      }
      return [{ id: a.id, name: a.name, kind, owner, cash: a.cash, positions: a.positions }];
    }),
  };
}
