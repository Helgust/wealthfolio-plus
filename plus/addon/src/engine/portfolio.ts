// Счета в проекции: позиции с лотами, рост, покупка, продажа по FIFO, traspaso между фондами.
// Все суммы — в базовой валюте (евро); стоимость приобретения лота — историческая, в евро.
import type { Owner, SpanishKind } from '../model/accounts';

export interface Lot {
  /** Дата приобретения, ISO; задаёт порядок FIFO */
  date: string;
  units: number;
  /** Стоимость приобретения всего лота, € */
  cost: number;
}

export interface Position {
  name: string;
  /** Цена пая, € */
  price: number;
  /** От старшего к младшему */
  lots: Lot[];
}

export interface Account {
  /** id счёта Wealthfolio */
  id: string;
  name: string;
  kind: Exclude<SpanishKind, 'other'>;
  owner: Owner;
  /** Деньги без лотов: CASH-счёт целиком или свободный остаток брокерского счёта */
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

/** Рост цены всех позиций счёта; свободный остаток не растёт. */
export function grow(a: Account, rate: number): void {
  for (const p of a.positions) p.price *= 1 + rate;
}

/**
 * Взнос в счёт. CASH-счёт — остаток; иначе покупка пропорционально стоимости позиций (доли
 * портфеля сохраняются), новый лот в каждой позиции. Пустой счёт получает позицию «New
 * contributions» с ценой 1.
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

/** Продать units паёв позиции по FIFO; стоимость приобретения проданного. */
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
  /** Стоимость приобретения проданного */
  cost: number;
}

/**
 * Вывести до amount из счёта: сначала свободный остаток, затем продажа пропорционально стоимости
 * позиций, внутри позиции — по FIFO. Прирост = proceeds − cost.
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
 * Traspaso между фондами (art. 94.1.a LIRPF): паи from продаются по FIFO на сумму value, на эту
 * сумму покупаются паи to. Налогового события нет: лоты переходят с датами и стоимостью
 * приобретения, пересчитаны только количества паёв.
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
