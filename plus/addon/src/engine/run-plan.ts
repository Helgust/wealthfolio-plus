// Deterministic yearly engine. Order of steps within a year — plus/docs/architecture.md §3.4:
// milestones → account income and growth → autónomo income and RETA, public pensions → expenses →
// IRPF → surplus through flows,
// or deficit from accounts in withdrawal order with tax gross-up. Tax is paid in the same year.
// Amounts are nominal; deflator converts them to euros of the plan's first year.
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
import { isActive, reachMilestones } from './timing';

/** Current finances from Wealthfolio at the plan start (base currency). */
export interface StartingPoint {
  netWorth: number;
  /** Modelled accounts; everything else (other, alternative assets, debts) stays constant */
  accounts: Account[];
}

export interface PersonYear {
  age: number;
  revenue: number;
  businessExpenses: number;
  cuotaReta: number;
  /** E.g. "general 3"; null — no autónomo income */
  retaTramo: string | null;
  rendimientoNeto: number;
  /** Seguridad Social pension, gross */
  publicPension: number;
}

export interface Balances {
  cash: number;
  fund: number;
  brokerage: number;
  pension: number;
}

const emptyBalances = (): Balances => ({ cash: 0, fund: 0, brokerage: 0, pension: 0 });
const balanceKey = (kind: Account['kind']): keyof Balances => (isPension(kind) ? 'pension' : kind);
export const totalOf = (b: Balances) => b.cash + b.fund + b.brokerage + b.pension;

export interface LedgerRow {
  year: number;
  people: PersonYear[];
  revenue: number;
  businessExpenses: number;
  reta: number;
  publicPension: number;
  irpfEstatal: number;
  irpfAutonomica: number;
  irpf: number;
  /** Sums over the year's tax returns */
  baseLiquidableGeneral: number;
  baseLiquidableAhorro: number;
  essentialExpenses: number;
  discretionaryExpenses: number;
  /** Interest and dividends paid into the cash flow */
  investmentIncome: number;
  /** Gain (loss) from sales — savings base */
  realizedGains: number;
  pensionContributions: number;
  /** Pension plan payouts — rendimientos del trabajo */
  pensionWithdrawals: number;
  /** Income − expenses − taxes, before flows and withdrawals */
  netCashFlow: number;
  /** Money put into accounts by type: surplus flows and the rest to cash (pension = contributions) */
  deposits: Balances;
  /** Money taken out of accounts by type to cover a deficit (pension = payouts, gross) */
  withdrawals: Balances;
  /** Deficit left when the accounts in the withdrawal order run out: cash goes negative */
  shortfall: number;
  /** Price growth of positions; interest and dividends are paid out as investmentIncome instead */
  marketGrowth: number;
  balances: Balances;
  /** Sum of CASH accounts; < 0 — money ran out, the deficit is debt */
  cash: number;
  /** Everything outside the model; does not change */
  otherAssets: number;
  netWorth: number;
  /** Nominal ÷ deflator = euros of the plan's first year */
  deflator: number;
  /** Ids of the milestones reached in this year */
  milestones: string[];
}

export interface PlanResult {
  filing: Filing;
  rows: LedgerRow[];
  /** Year each reached milestone was reached (may be before the plan start) */
  milestoneYears: Record<string, number>;
}

interface Carry {
  general?: PendientesGeneral;
  ahorro?: PendientesAhorro;
}

/** A person's income for the year besides the activity, and pension plan contributions — for IRPF. */
interface PersonRentas {
  rcm: number;
  ganancias: number;
  trabajo: number;
  ppi: number;
  ppes: number;
}

const emptyRentas = (): PersonRentas => ({ rcm: 0, ganancias: 0, trabajo: 0, ppi: 0, ppes: 0 });

/** Account for leftover surplus and shortfalls when the model has no CASH account. */
export const SINK_ID = '__cash';

const KIND_ORDER: Record<Account['kind'], number> = { cash: 0, fund: 1, brokerage: 2, ppi: 3, ppes: 3 };

