import { describe, expect, it } from 'vitest';
import {
  accountCost,
  accountValue,
  deposit,
  grow,
  positionUnits,
  traspaso,
  withdraw,
  type Account,
  type Position,
} from './portfolio';

function brokerage(positions: Position[], cash = 0): Account {
  return { id: 'b', name: 'Broker', kind: 'brokerage', owner: 0, cash, positions };
}

// Три лота по 10 паёв: 100, 150, 200 €/пай; цена сейчас 300.
const etf = (): Position => ({
  name: 'ETF',
  price: 300,
  lots: [
    { date: '2020-01-01', units: 10, cost: 1_000 },
    { date: '2021-01-01', units: 10, cost: 1_500 },
    { date: '2022-01-01', units: 10, cost: 2_000 },
  ],
});

describe('withdraw (FIFO)', () => {
  it('sells the oldest lot first and splits a lot on a partial sale', () => {
    const a = brokerage([etf()]);
    // 15 паёв × 300: первый лот целиком и половина второго.
    const sale = withdraw(a, 4_500);
    expect(sale.proceeds).toBeCloseTo(4_500, 9);
    expect(sale.cost).toBeCloseTo(1_000 + 750, 9);
    expect(a.positions[0].lots).toEqual([
      { date: '2021-01-01', units: 5, cost: 750 },
      { date: '2022-01-01', units: 10, cost: 2_000 },
    ]);
  });

  it('uses free cash first, without gain', () => {
    const a = brokerage([etf()], 1_000);
    const sale = withdraw(a, 1_600);
    expect(a.cash).toBe(0);
    expect(sale.proceeds).toBeCloseTo(1_600, 9);
    // 600 € = 2 пая первого лота по 100 €.
    expect(sale.cost).toBeCloseTo(1_000 + 200, 9);
  });

  it('sells positions pro rata by value, FIFO inside each', () => {
    const bond: Position = { name: 'Bond', price: 100, lots: [{ date: '2023-01-01', units: 90, cost: 9_000 }] };
    const a = brokerage([etf(), bond]);
    withdraw(a, 1_800); // 10 % счёта 18 000
    expect(positionUnits(a.positions[0])).toBeCloseTo(27, 9);
    expect(positionUnits(a.positions[1])).toBeCloseTo(81, 9);
  });

  it('stops at the account value', () => {
    const a = brokerage([etf()], 100);
    const sale = withdraw(a, 1e9);
    expect(sale.proceeds).toBeCloseTo(9_100, 9);
    expect(sale.cost).toBeCloseTo(4_600, 9);
    expect(accountValue(a)).toBeCloseTo(0, 9);
    expect(a.positions).toEqual([]);
  });
});

describe('deposit and grow', () => {
  it('buys pro rata by value and keeps weights', () => {
    const bond: Position = { name: 'Bond', price: 100, lots: [{ date: '2023-01-01', units: 30, cost: 3_000 }] };
    const a = brokerage([etf(), bond]); // 9 000 + 3 000
    deposit(a, 1_200, '2026-12-31');
    expect(a.positions[0].lots.at(-1)).toEqual({ date: '2026-12-31', units: 3, cost: 900 });
    expect(a.positions[1].lots.at(-1)).toEqual({ date: '2026-12-31', units: 3, cost: 300 });
    grow(a, 0.1);
    expect(accountValue(a)).toBeCloseTo(13_200 * 1.1, 9);
    expect(accountCost(a)).toBeCloseTo(4_500 + 3_000 + 1_200, 9);
  });

  it('opens a position in an empty account', () => {
    const a: Account = { id: 'f', name: 'Fund', kind: 'fund', owner: 0, cash: 0, positions: [] };
    deposit(a, 500, '2026-12-31');
    expect(accountValue(a)).toBe(500);
    expect(accountCost(a)).toBe(500);
  });
});

describe('traspaso', () => {
  it('moves lots with their dates and cost basis, only units change', () => {
    const from = etf();
    const to: Position = { name: 'Fund B', price: 50, lots: [{ date: '2021-06-01', units: 10, cost: 400 }] };
    const before = from.lots.reduce((s, l) => s + l.cost, 0) + to.lots[0].cost;
    traspaso(from, to, 4_500); // 15 паёв по 300 → 90 паёв по 50
    expect(positionUnits(from)).toBeCloseTo(15, 9);
    expect(to.lots).toEqual([
      { date: '2020-01-01', units: 60, cost: 1_000 },
      { date: '2021-01-01', units: 30, cost: 750 },
      { date: '2021-06-01', units: 10, cost: 400 },
    ]);
    // Без налогового события: стоимость приобретения не изменилась, стоимость — тоже.
    const after = from.lots.reduce((s, l) => s + l.cost, 0) + to.lots.reduce((s, l) => s + l.cost, 0);
    expect(after).toBeCloseTo(before, 9);
    expect(positionUnits(to) * to.price + positionUnits(from) * from.price).toBeCloseTo(9_000 + 500, 9);
  });

  it('a later sale of the new fund realizes the original gain', () => {
    const from = etf();
    const to: Position = { name: 'Fund B', price: 50, lots: [] };
    traspaso(from, to, 9_000);
    const a: Account = { id: 'f', name: 'Fund', kind: 'fund', owner: 0, cash: 0, positions: [to] };
    const sale = withdraw(a, 9_000);
    expect(sale.proceeds - sale.cost).toBeCloseTo(9_000 - 4_500, 9);
  });
});
