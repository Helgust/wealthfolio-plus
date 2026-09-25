// Годовой движок, детерминированный. Порядок шагов года — plus/docs/architecture.md §3.4:
// доходы счетов и рост → доход autónomo и RETA → расходы → IRPF → профицит по flows или дефицит
// из счетов по порядку изъятий с gross-up налога. Налог платится в том же году. Суммы
// номинальные; deflator переводит их в евро первого года плана.
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
  type IrpfRules,
  type Persona,
  type PendientesAhorro,
  type PendientesGeneral,
  type Rentas,
} from '../es-tax';
import { isPension, type Owner } from '../model/accounts';
import type { Filing, Plan } from '../model/plan';
import { accountValue, cloneAccount, deposit, grow, withdraw, type Account } from './portfolio';

/** Текущие финансы из Wealthfolio на старт плана (базовая валюта). */
export interface StartingPoint {
  netWorth: number;
  /** Счета в модели; всё остальное (other, альтернативные активы, долги) стоит на месте */
  accounts: Account[];
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

export interface Balances {
  cash: number;
  fund: number;
  brokerage: number;
  pension: number;
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
  /** Суммы по декларациям года */
  baseLiquidableGeneral: number;
  baseLiquidableAhorro: number;
  essentialExpenses: number;
  discretionaryExpenses: number;
  /** Проценты и дивиденды, выплаченные в денежный поток */
  investmentIncome: number;
  /** Прирост (убыток) от продаж — база сбережений */
  realizedGains: number;
  pensionContributions: number;
  /** Выплаты из планов пенсий — rendimientos del trabajo */
  pensionWithdrawals: number;
  /** Доходы − расходы − налоги, до flows и изъятий */
  netCashFlow: number;
  balances: Balances;
  /** Сумма CASH-счетов; < 0 — деньги кончились, дефицит в долг */
  cash: number;
  /** Всё вне модели; не меняется */
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

/** Доходы человека за год помимо деятельности и взносы в планы пенсий — для IRPF. */
interface PersonRentas {
  rcm: number;
  ganancias: number;
  trabajo: number;
  ppi: number;
  ppes: number;
}

const emptyRentas = (): PersonRentas => ({ rcm: 0, ganancias: 0, trabajo: 0, ppi: 0, ppes: 0 });

/** Счёт для остатка профицита и нехватки денег, если в модели нет CASH-счёта. */
export const SINK_ID = '__cash';

const KIND_ORDER: Record<Account['kind'], number> = { cash: 0, fund: 1, brokerage: 2, ppi: 3, ppes: 3 };

/** Доли людей в доходах счёта: совместный — поровну. */
function ownerShares(owner: Owner, n: number): number[] {
  if (owner === 'joint') return new Array(n).fill(1 / n);
  const i = owner < n ? owner : 0;
  return Array.from({ length: n }, (_, j) => (j === i ? 1 : 0));
}

/** План пенсий — всегда одного человека; совместный считается планом первого. */
const pensionOwner = (owner: Owner, n: number) => (owner === 'joint' || owner >= n ? 0 : owner);

function childrenAsFamiliares(plan: Plan, year: number, share: number): Familiar[] {
  return plan.children
    .map((c) => year - c.birthYear)
    .filter((edad) => edad >= 0)
    .map((edad) => ({ edad, discapacidad: 'ninguna', asistencia: false, renta_anual: 0, share }));
}

export function endYear(plan: Plan): number {
  return Math.min(...plan.people.map((p) => p.birthYear)) + plan.endAge;
}

/** Порядок изъятий: из плана (счета вне списка не трогаются) или cash → fondos → брокерский → планы пенсий. */
export function withdrawalOrder(plan: Plan, accounts: Account[]): Account[] {
  if (plan.withdrawalOrder.length) {
    return plan.withdrawalOrder
      .map((id) => accounts.find((a) => a.id === id))
      .filter((a): a is Account => a !== undefined);
  }
  return [...accounts].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

/** Остаток вычитаемых взносов человека в планы пенсий за год (arts. 51.6, 52.1 LIRPF). */
interface PensionRoom {
  general: number;
  incremento: number;
  tope: number;
}

function roomFor(kind: 'ppi' | 'ppes', r: PensionRoom): number {
  return Math.min(kind === 'ppes' ? r.general + r.incremento : r.general, r.tope);
}

/** PPES сначала занимает свой incremento, остаток — общий лимит. */
function useRoom(kind: 'ppi' | 'ppes', r: PensionRoom, c: number): void {
  const inc = kind === 'ppes' ? Math.min(c, r.incremento) : 0;
  r.incremento -= inc;
  r.general -= c - inc;
  r.tope -= c;
}

/** Прогон плана по годам. filing по умолчанию — из плана; другой — для сравнения деклараций. */
export function runPlan(plan: Plan, start: StartingPoint, filing: Filing = plan.filing): PlanResult {
  if (filing === 'joint' && plan.people.length !== 2) {
    throw new Error('Joint filing needs two people');
  }
  const n = plan.people.length;
  const r = plan.returns;
  const rows: LedgerRow[] = [];
  let carries: Carry[] = plan.people.map(() => ({}));
  let jointCarry: Carry = {};
  let accounts = start.accounts.map(cloneAccount);
  const otherAssets = start.netWorth - start.accounts.reduce((s, a) => s + accountValue(a), 0);
  let sinkId = accounts.find((a) => a.kind === 'cash')?.id;
  if (sinkId === undefined) {
    sinkId = SINK_ID;
    accounts.push({ id: SINK_ID, name: 'Cash', kind: 'cash', owner: 'joint', cash: 0, positions: [] });
  }
  const sink = () => accounts.find((a) => a.id === sinkId)!;

  for (let year = plan.startYear; year <= endYear(plan); year++) {
    const t = year - plan.startYear;
    const rules = rulesForYear(year);
    const deflator = (1 + plan.inflation) ** t;
    const ages = plan.people.map((p) => year - p.birthYear);

    // Доходы счетов — от стоимости на начало года, затем рост цен.
    const base = plan.people.map(emptyRentas);
    let investmentIncome = 0;
    for (const a of accounts) {
      let income = 0;
      if (a.kind === 'cash') income = Math.max(a.cash, 0) * r.cashInterest;
      else if (a.kind === 'brokerage') {
        income = (accountValue(a) - a.cash) * r.brokerageYield;
        grow(a, r.brokerageGrowth);
      } else grow(a, a.kind === 'fund' ? r.fundGrowth : r.pensionGrowth);
      investmentIncome += income;
      ownerShares(a.owner, n).forEach((s, i) => (base[i].rcm += income * s));
    }

    // Доход autónomo и RETA.
    const acts = plan.people.map((p, i) => {
      const inc = p.autonomo;
      if (!inc || ages[i] >= inc.untilAge) return null;
      const g = (1 + inc.growth) ** t;
      return actividad(inc.revenue * g, inc.expenses * g, rules);
    });
    const personas: Persona[] = plan.people.map((p, i) => ({
      edad: ages[i],
      discapacidad: p.disability,
      asistencia: false,
    }));

    // Расходы домохозяйства — в ценах первого года, растут с инфляцией.
    let essential = 0;
    let discretionary = 0;
    for (const e of plan.expenses) {
      if ((e.startYear !== null && year < e.startYear) || (e.endYear !== null && year > e.endYear)) {
        continue;
      }
      if (e.kind === 'essential') essential += e.amount * deflator;
      else discretionary += e.amount * deflator;
    }

    const people: PersonYear[] = acts.map((act, i) => ({
      age: ages[i],
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
    const cf0 = revenue - businessExpenses - reta - essential - discretionary + investmentIncome;

    const tax = (extra: PersonRentas[]) =>
      taxYear(plan, year, rules, filing, personas, acts, extra, carries, jointCarry);
    let taxed = tax(base);
    let realizedGains = 0;
    let pensionContributions = 0;
    let pensionWithdrawals = 0;

    if (cf0 - taxed.irpf >= 0) {
      // Профицит → flows по порядку; остаток и экономия на налоге от взносов — в cash.
      const prev = rules.reducciones.prevision_social;
      const room: PensionRoom[] = acts.map((act) => ({
        general: prev.limite_general,
        incremento: act ? prev.incremento_autonomo : 0,
        tope: prev.porcentaje_rendimientos * Math.max(act?.rendimiento_neto ?? 0, 0),
      }));
      const withContrib = base.map((b) => ({ ...b }));
      let budget = cf0 - taxed.irpf;
      for (const f of plan.flows) {
        const a = accounts.find((x) => x.id === f.accountId);
        if (!a || budget <= 0) continue;
        let want =
          f.mode === 'fixed'
            ? f.amount * deflator
            : f.mode === 'percent'
              ? budget * f.amount
              : f.mode === 'untilBalance'
                ? Math.max(f.amount * deflator - accountValue(a), 0)
                : budget;
        if (a.kind === 'ppi' || a.kind === 'ppes') {
          const i = pensionOwner(a.owner, n);
          want = Math.min(want, roomFor(a.kind, room[i]));
          useRoom(a.kind, room[i], Math.min(want, budget));
          withContrib[i][a.kind] += Math.min(want, budget);
          pensionContributions += Math.min(want, budget);
        }
        const c = Math.min(want, budget);
        deposit(a, c, `${year}-12-31`);
        budget -= c;
      }
      if (pensionContributions > 0) {
        const after = tax(withContrib);
        budget += taxed.irpf - after.irpf;
        taxed = after;
      }
      sink().cash += budget;
    } else {
      // Дефицит → изъятия по порядку. Продажа и выплата плана пенсий добавляют налог, поэтому
      // сумма изъятия — неподвижная точка x = налог(x) − cf0; итерации сходятся монотонно снизу.
      let x = taxed.irpf - cf0;
      let trial = accounts;
      let raised = 0;
      let need = x;
      for (let iter = 0; iter < 100; iter++) {
        trial = accounts.map(cloneAccount);
        const d = drawdown(plan, withdrawalOrder(plan, trial), x, ages);
        taxed = tax(
          base.map((b, i) => ({
            ...b,
            ganancias: b.ganancias + d.ganancias[i],
            trabajo: b.trabajo + d.trabajo[i],
          })),
        );
        raised = d.raised;
        realizedGains = d.ganancias.reduce((s, g) => s + g, 0);
        pensionWithdrawals = d.trabajo.reduce((s, g) => s + g, 0);
        need = taxed.irpf - cf0;
        if (raised < x - 1e-9 || need - raised < 1e-7) break;
        x = need;
      }
      accounts = trial;
      // Счета кончились: нехватка уходит в минус на cash.
      if (need - raised > 1e-6) sink().cash -= need - raised;
    }
    carries = taxed.carries;
    jointCarry = taxed.jointCarry;

    const balances: Balances = { cash: 0, fund: 0, brokerage: 0, pension: 0 };
    for (const a of accounts) balances[isPension(a.kind) ? 'pension' : a.kind] += accountValue(a);
    const d = taxed.declaraciones;
    rows.push({
      year,
      people,
      revenue,
      businessExpenses,
      reta,
      irpfEstatal: d.reduce((s, x) => s + x.cuota_liquida.estatal, 0),
      irpfAutonomica: d.reduce((s, x) => s + x.cuota_liquida.autonomica, 0),
      irpf: taxed.irpf,
      baseLiquidableGeneral: d.reduce((s, x) => s + x.base_liquidable_general, 0),
      baseLiquidableAhorro: d.reduce((s, x) => s + x.base_liquidable_ahorro, 0),
      essentialExpenses: essential,
      discretionaryExpenses: discretionary,
      investmentIncome,
      realizedGains,
      pensionContributions,
      pensionWithdrawals,
      netCashFlow: cf0 - taxed.irpf,
      balances,
      cash: balances.cash,
      otherAssets,
      netWorth: balances.cash + balances.fund + balances.brokerage + balances.pension + otherAssets,
      deflator,
    });
  }
  return { filing, rows };
}

interface Drawdown {
  raised: number;
  ganancias: number[];
  trabajo: number[];
}

/** Вывести amount из счетов по порядку; прирост и выплаты планов пенсий — по людям. */
function drawdown(plan: Plan, order: Account[], amount: number, ages: number[]): Drawdown {
  const n = plan.people.length;
  const out: Drawdown = { raised: 0, ganancias: new Array(n).fill(0), trabajo: new Array(n).fill(0) };
  for (const a of order) {
    const left = amount - out.raised;
    if (left <= 0) break;
    if (isPension(a.kind)) {
      const i = pensionOwner(a.owner, n);
      if (ages[i] < plan.pensionAccessAge) continue;
      const s = withdraw(a, left);
      out.trabajo[i] += s.proceeds;
      out.raised += s.proceeds;
      continue;
    }
    const s = withdraw(a, left);
    out.raised += s.proceeds;
    if (a.kind !== 'cash') {
      ownerShares(a.owner, n).forEach((sh, i) => (out.ganancias[i] += (s.proceeds - s.cost) * sh));
    }
  }
  return out;
}

interface TaxYear {
  declaraciones: IrpfAnual[];
  irpf: number;
  carries: Carry[];
  jointCarry: Carry;
}

/** IRPF года для заданных доходов. Перенос убытков не меняет, а возвращает новое состояние. */
function taxYear(
  plan: Plan,
  year: number,
  rules: IrpfRules,
  filing: Filing,
  personas: Persona[],
  acts: (ReturnType<typeof actividad> | null)[],
  extra: PersonRentas[],
  carries: Carry[],
  jointCarry: Carry,
): TaxYear {
  const rentas: Rentas[] = extra.map((e, i) => ({
    rendimiento_actividad: acts[i]?.rendimiento_neto ?? 0,
    // Выплаты планов пенсий — rendimientos íntegros del trabajo: otros gastos и reducción art. 20.
    trabajo_integro: e.trabajo,
    rcm: e.rcm,
    ganancias: e.ganancias,
    aportacion_pensiones: e.ppi,
    aportacion_pensiones_autonomo: e.ppes,
  }));
  if (filing === 'joint') {
    const minimo = minimoConjunta(personas, rules, childrenAsFamiliares(plan, year, 1));
    const res = irpfConjunta(rules, minimo, rentas, {
      pendientes_general: jointCarry.general,
      pendientes_ahorro: jointCarry.ahorro,
    });
    return {
      declaraciones: [res],
      irpf: total(res.cuota_liquida),
      carries,
      jointCarry: { general: res.pendientes_general, ahorro: res.pendientes_ahorro },
    };
  }
  // Детей декларируют оба родителя: mínimo por descendientes делится поровну (art. 61).
  const share = 1 / plan.people.length;
  const declaraciones = personas.map((persona, i) =>
    irpfAnual(
      rules,
      minimoPersonalFamiliar(persona, rules, childrenAsFamiliares(plan, year, share)),
      rentas[i],
      { pendientes_general: carries[i].general, pendientes_ahorro: carries[i].ahorro },
    ),
  );
  return {
    declaraciones,
    irpf: declaraciones.reduce((s, d) => s + total(d.cuota_liquida), 0),
    carries: declaraciones.map((d) => ({ general: d.pendientes_general, ahorro: d.pendientes_ahorro })),
    jointCarry,
  };
}

function retaLabel(t: { tabla: string; tramo: number }): string {
  return `${t.tabla} ${t.tramo}`;
}
