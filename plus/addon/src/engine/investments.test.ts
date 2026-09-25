// Phase 2 engine: accounts, surplus flows, pension plan limits, withdrawals with gross-up, loss carry-forward.
import { describe, expect, it } from 'vitest';
import {
  actividad,
  irpfAnual,
  minimoPersonalFamiliar,
  rulesForYear,
  total,
} from '../es-tax';
import { defaultPlan, type Plan } from '../model/plan';
import { runPlan, type StartingPoint } from './run-plan';
import { cashAccount, investAccount, ZERO_RETURNS } from './test-helpers';

const rules = rulesForYear(2026);
const persona = (edad: number) => ({ edad, discapacidad: 'ninguna', asistencia: false }) as const;

function plan(overrides: Partial<Plan> = {}): Plan {
  return { ...defaultPlan(2026), returns: ZERO_RETURNS, ...overrides };
}

/** Retiree aged 70 with no income, spending amount per year. */
function retiree(amount: number, overrides: Partial<Plan> = {}): Plan {
  return plan({
    people: [{ name: 'R', birthYear: 1956, disability: 'ninguna', autonomo: null, pension: null }],
    expenses: [{ name: 'Living', amount, kind: 'essential', start: null, end: null }],
    inflation: 0,
    ...overrides,
  });
}

const start = (...accounts: StartingPoint['accounts']): StartingPoint => ({
  netWorth: accounts.reduce(
    (s, a) => s + a.cash + a.positions.reduce((v, p) => v + p.price * p.lots[0].units, 0),
    0,
  ),
  accounts,
});

describe('returns', () => {
  it('interest and dividends go to the savings base; funds and pensions only grow', () => {
    const p = retiree(0, {
      returns: {
        cashInterest: 0.02,
        fundGrowth: 0.05,
        brokerageGrowth: 0.04,
        brokerageYield: 0.03,
        pensionGrowth: 0.06,
        propertyGrowth: 0,
      },
    });
    const s = start(
      cashAccount(10_000),
      investAccount('etf', 'brokerage', 100, 100, 5_000),
      investAccount('fund', 'fund', 100, 100, 5_000),
      investAccount('pp', 'ppi', 100, 100, 5_000),
    );
    const [row] = runPlan(p, s).rows;
    expect(row.investmentIncome).toBeCloseTo(200 + 300, 9);
    expect(row.baseLiquidableAhorro).toBeCloseTo(500, 9);
    expect(row.balances.brokerage).toBeCloseTo(10_400, 9);
    expect(row.balances.fund).toBeCloseTo(10_500, 9);
    expect(row.balances.pension).toBeCloseTo(10_600, 9);
    // Income within the mínimo: no tax, interest and dividends stay in cash.
    expect(row.irpf).toBe(0);
    expect(row.balances.cash).toBeCloseTo(10_500, 9);
    expect(row.netWorth).toBeCloseTo(row.otherAssets + 10_500 + 10_400 + 10_500 + 10_600, 9);
  });

  it('keeps accounts outside the model constant', () => {
    const s = { netWorth: 250_000, accounts: [cashAccount(50_000)] };
    const rows = runPlan(retiree(0), s).rows;
    expect(rows.every((r) => r.otherAssets === 200_000)).toBe(true);
  });
});

