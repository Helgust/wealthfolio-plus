// Plan model: household, autónomo income, expenses; since phase 2 — account returns, surplus
// flows and withdrawal order. The Zod schema validates the plan read from storage: old or
// broken JSON must not silently turn into zeros. Phase 2 fields have defaults, so a phase 1
// plan loads without migration.
import { z } from 'zod';

const money = z.number().finite().min(0);
const rate = z.number().finite().min(-0.5).max(0.5);
const year = z.number().int().min(1900).max(2200);

export const AutonomoIncomeSchema = z.object({
  /** Facturación in the plan's first year, € per year */
  revenue: money,
  /** Deductible business expenses excluding the RETA cuota, € per year */
  expenses: money,
  /** Nominal growth of revenue and expenses per year */
  growth: rate,
  /** Age from which there is no income (the year it is reached already has none) */
  untilAge: z.number().int().min(0).max(120),
});

export const PersonSchema = z.object({
  name: z.string().min(1).max(60),
  birthYear: year,
  disability: z.enum(['ninguna', 'grado_33', 'grado_65']),
  autonomo: AutonomoIncomeSchema.nullable(),
});

export const ChildSchema = z.object({
  birthYear: year,
});

export const ExpenseSchema = z.object({
  name: z.string().min(1).max(60),
  /** € per year in first-year prices; grows with inflation */
  amount: money,
  kind: z.enum(['essential', 'discretionary']),
  startYear: year.nullable(),
  endYear: year.nullable(),
});

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

export const PlanSchema = z
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
  })
  .refine((p) => p.filing === 'individual' || p.people.length === 2, {
    message: 'Joint filing needs two people',
    path: ['filing'],
  });

export type AutonomoIncome = z.infer<typeof AutonomoIncomeSchema>;
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
        autonomo: { revenue: 40_000, expenses: 5_000, growth: 0.02, untilAge: 65 },
      },
    ],
    children: [],
    expenses: [
      {
        name: 'Living',
        amount: 20_000,
        kind: 'essential',
        startYear: null,
        endYear: null,
      },
    ],
    returns: DEFAULT_RETURNS,
    flows: [],
    withdrawalOrder: [],
    pensionAccessAge: 65,
  };
}
