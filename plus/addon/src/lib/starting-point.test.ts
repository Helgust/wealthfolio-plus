import type { AddonContext, Holding } from '@wealthfolio/addon-sdk';
import { describe, expect, it } from 'vitest';
import { accountCost, accountValue } from '../engine/portfolio';
import { buildStart, loadPortfolio } from './starting-point';

const money = (base: number, local = base) => ({ base, local });

// Brokerage account: an ETF in USD (2 lots, $900 cost = 810 € at historical rates) and 100 € cash.
const etf = {
  id: 'h1',
  holdingType: 'security',
  accountId: 'broker',
  instrument: { id: 'asset-etf', symbol: 'VWCE' },
  quantity: 10,
  marketValue: money(1_200, 1_300),
  costBasis: money(810, 900),
  asOfDate: '2026-09-25',
} as unknown as Holding;
const cashHolding = {
  id: 'h2',
  holdingType: 'cash',
  accountId: 'broker',
  quantity: 100,
  marketValue: money(100),
} as unknown as Holding;
const lots = [
  { id: 'l2', positionId: 'p', acquisitionDate: '2024-05-01T00:00:00Z', quantity: 4, costBasis: 500, acquisitionPrice: 125, acquisitionFees: 0 },
  { id: 'l1', positionId: 'p', acquisitionDate: '2023-01-10T00:00:00Z', quantity: 6, costBasis: 400, acquisitionPrice: 66.7, acquisitionFees: 0 },
];

const ctx = {
  api: {
    accounts: {
      getAll: async () => [
        { id: 'bank', name: 'Bank', accountType: 'CASH', isActive: true, isArchived: false },
        { id: 'broker', name: 'Broker', accountType: 'SECURITIES', isActive: true, isArchived: false },
        { id: 'card', name: 'Card', accountType: 'CREDIT_CARD', isActive: true, isArchived: false },
        { id: 'old', name: 'Old', accountType: 'CASH', isActive: true, isArchived: true },
      ],
    },
    portfolio: {
      getLatestValuations: async (ids: string[]) =>
        ids.map((id) => ({
          accountId: id,
          totalValueBase: { bank: 5_000, broker: 1_300, card: -300 }[id],
          baseCurrency: 'EUR',
        })),
      getHoldings: async (id: string) =>
        id === 'broker'
          ? [etf, cashHolding]
          : id === 'bank'
            ? [{ ...cashHolding, accountId: 'bank', marketValue: money(5_000) }]
            : [],
      getHolding: async (_: string, assetId: string) => (assetId === 'asset-etf' ? { ...etf, lots } : null),
      getNetWorth: async () => {
        throw new Error('not in the official build');
      },
    },
    logger: { warn: () => {} },
  },
} as unknown as AddonContext;

describe('loadPortfolio', () => {
  it('reads lots via getHolding and scales their cost to the base-currency cost basis', async () => {
    const p = await loadPortfolio(ctx);
    expect(p.accounts.map((a) => a.id)).toEqual(['bank', 'broker', 'card']);
    const broker = p.accounts[1];
    expect(broker.cash).toBe(100);
    expect(broker.positions[0].price).toBeCloseTo(120, 9);
    expect(broker.positions[0].lots).toEqual([
      { date: '2023-01-10', units: 6, cost: 360 },
      { date: '2024-05-01', units: 4, cost: 450 },
    ]);
    // Official build: net worth = sum of account valuations.
    expect(p.exact).toBe(false);
    expect(p.netWorth).toBe(6_000);
  });

  it('first-year balances equal Wealthfolio valuations; unmodelled accounts stay outside', async () => {
    const p = await loadPortfolio(ctx);
    const s = buildStart(p, {});
    expect(s.accounts.map((a) => [a.id, a.kind])).toEqual([
      ['bank', 'cash'],
      ['broker', 'brokerage'],
    ]);
    for (const a of s.accounts) {
      expect(accountValue(a)).toBeCloseTo(p.accounts.find((x) => x.id === a.id)!.wfValue, 9);
    }
    expect(accountCost(s.accounts[1])).toBeCloseTo(100 + 810, 9);
  });

  it('official build: no real estate (getAlternativeHoldings unavailable)', async () => {
    const p = await loadPortfolio(ctx);
    expect(p.alternatives).toBeNull();
    expect(buildStart(p, {}).properties).toEqual([]);
  });

  it('real estate: properties with a use, loans with a monthly payment', async () => {
    const p = await loadPortfolio(ctx);
    const alternatives = [
      {
        id: 'PROP-1',
        kind: 'PROPERTY',
        name: 'Home',
        currency: 'EUR',
        marketValue: '300000',
        purchasePrice: '150000',
        valuationDate: '2026-09-01',
        metadata: { sub_type: 'residence' },
      },
      { id: 'PROP-2', kind: 'PROPERTY', name: 'Plot', currency: 'EUR', marketValue: '40000', valuationDate: '2026-09-01', metadata: { sub_type: 'land' } },
      {
        id: 'LIAB-1',
        kind: 'LIABILITY',
        name: 'Mortgage',
        currency: 'EUR',
        marketValue: '80000',
        valuationDate: '2026-09-01',
        metadata: { sub_type: 'mortgage', interest_rate: '3.5' },
        linkedAssetId: 'PROP-1',
      },
    ];
    const withAlt = { ...p, alternatives };
    // Defaults: a residence is the vivienda habitual, land stays outside; a loan without a payment stays constant.
    let s = buildStart(withAlt, {});
    expect(s.properties).toEqual([expect.objectContaining({ id: 'PROP-1', use: 'habitual', value: 300_000, acquisitionValue: 150_000 })]);
    expect(s.loans).toEqual([]);
    s = buildStart(withAlt, {}, {
      properties: { 'PROP-1': { use: 'second', owner: 0, valorCatastral: 90_000, catastroRevisado: true, ibi: 400, acquisitionCosts: 12_000 } },
      loans: { 'LIAB-1': { monthlyPayment: 700 } },
    });
    expect(s.properties![0]).toMatchObject({ use: 'second', acquisitionValue: 162_000, valorCatastral: 90_000 });
    expect(s.loans).toEqual([
      { id: 'LIAB-1', name: 'Mortgage', balance: 80_000, rate: 0.035, monthlyPayment: 700, propertyId: 'PROP-1' },
    ]);
  });

  it('applies saved Spanish types and owners', async () => {
    const p = await loadPortfolio(ctx);
    const s = buildStart(p, { broker: { kind: 'fund', owner: 1 }, bank: { kind: 'other', owner: 'joint' } });
    expect(s.accounts).toHaveLength(1);
    expect(s.accounts[0]).toMatchObject({ id: 'broker', kind: 'fund', owner: 1 });
  });
});