describe('surplus flows', () => {
  const worker = () =>
    plan({ expenses: [{ name: 'L', amount: 10_000, kind: 'essential', start: null, end: null }] });

  it('without flows, the surplus stays in cash', () => {
    const [row] = runPlan(worker(), start(cashAccount(0), investAccount('fund', 'fund', 1, 0, 0))).rows;
    expect(row.balances.cash).toBeCloseTo(row.netCashFlow, 9);
    expect(row.balances.fund).toBe(0);
  });

  it('fills flows in order: until balance, then a share of the rest', () => {
    const p = worker();
    p.flows = [
      { accountId: 'cash', mode: 'untilBalance', amount: 5_000 },
      { accountId: 'fund', mode: 'percent', amount: 0.5 },
      { accountId: 'etf', mode: 'fixed', amount: 1_000 },
    ];
    const s = start(cashAccount(2_000), investAccount('fund', 'fund', 1, 0, 0), investAccount('etf', 'brokerage', 1, 0, 0));
    const [row] = runPlan(p, s).rows;
    const rest = row.netCashFlow - 3_000;
    expect(row.balances.fund).toBeCloseTo(rest / 2, 9);
    expect(row.balances.brokerage).toBeCloseTo(1_000, 9);
    expect(row.balances.cash).toBeCloseTo(5_000 + rest / 2 - 1_000, 9);
  });

  it('PPES max = incremento autónomo + general limit, and lowers IRPF', () => {
    const p = worker();
    p.people[0].autonomo = { revenue: 80_000, expenses: 5_000, growth: 0, start: null, end: { kind: 'age', person: 0, age: 65 } };
    p.flows = [{ accountId: 'pp', mode: 'max', amount: 0 }];
    const [row] = runPlan(p, start(cashAccount(0), investAccount('pp', 'ppes', 1, 0, 0))).rows;
    expect(row.pensionContributions).toBeCloseTo(4_250 + 1_500, 9);
    const act = actividad(80_000, 5_000, rules);
    const expected = irpfAnual(rules, minimoPersonalFamiliar(persona(40), rules), {
      rendimiento_actividad: act.rendimiento_neto,
      aportacion_pensiones_autonomo: 5_750,
    });
    expect(row.irpf).toBeCloseTo(total(expected.cuota_liquida), 6);
    // The tax saving stays in cash.
    expect(row.balances.cash).toBeCloseTo(row.netCashFlow - 5_750, 6);
  });

  it('PPI takes the general limit first; PPES gets only its incremento', () => {
    const p = worker();
    p.people[0].autonomo = { revenue: 80_000, expenses: 5_000, growth: 0, start: null, end: { kind: 'age', person: 0, age: 65 } };
    p.flows = [
      { accountId: 'ppi', mode: 'max', amount: 0 },
      { accountId: 'ppes', mode: 'fixed', amount: 100_000 },
    ];
    const s = start(cashAccount(0), investAccount('ppi', 'ppi', 1, 0, 0), investAccount('ppes', 'ppes', 1, 0, 0));
    const [row] = runPlan(p, s).rows;
    expect(row.pensionContributions).toBeCloseTo(5_750, 9);
    expect(row.balances.pension).toBeCloseTo(5_750, 9);
  });

  it('caps contributions at 30 % of rendimientos netos', () => {
    const p = worker();
    p.expenses = [];
    p.people[0].autonomo = { revenue: 16_000, expenses: 2_000, growth: 0, start: null, end: { kind: 'age', person: 0, age: 65 } };
    p.flows = [{ accountId: 'pp', mode: 'max', amount: 0 }];
    const [row] = runPlan(p, start(cashAccount(0), investAccount('pp', 'ppes', 1, 0, 0))).rows;
    expect(row.pensionContributions).toBeCloseTo(0.3 * row.people[0].rendimientoNeto, 9);
    expect(row.pensionContributions).toBeLessThan(5_750);
  });

  it('no incremento without autónomo income', () => {
    const p = retiree(0, { flows: [{ accountId: 'pp', mode: 'max', amount: 0 }] });
    const [row] = runPlan(p, start(cashAccount(100_000), investAccount('pp', 'ppes', 1, 0, 0))).rows;
    expect(row.pensionContributions).toBe(0);
  });
});

