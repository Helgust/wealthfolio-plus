// Budget against Wealthfolio: month ends, the fact by month, spending averages, goal targets.
import { describe, expect, it } from 'vitest';
import type { Budget } from '../model/budget';
import { lastMonths, monthEnd, spendingLines, valuesByMonth, withGoalTargets } from './budget-fact';

describe('budget fact', () => {
  it('finds month ends, February in a leap year included', () => {
    expect(monthEnd('2026-11')).toBe('2026-11-30');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(monthEnd('2026-12')).toBe('2026-12-31');
  });

  it('takes the last value on or before each month end, up to today', () => {
    const points = [
      { date: '2026-11-15', value: 100 },
      { date: '2026-10-31T12:00:00', value: 50 },
      { date: '2027-01-10', value: 300 },
    ];
    const months = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02'];
    expect(valuesByMonth(points, months, '2027-01')).toEqual({
      '2026-10': 50,
      '2026-11': 100,
      // No valuation in December: the balance did not change.
      '2026-12': 100,
      '2027-01': 300,
    });
  });

  it('ranges the full months before today', () => {
    expect(lastMonths('2026-03', 6)).toEqual({
      startDate: '2025-09-01T00:00:00Z',
      endDate: '2026-02-28T23:59:59Z',
    });
  });

  it('averages the spending report into budget lines', () => {
    const report = {
      baseCurrency: 'EUR',
      incomeBreakdown: [{ categoryId: 'salary', amount: 36_000 }],
      spendingBreakdown: [
        { categoryId: 'rent', amount: 12_000 },
        { categoryId: '__uncategorized__', amount: 1_200 },
        { categoryId: 'gifts', amount: 4 },
        { categoryId: 'food', amount: 600 },
      ],
    };
    const names = new Map([
      ['salary', 'Salary'],
      ['rent', 'Rent'],
      ['gifts', 'Gifts'],
    ]);
    const { incomes, expenses } = spendingLines(report, names, 12, { incomes: 30, expenses: 2 });
    expect(incomes).toEqual([{ name: 'Salary', amount: 3_000, from: null, to: null }]);
    // Below one euro a month is dropped; the rest is capped at two lines.
    expect(expenses.map((l) => [l.name, l.amount])).toEqual([
      ['Rent', 1_000],
      ['Uncategorized', 100],
    ]);
  });

  it('takes fill targets from linked goals', () => {
    const b = {
      steps: [
        { kind: 'fill', envelopeId: 'safety', target: 10_000, goalId: 'g1' },
        { kind: 'fill', envelopeId: 'trip', target: 2_000, goalId: 'gone' },
        { kind: 'rest', envelopeId: 'long', whileLoan: null },
      ],
    } as Budget;
    expect(
      withGoalTargets(b, [{ id: 'g1', targetAmount: 16_000 }]).steps.map((s) => s.kind === 'fill' && s.target),
    ).toEqual([16_000, 2_000, false]);
    const plain = { steps: [{ kind: 'fill', envelopeId: 'safety', target: 1 }] } as Budget;
    expect(withGoalTargets(plain, [])).toBe(plain);
  });
});
