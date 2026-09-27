// Plan model: household, autónomo income, expenses; since phase 2 — account returns, surplus
// flows and withdrawal order; since phase 3 — milestones, event timing, public pension; since
// phase 4 — equity shares and Monte Carlo settings; since phase 5 — the period and the change over
// time of event amounts, other incomes and one-time events; since phase 6 — savings goals and the
// monthly savings schedule. The Zod
// schema validates the plan read from storage: old or broken JSON must not silently turn into
// zeros. New fields have defaults or are optional, and old ones are upgraded (upgradeLegacy), so
// plans of earlier phases load without migration.
import { z } from 'zod';
import { OwnerSchema } from './accounts';

const money = z.number().finite().min(0);
const rate = z.number().finite().min(-0.5).max(0.5);
/** A month of the year, 1 — January */
const monthOfYear = z.number().int().min(1).max(12);
const year = z.number().int().min(1900).max(2200);
const age = z.number().int().min(0).max(120);
/** Index of a person in the plan */
const person = z.number().int().min(0).max(1);

/**
 * A point in the plan: a calendar year, the year a person reaches an age, or the year a milestone
 * is reached. An event is active from its start year up to, not including, its end year.
 */
export const TimingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('year'), year }),
  z.object({ kind: z.literal('age'), person, age }),
  z.object({ kind: z.literal('milestone'), id: z.string().min(1) }),
]);

/**
 * A named point in the plan that events start or stop at. year and age are reached in that year;
 * netWorth — in the first year whose start net worth (the previous year's end, in first-year
 * euros) is at least amount. A milestone is reached once.
 */
export const MilestoneSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  trigger: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('year'), year }),
    z.object({ kind: z.literal('age'), person, age }),
    z.object({ kind: z.literal('netWorth'), amount: money }),
  ]),
});

/**
 * The period an amount is entered for. The plan keeps it, so the editor shows the amount as
 * entered; the engine turns it into an amount per year.
 */
export const PeriodSchema = z.enum(['year', 'quarter', 'month']);

export const PERIODS_PER_YEAR: Record<Period, number> = { year: 1, quarter: 4, month: 12 };

/**
 * How an amount changes over time from the plan's first year. inflation — follows each year's
 * inflation plus a real growth (real 0 — constant in first-year euros); nominal — a constant
 * nominal growth whatever the inflation (rate 0 — a fixed nominal amount: a rent by contract, a
 * subscription).
 */
export const GrowthSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inflation'), real: rate }),
  z.object({ kind: z.literal('nominal'), rate }),
]);

/** Grows with inflation: constant in first-year euros. Amounts without a growth change so. */
export const WITH_INFLATION: Growth = { kind: 'inflation', real: 0 };

export const AutonomoIncomeSchema = z.object({
  /** Facturación per period in first-year prices */
  revenue: money,
  /** Deductible business expenses excluding the RETA cuota, per period in first-year prices */
  expenses: money,
  /** Period of revenue and expenses; absent — per year */
  per: PeriodSchema.optional(),
  /**
   * Phases 1–4: nominal growth of revenue and expenses per year at the plan's inflation; in
   * years with other inflation (Monte Carlo) they keep the same real growth. Revenue and expenses
   * without their own growth change so (autonomoGrowth).
   */
  growth: rate,
  revenueGrowth: GrowthSchema.optional(),
  expensesGrowth: GrowthSchema.optional(),
  /** null — from the plan's first year */
  start: TimingSchema.nullable(),
  /** null — until the end of the plan */
  end: TimingSchema.nullable(),
});

/**
 * Seguridad Social pension: an input amount (from the SS report), not computed. Grows with
 * inflation by default (revalorización by IPC); taxed as rendimientos del trabajo.
 */
export const PublicPensionSchema = z.object({
  /** Gross per period in first-year prices */
  amount: money,
  /** Absent — per year */
  per: PeriodSchema.optional(),
  /** Absent — with inflation */
  growth: GrowthSchema.optional(),
  start: TimingSchema,
});

