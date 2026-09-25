// Plan model: household, autónomo income, expenses; since phase 2 — account returns, surplus
// flows and withdrawal order; since phase 3 — milestones, event timing, public pension. The Zod
// schema validates the plan read from storage: old or broken JSON must not silently turn into
// zeros. New fields have defaults and old ones are upgraded (upgradeLegacy), so plans of earlier
// phases load without migration.
import { z } from 'zod';

const money = z.number().finite().min(0);
const rate = z.number().finite().min(-0.5).max(0.5);
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

export const AutonomoIncomeSchema = z.object({
  /** Facturación in the plan's first year, € per year */
  revenue: money,
  /** Deductible business expenses excluding the RETA cuota, € per year */
  expenses: money,
  /** Nominal growth of revenue and expenses per year, from the plan's first year */
  growth: rate,
  /** null — from the plan's first year */
  start: TimingSchema.nullable(),
  /** null — until the end of the plan */
  end: TimingSchema.nullable(),
});

/**
 * Seguridad Social pension: an input amount (from the SS report), not computed. Grows with
 * inflation (revalorización by IPC); taxed as rendimientos del trabajo.
 */
export const PublicPensionSchema = z.object({
  /** Gross € per year in first-year prices */
  amount: money,
  start: TimingSchema,
});

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
  /** € per year in first-year prices; grows with inflation */
  amount: money,
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
});

/**
 * Where the year's surplus goes, in order. max — up to the deductible limit for a pension plan,
 * otherwise the whole rest; fixed — amount per year; percent — share of the rest (amount 0…1);
 * untilBalance — top up to a balance. fixed and untilBalance amounts are in first-year prices.
 * What is left after the flows goes to the first CASH account.
 */
export const FlowSchema = z.object({
  accountId: z.string().min(1),
  mode: z.enum(['max', 'fixed', 'percent', 'untilBalance']),
  amount: money,
});

export const DEFAULT_RETURNS: Returns = {
  cashInterest: 0.015,
  fundGrowth: 0.06,
  brokerageGrowth: 0.045,
  brokerageYield: 0.015,
  pensionGrowth: 0.05,
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
    returns: ReturnsSchema.default(DEFAULT_RETURNS),
    flows: z.array(FlowSchema).max(30).default([]),
    /** Wealthfolio account ids; empty — cash → fondos → brokerage → pension plans */
    withdrawalOrder: z.array(z.string().min(1)).max(50).default([]),
    /** From this owner age the pension plan is available for withdrawals */
    pensionAccessAge: z.number().int().min(50).max(80).default(65),
    milestones: z.array(MilestoneSchema).max(20).default([]),
    spending: SpendingRuleSchema.default({ kind: 'planned' }),
    /**
     * Tax rules after the last known year: frozen as they are (Spanish thresholds are not indexed
     * automatically) or indexed — money thresholds grow with the plan's inflation.
     */
    taxRules: z.enum(['frozen', 'indexed']).default('frozen'),
  })
  .refine((p) => p.filing === 'individual' || p.people.length === 2, {
    message: 'Joint filing needs two people',
    path: ['filing'],
  });

export const PlanSchema = z.preprocess(upgradeLegacy, PlanObject);

export type Timing = z.infer<typeof TimingSchema>;
export type Milestone = z.infer<typeof MilestoneSchema>;
export type AutonomoIncome = z.infer<typeof AutonomoIncomeSchema>;
export type PublicPension = z.infer<typeof PublicPensionSchema>;
export type SpendingRule = z.infer<typeof SpendingRuleSchema>;
export type Person = z.infer<typeof PersonSchema>;
export type Child = z.infer<typeof ChildSchema>;
export type Expense = z.infer<typeof ExpenseSchema>;
export type Returns = z.infer<typeof ReturnsSchema>;
export type Flow = z.infer<typeof FlowSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Filing = Plan['filing'];

/** Template for a new plan: amounts are placeholders, the user enters their own. */
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
    returns: DEFAULT_RETURNS,
    flows: [],
    withdrawalOrder: [],
    pensionAccessAge: 65,
    milestones: [{ id: 'retirement', name: 'Retirement', trigger: { kind: 'age', person: 0, age: 65 } }],
    spending: { kind: 'planned' },
    taxRules: 'frozen',
  };
}
