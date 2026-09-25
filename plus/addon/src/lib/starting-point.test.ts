import type { AddonContext, Holding } from '@wealthfolio/addon-sdk';
import { describe, expect, it } from 'vitest';
import { accountCost, accountValue } from '../engine/portfolio';
import { buildStart, loadPortfolio } from './starting-point';

const money = (base: number, local = base) => ({ base, local });

// Брокерский счёт: ETF в USD (2 лота, 900 $ стоимости = 810 € по историческим курсам) и 100 € денег.
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
    // Официальная сборка: net worth = сумма оценок счетов.
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

  it('applies saved Spanish types and owners', async () => {
    const p = await loadPortfolio(ctx);
    const s = buildStart(p, { broker: { kind: 'fund', owner: 1 }, bank: { kind: 'other', owner: 'joint' } });
    expect(s.accounts).toHaveLength(1);
    expect(s.accounts[0]).toMatchObject({ id: 'broker', kind: 'fund', owner: 1 });
  });
});