/**
 * How an income is taxed. trabajo — a salary (nómina): the salario bruto from the contract, a
 * rendimiento del trabajo after the employee's cotizaciones; ganancia — a gain in the savings base
 * (enter the gain, not the proceeds); exento — not in IRPF (herencia, donación: Sucesiones y
 * Donaciones is not modelled).
 */
export const IncomeTaxSchema = z.enum(['trabajo', 'ganancia', 'exento']);

/** A recurring income of a person besides the autónomo activity and the SS pension. */
export const IncomeSchema = z.object({
  name: z.string().min(1).max(60),
  person,
  tax: IncomeTaxSchema,
  /** Per period in first-year prices */
  amount: money,
  /** Absent — per year */
  per: PeriodSchema.optional(),
  /** Absent — with inflation */
  growth: GrowthSchema.optional(),
  /** A salary's payments a year: 14 — with the pagas extra of June and December; absent — 12 */
  pagas: z.union([z.literal(12), z.literal(14)]).optional(),
  /** null — from the plan's first year */
  start: TimingSchema.nullable(),
  /** null — until the end of the plan */
  end: TimingSchema.nullable(),
});

const oneTimeFields = {
  name: z.string().min(1).max(60),
  amount: money,
  /** The amount is in nominal euros of the year it happens; otherwise in first-year prices */
  nominal: z.boolean(),
  at: TimingSchema,
  /** The month it happens in; absent — spread over the year */
  month: monthOfYear.optional(),
  /** Again every `every` years from `at`, up to (not including) `until`; null — once */
  repeat: z
    .object({ every: z.number().int().min(1).max(50), until: TimingSchema.nullable() })
    .nullable(),
};

/** An expense or an income that happens in one year, maybe again every few years (a car, a renovation). */
export const OneTimeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('expense'), ...oneTimeFields, kind: z.enum(['essential', 'discretionary']) }),
  z.object({ type: z.literal('income'), ...oneTimeFields, person, tax: IncomeTaxSchema }),
]);

export const PersonSchema = z.object({
  name: z.string().min(1).max(60),
  birthYear: year,
  disability: z.enum(['ninguna', 'grado_33', 'grado_65']),
  autonomo: AutonomoIncomeSchema.nullable(),
  pension: PublicPensionSchema.nullable().default(null),
});

export const ChildSchema = z.object({
  birthYear: year,
});

export const ExpenseSchema = z.object({
  name: z.string().min(1).max(60),
  /** Per period in first-year prices */
  amount: money,
  /** Absent — per year */
  per: PeriodSchema.optional(),
  /** Absent — with inflation */
  growth: GrowthSchema.optional(),
  kind: z.enum(['essential', 'discretionary']),
  /** null — from the plan's first year */
  start: TimingSchema.nullable(),
  /** null — until the end of the plan */
  end: TimingSchema.nullable(),
});

const share = z.number().finite().min(0).max(1);

/**
 * How much the household spends once the rule starts. The rule sets how much the portfolio (all
 * modelled accounts) gives per year; discretionary spending is what the income and that
 * withdrawal leave after essential expenses and taxes, and replaces the planned discretionary
 * expenses. Essential expenses are always paid: they are the floor.
 * planned — no rule, the expense list as is; percent — rate × the start-of-year portfolio;
 * guytonKlinger — starts at rate × portfolio and grows with inflation, then cut by adjustment
 * when it is above rate × (1 + guardrail) of the portfolio, raised by adjustment when below
 * rate × (1 − guardrail).
 */
export const SpendingRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('planned') }),
  z.object({ kind: z.literal('percent'), start: TimingSchema, rate: z.number().finite().min(0).max(0.2) }),
  z.object({
    kind: z.literal('guytonKlinger'),
    start: TimingSchema,
    rate: z.number().finite().min(0).max(0.2),
    guardrail: share,
    adjustment: share,
  }),
]);

