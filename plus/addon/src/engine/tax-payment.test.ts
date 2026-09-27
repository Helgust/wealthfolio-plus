// Phase 5: IRPF paid the next year (pagos a cuenta in the year, the renta after it) and the marginal
// and effective rates.
import { describe, expect, it } from 'vitest';
import { irpfAnual, minimoPersonalFamiliar, rulesForYear } from '../es-tax';
import { defaultPlan, newPlan, type Plan } from '../model/plan';
import { marginalRates, runPlan, type StartingPoint } from './run-plan';
import { cashAccount, ZERO_RETURNS } from './test-helpers';

const START: StartingPoint = { netWorth: 100_000, accounts: [cashAccount(100_000)] };

/** The template (autónomo 40 000 €, expenses 20 000 €) with zero returns. */
const plan = (overrides: Partial<Plan> = {}): Plan => ({ ...defaultPlan(2026), returns: ZERO_RETURNS, ...overrides });

describe('IRPF in its year', () => {
  it('is the default and what plans before phase 5 do', () => {
    expect(plan().taxPayment).toBe('sameYear');
    const rows = runPlan(plan(), START).rows;
    expect(rows.every((r) => r.irpfPaid === r.irpf && r.taxOwed === 0 && r.irpfRefund === 0)).toBe(true);
  });

  it('a new plan in the page pays it the next year', () => {
    expect(newPlan(2026).taxPayment).toBe('nextYear');
  });
});

describe('IRPF the next year', () => {
  const same = runPlan(plan(), START).rows;
  const next = runPlan(plan({ taxPayment: 'nextYear' }), START).rows;

  it('the autónomo pays the modelo 130 in the year and the rest with the renta', () => {
    const rules = rulesForYear(2026);
    next.forEach((r, i) => {
      // From 67 the SS pension has retenciones; before that only the modelo 130 is paid on account.
      if (r.publicPension > 0) return;
      const pagos130 = rules.actividad.pago_fraccionado * Math.max(r.people[0].rendimientoNeto, 0);
      // Accrued IRPF = pagos a cuenta + the renta owed at the end of the year.
      expect(r.taxOwed).toBeCloseTo(r.irpf - pagos130, 6);
      const lastRenta = i === 0 ? 0 : next[i - 1].taxOwed;
      expect(r.irpfPaid - r.irpfRefund).toBeCloseTo(pagos130 + lastRenta, 6);
    });
    // At this rendimiento 20 % on account is more than the IRPF: the renta is a refund.
    expect(next[0].taxOwed).toBeLessThan(0);
    expect(next[1].irpfRefund).toBeCloseTo(-next[0].taxOwed, 6);
    // The accrued tax does not depend on when it is paid.
    next.forEach((r, i) => expect(r.irpf).toBeCloseTo(same[i].irpf, 6));
  });

  it('the renta owed is in net worth: with no returns net worth is the same as paying in the year', () => {
    next.forEach((r, i) => {
      expect(r.cash).toBeCloseTo(same[i].cash + r.taxOwed, 4);
      expect(r.netWorth).toBeCloseTo(same[i].netWorth, 4);
    });
  });

  it('the last year’s renta of the year before the plan is paid in its first year', () => {
    const [first] = runPlan(plan({ taxPayment: 'nextYear', priorYearTax: 1_500 }), START).rows;
    expect(first.irpfPaid - first.irpfRefund).toBeCloseTo(0.2 * first.people[0].rendimientoNeto + 1_500, 6);
    const [refund] = runPlan(plan({ taxPayment: 'nextYear', priorYearTax: -800 }), START).rows;
    expect(refund.irpfRefund).toBe(800);
  });

  it('retenciones cover the tax on a salary: nothing is left for the renta', () => {
    const p = defaultPlan(2026);
    const employee = plan({
      taxPayment: 'nextYear',
      people: [{ ...p.people[0], autonomo: null, pension: null }],
      incomes: [{ name: 'Salary', person: 0, tax: 'trabajo', amount: 45_000, start: null, end: null }],
    });
    const rows = runPlan(employee, START).rows;
    expect(rows[0].irpf).toBeGreaterThan(5_000);
    expect(rows.every((r) => Math.abs(r.taxOwed) < 1e-6)).toBe(true);
    expect(rows[0].irpfPaid).toBeCloseTo(rows[0].irpf, 6);
  });
});

describe('rates', () => {
  const rules = rulesForYear(2026);
  const minimo = minimoPersonalFamiliar({ edad: 40, discapacidad: 'ninguna', asistencia: false }, rules);
  const at = (general: number, ahorro = 0) =>
    marginalRates(irpfAnual(rules, minimo, { otras_rentas_general: general, rcm: ahorro }), rules);

  it('the general marginal rate adds both halves and moves at the brackets', () => {
    expect(at(12_449).general).toBeCloseTo(0.095 + 0.117, 12);
    expect(at(12_451).general).toBeCloseTo(0.12 + 0.117, 12);
    expect(at(35_199).general).toBeCloseTo(0.15 + 0.17, 12);
    expect(at(35_201).general).toBeCloseTo(0.185 + 0.17, 12);
    expect(at(70_000).general).toBeCloseTo(0.225 + 0.244, 12);
  });

  it('within the mínimo of a half the next euro costs nothing in that half', () => {
    // Mínimo personal: 5 550 € estatal, 6 105 € autonómico (Comunitat Valenciana).
    expect(at(5_000).general).toBe(0);
    expect(at(5_800).general).toBeCloseTo(0.095, 12);
    expect(at(6_200).general).toBeCloseTo(0.095 + 0.088, 12);
  });

  it('the savings marginal rate uses what is left of the mínimo', () => {
    expect(at(0, 3_000).ahorro).toBe(0);
    expect(at(20_000, 5_999).ahorro).toBeCloseTo(0.095 * 2, 12);
    expect(at(20_000, 6_001).ahorro).toBeCloseTo(0.105 * 2, 12);
  });

  it('the ledger has them per person and the effective rate of the year', () => {
    const [row] = runPlan(plan(), START).rows;
    const m = marginalRates(
      irpfAnual(rules, minimo, { rendimiento_actividad: row.people[0].rendimientoNeto }),
      rules,
    );
    expect(row.people[0].marginalGeneral).toBeCloseTo(m.general, 12);
    expect(row.effectiveRate).toBeCloseTo(row.irpf / row.revenue, 12);
  });
});