/** People's shares in an account's income: a joint account splits equally. */
function ownerShares(owner: Owner, n: number): number[] {
  if (owner === 'joint') return new Array(n).fill(1 / n);
  const i = owner < n ? owner : 0;
  return Array.from({ length: n }, (_, j) => (j === i ? 1 : 0));
}

/** A pension plan always belongs to one person; a joint one counts as the first person's. */
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

/** Withdrawal order: from the plan (accounts not listed are never touched) or cash → fondos → brokerage → pension plans. */
export function withdrawalOrder(plan: Plan, accounts: Account[]): Account[] {
  if (plan.withdrawalOrder.length) {
    return plan.withdrawalOrder
      .map((id) => accounts.find((a) => a.id === id))
      .filter((a): a is Account => a !== undefined);
  }
  return [...accounts].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

/** A person's remaining deductible pension plan contributions for the year (arts. 51.6, 52.1 LIRPF). */
interface PensionRoom {
  general: number;
  incremento: number;
  tope: number;
}

function roomFor(kind: 'ppi' | 'ppes', r: PensionRoom): number {
  return Math.min(kind === 'ppes' ? r.general + r.incremento : r.general, r.tope);
}

/** PPES uses its own incremento first, then the general limit. */
function useRoom(kind: 'ppi' | 'ppes', r: PensionRoom, c: number): void {
  const inc = kind === 'ppes' ? Math.min(c, r.incremento) : 0;
  r.incremento -= inc;
  r.general -= c - inc;
  r.tope -= c;
}

/** Runs the plan year by year. filing defaults to the plan's; the other one is for comparing returns. */
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
  const reached = new Map<string, number>();

  for (let year = plan.startYear; year <= endYear(plan); year++) {
    const t = year - plan.startYear;
    const rules = rulesForYear(year);
    const deflator = (1 + plan.inflation) ** t;
    const ages = plan.people.map((p) => year - p.birthYear);
    const prev = rows.at(-1);
    const reachedNow = reachMilestones(plan, year, prev ? prev.netWorth / prev.deflator : start.netWorth, reached);

    // Account income — on start-of-year value, then price growth.
    const base = plan.people.map(emptyRentas);
    let investmentIncome = 0;
    let marketGrowth = 0;
    for (const a of accounts) {
      const value = accountValue(a);
      let income = 0;
      if (a.kind === 'cash') income = Math.max(a.cash, 0) * r.cashInterest;
      else if (a.kind === 'brokerage') {
        income = (value - a.cash) * r.brokerageYield;
        grow(a, r.brokerageGrowth);
      } else grow(a, a.kind === 'fund' ? r.fundGrowth : r.pensionGrowth);
      marketGrowth += accountValue(a) - value;
      investmentIncome += income;
      ownerShares(a.owner, n).forEach((s, i) => (base[i].rcm += income * s));
    }

    // Autónomo income and RETA; public pensions are rendimientos del trabajo.
    const acts = plan.people.map((p) => {
      const inc = p.autonomo;
      if (!inc || !isActive(inc.start, inc.end, year, plan, reached)) return null;
      const g = (1 + inc.growth) ** t;
      return actividad(inc.revenue * g, inc.expenses * g, rules);
    });
    const pensions = plan.people.map((p) =>
      p.pension && isActive(p.pension.start, null, year, plan, reached) ? p.pension.amount * deflator : 0,
    );
    pensions.forEach((v, i) => (base[i].trabajo += v));
    const personas: Persona[] = plan.people.map((p, i) => ({
      edad: ages[i],
      discapacidad: p.disability,
      asistencia: false,
    }));

    // Household expenses — in first-year prices, growing with inflation.
    let essential = 0;
    let discretionary = 0;
    for (const e of plan.expenses) {
      if (!isActive(e.start, e.end, year, plan, reached)) continue;
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
      publicPension: pensions[i],
    }));
    const sum = (f: (p: PersonYear) => number) => people.reduce((s, p) => s + f(p), 0);
    const revenue = sum((p) => p.revenue);
    const businessExpenses = sum((p) => p.businessExpenses);
    const reta = sum((p) => p.cuotaReta);
    const publicPension = sum((p) => p.publicPension);
    const cf0 =
      revenue - businessExpenses - reta + publicPension - essential - discretionary + investmentIncome;

    const tax = (extra: PersonRentas[]) =>
      taxYear(plan, year, rules, filing, personas, acts, extra, carries, jointCarry);
    let taxed = tax(base);
    let realizedGains = 0;
    let pensionContributions = 0;
    let pensionWithdrawals = 0;
    const deposits = emptyBalances();
    let withdrawals = emptyBalances();
    let shortfall = 0;

    if (cf0 - taxed.irpf >= 0) {
      // Surplus → flows in order; the rest and the tax saving from contributions → cash.
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
        deposits[balanceKey(a.kind)] += c;
        budget -= c;
      }
      if (pensionContributions > 0) {
        const after = tax(withContrib);
        budget += taxed.irpf - after.irpf;
        taxed = after;
      }
      sink().cash += budget;
      deposits.cash += budget;
    } else {
      // Deficit → withdrawals in order. Sales and pension payouts add tax, so the amount to
      // withdraw is the fixed point x = tax(x) − cf0; iterations converge monotonically from below.
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
        withdrawals = d.byKind;
        realizedGains = d.ganancias.reduce((s, g) => s + g, 0);
        pensionWithdrawals = d.trabajo.reduce((s, g) => s + g, 0);
        need = taxed.irpf - cf0;
        if (raised < x - 1e-9 || need - raised < 1e-7) break;
        x = need;
      }
      accounts = trial;
      if (need - raised > 1e-6) {
        // Accounts ran out: the shortfall makes cash negative.
        shortfall = need - raised;
        sink().cash -= shortfall;
      } else if (raised > need) {
        // A sale at a loss lowered the tax: what was raised beyond the need stays in cash.
        sink().cash += raised - need;
        deposits.cash += raised - need;
      }
    }
    carries = taxed.carries;
    jointCarry = taxed.jointCarry;

    const balances = emptyBalances();
    for (const a of accounts) balances[balanceKey(a.kind)] += accountValue(a);
    const d = taxed.declaraciones;
    rows.push({
      year,
      people,
      revenue,
      businessExpenses,
      reta,
      publicPension,
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
      deposits,
      withdrawals,
      shortfall,
      marketGrowth,
      balances,
      cash: balances.cash,
      otherAssets,
      netWorth: totalOf(balances) + otherAssets,
      deflator,
      milestones: reachedNow.map((m) => m.id),
    });
  }
  return { filing, rows, milestoneYears: Object.fromEntries(reached) };
}