/** Nominal expected returns by Spanish account type, fraction per year. */
export const ReturnsSchema = z.object({
  /** Interest on CASH accounts — rendimientos del capital mobiliario */
  cashInterest: rate,
  /** Growth of fondos de inversión (accumulating: no payouts) */
  fundGrowth: rate,
  /** Price growth of ETFs and stocks */
  brokerageGrowth: rate,
  /** Brokerage dividends on start-of-year value */
  brokerageYield: rate,
  /** Growth of planes de pensiones */
  pensionGrowth: rate,
  /** Nominal growth of real estate values */
  propertyGrowth: rate.default(0.02),
});

/**
 * Share of stocks by account type, the rest is bonds: how random and historical years move the
 * type's returns. The deterministic plan does not use it.
 */
export const EquityShareSchema = z.object({
  fund: share,
  brokerage: share,
  pension: share,
});

/** Monte Carlo run: number of trials and the seed that makes it reproducible. */
export const MonteCarloSchema = z.object({
  trials: z.number().int().min(100).max(10_000),
  seed: z.number().int().min(0).max(2 ** 32 - 1),
});

/** Sale of a property from Wealthfolio: at its projected value, less selling costs. */
export const PropertySaleSchema = z.object({
  propertyId: z.string().min(1),
  timing: TimingSchema,
  /** Agency, notary, plusvalía municipal — share of the price */
  costs: share,
});

/**
 * Notaría, registro, gestoría and tasación of a purchase: a share of the price, or an amount in
 * first-year prices.
 */
export const PurchaseCostsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('percent'), rate: z.number().finite().min(0).max(0.2) }),
  z.object({ kind: z.literal('amount'), amount: money }),
]);

/**
 * Purchase of a home. The purchase tax (ITP for a second-hand home, IVA + AJD for a new one) and
 * the costs are paid on top of the price; the mortgage is an annuity from the month after the
 * purchase — without a month, the purchase is at the end of the year and the mortgage is paid from
 * the next one.
 */
export const PropertyPurchaseSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  timing: TimingSchema,
  /** The month of the purchase; absent — the end of the year */
  month: monthOfYear.optional(),
  /** First-year prices */
  price: money,
  /** Absent — none */
  costs: PurchaseCostsSchema.optional(),
  newBuild: z.boolean(),
  habitual: z.boolean(),
  owner: OwnerSchema,
  /** IBI per year from the next year, first-year prices */
  ibi: money,
  /** Comunidad and insurance per year from the next year, first-year prices */
  community: money.optional(),
  insurance: money.optional(),
  /** The months IBI and insurance are paid in; absent — spread over the year */
  ibiMonth: monthOfYear.optional(),
  insuranceMonth: monthOfYear.optional(),
  /** Share of the building in the value, without the land: for the amortización of a rental */
  constructionShare: share.optional(),
  mortgage: z
    .object({
      /** First-year prices */
      amount: money,
      /** The fixed rate; of a mixed mortgage — for its fixed years */
      rate: z.number().finite().min(0).max(0.2),
      years: z.number().int().min(1).max(40),
      /**
       * Absent — fixed. Otherwise Euríbor + diferencial, revised once a year: from the start
       * (fixedYears 0, variable) or after fixedYears at the fixed rate (mixta).
       */
      variable: z
        .object({ diferencial: rate, fixedYears: z.number().int().min(0).max(30) })
        .optional(),
    })
    .nullable(),
});

/**
 * Letting a home out: a Wealthfolio property or one bought in the plan. While it is active the home
 * is rented: no imputación de rentas, and its rendimiento del capital inmobiliario (arts. 22–23
 * LIRPF) goes to the owners' base general. The reducción of art. 23.2 depends on the contract.
 */
