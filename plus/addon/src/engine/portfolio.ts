// Accounts in the projection: positions with lots, growth, buying, FIFO selling, traspaso between funds.
// All amounts are in base currency (euros); lot cost basis is historical, in euros.
import type { Owner, SpanishKind } from '../model/accounts';

export interface Lot {
  /** Acquisition date, ISO; sets the FIFO order */
  date: string;
  units: number;
  /** Cost basis of the whole lot, € */
  cost: number;
}

export interface Position {
  name: string;
  /** Unit price, € */
  price: number;
  /** Oldest first */
  lots: Lot[];
}

export interface Account {
  /** Wealthfolio account id */
  id: string;
  name: string;
  kind: Exclude<SpanishKind, 'other'>;
  owner: Owner;
  /** Money without lots: a whole CASH account or the free balance of a brokerage account */
  cash: number;
  positions: Position[];
}

export const positionUnits = (p: Position) => p.lots.reduce((s, l) => s + l.units, 0);
export const positionValue = (p: Position) => positionUnits(p) * p.price;
export const accountValue = (a: Account) =>
  a.cash + a.positions.reduce((s, p) => s + positionValue(p), 0);
export const accountCost = (a: Account) =>
  a.cash + a.positions.reduce((s, p) => s + p.lots.reduce((c, l) => c + l.cost, 0), 0);

export function cloneAccount(a: Account): Account {
  return {
    ...a,
    positions: a.positions.map((p) => ({ ...p, lots: p.lots.map((l) => ({ ...l })) })),
  };
}

/** Grows the price of every position in the account; the free balance does not grow. */
export function grow(a: Account, rate: number): void {
  for (const p of a.positions) p.price *= 1 + rate;
}

/**
 * Contribution to an account. A CASH account gets balance; otherwise buys pro rata to position
 * values (portfolio weights are kept), one new lot per position. An empty account gets a "New
 * contributions" position priced at 1.
 */
export function deposit(a: Account, amount: number, date: string): void {
  if (amount <= 0) return;
  if (a.kind === 'cash') {
    a.cash += amount;
    return;
  }
  const values = a.positions.map(positionValue);
  const total = values.reduce((s, v) => s + v, 0);
  if (total <= 0) {
    a.positions.push({ name: 'New contributions', price: 1, lots: [] });
    values.push(1);
  }
  const sum = values.reduce((s, v) => s + v, 0);
  a.positions.forEach((p, i) => {
    const part = (amount * values[i]) / sum;
    if (part > 0) p.lots.push({ date, units: part / p.price, cost: part });
  });
}

/** Sells units of a position FIFO; returns the cost basis of what was sold. */
function sellUnits(p: Position, units: number): number {
  let left = units;
  let cost = 0;
  while (left > 1e-12 && p.lots.length) {
    const lot = p.lots[0];
    if (lot.units <= left) {
      left -= lot.units;
      cost += lot.cost;
      p.lots.shift();
    } else {
      const part = left / lot.units;
      cost += lot.cost * part;
      lot.cost -= lot.cost * part;
      lot.units -= left;
      left = 0;
    }
  }
  return cost;
}

export interface Sale {
  proceeds: number;
  /** Cost basis of what was sold */
  cost: number;
}

/**
 * Takes up to amount out of the account: free balance first, then sells pro rata to position
 * values, FIFO within a position. Gain = proceeds − cost.
 */
export function withdraw(a: Account, amount: number): Sale {
  const fromCash = Math.min(Math.max(a.cash, 0), Math.max(amount, 0));
  a.cash -= fromCash;
  const rest = amount - fromCash;
  const invested = a.positions.reduce((s, p) => s + positionValue(p), 0);
  if (rest <= 0 || invested <= 0) return { proceeds: fromCash, cost: fromCash };
  const share = Math.min(rest / invested, 1);
  let proceeds = fromCash;
  let cost = fromCash;
  for (const p of a.positions) {
    const units = positionUnits(p) * share;
    proceeds += units * p.price;
    cost += sellUnits(p, units);
  }
  a.positions = a.positions.filter((p) => p.lots.length > 0);
  return { proceeds, cost };
}

/**
 * Traspaso between funds (art. 94.1.a LIRPF): units of from are sold FIFO for value, and that
 * amount buys units of to. No taxable event: lots move with their acquisition dates and cost
 * basis; only unit counts are recalculated.
 */
export function traspaso(from: Position, to: Position, value: number): void {
  const units = Math.min(value / from.price, positionUnits(from));
  const ratio = from.price / to.price;
  let left = units;
  const moved: Lot[] = [];
  while (left > 1e-12 && from.lots.length) {
    const lot = from.lots[0];
    const u = Math.min(lot.units, left);
    const cost = lot.cost * (u / lot.units);
    moved.push({ date: lot.date, units: u * ratio, cost });
    lot.units -= u;
    lot.cost -= cost;
    if (lot.units <= 1e-12) from.lots.shift();
    left -= u;
  }
  to.lots = [...to.lots, ...moved].sort((x, y) => x.date.localeCompare(y.date));
}
