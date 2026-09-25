// Phase 3: spending rules and indexed tax rules.
import { describe, expect, it } from 'vitest';
import {
  actividad,
  indexRules,
  irpfAnual,
  minimoPersonalFamiliar,
  rulesForYear,
  total,
} from '../es-tax';
import { yearFlows } from '../lib/cashflow';
import { defaultPlan, type Plan } from '../model/plan';
import { runPlan, spendingRuleWithdrawal, type StartingPoint } from './run-plan';
import { cashAccount, investAccount, ZERO_RETURNS } from './test-helpers';

const MILLION: StartingPoint = { netWorth: 1_000_000, accounts: [cashAccount(1_000_000)] };

/** Retiree aged 70 with no income: essential 10,000 and planned discretionary 50,000 a year. */
function retiree(overrides: Partial<Plan> = {}): Plan {
  return {
    ...defaultPlan(2026),
    returns: ZERO_RETURNS,
    inflation: 0,
    milestones: [],
    people: [{ name: 'R', birthYear: 1956, disability: 'ninguna', autonomo: null, pension: null }],
    expenses: [
      { name: 'Living', amount: 10_000, kind: 'essential', start: null, end: null },
      { name: 'Travel', amount: 50_000, kind: 'discretionary', start: null, end: null },
    ],
    ...overrides,
  };
}

const from2026 = { kind: 'year', year: 2026 } as const;

describe('spending rules', () => {
  it('% of portfolio: the portfolio gives rate × its start value; discretionary is the rest', () => {
    const rows = runPlan(retiree({ spending: { kind: 'percent', start: from2026, rate: 0.04 } }), MILLION).rows;
    expect(rows[0].ruleWithdrawal).toBeCloseTo(40_000, 6);
    expect(rows[0].withdrawals.cash).toBeCloseTo(40_000, 6);
    expect(rows[0].discretionaryExpenses).toBeCloseTo(30_000, 6);
    expect(rows[1].ruleWithdrawal).toBeCloseTo(0.04 * 960_000, 6);
    expect(rows[1].discretionaryExpenses).toBeCloseTo(0.04 * 960_000 - 10_000, 6);
  });

  it('essential expenses are a floor', () => {
    const rows = runPlan(retiree({ spending: { kind: 'percent', start: from2026, rate: 0.005 } }), MILLION).rows;
    expect(rows[0].discretionaryExpenses).toBe(0);
    expect(rows[0].withdrawals.cash).toBeCloseTo(10_000, 6);
  });

  it('planned expenses apply until the rule starts', () => {
    const p = retiree({ spending: { kind: 'percent', start: { kind: 'year', year: 2028 }, rate: 0.04 } });
    const rows = runPlan(p, MILLION).rows;
    expect(rows.slice(0, 2).map((r) => r.discretionaryExpenses)).toEqual([50_000, 50_000]);
    expect(rows[0].ruleWithdrawal).toBeNull();
    expect(rows[2].discretionaryExpenses).toBeCloseTo(0.04 * 880_000 - 10_000, 6);
  });

  it('income and the tax on the withdrawal count: discretionary = income + withdrawal − essential − taxes', () => {
    const p = retiree({
      spending: { kind: 'percent', start: from2026, rate: 0.04 },
      people: [
        {
          name: 'R',
          birthYear: 1956,
          disability: 'ninguna',
          autonomo: null,
          pension: { amount: 20_000, start: { kind: 'year', year: 2026 } },
        },
      ],
    });
    // Brokerage at a gain: selling adds IRPF in the savings base.
    const start: StartingPoint = { netWorth: 1_000_000, accounts: [investAccount('b', 'brokerage', 100, 10_000, 400_000)] };
    const [row] = runPlan(p, start).rows;
    expect(row.withdrawals.brokerage).toBeCloseTo(40_000, 4);
    expect(row.realizedGains).toBeGreaterThan(0);
    expect(row.discretionaryExpenses).toBeCloseTo(20_000 + 40_000 - 10_000 - row.irpf, 4);
    // The year still balances.
    const f = yearFlows(row);
    expect(f.uses.reduce((s, x) => s + x.value, 0)).toBeCloseTo(f.total, 4);
  });

  it('Guyton–Klinger: grows with inflation, cut when above the upper guardrail', () => {
    const rule = { kind: 'guytonKlinger', start: from2026, rate: 0.05, guardrail: 0.2, adjustment: 0.1 } as const;
    const p = retiree({ inflation: 0.02, spending: rule, expenses: [] });
    const rows = runPlan(p, MILLION).rows;
    // Reference: no returns, no income, no tax — the portfolio loses exactly the withdrawal.
    let portfolio = 1_000_000;
    let w: number | null = null;
    let cuts = 0;
    for (const r of rows.slice(0, 15)) {
      const next = spendingRuleWithdrawal(rule, portfolio, w, 0.02);
      if (w !== null && next < w) cuts++;
      w = next;
      expect(r.ruleWithdrawal).toBeCloseTo(w, 4);
      expect(r.discretionaryExpenses).toBeCloseTo(w, 4);
      portfolio -= w;
    }
    expect(cuts).toBeGreaterThan(0);
  });

  it('Guyton–Klinger raises spending below the lower guardrail', () => {
    const rule = { kind: 'guytonKlinger', start: from2026, rate: 0.05, guardrail: 0.2, adjustment: 0.1 } as const;
    expect(spendingRuleWithdrawal(rule, 2_000_000, 50_000, 0)).toBeCloseTo(55_000, 6);
    expect(spendingRuleWithdrawal(rule, 1_000_000, 50_000, 0)).toBeCloseTo(50_000, 6);
    expect(spendingRuleWithdrawal(rule, 500_000, 50_000, 0)).toBeCloseTo(45_000, 6);
  });
});

describe('tax rules after the last known year', () => {
  const autonomo = (taxRules: Plan['taxRules']) =>
    runPlan({ ...defaultPlan(2026), returns: ZERO_RETURNS, taxRules }, MILLION).rows;

  it('frozen: the last known rules; indexed: their money thresholds grow with inflation', () => {
    const frozen = autonomo('frozen');
    const indexed = autonomo('indexed');
    const year = 2030;
    const t = year - 2026;
    const known = rulesForYear(year);
    expect(known.year).toBe(2026);
    for (const [rows, rules] of [
      [frozen, known],
      [indexed, indexRules(known, 1.02 ** t)],
    ] as const) {
      const row = rows[t];
      const act = actividad(40_000 * 1.02 ** t, 5_000 * 1.02 ** t, rules);
      const irpf = irpfAnual(
        rules,
        minimoPersonalFamiliar({ edad: 44, discapacidad: 'ninguna', asistencia: false }, rules),
        { rendimiento_actividad: act.rendimiento_neto, rcm: row.investmentIncome },
      );
      expect(row.reta).toBeCloseTo(act.cuota_reta, 6);
      expect(row.irpf).toBeCloseTo(total(irpf.cuota_liquida), 6);
    }
    // Growing income against frozen thresholds pays more.
    expect(frozen[t].irpf).toBeGreaterThan(indexed[t].irpf);
    // Known years are the same under both policies.
    expect(indexed[0].irpf).toBeCloseTo(frozen[0].irpf, 9);
  });
});