export const RentalSchema = z.object({
  /** A Wealthfolio property id or purchase:<purchase id> */
  propertyId: z.string().min(1),
  /** Rent per period in first-year prices */
  amount: money,
  /** Absent — per year */
  per: PeriodSchema.optional(),
  /** Absent — with inflation */
  growth: GrowthSchema.optional(),
  /** Share of the year the home is let */
  occupancy: share,
  /** Repairs and maintenance per year in first-year prices */
  repairs: money,
  reduction: z.enum(['general', 'rehabilitacion', 'joven_o_social', 'rebaja_tensionada', 'anterior_2023']),
  /** null — from the plan's first year (or once the home is bought) */
  start: TimingSchema.nullable(),
  /** null — until the end of the plan (or the sale) */
  end: TimingSchema.nullable(),
});

/**
 * Where the year's surplus goes, in order. max — up to the deductible limit for a pension plan,
 * otherwise the whole rest; fixed — amount per year; percent — share of the rest (amount 0…1);
 * untilBalance — top up to a balance. fixed and untilBalance amounts are in first-year prices.
 * What is left after the flows goes to the first CASH account.
 */
export const AccountFlowSchema = z.object({
  accountId: z.string().min(1),
  mode: z.enum(['max', 'fixed', 'percent', 'untilBalance']),
  amount: money,
});

/**
 * Amortización anticipada of a loan from the surplus: max — the whole rest until the loan is repaid;
 * fixed — amount per year in first-year prices; percent — share of the rest (amount 0…1). The fee is
 * paid on top of the amount prepaid. term — reducir plazo: the payment stays, the loan ends sooner;
 * payment — reducir cuota: the term stays, the payment falls.
 */
export const PrepayFlowSchema = z.object({
  /** A Wealthfolio liability id or mortgage:<purchase id> */
  loanId: z.string().min(1),
  mode: z.enum(['max', 'fixed', 'percent']),
  amount: money,
  effect: z.enum(['term', 'payment']),
  /** Up to, not including; null — until the loan is repaid */
  until: TimingSchema.nullable(),
  /** Comisión por amortización anticipada, share of the amount prepaid */
  fee: z.number().finite().min(0).max(0.05),
});

export const FlowSchema = z.union([AccountFlowSchema, PrepayFlowSchema]);

/** A month of the plan: the calendar year and the month, 1 — January. */
export const YearMonthSchema = z.object({ year, month: z.number().int().min(1).max(12) });

/**
 * Where the monthly savings go. account — into a modelled account; with a target, while its balance
 * is below the target (again once it falls below it), without one — while the goal has an amount
 * in the schedule. A pension plan takes no more than the year's deductible room. loan — amortización
 * anticipada until the loan is repaid. A goal stops receiving from the year of end.
 */
export const AccountGoalSchema = z.object({
  kind: z.literal('account'),
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  accountId: z.string().min(1),
  /**
   * Target balance of the account: an amount in nominal euros, or the down payment of a purchase in
   * the plan — price − mortgage + purchase tax + costs, at the year's prices; the goal pays it at the
   * purchase and ends. null — no target.
   */
  target: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('amount'), amount: money }),
      z.object({ kind: z.literal('purchase'), purchaseId: z.string().min(1) }),
    ])
    .nullable(),
  /** null — never stops */
  end: TimingSchema.nullable(),
});

/**
 * When a loan goal's money goes to the loan: monthly — every month, as saved; threshold — once the
 * money held for it reaches amount (nominal euros); months — in these months of every year. Until
 * then it is held apart: cash in net worth, not touched by the withdrawal order.
 */
export const LoanPrepaySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('monthly') }),
  z.object({ kind: z.literal('threshold'), amount: money }),
  z.object({ kind: z.literal('months'), months: z.array(z.number().int().min(1).max(12)).min(1).max(12) }),
]);

/**
 * Amortización anticipada from the savings, after the month's payment: term — reducir plazo, the
 * payment stays and the loan ends sooner; payment — reducir cuota, the payment falls. The fee is
 * paid on top, out of the goal's money. Reached when the loan is repaid.
 */
