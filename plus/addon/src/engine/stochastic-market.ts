// Random market years for Monte Carlo. Ported from ignidash (github.com/schelskedevco/ignidash,
// commit a0d4f3a, src/lib/calc/returns-providers/stochastic-returns-provider.ts, AGPL-3.0):
// correlated standard normals through the Cholesky decomposition of a correlation matrix,
// log-normal stock returns, normal bond, bill and inflation shocks. Unlike ignidash: four factors
// instead of six (dividend yields stay at the plan's), and each account type mixes stocks and
// bonds by its equity share around the plan's expected return for that type, so the mean of every
// type is the plan's expectation.
import type { Plan } from '../model/plan';
import type { MarketYear } from './market';
import { gaussian } from './random';

export interface MarketModel {
  /** Standard deviation of annual returns and inflation */
  volatility: { stocks: number; bonds: number; cash: number; inflation: number };
  /** Correlations in the order stocks, bonds, cash (bills), inflation */
  correlation: number[][];
}

/**
 * ignidash's defaults until the calibration on JST data (phase 4, slice 2). Volatility —
 * DEFAULT_VOLATILITY, "derived from NYU Stern historical data (1928–2024)"; correlation — the
 * stock, bond, cash and inflation rows of MODERN_CORRELATION_MATRIX, "computed from NYU
 * Stern/Shiller historical data (1990–2024)". US data in dollars.
 */
export const IGNIDASH_MODEL: MarketModel = {
  volatility: { stocks: 0.18, bonds: 0.06, cash: 0.03, inflation: 0.04 },
  correlation: [
    [1.0, -0.1, 0.07, -0.02],
    [-0.1, 1.0, 0.21, -0.33],
    [0.07, 0.21, 1.0, 0.31],
    [-0.02, -0.33, 0.31, 1.0],
  ],
};

/** Lower triangular L with L·Lᵀ = m; m must be positive definite. */
export function cholesky(m: number[][]): number[][] {
  const n = m.length;
  const l = m.map(() => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += l[i][k] * l[j][k];
      if (i === j) {
        const d = m[i][i] - sum;
        if (d <= 0) throw new Error('Correlation matrix is not positive definite');
        l[i][j] = Math.sqrt(d);
      } else l[i][j] = (m[i][j] - sum) / l[j][j];
    }
  }
  return l;
}

/**
 * Return whose gross value 1 + R is log-normal with arithmetic mean 1 + mean and standard deviation
 * vol; z — a standard normal number.
 */
export function logNormalReturn(mean: number, vol: number, z: number): number {
  const gross = 1 + mean;
  const sigma = Math.sqrt(Math.log(1 + (vol * vol) / (gross * gross)));
  return Math.exp(Math.log(gross) - 0.5 * sigma * sigma + sigma * z) - 1;
}

/** Market of every plan year drawn at random around the plan's expected returns and inflation. */
export function stochasticPath(
  plan: Plan,
  years: number,
  next: () => number,
  model: MarketModel = IGNIDASH_MODEL,
): MarketYear[] {
  const l = cholesky(model.correlation);
  const v = model.volatility;
  const r = plan.returns;
  const w = plan.equityShare;
  const path: MarketYear[] = [];
  for (let t = 0; t < years; t++) {
    const z = [gaussian(next), gaussian(next), gaussian(next), gaussian(next)];
    const c = l.map((row) => row.reduce((s, x, j) => s + x * z[j], 0));
    const mix = (mean: number, share: number) =>
      share * logNormalReturn(mean, v.stocks, c[0]) + (1 - share) * (mean + v.bonds * c[1]);
    const inflation = plan.inflation + v.inflation * c[3];
    path.push({
      cashInterest: r.cashInterest + v.cash * c[2],
      fundGrowth: mix(r.fundGrowth, w.fund),
      brokerageGrowth: mix(r.brokerageGrowth, w.brokerage),
      brokerageYield: r.brokerageYield,
      pensionGrowth: mix(r.pensionGrowth, w.pension),
      // Real estate keeps its real growth: it follows the year's inflation.
      propertyGrowth: r.propertyGrowth + inflation - plan.inflation,
      inflation,
    });
  }
  return path;
}