interface Drawdown {
  raised: number;
  byKind: Balances;
  ganancias: number[];
  trabajo: number[];
}

/** Takes amount out of accounts in order; gains and pension payouts per person. */
function drawdown(plan: Plan, order: Account[], amount: number, ages: number[]): Drawdown {
  const n = plan.people.length;
  const out: Drawdown = {
    raised: 0,
    byKind: emptyBalances(),
    ganancias: new Array(n).fill(0),
    trabajo: new Array(n).fill(0),
  };
  for (const a of order) {
    const left = amount - out.raised;
    if (left <= 0) break;
    if (isPension(a.kind)) {
      const i = pensionOwner(a.owner, n);
      if (ages[i] < plan.pensionAccessAge) continue;
      const s = withdraw(a, left);
      out.trabajo[i] += s.proceeds;
      out.raised += s.proceeds;
      out.byKind.pension += s.proceeds;
      continue;
    }
    const s = withdraw(a, left);
    out.raised += s.proceeds;
    out.byKind[balanceKey(a.kind)] += s.proceeds;
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

/** IRPF for the year for the given income. Does not mutate the loss carry-forward; returns the new state. */
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
    // Pension plan payouts are rendimientos íntegros del trabajo: otros gastos and reducción art. 20.
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
  // Both parents declare the children: the mínimo por descendientes is split equally (art. 61).
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