export const LoanGoalSchema = z.object({
  kind: z.literal('loan'),
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  /** A Wealthfolio liability id or mortgage:<purchase id> */
  loanId: z.string().min(1),
  effect: z.enum(['term', 'payment']),
  /** Comisión por amortización anticipada, share of the amount prepaid */
  fee: z.number().finite().min(0).max(0.05),
  prepay: LoanPrepaySchema,
  /** null — until the loan is repaid */
  end: TimingSchema.nullable(),
});

export const GoalSchema = z.discriminatedUnion('kind', [AccountGoalSchema, LoanGoalSchema]);

/**
 * Savings from a month on, until the next step: nominal euros a month for each goal id. The
 * month's savings are their sum; a goal that cannot take its amount leaves it to the other goals.
 */
export const SavingsStepSchema = z.object({
  from: YearMonthSchema,
  amounts: z.record(z.string().min(1), money),
});

/** Template values: the user sets their own allocation. */
export const DEFAULT_EQUITY_SHARE: EquityShare = { fund: 1, brokerage: 1, pension: 0.5 };
export const DEFAULT_MONTE_CARLO: MonteCarlo = { trials: 1000, seed: 1 };

export const DEFAULT_RETURNS: Returns = {
  cashInterest: 0.015,
  fundGrowth: 0.06,
  brokerageGrowth: 0.045,
  brokerageYield: 0.015,
  pensionGrowth: 0.05,
  propertyGrowth: 0.02,
};

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Phases 1–2 fields: autónomo untilAge (the year the age is reached has no income) and expense
 * startYear/endYear (both inclusive). They become timings with the same active years.
 */
function upgradeLegacy(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  const people = Array.isArray(raw.people)
    ? raw.people.map((p: unknown, i) => {
        if (!isObject(p) || !isObject(p.autonomo) || !('untilAge' in p.autonomo)) return p;
        const { untilAge, ...income } = p.autonomo;
        return { ...p, autonomo: { ...income, start: null, end: { kind: 'age', person: i, age: untilAge } } };
      })
    : raw.people;
  const expenses = Array.isArray(raw.expenses)
    ? raw.expenses.map((e: unknown) => {
        if (!isObject(e) || !('startYear' in e || 'endYear' in e)) return e;
        const { startYear, endYear, ...rest } = e;
        return {
          ...rest,
          start: startYear == null ? null : { kind: 'year', year: startYear },
          end: endYear == null ? null : { kind: 'year', year: typeof endYear === 'number' ? endYear + 1 : endYear },
        };
      })
    : raw.expenses;
  return { ...raw, people, expenses };
}

