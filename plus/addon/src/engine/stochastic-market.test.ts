// Random market years: reproducible, centred on the plan's expectations, with the model's
// volatility and correlations.
import { describe, expect, it } from 'vitest';
import { defaultPlan, type Plan } from '../model/plan';
import { constantPath, priceLevels, type MarketYear } from './market';
import { mulberry32 } from './random';
import { cholesky, IGNIDASH_MODEL, stochasticPath, type MarketModel } from './stochastic-market';

// Fund all stocks, pension plans all bonds: each factor shows through one account type.
const plan: Plan = { ...defaultPlan(2026), equityShare: { fund: 1, brokerage: 0.6, pension: 0 } };

const ZERO_VOLATILITY: MarketModel = {
  volatility: { stocks: 0, bonds: 0, cash: 0, inflation: 0 },
  correlation: IGNIDASH_MODEL.correlation,
};

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
function sd(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
function corr(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  const cov = mean(xs.map((x, i) => (x - mx) * (ys[i] - my)));
  return cov / (sd(xs) * sd(ys));
}

describe('random market years', () => {
  it('the Cholesky factor reproduces the correlations', () => {
    const l = cholesky(IGNIDASH_MODEL.correlation);
    IGNIDASH_MODEL.correlation.forEach((row, i) =>
      row.forEach((c, j) => expect(l[i].reduce((s, x, k) => s + x * l[j][k], 0)).toBeCloseTo(c, 12)),
    );
    expect(() => cholesky([[1, 2], [2, 1]])).toThrow('positive definite');
  });

  it('without volatility every year is the plan’s expectation', () => {
    const path = stochasticPath(plan, 30, mulberry32(7), ZERO_VOLATILITY);
    const expected = constantPath(plan, 30);
    path.forEach((y, t) =>
      (Object.keys(y) as (keyof MarketYear)[]).forEach((k) => expect(y[k]).toBeCloseTo(expected[t][k], 12)),
    );
  });

  it('the same seed gives the same years', () => {
    expect(stochasticPath(plan, 40, mulberry32(42))).toEqual(stochasticPath(plan, 40, mulberry32(42)));
    expect(stochasticPath(plan, 40, mulberry32(43))).not.toEqual(stochasticPath(plan, 40, mulberry32(42)));
  });

  it('centres each type on the plan’s return, with the model’s volatility and correlations', () => {
    const years = stochasticPath(plan, 40_000, mulberry32(1));
    const col = (k: keyof MarketYear) => years.map((y) => y[k]);
    const r = plan.returns;
    const v = IGNIDASH_MODEL.volatility;
    // Means within about three standard errors.
    expect(mean(col('fundGrowth'))).toBeCloseTo(r.fundGrowth, 2);
    expect(mean(col('brokerageGrowth'))).toBeCloseTo(r.brokerageGrowth, 2);
    expect(mean(col('pensionGrowth'))).toBeCloseTo(r.pensionGrowth, 2);
    expect(mean(col('cashInterest'))).toBeCloseTo(r.cashInterest, 2);
    expect(mean(col('inflation'))).toBeCloseTo(plan.inflation, 2);
    expect(sd(col('fundGrowth'))).toBeCloseTo(v.stocks, 2);
    expect(sd(col('pensionGrowth'))).toBeCloseTo(v.bonds, 2);
    expect(sd(col('inflation'))).toBeCloseTo(v.inflation, 2);
    // Stocks — fund, bonds — pension plans, bills — cash.
    const c = IGNIDASH_MODEL.correlation;
    expect(Math.abs(corr(col('fundGrowth'), col('pensionGrowth')) - c[0][1])).toBeLessThan(0.03);
    expect(Math.abs(corr(col('pensionGrowth'), col('inflation')) - c[1][3])).toBeLessThan(0.03);
    expect(Math.abs(corr(col('cashInterest'), col('inflation')) - c[2][3])).toBeLessThan(0.03);
  });

  it('dividends stay at the plan’s yield; real estate keeps its real growth', () => {
    for (const y of stochasticPath(plan, 50, mulberry32(3))) {
      expect(y.brokerageYield).toBe(plan.returns.brokerageYield);
      expect(y.propertyGrowth - y.inflation).toBeCloseTo(plan.returns.propertyGrowth - plan.inflation, 12);
    }
  });

  it('the price level is the product of the years’ inflation after the first', () => {
    const path = constantPath(plan, 3).map((y, t) => ({ ...y, inflation: [0.5, 0.1, -0.02][t] }));
    expect(priceLevels(path)).toEqual([1, 1.1, 1.1 * 0.98]);
  });
});
