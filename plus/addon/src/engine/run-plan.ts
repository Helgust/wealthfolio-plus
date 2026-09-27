// Yearly engine. Order of steps within a year — plus/docs/architecture.md §3.4:
// milestones → account income and growth → autónomo income and RETA, public pensions, other and
// one-time incomes → real estate and loans → expenses (a spending rule sets the discretionary ones)
// → IRPF → savings by goals, month by month (engine/savings.ts) → the year's rest: surplus through
// flows, or deficit from accounts in withdrawal order with tax gross-up. IRPF is paid in its year, or
// (taxPayment nextYear) the pagos a cuenta in the year and the rest with the renta the next one.
// Amounts are nominal; deflator converts them to euros of the plan's first year. Returns and
// inflation come from the market path: constant for the deterministic plan, one per trial in Monte
// Carlo.
import {
  actividad,
  cotizacionTrabajador,
  indexRules,
  marginalRate,
  irpfAnual,
  irpfConjunta,
  minimoConjunta,
  minimoPersonalFamiliar,
  rendimientoTrabajo,
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
import { autonomoGrowth, isPrepay, type Filing, type IncomeTax, type Plan, type SpendingRule } from '../model/plan';
import { amountInYear } from './amounts';
import {
  EVEN,
  inMonth,
  MODELO_130,
  monthOrEven,
  PUBLIC_PENSION,
  renta,
  salary,
  spread,
  weightsOf,
  type Calendar,
} from './calendar';
import { constantPath, priceLevelAt, priceLevels, type MarketYear } from './market';
import { accountValue, cloneAccount, deposit, grow, withdraw, type Account } from './portfolio';
import {
  amortizeMonth,
  downPayment,
  loansBalance,
  prepayLoan,
  purchaseAmounts,
  propertiesValue,
  realEstateCash,
  realEstateYear,
  type Loan,
  type Property,
  type RealEstateYear,
} from './real-estate';
import {
  heldId,
  holds,
  savingsYear,
  type DownPaymentDue,
  type DownPaymentPaid,
  type MonthRow,
  type Reached,
  type SavingsYear,
} from './savings';
import { isActive, occursIn, reachMilestones, timingYear } from './timing';

/** Current finances from Wealthfolio at the plan start (base currency). */
export interface StartingPoint {
  netWorth: number;
  /** Modelled accounts; everything else (other, alternative assets, debts) stays constant */
  accounts: Account[];
  /** Modelled real estate and loans (Wealthfolio alternative assets with a setting) */
  properties?: Property[];
  loans?: Loan[];
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
  /** Salaries, gross */
  wages: number;
  /** The employee's Seguridad Social cotizaciones on the salaries */
  employeeContributions: number;
  /** IRPF on the next euro of the base general and of the base del ahorro, both halves */
  marginalGeneral: number;
  marginalAhorro: number;
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

/**
 * Money taken out of one account in a year: to cover the year's minus in the withdrawal order, or a
 * down payment out of the goal that saved for it.
 */
export interface AccountSale {
  accountId: string;
  name: string;
  kind: Account['kind'];
  reason: 'deficit' | 'downPayment';
  proceeds: number;
  /** What IRPF taxes: the gain of a sale (savings base), a pension plan's payout (trabajo) */
  taxable: number;
  /**
   * IRPF the sale adds to the year. The tax the year's sales add is split into the part of pension
   * plan payouts and the part of gains, each by the accounts' taxable amounts.
   */
  tax: number;
}

export interface LedgerRow {
  year: number;
  people: PersonYear[];
  revenue: number;
  businessExpenses: number;
  reta: number;
  publicPension: number;
  /** Salaries, gross, and the employee's cotizaciones on them */
  wages: number;
  employeeContributions: number;
  /** Incomes taxed as gains in the savings base (the gain entered by the user) */
  gainIncome: number;
  /** Incomes outside IRPF: herencia, donación */
  exemptIncome: number;
  irpfEstatal: number;
  irpfAutonomica: number;
  /** IRPF of the year (accrued), whenever it is paid */
  irpf: number;
  /** Cash paid for IRPF in the year: pagos a cuenta and last year's renta, or all of it (sameYear) */
  irpfPaid: number;
  /** Last year's renta refunded in the year */
  irpfRefund: number;
  /** The year's renta still to pay (< 0 — to be refunded) at its end: in net worth */
  taxOwed: number;
  /** IRPF ÷ the year's income: revenue, salaries, pensions, interest and dividends, plan payouts, rent, gains */
  effectiveRate: number;
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
  /** The same by account, with the tax each sale adds */
  sales: AccountSale[];
  /** Deficit left when the accounts in the withdrawal order run out: cash goes negative */
  shortfall: number;
  /** What the spending rule lets the portfolio give this year; null — no rule in force */
  ruleWithdrawal: number | null;
  /** Price growth of positions; interest and dividends are paid out as investmentIncome instead */
  marketGrowth: number;
  balances: Balances;
  /** Modelled real estate at the end of the year */
  propertyValue: number;
  /** Modelled loans still owed at the end of the year */
  loanBalance: number;
  realEstate: RealEstateYear;
  /** Sum of CASH accounts; < 0 — money ran out, the deficit is debt */
  cash: number;
  /** Everything outside the model; does not change */
  otherAssets: number;
  netWorth: number;
  /** Nominal ÷ deflator = euros of the plan's first year */
  deflator: number;
  /** Ids of the milestones reached in this year */
  milestones: string[];
  /** Savings by goals in the year; null — the plan has no goals or savings */
  savings: SavingsYear | null;
}

export interface PlanResult {
  filing: Filing;
  rows: LedgerRow[];
  /** Year each reached milestone was reached (may be before the plan start) */
  milestoneYears: Record<string, number>;
  /** Months of the first years asked for, in order */
  months: MonthRow[];
  /** Month each goal first reached its target */
  goalsReached: Record<string, Reached>;
  /** Down payments paid out of the goals that saved for them */
  downPayments: DownPaymentPaid[];
}

interface Carry {
  general?: PendientesGeneral;
  ahorro?: PendientesAhorro;
}

/** A person's income for the year besides the activity, and pension plan contributions — for IRPF. */
interface PersonRentas {
  /** Other renta general: imputación de rentas inmobiliarias */
  otras: number;
  rcm: number;
  ganancias: number;
  /** Rendimientos íntegros del trabajo: salaries, pensions, pension plan payouts */
  trabajo: number;
  /** The employee's cotizaciones on the salaries in trabajo */
  cotizaciones: number;
  ppi: number;
  ppes: number;
}

const emptyRentas = (): PersonRentas => ({
  otras: 0,
  rcm: 0,
  ganancias: 0,
  trabajo: 0,
  cotizaciones: 0,
  ppi: 0,
  ppes: 0,
});

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

/**
 * Withdrawal order: from the plan (accounts not listed are never touched) or cash → fondos →
 * brokerage → pension plans. Money held for a loan goal is never in it.
 */
export function withdrawalOrder(plan: Plan, accounts: Account[]): Account[] {
  if (plan.withdrawalOrder.length) {
    return plan.withdrawalOrder
      .map((id) => accounts.find((a) => a.id === id))
      .filter((a): a is Account => a !== undefined);
  }
  return accounts.filter((a) => !a.id.startsWith('goal:')).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
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

/**
 * Runs the plan year by year. filing defaults to the plan's; the other one is for comparing returns.
 * market — returns and inflation of every plan year; defaults to the plan's expected ones.
 * monthYears — how many first plan years to keep month by month in the result.
 */
export function runPlan(
  plan: Plan,
  start: StartingPoint,
  filing: Filing = plan.filing,
  market?: MarketYear[],
  monthYears = 0,
): PlanResult {
  if (filing === 'joint' && plan.people.length !== 2) {
    throw new Error('Joint filing needs two people');
  }
  const n = plan.people.length;
  const years = endYear(plan) - plan.startYear + 1;
  const path = market ?? constantPath(plan, years);
  if (path.length < years) throw new Error(`Market path has ${path.length} years, the plan ${years}`);
  const levels = priceLevels(path);
  const level = (y: number) => priceLevelAt(levels, plan.inflation, y - plan.startYear);
  const rows: LedgerRow[] = [];
  let carries: Carry[] = plan.people.map(() => ({}));
  let jointCarry: Carry = {};
  let accounts = start.accounts.map(cloneAccount);
  const properties = (start.properties ?? []).map((p) => ({ ...p }));
  const loans = (start.loans ?? []).map((l) => ({ ...l }));
  const otherAssets =
    start.netWorth -
    start.accounts.reduce((s, a) => s + accountValue(a), 0) -
    propertiesValue(properties) +
    loansBalance(loans);
  let sinkId = accounts.find((a) => a.kind === 'cash')?.id;
  if (sinkId === undefined) {
    sinkId = SINK_ID;
    accounts.push({ id: SINK_ID, name: 'Cash', kind: 'cash', owner: 'joint', cash: 0, positions: [] });
  }
  const sink = () => accounts.find((a) => a.id === sinkId)!;
  // Money a loan goal keeps until a prepayment: cash apart from the rest.
  for (const g of plan.goals) {
    if (holds(g)) accounts.push({ id: heldId(g), name: `${g.name} · held`, kind: 'cash', owner: 'joint', cash: 0, positions: [] });
  }
  const goalLoans = new Set(plan.goals.flatMap((g) => (g.kind === 'loan' ? [g.loanId] : [])));
  /** Goals saving for the down payment of a purchase, with it */
  const purchaseGoals = plan.goals.flatMap((g) => {
    if (g.kind !== 'account' || g.target?.kind !== 'purchase') return [];
    const { purchaseId } = g.target;
    const pp = plan.propertyPurchases.find((x) => x.id === purchaseId);
    return pp ? [{ goal: g, pp }] : [];
  });
  /** Goals whose purchase has happened */
  const bought = new Set<string>();
  const downPayments: DownPaymentPaid[] = [];
  const reached = new Map<string, number>();
  let lastRuleWithdrawal: number | null = null;
  const nextYear = plan.taxPayment === 'nextYear';
  /** The renta of last year: paid (> 0) or refunded (< 0) this year */
  let settlement = nextYear ? plan.priorYearTax : 0;
  const hasSavings = plan.goals.length > 0 || plan.savings.length > 0;
  const months: MonthRow[] = [];
  const goalsReached = new Map<string, Reached>();

  for (let year = plan.startYear; year <= endYear(plan); year++) {
    const t = year - plan.startYear;
    const m = path[t];
    const rules = planRules(plan, year, level);
    const deflator = levels[t];
    const ages = plan.people.map((p) => year - p.birthYear);
    const prev = rows.at(-1);
    const reachedNow = reachMilestones(plan, year, prev ? prev.netWorth / prev.deflator : start.netWorth, reached);

    const portfolio = Math.max(accounts.reduce((s, a) => s + accountValue(a), 0), 0);
    const rule = plan.spending;
    const ruleWithdrawal: number | null =
      rule.kind !== 'planned' && isActive(rule.start, null, year, plan, reached)
        ? spendingRuleWithdrawal(rule, portfolio, lastRuleWithdrawal, m.inflation)
        : null;
    lastRuleWithdrawal = ruleWithdrawal;
    // The year's money by month (engine/calendar.ts), when the months are needed: savings go month
    // by month. What comes in is added, what goes out subtracted.
    const cal = hasSavings || t < monthYears ? new Array<number>(12).fill(0) : null;
    const toMonths = (amount: number, calendar: Calendar) => cal && spread(cal, amount, calendar);
    /** When work income is paid: the retenciones on it follow */
    const workMonths = cal ? new Array<number>(12).fill(0) : null;
    const toWork = (amount: number, calendar: Calendar) => {
      toMonths(amount, calendar);
      if (workMonths) spread(workMonths, amount, calendar);
    };

    // Account income — on start-of-year value, then price growth.
    const base = plan.people.map(emptyRentas);
    let investmentIncome = 0;
    let marketGrowth = 0;
    const growthOf = cal ? new Map<string, number>() : null;
    for (const a of accounts) {
      const value = accountValue(a);
      let income = 0;
      if (a.kind === 'cash') income = Math.max(a.cash, 0) * m.cashInterest;
      else if (a.kind === 'brokerage') {
        income = (value - a.cash) * m.brokerageYield;
        grow(a, m.brokerageGrowth);
      } else grow(a, a.kind === 'fund' ? m.fundGrowth : m.pensionGrowth);
      growthOf?.set(a.id, accountValue(a) - value);
      marketGrowth += accountValue(a) - value;
      investmentIncome += income;
      ownerShares(a.owner, n).forEach((s, i) => (base[i].rcm += income * s));
    }
    toMonths(investmentIncome, EVEN);

    // Autónomo income and RETA; public pensions are rendimientos del trabajo.
    const acts = plan.people.map((p) => {
      const inc = p.autonomo;
      if (!inc || !isActive(inc.start, inc.end, year, plan, reached)) return null;
      const inYear = (value: number, part: 'revenue' | 'expenses') =>
        amountInYear(value, inc.per, autonomoGrowth(inc, part, plan.inflation), t, deflator);
      return actividad(inYear(inc.revenue, 'revenue'), inYear(inc.expenses, 'expenses'), rules);
    });
    const pensions = plan.people.map((p) =>
      p.pension && isActive(p.pension.start, null, year, plan, reached)
        ? amountInYear(p.pension.amount, p.pension.per, p.pension.growth, t, deflator)
        : 0,
    );
    pensions.forEach((v, i) => {
      base[i].trabajo += v;
      toWork(v, PUBLIC_PENSION);
    });

    // Other and one-time incomes of the people; one-time expenses join the household expenses below.
    const wages = new Array<number>(n).fill(0);
    let gainIncome = 0;
    let exemptIncome = 0;
    let oneTimeEssential = 0;
    let oneTimeDiscretionary = 0;
    const addIncome = (i: number, tax: IncomeTax, amount: number, calendar: Calendar) => {
      if (i >= n) return; // a person no longer in the plan
      if (tax === 'trabajo') {
        wages[i] += amount;
        toWork(amount, calendar);
        return;
      }
      toMonths(amount, calendar);
      if (tax === 'ganancia') {
        base[i].ganancias += amount;
        gainIncome += amount;
      } else exemptIncome += amount;
    };
    for (const inc of plan.incomes) {
      if (isActive(inc.start, inc.end, year, plan, reached)) {
        const calendar = inc.tax === 'trabajo' ? salary(inc.pagas) : EVEN;
        addIncome(inc.person, inc.tax, amountInYear(inc.amount, inc.per, inc.growth, t, deflator), calendar);
      }
    }
    for (const e of plan.oneTime) {
      if (!occursIn(e, year, plan, reached)) continue;
      const amount = e.nominal ? e.amount : e.amount * deflator;
      const calendar = monthOrEven(e.month);
      if (e.type === 'income') addIncome(e.person, e.tax, amount, calendar);
      else if (e.kind === 'essential') {
        oneTimeEssential += amount;
        toMonths(-amount, calendar);
      } else {
        oneTimeDiscretionary += amount;
        if (ruleWithdrawal === null) toMonths(-amount, calendar);
      }
    }
    const contributions = wages.map((w) => cotizacionTrabajador(w, rules.cotizacion));
    toMonths(-contributions.reduce((s, c) => s + c, 0), EVEN);
    wages.forEach((w, i) => {
      base[i].trabajo += w;
      base[i].cotizaciones = contributions[i];
    });

    // Loans of loan goals are paid month by month with the savings — unless their home is sold
    // this year: the sale repays them.
    let monthlyLoans: Loan[] = [];
    if (goalLoans.size) {
      const sold = new Set(
        plan.propertySales.filter((s) => timingYear(s.timing, plan, reached) === year).map((s) => s.propertyId),
      );
      monthlyLoans = loans.filter((l) => goalLoans.has(l.id) && !(l.propertyId && sold.has(l.propertyId)));
    }
    const re = realEstateYear(plan, year, rules, properties, loans, reached, ages, m, level, new Set(monthlyLoans.map((l) => l.id)), cal);
    re.imputedRent.forEach((v, i) => (base[i].otras += v));
    re.rentalIncome.forEach((v, i) => (base[i].otras += v));
    re.gains.forEach((g, i) => (base[i].ganancias += g));
    const personas: Persona[] = plan.people.map((p, i) => ({
      edad: ages[i],
      discapacidad: p.disability,
      asistencia: false,
    }));

    // Household expenses. Under a spending rule the planned discretionary expenses give way to what
    // the rule leaves (below).
    let essential = oneTimeEssential;
    let discretionary = ruleWithdrawal === null ? oneTimeDiscretionary : 0;
    for (const e of plan.expenses) {
      if (!isActive(e.start, e.end, year, plan, reached)) continue;
      const amount = amountInYear(e.amount, e.per, e.growth, t, deflator);
      if (e.kind === 'essential') essential += amount;
      else if (ruleWithdrawal === null) discretionary += amount;
      else continue;
      toMonths(-amount, EVEN);
    }

    const people: PersonYear[] = acts.map((act, i) => ({
      age: ages[i],
      revenue: act?.ingresos ?? 0,
      businessExpenses: act?.gastos ?? 0,
      cuotaReta: act?.cuota_reta ?? 0,
      retaTramo: act ? retaLabel(rules.reta.tramos[act.reta_tramo]) : null,
      rendimientoNeto: act?.rendimiento_neto ?? 0,
      publicPension: pensions[i],
      wages: wages[i],
      employeeContributions: contributions[i],
      marginalGeneral: 0,
      marginalAhorro: 0,
    }));
    const sum = (f: (p: PersonYear) => number) => people.reduce((s, p) => s + f(p), 0);
    const revenue = sum((p) => p.revenue);
    const businessExpenses = sum((p) => p.businessExpenses);
    const reta = sum((p) => p.cuotaReta);
    const publicPension = sum((p) => p.publicPension);
    const wagesTotal = sum((p) => p.wages);
    const employeeContributions = sum((p) => p.employeeContributions);
    toMonths(revenue - businessExpenses - reta, EVEN);
    let cf0 =
      revenue -
      businessExpenses -
      reta +
      publicPension +
      wagesTotal -
      employeeContributions +
      gainIncome +
      exemptIncome -
      essential -
      discretionary +
      investmentIncome +
      realEstateCash(re);

    const tax = (extra: PersonRentas[]) =>
      taxYear(plan, year, rules, filing, personas, acts, extra, carries, jointCarry);
    const withDrawdown = (d: Drawdown) =>
      base.map((b, i) => ({ ...b, ganancias: b.ganancias + d.ganancias[i], trabajo: b.trabajo + d.trabajo[i] }));
    let taxed = tax(base);
    // IRPF paid in the year. nextYear: the pagos a cuenta — modelo 130 on the activity and the
    // retenciones on work income (the tax it adds to the rest) — plus last year's renta; they do not
    // change with this year's withdrawals and contributions, whose tax goes with the renta.
    let onAccount = 0;
    let pagos130 = 0;
    let retenciones = 0;
    if (nextYear) {
      pagos130 = acts.reduce((s, a) => s + rules.actividad.pago_fraccionado * Math.max(a?.rendimiento_neto ?? 0, 0), 0);
      const withoutWork = base.map((b) => ({ ...b, trabajo: 0, cotizaciones: 0 }));
      retenciones = base.some((b) => b.trabajo > 0) ? Math.max(taxed.irpf - tax(withoutWork).irpf, 0) : 0;
      onAccount = pagos130 + retenciones;
    }
    const cashTax = (t: TaxYear) => (nextYear ? settlement + onAccount : t.irpf);
    if (ruleWithdrawal !== null) {
      // Discretionary = income + the rule's withdrawal − costs − essential − taxes (with the tax on
      // that withdrawal), not below 0. The withdrawal itself happens below as for any deficit.
      // Loans paid month by month are not in cf0 yet: their payments as scheduled count.
      const scheduled = monthlyLoans.reduce((sum, l) => {
        const c = { ...l };
        for (let k = 0; k < 12; k++) {
          const a = amortizeMonth(c);
          sum += a.interest + a.principal;
        }
        return sum;
      }, 0);
      const d = drawdown(plan, withdrawalOrder(plan, accounts.map(cloneAccount)), ruleWithdrawal, ages);
      discretionary = Math.max(cf0 - scheduled + d.raised - cashTax(tax(withDrawdown(d))), 0);
      cf0 -= discretionary;
      toMonths(-discretionary, EVEN);
    }
    let realizedGains = 0;
    let pensionContributions = 0;
    let pensionWithdrawals = 0;
    const deposits = emptyBalances();
    let withdrawals = emptyBalances();
    const sales: AccountSale[] = [];
    let shortfall = 0;
    const prevision = rules.reducciones.prevision_social;
    /** Deductible room of each person's pension plan contributions, worked out when first needed */
    let roomOf: PensionRoom[] | null = null;
    const room = () =>
      (roomOf ??= acts.map((act, i) => {
        const b = base[i];
        const rn = act?.rendimiento_neto ?? 0;
        const otras = rn + b.otras + b.rcm + b.ganancias;
        const trabajo = rendimientoTrabajo(b.trabajo, otras, rules.reducciones.trabajo, b.cotizaciones);
        return {
          general: prevision.limite_general,
          incremento: act ? prevision.incremento_autonomo : 0,
          // 30 % of rendimientos netos del trabajo + actividades (art. 52.1.a LIRPF)
          tope: prevision.porcentaje_rendimientos * Math.max(rn + trabajo.neto_reducido, 0),
        };
      }));

    // Savings by goals, month by month, before the flows; loans of loan goals are paid there.
    // Contributions to pension plans lower the year's IRPF; the saving comes with the year's rest,
    // not in the months.
    let saved = 0;
    let savings: SavingsYear | null = null;
    let fromHeld = 0;
    /** Paid out of goals towards purchases, and the gain on what they sold for it */
    let fromGoals = 0;
    let goalSales: Balances | null = null;
    let goalGains = 0;
    const goalSold: AccountSale[] = [];
    const goalGainOf = new Array<number>(n).fill(0);
    if (cal) {
      const downPaymentOf = (id: string) => {
        const pp = plan.propertyPurchases.find((x) => x.id === id)!;
        return downPayment(purchaseAmounts(pp, rules.inmuebles, level(year)));
      };
      const due: DownPaymentDue[] = purchaseGoals
        .filter(({ goal, pp }) => !bought.has(goal.id) && timingYear(pp.timing, plan, reached) === year)
        .map(({ goal, pp }) => ({ goalId: goal.id, month: pp.month ?? 12, needed: downPaymentOf(pp.id) }));
      // The IRPF paid in the months: withheld with the work income and modelo 130 by quarters, the
      // renta in June (60/40 with November); in its year — spread over it.
      if (nextYear) {
        toMonths(-pagos130, MODELO_130);
        toMonths(-retenciones, weightsOf(workMonths!));
        toMonths(-settlement, settlement > 0 ? renta(plan.renta === 'split') : inMonth(6));
      } else toMonths(-taxed.irpf, EVEN);
      const sv = savingsYear({
        plan,
        year,
        reached,
        freeMoney: cal,
        accounts,
        sink: sink(),
        growth: growthOf!,
        room: (a) => (a.kind === 'ppi' || a.kind === 'ppes' ? roomFor(a.kind, room()[pensionOwner(a.owner, n)]) : Infinity),
        put: (a, x) => {
          deposits[balanceKey(a.kind)] += x;
          if (a.kind === 'ppi' || a.kind === 'ppes') {
            const i = pensionOwner(a.owner, n);
            useRoom(a.kind, room()[i], x);
            base[i][a.kind] += x;
            pensionContributions += x;
          }
        },
        loans: monthlyLoans,
        target: (g) => (g.target === null ? null : g.target.kind === 'amount' ? g.target.amount : downPaymentOf(g.target.purchaseId)),
        purchases: due,
        bought,
        take: (a, x) => {
          if (isPension(a.kind) || x <= 0) return 0;
          const s = withdraw(a, x);
          goalSales ??= emptyBalances();
          goalSales[balanceKey(a.kind)] += s.proceeds;
          const gain = a.kind === 'cash' ? 0 : s.proceeds - s.cost;
          if (gain !== 0) {
            ownerShares(a.owner, n).forEach((sh, i) => {
              base[i].ganancias += gain * sh;
              goalGainOf[i] += gain * sh;
            });
            goalGains += gain;
          }
          goalSold.push({ accountId: a.id, name: a.name, kind: a.kind, reason: 'downPayment', proceeds: s.proceeds, taxable: gain, tax: 0 });
          return s.proceeds;
        },
        firstReached: goalsReached,
        record: t < monthYears,
      });
      months.push(...sv.months);
      saved = sv.year.saved;
      downPayments.push(...sv.downPayments);
      fromGoals = sv.downPayments.reduce((s, x) => s + x.paid, 0);
      for (const x of due) bought.add(x.goalId);
      const l = sv.loans;
      re.loanInterest += l.interest;
      re.loanPrincipal += l.principal;
      re.loanPrepaid += l.prepaid;
      re.prepaymentFees += l.fees;
      cf0 -= l.interest + l.principal;
      fromHeld = l.fromHeld;
      if (hasSavings) savings = sv.year;
      if (goalGains !== 0) {
        // The tax the down payments' sales add: all of it by their gains.
        const without = tax(base.map((b, i) => ({ ...b, ganancias: b.ganancias - goalGainOf[i] })));
        taxed = tax(base);
        splitTax(goalSold, taxed.irpf - without.irpf, 0);
      } else if (pensionContributions > 0) taxed = tax(base);
    }
    // What the year has for flows after the savings (and with what goals paid towards purchases):
    // all of it without goals.
    const cfRest = cf0 - saved + fromGoals;

    if (cfRest - cashTax(taxed) >= 0) {
      // Surplus → flows in order; the rest and the tax saving from contributions → cash.
      const withContrib = base.map((b) => ({ ...b }));
      let flowContributions = 0;
      let budget = cfRest - cashTax(taxed);
      for (const f of plan.flows) {
        if (budget <= 0) continue;
        if (isPrepay(f)) {
          // Amortización anticipada at the end of the year; the fee comes on top.
          const l = loans.find((x) => x.id === f.loanId);
          if (!l || l.balance <= 0 || !isActive(null, f.until, year, plan, reached)) continue;
          const want = f.mode === 'fixed' ? f.amount * deflator : f.mode === 'percent' ? budget * f.amount : l.balance;
          const x = Math.min(want, l.balance, budget / (1 + f.fee));
          prepayLoan(l, x, f.effect);
          re.loanPrepaid += x;
          re.prepaymentFees += x * f.fee;
          budget -= x * (1 + f.fee);
          continue;
        }
        const a = accounts.find((x) => x.id === f.accountId);
        if (!a) continue;
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
          want = Math.min(want, roomFor(a.kind, room()[i]));
          useRoom(a.kind, room()[i], Math.min(want, budget));
          withContrib[i][a.kind] += Math.min(want, budget);
          pensionContributions += Math.min(want, budget);
          flowContributions += Math.min(want, budget);
        }
        const c = Math.min(want, budget);
        deposit(a, c, `${year}-12-31`);
        deposits[balanceKey(a.kind)] += c;
        budget -= c;
      }
      // The goals' contributions are in the tax already; the flows' lower it now.
      if (flowContributions > 0) {
        const after = tax(withContrib);
        budget += cashTax(taxed) - cashTax(after);
        taxed = after;
      }
      sink().cash += budget;
      deposits.cash += budget;
    } else {
      // Deficit → withdrawals in order. Sales and pension payouts add tax, so the amount to
      // withdraw is the fixed point x = tax(x) − cf0. Plain steps x → tax(x) − cf0 converge
      // monotonically from below, at the rate of the marginal tax. The tax is piecewise linear in
      // x, so the secant through the last two points usually lands on the fixed point at once; a
      // secant step that goes past it is replaced by the plain step.
      let x = cashTax(taxed) - cfRest;
      let trial = accounts;
      let raised = 0;
      let need = x;
      /** The last point below the fixed point and how far below it was */
      let below: { x: number; gap: number } | null = null;
      let secant = false;
      const before = taxed;
      let last: Drawdown | null = null;
      for (let iter = 0; iter < 100; iter++) {
        trial = accounts.map(cloneAccount);
        const d = drawdown(plan, withdrawalOrder(plan, trial), x, ages);
        last = d;
        taxed = tax(withDrawdown(d));
        raised = d.raised;
        withdrawals = d.byKind;
        realizedGains = d.ganancias.reduce((s, g) => s + g, 0);
        pensionWithdrawals = d.trabajo.reduce((s, g) => s + g, 0);
        need = cashTax(taxed) - cfRest;
        if (secant && need - raised < -1e-7) {
          x = below!.x + below!.gap;
          secant = false;
          continue;
        }
        if (raised < x - 1e-9 || need - raised < 1e-7) break;
        const gap = need - x;
        secant = below !== null && below.gap - gap > 1e-9;
        const next = secant ? x + (gap * (x - below!.x)) / (below!.gap - gap) : need;
        below = { x, gap };
        x = next;
      }
      accounts = trial;
      if (last) {
        // What the sales add to the IRPF: the part of pension plan payouts, the rest from gains.
        const all = taxed.irpf - before.irpf;
        const payouts = last.byAccount.some((s) => isPension(s.kind) && s.proceeds > 0);
        const gains = last.byAccount.some((s) => s.kind !== 'cash' && !isPension(s.kind) && s.taxable !== 0);
        const fromPayouts =
          payouts && gains
            ? tax(base.map((b, i) => ({ ...b, trabajo: b.trabajo + last!.trabajo[i] }))).irpf - before.irpf
            : payouts
              ? all
              : 0;
        splitTax(last.byAccount, all - fromPayouts, fromPayouts);
        sales.push(...last.byAccount.filter((s) => s.proceeds > 0));
      }
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
    const paid = cashTax(taxed);
    const owed = nextYear ? taxed.irpf - onAccount : 0;
    const irpfRefund = nextYear ? Math.max(-settlement, 0) : 0;
    settlement = owed;

    // Prepayments out of the money held for loan goals; down payments out of goals.
    withdrawals.cash += fromHeld;
    if (goalSales) for (const k of ['cash', 'fund', 'brokerage'] as const) withdrawals[k] += goalSales[k];
    sales.push(...goalSold);
    realizedGains += goalGains;
    const balances = emptyBalances();
    for (const a of accounts) balances[balanceKey(a.kind)] += accountValue(a);
    // A goal's balance at the end of the year: after the flows and withdrawals.
    for (const g of plan.goals) {
      if (!savings) break;
      const y = savings.goals[g.id];
      if (g.kind === 'loan') {
        y.balance = loans.find((x) => x.id === g.loanId)?.balance ?? 0;
        continue;
      }
      const a = accounts.find((x) => x.id === g.accountId);
      y.balance = a ? accountValue(a) : 0;
    }
    const d = taxed.declaraciones;
    // Marginal rates: of each person's return, or of the joint one for both.
    people.forEach((p, i) => {
      const m = marginalRates(d[filing === 'joint' ? 0 : i], rules);
      p.marginalGeneral = m.general;
      p.marginalAhorro = m.ahorro;
    });
    const income =
      revenue +
      wagesTotal +
      publicPension +
      investmentIncome +
      pensionWithdrawals +
      re.rent +
      gainIncome +
      Math.max(realizedGains, 0) +
      re.gains.reduce((s, g) => s + Math.max(g, 0), 0);
    rows.push({
      year,
      people,
      revenue,
      businessExpenses,
      reta,
      publicPension,
      wages: wagesTotal,
      employeeContributions,
      gainIncome,
      exemptIncome,
      irpfEstatal: d.reduce((s, x) => s + x.cuota_liquida.estatal, 0),
      irpfAutonomica: d.reduce((s, x) => s + x.cuota_liquida.autonomica, 0),
      irpf: taxed.irpf,
      irpfPaid: paid + irpfRefund,
      irpfRefund,
      taxOwed: owed,
      effectiveRate: income > 0 ? taxed.irpf / income : 0,
      baseLiquidableGeneral: d.reduce((s, x) => s + x.base_liquidable_general, 0),
      baseLiquidableAhorro: d.reduce((s, x) => s + x.base_liquidable_ahorro, 0),
      essentialExpenses: essential,
      discretionaryExpenses: discretionary,
      investmentIncome,
      realizedGains,
      pensionContributions,
      pensionWithdrawals,
      netCashFlow: cf0 - paid,
      deposits,
      withdrawals,
      sales,
      shortfall,
      ruleWithdrawal,
      marketGrowth,
      balances,
      propertyValue: propertiesValue(properties),
      loanBalance: loansBalance(loans),
      realEstate: re,
      cash: balances.cash,
      otherAssets,
      netWorth: totalOf(balances) + propertiesValue(properties) - loansBalance(loans) + otherAssets - owed,
      deflator,
      milestones: reachedNow.map((m) => m.id),
      savings,
    });
  }
  return {
    filing,
    rows,
    milestoneYears: Object.fromEntries(reached),
    months,
    goalsReached: Object.fromEntries(goalsReached),
    downPayments,
  };
}

/**
 * Tax rules for the year under the plan's policy for years after the last known rules.
 * level — price level of a calendar year.
 */
function planRules(plan: Plan, year: number, level: (year: number) => number): IrpfRules {
  const known = rulesForYear(year);
  if (plan.taxRules === 'frozen' || year <= known.year) return known;
  return indexRules(known, level(year) / level(known.year));
}

/**
 * What a spending rule lets the portfolio give this year (nominal).
 * @param last the rule's amount last year; null — the rule starts this year
 */
export function spendingRuleWithdrawal(
  rule: Exclude<SpendingRule, { kind: 'planned' }>,
  portfolio: number,
  last: number | null,
  inflation: number,
): number {
  if (rule.kind === 'percent' || last === null) return rule.rate * portfolio;
  // Guyton–Klinger guardrails on the inflation-adjusted amount.
  const w = last * (1 + inflation);
  const current = portfolio > 0 ? w / portfolio : Infinity;
  if (current > rule.rate * (1 + rule.guardrail)) return w * (1 - rule.adjustment);
  if (current < rule.rate * (1 - rule.guardrail)) return w * (1 + rule.adjustment);
  return w;
}

interface Drawdown {
  raised: number;
  byKind: Balances;
  /** Each account's sale, its tax not split yet */
  byAccount: AccountSale[];
  ganancias: number[];
  trabajo: number[];
}

/**
 * Splits the tax the sales add over them: gains by the accounts' gains, pension plan payouts by the
 * payouts. Writes each sale's tax.
 */
function splitTax(sales: AccountSale[], onGains: number, onPayouts: number): void {
  const share = (xs: AccountSale[], total: number) => {
    // A tax is shared by the sales that add it: gains when it is positive, losses when negative.
    const part = (s: AccountSale) => (total >= 0 ? Math.max(s.taxable, 0) : Math.min(s.taxable, 0));
    const sum = xs.reduce((acc, s) => acc + part(s), 0);
    for (const s of xs) s.tax = sum !== 0 ? (total * part(s)) / sum : 0;
  };
  share(sales.filter((s) => s.kind !== 'cash' && !isPension(s.kind)), onGains);
  share(sales.filter((s) => isPension(s.kind)), onPayouts);
}

/** Takes amount out of accounts in order; gains and pension payouts per person. */
function drawdown(plan: Plan, order: Account[], amount: number, ages: number[]): Drawdown {
  const n = plan.people.length;
  const out: Drawdown = {
    raised: 0,
    byKind: emptyBalances(),
    byAccount: [],
    ganancias: new Array(n).fill(0),
    trabajo: new Array(n).fill(0),
  };
  const sold = (a: Account, proceeds: number, taxable: number) =>
    out.byAccount.push({ accountId: a.id, name: a.name, kind: a.kind, reason: 'deficit', proceeds, taxable, tax: 0 });
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
      sold(a, s.proceeds, s.proceeds);
      continue;
    }
    const s = withdraw(a, left);
    out.raised += s.proceeds;
    out.byKind[balanceKey(a.kind)] += s.proceeds;
    if (a.kind !== 'cash') {
      ownerShares(a.owner, n).forEach((sh, i) => (out.ganancias[i] += (s.proceeds - s.cost) * sh));
    }
    sold(a, s.proceeds, a.kind === 'cash' ? 0 : s.proceeds - s.cost);
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
    cotizaciones_trabajo: e.cotizaciones,
    otras_rentas_general: e.otras,
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

/**
 * IRPF on the next euro of each base, estatal + autonómica. The mínimo is taxed at the scale too
 * and subtracted (art. 63 LIRPF): while a base is within the mínimo left for it, the next euro costs
 * nothing.
 */
export function marginalRates(d: IrpfAnual, rules: IrpfRules): { general: number; ahorro: number } {
  const blg = d.base_liquidable_general;
  const bla = d.base_liquidable_ahorro;
  let general = 0;
  let ahorro = 0;
  for (const half of ['estatal', 'autonomica'] as const) {
    const minimo = d.minimo[half];
    if (blg >= minimo) general += marginalRate(rules[half].general, blg);
    if (bla >= Math.max(minimo - blg, 0)) ahorro += marginalRate(rules[half].ahorro, bla);
  }
  return { general, ahorro };
}

function retaLabel(t: { tabla: string; tramo: number }): string {
  return `${t.tabla} ${t.tramo}`;
}