const PlanObject = z
  .object({
    version: z.literal(1),
    name: z.string().min(1).max(80),
    startYear: year,
    /** The plan runs until the oldest person reaches endAge */
    endAge: z.number().int().min(1).max(120),
    inflation: rate,
    /** Tributación individual or conjunta; conjunta only for a couple */
    filing: z.enum(['individual', 'joint']),
    people: z.array(PersonSchema).min(1).max(2),
    children: z.array(ChildSchema).max(10),
    expenses: z.array(ExpenseSchema).max(50),
    incomes: z.array(IncomeSchema).max(30).default([]),
    oneTime: z.array(OneTimeSchema).max(50).default([]),
    returns: ReturnsSchema.default(DEFAULT_RETURNS),
    equityShare: EquityShareSchema.default(DEFAULT_EQUITY_SHARE),
    monteCarlo: MonteCarloSchema.default(DEFAULT_MONTE_CARLO),
    flows: z.array(FlowSchema).max(30).default([]),
    /** Wealthfolio account ids; empty — cash → fondos → brokerage → pension plans */
    withdrawalOrder: z.array(z.string().min(1)).max(50).default([]),
    /**
     * Euríbor assumption for variable-rate loans. In Monte Carlo it moves with the cash return:
     * Euríbor + (cash interest of the year − the plan's cash interest).
     */
    euribor: rate.default(0.025),
    /** From this owner age the pension plan is available for withdrawals */
    pensionAccessAge: z.number().int().min(50).max(80).default(65),
    milestones: z.array(MilestoneSchema).max(20).default([]),
    spending: SpendingRuleSchema.default({ kind: 'planned' }),
    /**
     * Tax rules after the last known year: frozen as they are (Spanish thresholds are not indexed
     * automatically) or indexed — money thresholds grow with the plan's inflation.
     */
    taxRules: z.enum(['frozen', 'indexed']).default('frozen'),
    /**
     * When the IRPF is paid. sameYear — all of it in its year (plans before phase 5); nextYear —
     * during the year the pagos a cuenta: modelo 130 of the autónomo and the retenciones on work
     * income, taken equal to the tax that income adds; the rest, or a refund, with the renta the next
     * year. Retenciones on interest, dividends and fund redemptions are not modelled: that tax goes
     * with the renta.
     */
    taxPayment: z.enum(['sameYear', 'nextYear']).default('sameYear'),
    /** The renta of the year before the plan: paid (> 0) or refunded (< 0) in the first year; nextYear only */
    priorYearTax: z.number().finite().min(-1e7).max(1e7).default(0),
    /**
     * When the renta to pay is paid (nextYear): in June, or split — 60 % in June and 40 % in
     * November. A refund comes in June.
     */
    renta: z.enum(['june', 'split']).default('june'),
    propertySales: z.array(PropertySaleSchema).max(10).default([]),
    propertyPurchases: z.array(PropertyPurchaseSchema).max(10).default([]),
    rentals: z.array(RentalSchema).max(10).default([]),
    goals: z.array(GoalSchema).max(20).default([]),
    /** Steps of the monthly savings, in order of their start month */
    savings: z.array(SavingsStepSchema).max(60).default([]),
  })
  .refine((p) => p.filing === 'individual' || p.people.length === 2, {
    message: 'Joint filing needs two people',
    path: ['filing'],
  })
  .superRefine((p, ctx) => {
    const ids = new Set<string>();
    const targets = new Set<string>();
    p.goals.forEach((g, i) => {
      if (ids.has(g.id)) ctx.addIssue({ code: 'custom', message: 'Goal ids must be unique', path: ['goals', i, 'id'] });
      ids.add(g.id);
      const target = g.kind === 'account' ? `account:${g.accountId}` : `loan:${g.loanId}`;
      if (targets.has(target)) {
        ctx.addIssue({ code: 'custom', message: `One goal per ${g.kind}`, path: ['goals', i] });
      }
      targets.add(target);
    });
    p.goals.forEach((g, i) => {
      if (g.kind === 'account' && g.target?.kind === 'purchase') {
        const { purchaseId } = g.target;
        if (!p.propertyPurchases.some((pp) => pp.id === purchaseId)) {
          ctx.addIssue({ code: 'custom', message: `No purchase ${purchaseId}`, path: ['goals', i, 'target'] });
        }
      }
    });
    p.savings.forEach((s, i) => {
      const prev = p.savings[i - 1];
      if (prev && monthIndex(prev.from) >= monthIndex(s.from)) {
        ctx.addIssue({ code: 'custom', message: 'Savings steps must start in later months', path: ['savings', i, 'from'] });
      }
      for (const id of Object.keys(s.amounts)) {
        if (!ids.has(id)) ctx.addIssue({ code: 'custom', message: `No goal ${id}`, path: ['savings', i, 'amounts'] });
      }
    });
  });

export const PlanSchema = z.preprocess(upgradeLegacy, PlanObject);

