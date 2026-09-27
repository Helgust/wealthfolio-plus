// Phase 6: when goals are reached in a run, and what a loan goal's loan costs.
import { describe, expect, it } from 'vitest';
import { annuityPayment } from '../engine/real-estate';
import { runPlan, type StartingPoint } from '../engine/run-plan';
import { cashAccount, ZERO_RETURNS } from '../engine/test-helpers';
import { defaultPlan, type LoanGoal, type Plan } from '../model/plan';
import { formatMonthIndex, goalLabel, goalMonth, loanInterest, loanPayment } from './goals';

const home = {
  id: 'home',
  name: 'Home',
  value: 200_000,
  use: 'habitual' as const,
  owner: 0 as const,
  valorCatastral: 80_000,
  catastroRevisado: false,
  ibi: 0,
  acquisitionValue: 150_000,
};
const start: StartingPoint = {
  netWorth: 20_000 + 200_000 - 50_000,
  accounts: [cashAccount(20_000)],
  properties: [home],
  loans: [{ id: 'm', name: 'M', balance: 50_000, rate: 0.03, monthlyPayment: annuityPayment(50_000, 0.03, 10), propertyId: 'home' }],
};
const goal: LoanGoal = { kind: 'loan', id: 'g', name: 'Mortgage', loanId: 'm', effect: 'term', fee: 0, prepay: { kind: 'monthly' }, end: null };

function plan(overrides: Partial<Plan> = {}): Plan {
  const d = defaultPlan(2026);
  return {
    ...d,
    returns: ZERO_RETURNS,
    inflation: 0,
    milestones: [],
    people: [{ ...d.people[0], autonomo: null, pension: null }],
    incomes: [{ name: 'Job', person: 0, tax: 'trabajo', amount: 50_000, start: null, end: null }],
    goals: [goal],
    savings: [{ from: { year: 2026, month: 1 }, amounts: { g: 1_000 } }],
    ...overrides,
  };
}

describe('goal dates', () => {
  it('a loan the goal repays: the month', () => {
    const r = runPlan(plan(), start, 'individual', undefined, 1);
    const reached = r.goalsReached.g;
    expect(goalMonth(r, goal)).toBe(reached.year * 12 + reached.month - 1);
    expect(goalLabel(r, goal)).toBe(formatMonthIndex(goalMonth(r, goal)!));
    expect(loanPayment(r, goal, 2026, 1)).toBeCloseTo(annuityPayment(50_000, 0.03, 10), 9);
    expect(loanPayment(r, goal, 2040, 1)).toBeNull();
    expect(loanInterest(r, goal)).toBeCloseTo(r.rows.reduce((s, x) => s + x.realEstate.loanInterest, 0), 6);
  });

  it('a loan repaid with the sale of its home: the year, with the sale', () => {
    const r = runPlan(plan({ savings: [], propertySales: [{ propertyId: 'home', timing: { kind: 'year', year: 2029 }, costs: 0 }] }), start);
    expect(r.goalsReached.g).toBeUndefined();
    expect(goalLabel(r, goal)).toBe('2029, with the sale');
    expect(goalMonth(r, goal)).toBe(2029 * 12 + 11);
  });

  it('a loan still owed at the end is not reached', () => {
    const r = runPlan(plan({ savings: [], endAge: 45 }), start);
    expect(goalMonth(r, goal)).toBeNull();
    expect(goalLabel(r, goal)).toBeNull();
  });
});