describe('withdrawals', () => {
  it('sells with gross-up: proceeds cover expenses and the tax on the gain', () => {
    const p = retiree(30_000);
    const s = start(investAccount('etf', 'brokerage', 100, 1_000, 50_000));
    const [row] = runPlan(p, s).rows;
    const proceeds = 100_000 - row.balances.brokerage;
    expect(row.realizedGains).toBeCloseTo(proceeds / 2, 6);
    const expected = irpfAnual(rules, minimoPersonalFamiliar(persona(70), rules), {
      ganancias: row.realizedGains,
    });
    expect(row.irpf).toBeGreaterThan(0);
    expect(row.irpf).toBeCloseTo(total(expected.cuota_liquida), 6);
    expect(proceeds).toBeCloseTo(30_000 + row.irpf, 5);
    expect(row.balances.cash).toBeCloseTo(0, 5);
  });

  it('carries a realized loss into the next year (compensación)', () => {
    const p = retiree(20_000, { withdrawalOrder: ['loss', 'cash', 'fund'] });
    const s = start(
      investAccount('loss', 'brokerage', 50, 100, 10_000),
      cashAccount(16_000),
      investAccount('fund', 'fund', 100, 500, 25_000),
    );
    const [y1, y2] = runPlan(p, s).rows;
    expect(y1.realizedGains).toBeCloseTo(-5_000, 6);
    expect(y1.baseLiquidableAhorro).toBe(0);
    expect(y2.realizedGains).toBeCloseTo(9_500, 6);
    expect(y2.baseLiquidableAhorro).toBeCloseTo(9_500 - 5_000, 6);
  });

  it('splits a joint account gain between two individual filers', () => {
    const p = retiree(40_000);
    p.people.push({ name: 'S', birthYear: 1956, disability: 'ninguna', autonomo: null, pension: null });
    const s = start(investAccount('etf', 'brokerage', 100, 1_000, 20_000, 'joint'));
    const [row] = runPlan(p, s).rows;
    const half = irpfAnual(rules, minimoPersonalFamiliar(persona(70), rules), {
      ganancias: row.realizedGains / 2,
    });
    expect(row.irpf).toBeCloseTo(2 * total(half.cuota_liquida), 6);
  });

  it('pension plan is drawn only from the access age, taxed as trabajo', () => {
    const p = retiree(20_000, {
      people: [{ name: 'R', birthYear: 1966, disability: 'ninguna', autonomo: null, pension: null }],
    });
    const rows = runPlan(p, start(investAccount('pp', 'ppi', 1, 500_000, 300_000))).rows;
    const at = (age: number) => rows.find((r) => r.people[0].age === age)!;
    expect(at(64).pensionWithdrawals).toBe(0);
    expect(at(64).cash).toBeCloseTo(-5 * 20_000, 6);
    const y = at(65);
    const expected = irpfAnual(rules, minimoPersonalFamiliar(persona(65), rules), {
      trabajo_integro: y.pensionWithdrawals,
    });
    expect(expected.gastos_trabajo).toBe(2_000);
    expect(y.irpf).toBeCloseTo(total(expected.cuota_liquida), 6);
    expect(y.pensionWithdrawals).toBeCloseTo(20_000 + y.irpf, 5);
    expect(y.realizedGains).toBe(0);
    expect(y.cash).toBeCloseTo(at(64).cash, 5);
  });

  it('never touches accounts left out of an explicit order', () => {
    const p = retiree(10_000, { withdrawalOrder: ['cash'] });
    const rows = runPlan(p, start(cashAccount(15_000), investAccount('fund', 'fund', 1, 50_000, 50_000))).rows;
    expect(rows[1].balances.fund).toBe(50_000);
    expect(rows[1].cash).toBeCloseTo(-5_000, 6);
  });

  it('projects 30+ years of a mixed portfolio fast', () => {
    const p = retiree(40_000, { returns: { ...ZERO_RETURNS, brokerageGrowth: 0.05, brokerageYield: 0.02 } });
    const s = start(cashAccount(20_000), investAccount('etf', 'brokerage', 100, 10_000, 400_000));
    const t0 = performance.now();
    const rows = runPlan(p, s).rows;
    expect(rows.length).toBeGreaterThan(20);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
