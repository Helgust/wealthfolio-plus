// Годовой движок фазы 1, детерминированный: доход autónomo → RETA → IRPF → расходы → остаток →
// строка ledger. Порядок шагов года — plus/docs/architecture.md §3.4; налог платится в том же году.
// Суммы номинальные; deflator переводит их в евро первого года плана.
import {
  actividad,
  irpfAnual,
  irpfConjunta,
  minimoConjunta,
  minimoPersonalFamiliar,
  rulesForYear,
  total,
  type Familiar,
  type IrpfAnual,
  type Persona,
  type PendientesAhorro,
  type PendientesGeneral,
} from '../es-tax';
import type { Filing, Plan } from '../model/plan';

/** Текущие финансы из Wealthfolio на старт плана (базовая валюта). */
export interface StartingPoint {
  netWorth: number;
  /** Сумма CASH-счетов: в фазе 1 весь денежный поток идёт в них */
  cash: number;
}

export interface PersonYear {
  age: number;
  revenue: number;
  businessExpenses: number;
  cuotaReta: number;
  /** Например, «general 3»; null — дохода autónomo нет */
  retaTramo: string | null;
  rendimientoNeto: number;
}

export interface LedgerRow {
  year: number;
  people: PersonYear[];
  revenue: number;
  businessExpenses: number;
  reta: number;
  irpfEstatal: number;
  irpfAutonomica: number;
  irpf: number;
  /** Сумма по декларациям года */
  baseLiquidableGeneral: number;
  essentialExpenses: number;
  discretionaryExpenses: number;
  netCashFlow: number;
  cash: number;
  /** Всё, кроме CASH-счетов; в фазе 1 не меняется */
  otherAssets: number;
  netWorth: number;
  /** Номинал ÷ deflator = евро первого года плана */
  deflator: number;
}

export interface PlanResult {
  filing: Filing;
  rows: LedgerRow[];
}

interface Carry {
  general?: PendientesGeneral;
  ahorro?: PendientesAhorro;
}

function childrenAsFamiliares(plan: Plan, year: number, share: number): Familiar[] {
  return plan.children
    .map((c) => year - c.birthYear)
    .filter((edad) => edad >= 0)
    .map((edad) => ({ edad, discapacidad: 'ninguna', asistencia: false, renta_anual: 0, share }));
}

export function endYear(plan: Plan): number {
  return Math.min(...plan.people.map((p) => p.birthYear)) + plan.endAge;
}

/** Прогон плана по годам. filing по умолчанию — из плана; другой — для сравнения деклараций. */
export function runPlan(plan: Plan, start: StartingPoint, filing: Filing = plan.filing): PlanResult {
  if (filing === 'joint' && plan.people.length !== 2) {
    throw new Error('Joint filing needs two people');
  }
  const rows: LedgerRow[] = [];
  const carries: Carry[] = plan.people.map(() => ({}));
  let jointCarry: Carry = {};
  let cash = start.cash;
  const otherAssets = start.netWorth - start.cash;

  for (let year = plan.startYear; year <= endYear(plan); year++) {
    const t = year - plan.startYear;
    const rules = rulesForYear(year);

    // Доходы и RETA.
    const acts = plan.people.map((p) => {
      const age = year - p.birthYear;
      const inc = p.autonomo;
      if (!inc || age >= inc.untilAge) return { age, act: null };
      const g = (1 + inc.growth) ** t;
      return { age, act: actividad(inc.revenue * g, inc.expenses * g, rules) };
    });
    const personas: Persona[] = plan.people.map((p, i) => ({
      edad: acts[i].age,
      discapacidad: p.disability,
      asistencia: false,
    }));

    // IRPF.
    let declaraciones: IrpfAnual[];
    if (filing === 'joint') {
      const minimo = minimoConjunta(personas, rules, childrenAsFamiliares(plan, year, 1));
      const res = irpfConjunta(
        rules,
        minimo,
        acts.map(({ act }) => ({ rendimiento_actividad: act?.rendimiento_neto ?? 0 })),
        { pendientes_general: jointCarry.general, pendientes_ahorro: jointCarry.ahorro },
      );
      jointCarry = { general: res.pendientes_general, ahorro: res.pendientes_ahorro };
      declaraciones = [res];
    } else {
      // Детей декларируют оба родителя: mínimo por descendientes делится поровну (art. 61).
      const share = 1 / plan.people.length;
      declaraciones = personas.map((persona, i) => {
        const minimo = minimoPersonalFamiliar(
          persona,
          rules,
          childrenAsFamiliares(plan, year, share),
        );
        const res = irpfAnual(
          rules,
          minimo,
          { rendimiento_actividad: acts[i].act?.rendimiento_neto ?? 0 },
          { pendientes_general: carries[i].general, pendientes_ahorro: carries[i].ahorro },
        );
        carries[i] = { general: res.pendientes_general, ahorro: res.pendientes_ahorro };
        return res;
      });
    }

    // Расходы домохозяйства — в ценах первого года, растут с инфляцией.
    const deflator = (1 + plan.inflation) ** t;
    let essential = 0;
    let discretionary = 0;
    for (const e of plan.expenses) {
      if ((e.startYear !== null && year < e.startYear) || (e.endYear !== null && year > e.endYear)) {
        continue;
      }
      if (e.kind === 'essential') essential += e.amount * deflator;
      else discretionary += e.amount * deflator;
    }

    const people: PersonYear[] = acts.map(({ age, act }) => ({
      age,
      revenue: act?.ingresos ?? 0,
      businessExpenses: act?.gastos ?? 0,
      cuotaReta: act?.cuota_reta ?? 0,
      retaTramo: act ? retaLabel(rules.reta.tramos[act.reta_tramo]) : null,
      rendimientoNeto: act?.rendimiento_neto ?? 0,
    }));
    const sum = (f: (p: PersonYear) => number) => people.reduce((s, p) => s + f(p), 0);
    const revenue = sum((p) => p.revenue);
    const businessExpenses = sum((p) => p.businessExpenses);
    const reta = sum((p) => p.cuotaReta);
    const irpfEstatal = declaraciones.reduce((s, d) => s + d.cuota_liquida.estatal, 0);
    const irpfAutonomica = declaraciones.reduce((s, d) => s + d.cuota_liquida.autonomica, 0);
    const irpf = declaraciones.reduce((s, d) => s + total(d.cuota_liquida), 0);

    const netCashFlow =
      revenue - businessExpenses - reta - irpf - essential - discretionary;
    cash += netCashFlow;
    rows.push({
      year,
      people,
      revenue,
      businessExpenses,
      reta,
      irpfEstatal,
      irpfAutonomica,
      irpf,
      baseLiquidableGeneral: declaraciones.reduce((s, d) => s + d.base_liquidable_general, 0),
      essentialExpenses: essential,
      discretionaryExpenses: discretionary,
      netCashFlow,
      cash,
      otherAssets,
      netWorth: cash + otherAssets,
      deflator,
    });
  }
  return { filing, rows };
}

function retaLabel(t: { tabla: string; tramo: number }): string {
  return `${t.tabla} ${t.tramo}`;
}
