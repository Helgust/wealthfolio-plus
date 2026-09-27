// Phase 6: withdrawals by account — what each account gave and the tax its sale adds.
import { describe, expect, it } from 'vitest';
import { defaultPlan, type Plan } from '../model/plan';
import { runPlan, type LedgerRow, type StartingPoint } from './run-plan';
import { cashAccount, investAccount, ZERO_RETURNS } from './test-helpers';

/** One person of 70 with no income: every expense comes out of the accounts. */
function retiree(overrides: Partial<Plan> = {}): Plan {
  const d = defaultPlan(2026);
  return {
    ...d,
    returns: ZERO_RETURNS,
    inflation: 0,
    milestones: [],
    people: [{ name: 'R', birthYear: 1956, disability: 'ninguna', autonomo: null, pension: null }],
    expenses: [{ name: 'Living', amount: 30_000, kind: 'essential', start: null, end: null }],
    endAge: 75,
    ...overrides,
  };
}

const START: StartingPoint = {
  netWorth: 5_000 + 40_000 + 100_000 + 50_000,
  accounts: [
    cashAccount(5_000),
    investAccount('fund', 'fund', 2, 20_000, 10_000),
    investAccount('broker', 'brokerage', 1, 100_000, 100_000),
    investAccount('ppi', 'ppi', 1, 50_000, 50_000),
  ],
};

const byKind = (r: LedgerRow, kind: string) =>
  r.sales.filter((s) => (kind === 'pension' ? s.kind === 'ppi' || s.kind === 'ppes' : s.kind === kind)).reduce((sum, s) => sum + s.proceeds, 0);

describe('withdrawals by account', () => {
  it('add up to the withdrawals by type', () => {
    const rows = runPlan(retiree({ withdrawalOrder: ['cash', 'fund', 'broker', 'ppi'] }), START).rows;
    for (const r of rows) {
      for (const kind of ['cash', 'fund', 'brokerage', 'pension'] as const) {
        expect(byKind(r, kind)).toBeCloseTo(r.withdrawals[kind], 6);
      }
    }
    expect(rows[0].sales.map((s) => s.accountId)).toEqual(['cash', 'fund']);
    expect(rows.some((r) => r.sales.some((s) => s.kind === 'ppi'))).toBe(true);
  });

  it('split the tax the sales add: with no other income it is the whole IRPF of the year', () => {
    const rows = runPlan(retiree({ withdrawalOrder: ['fund', 'ppi'] }), START).rows;
    const both = rows.find((r) => r.sales.some((s) => s.kind === 'fund') && r.sales.some((s) => s.kind === 'ppi'))!;
    expect(both).toBeDefined();
    const [fund, ppi] = both.sales;
    expect(fund.taxable).toBeGreaterThan(0);
    expect(fund.tax).toBeGreaterThan(0);
    expect(ppi.taxable).toBe(ppi.proceeds);
    expect(fund.tax + ppi.tax).toBeCloseTo(both.irpf, 6);
    for (const r of rows) expect(r.sales.reduce((s, x) => s + x.tax, 0)).toBeCloseTo(r.irpf, 6);
  });

  it('a sale with no gain adds no tax', () => {
    const [row] = runPlan(retiree({ withdrawalOrder: ['broker'] }), START).rows;
    expect(row.sales).toHaveLength(1);
    expect(row.sales[0]).toMatchObject({ accountId: 'broker', taxable: 0, tax: 0, reason: 'deficit' });
  });

  it('a down payment out of a fund goal is a sale of its own, with its tax', () => {
    const p = retiree({
      expenses: [],
      incomes: [{ name: 'Pension', person: 0, tax: 'exento', amount: 30_000, start: null, end: null }],
      propertyPurchases: [
        { id: 'flat', name: 'Flat', timing: { kind: 'year', year: 2027 }, month: 2, price: 60_000, newBuild: false, habitual: true, owner: 0, ibi: 0, mortgage: null },
      ],
      goals: [{ kind: 'account', id: 'dp', name: 'Flat', accountId: 'fund', target: { kind: 'purchase', purchaseId: 'flat' }, end: null }],
    });
    const row = runPlan(p, START).rows[1];
    const sale = row.sales.find((s) => s.reason === 'downPayment')!;
    expect(sale.accountId).toBe('fund');
    // Units worth 40 000 € cost 10 000 €: three quarters of the proceeds are gain.
    expect(sale.taxable).toBeCloseTo(sale.proceeds * 0.75, 6);
    expect(sale.tax).toBeGreaterThan(0);
    expect(row.sales.reduce((s, x) => s + x.tax, 0)).toBeCloseTo(row.irpf, 6);
  });
});
