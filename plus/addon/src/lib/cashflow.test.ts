// Cash flow of every year adds up: sources = uses, and the net worth change is explained by
// money put into and taken out of accounts plus market growth.
import { describe, expect, it } from 'vitest';
import { runPlan, totalOf, type LedgerRow, type StartingPoint } from '../engine/run-plan';
import { cashAccount, investAccount, ZERO_RETURNS } from '../engine/test-helpers';
import { defaultPlan, type Plan } from '../model/plan';
import { yearFlows } from './cashflow';

const sum = (xs: { value: number }[]) => xs.reduce((s, x) => s + x.value, 0);

function expectBalanced(rows: LedgerRow[], start: StartingPoint) {
  rows.forEach((r, i) => {
    const f = yearFlows(r);
    const sources = sum(f.sources);
    // Sources = uses: income + withdrawals + shortfall = taxes + spending + deposits.
    expect(sum(f.uses)).toBeCloseTo(sources, 4);
    // Net worth change = deposits − withdrawals − shortfall + market growth.
    const before = i === 0 ? start.netWorth : rows[i - 1].netWorth;
    const explained = totalOf(r.deposits) - totalOf(r.withdrawals) - r.shortfall + r.marketGrowth;
    expect(r.netWorth - before).toBeCloseTo(explained, 4);
  });
}

const RETURNS: Plan['returns'] = {
  cashInterest: 0.01,
  fundGrowth: 0.05,
  brokerageGrowth: 0.04,
  brokerageYield: 0.02,
  pensionGrowth: 0.04,
};

describe('cash flow of a year', () => {
  it('adds up over a whole life: saving, then drawing down with gains and pension payouts', () => {
    const start: StartingPoint = {
      netWorth: 120_000,
      accounts: [
        cashAccount(20_000),
        investAccount('fund', 'fund', 10, 3_000, 20_000),
        investAccount('broker', 'brokerage', 20, 1_000, 12_000),
        investAccount('ppi', 'ppi', 1, 30_000, 30_000),
      ],
    };
    const p: Plan = {
      ...defaultPlan(2026),
      returns: RETURNS,
      flows: [
        { accountId: 'ppi', mode: 'max', amount: 0 },
        { accountId: 'fund', mode: 'percent', amount: 0.5 },
      ],
      expenses: [
        ...defaultPlan(2026).expenses,
        {
          name: 'Travel',
          amount: 25_000,
          kind: 'discretionary',
          start: { kind: 'milestone', id: 'retirement' },
          end: null,
        },
      ],
    };
    const rows = runPlan(p, start).rows;
    expect(rows.some((r) => totalOf(r.deposits) > 0)).toBe(true);
    expect(rows.some((r) => r.withdrawals.fund > 0 && r.realizedGains > 0)).toBe(true);
    expect(rows.some((r) => r.withdrawals.pension > 0)).toBe(true);
    expectBalanced(rows, start);
  });

  it('adds up when a sale at a loss lowers the tax', () => {
    // Interest is taxed in the savings base; the fund (bought for 30,000, worth 10,000) is sold
    // first at a loss, which offsets up to 25 % of the interest — the tax falls below the
    // amount already raised for it.
    const start: StartingPoint = {
      netWorth: 510_000,
      accounts: [cashAccount(500_000), investAccount('fund', 'fund', 10, 1_000, 30_000)],
    };
    const p: Plan = {
      ...defaultPlan(2026),
      returns: { ...ZERO_RETURNS, cashInterest: 0.03 },
      milestones: [],
      people: [{ name: 'R', birthYear: 1956, disability: 'ninguna', autonomo: null, pension: null }],
      expenses: [{ name: 'Living', amount: 20_000, kind: 'essential', start: null, end: null }],
      withdrawalOrder: ['fund', 'cash'],
    };
    const rows = runPlan(p, start).rows;
    expect(rows[0].realizedGains).toBeLessThan(0);
    expect(rows[0].deposits.cash).toBeGreaterThan(0);
    expectBalanced(rows, start);
  });

  it('adds up under a Guyton–Klinger spending rule from retirement', () => {
    const start: StartingPoint = {
      netWorth: 400_000,
      accounts: [cashAccount(50_000), investAccount('broker', 'brokerage', 20, 17_500, 200_000)],
    };
    const p: Plan = {
      ...defaultPlan(2026),
      returns: RETURNS,
      spending: {
        kind: 'guytonKlinger',
        start: { kind: 'milestone', id: 'retirement' },
        rate: 0.05,
        guardrail: 0.2,
        adjustment: 0.1,
      },
    };
    const rows = runPlan(p, start).rows;
    expect(rows.some((r) => r.ruleWithdrawal !== null && r.discretionaryExpenses > 0)).toBe(true);
    expectBalanced(rows, start);
  });

  it('adds up when the accounts run out', () => {
    const start: StartingPoint = { netWorth: 5_000, accounts: [cashAccount(5_000)] };
    const p: Plan = {
      ...defaultPlan(2026),
      returns: ZERO_RETURNS,
      expenses: [{ name: 'Living', amount: 60_000, kind: 'essential', start: null, end: null }],
    };
    const rows = runPlan(p, start).rows;
    expect(rows[0].shortfall).toBeGreaterThan(0);
    expect(rows.at(-1)!.cash).toBeLessThan(0);
    expectBalanced(rows, start);
  });

  it('lists only non-zero flows and converts to today’s euros', () => {
    const start: StartingPoint = { netWorth: 30_000, accounts: [cashAccount(30_000)] };
    const [, second] = runPlan({ ...defaultPlan(2026), returns: ZERO_RETURNS }, start).rows;
    const f = yearFlows(second, 'today');
    expect(f.sources.map((x) => x.key)).toEqual(['revenue']);
    expect(f.uses.map((x) => x.key)).toEqual(['irpf', 'reta', 'businessExpenses', 'essential', 'toCash']);
    expect(f.sources[0].value).toBeCloseTo(second.revenue / second.deflator, 6);
  });
});
