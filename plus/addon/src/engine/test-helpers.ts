// Shared fixtures for engine tests.
import type { Plan } from '../model/plan';
import type { Account, Position } from './portfolio';

export const ZERO_RETURNS: Plan['returns'] = {
  cashInterest: 0,
  fundGrowth: 0,
  brokerageGrowth: 0,
  brokerageYield: 0,
  pensionGrowth: 0,
  propertyGrowth: 0,
};

export const cashAccount = (cash: number, id = 'cash'): Account => ({
  id,
  name: 'Cash',
  kind: 'cash',
  owner: 'joint',
  cash,
  positions: [],
});

/** Account with one position: one lot of units at price, cost basis cost. */
export function investAccount(
  id: string,
  kind: Account['kind'],
  price: number,
  units: number,
  cost: number,
  owner: Account['owner'] = 0,
): Account {
  const position: Position = { name: id, price, lots: [{ date: '2020-01-01', units, cost }] };
  return { id, name: id, kind, owner, cash: 0, positions: [position] };
}