export type Timing = z.infer<typeof TimingSchema>;
export type Period = z.infer<typeof PeriodSchema>;
export type Growth = z.infer<typeof GrowthSchema>;
export type Milestone = z.infer<typeof MilestoneSchema>;
export type AutonomoIncome = z.infer<typeof AutonomoIncomeSchema>;
export type PublicPension = z.infer<typeof PublicPensionSchema>;
export type SpendingRule = z.infer<typeof SpendingRuleSchema>;
export type PropertySale = z.infer<typeof PropertySaleSchema>;
export type PropertyPurchase = z.infer<typeof PropertyPurchaseSchema>;
export type PurchaseCosts = z.infer<typeof PurchaseCostsSchema>;
export type Rental = z.infer<typeof RentalSchema>;
export type Person = z.infer<typeof PersonSchema>;
export type Child = z.infer<typeof ChildSchema>;
export type Expense = z.infer<typeof ExpenseSchema>;
export type IncomeTax = z.infer<typeof IncomeTaxSchema>;
export type Income = z.infer<typeof IncomeSchema>;
export type OneTime = z.infer<typeof OneTimeSchema>;
export type Returns = z.infer<typeof ReturnsSchema>;
export type EquityShare = z.infer<typeof EquityShareSchema>;
export type MonteCarlo = z.infer<typeof MonteCarloSchema>;
export type AccountFlow = z.infer<typeof AccountFlowSchema>;
export type PrepayFlow = z.infer<typeof PrepayFlowSchema>;
export type Flow = z.infer<typeof FlowSchema>;
export type YearMonth = z.infer<typeof YearMonthSchema>;
export type AccountGoal = z.infer<typeof AccountGoalSchema>;
export type LoanGoal = z.infer<typeof LoanGoalSchema>;
export type LoanPrepay = z.infer<typeof LoanPrepaySchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type SavingsStep = z.infer<typeof SavingsStepSchema>;

export const isPrepay = (f: Flow): f is PrepayFlow => 'loanId' in f;

/** Months since year 0: orders months and counts the months between them. */
export const monthIndex = (m: YearMonth) => m.year * 12 + m.month - 1;
export type Plan = z.infer<typeof PlanSchema>;
export type Filing = Plan['filing'];

/**
 * Change over time of an autónomo's revenue or expenses: their own growth, or else the phases
 * 1–4 growth — nominal at the plan's inflation, that is inflation plus
 * (1 + growth) / (1 + inflation) − 1.
 */
export function autonomoGrowth(inc: AutonomoIncome, part: 'revenue' | 'expenses', inflation: number): Growth {
  const own = part === 'revenue' ? inc.revenueGrowth : inc.expensesGrowth;
  return own ?? { kind: 'inflation', real: (1 + inc.growth) / (1 + inflation) - 1 };
}

/**
 * Base template: amounts are placeholders, the user enters their own. Tests build on it; the page
 * creates plans from newPlan.
 */
export function defaultPlan(startYear: number): Plan {
  return {
    version: 1,
    name: 'My plan',
    startYear,
    endAge: 90,
    inflation: 0.02,
    filing: 'individual',
    people: [
      {
        name: 'Me',
        birthYear: startYear - 40,
        disability: 'ninguna',
        autonomo: {
          revenue: 40_000,
          expenses: 5_000,
          growth: 0.02,
          start: null,
          end: { kind: 'milestone', id: 'retirement' },
        },
        pension: { amount: 15_000, start: { kind: 'age', person: 0, age: 67 } },
      },
    ],
    children: [],
    expenses: [
      {
        name: 'Living',
        amount: 20_000,
        kind: 'essential',
        start: null,
        end: null,
      },
    ],
    incomes: [],
    oneTime: [],
    returns: DEFAULT_RETURNS,
    equityShare: DEFAULT_EQUITY_SHARE,
    monteCarlo: DEFAULT_MONTE_CARLO,
    flows: [],
    withdrawalOrder: [],
    euribor: 0.025,
    pensionAccessAge: 65,
    milestones: [{ id: 'retirement', name: 'Retirement', trigger: { kind: 'age', person: 0, age: 65 } }],
    spending: { kind: 'planned' },
    taxRules: 'frozen',
    taxPayment: 'sameYear',
    priorYearTax: 0,
    renta: 'june',
    propertySales: [],
    propertyPurchases: [],
    rentals: [],
    goals: [],
    savings: [],
  };
}

/** A new plan in the page: the base template with the IRPF paid as it is — the renta the next year. */
export function newPlan(startYear: number): Plan {
  return { ...defaultPlan(startYear), taxPayment: 'nextYear' };
}
