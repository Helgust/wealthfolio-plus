// Short-term budget: a month-by-month plan for one to three years in net euros. Money left after
// incomes, expenses and loan payments goes to envelopes (savings pockets) by an ordered queue;
// a prepayment envelope is swept into a loan on set months. No taxes, no returns, no inflation —
// the yearly plan models those. Stored in ctx.api.storage under budgets.v1; written by the budget
// page and, as a draft, by the MCP server, so the schema is the validation boundary.
import { z } from 'zod';

const money = z.number().finite().min(0);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const name = z.string().min(1).max(60);
/** A calendar month, "2026-11" */
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const MAX_BUDGET_MONTHS = 36;

/** A monthly amount from `from` up to, not including, `to`; null — from the start, to the end. */
export const BudgetLineSchema = z.object({
  name,
  amount: money,
  from: month.nullable(),
  to: month.nullable(),
});

/** A one-time income or expense; an expense with an envelope is paid from it first. */
export const OneTimeItemSchema = z.object({
  name,
  month,
  amount: money,
  kind: z.enum(['income', 'expense']),
  envelopeId: id.nullable(),
});

/** A savings pocket; accountId — the Wealthfolio account that holds it, to compare with the fact. */
export const EnvelopeSchema = z.object({
  id,
  name,
  /** Balance at the start of the first month */
  balance: money,
  accountId: z.string().min(1).nullable(),
});

/** An annuity loan; the payment is due every month while there is a balance. */
export const BudgetLoanSchema = z.object({
  id,
  name,
  /** Balance at the start of the first month */
  balance: money,
  /** Annual nominal rate (TIN) */
  rate: z.number().finite().min(0).max(0.5),
  payment: money,
  liabilityId: z.string().min(1).nullable(),
});

/**
 * One step of the queue that shares out the month's free money, in order. fixed — an amount a
 * month, up to cap if set; fill — up to a target balance; rest — everything left. whileLoan — the
 * step runs only while that loan has a balance at the start of the month.
 */
export const BudgetStepSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('fixed'),
    envelopeId: id,
    amount: money,
    cap: money.nullable(),
    whileLoan: id.nullable(),
  }),
  z.object({ kind: z.literal('fill'), envelopeId: id, target: money }),
  z.object({ kind: z.literal('rest'), envelopeId: id, whileLoan: id.nullable() }),
]);

/**
 * The envelope is swept into the loan at the end of the given months (1–12), and at once when it
 * covers the balance. term — reducir plazo, payment — reducir cuota. Once the loan is repaid,
 * what is left in the envelope returns to the next month's free money.
 */
export const PrepaymentSchema = z.object({
  envelopeId: id,
  loanId: id,
  months: z.array(z.number().int().min(1).max(12)).max(12),
  effect: z.enum(['term', 'payment']),
});

export const BudgetSchema = z
  .object({
    name,
    start: month,
    months: z.number().int().min(1).max(MAX_BUDGET_MONTHS),
    incomes: z.array(BudgetLineSchema).max(30),
    expenses: z.array(BudgetLineSchema).max(30),
    oneTime: z.array(OneTimeItemSchema).max(100),
    envelopes: z.array(EnvelopeSchema).max(20),
    loans: z.array(BudgetLoanSchema).max(10),
    steps: z.array(BudgetStepSchema).max(30),
    prepayments: z.array(PrepaymentSchema).max(10),
  })
  .superRefine((b, ctx) => {
    const envelopes = new Set(b.envelopes.map((e) => e.id));
    const loans = new Set(b.loans.map((l) => l.id));
    const check = (ok: boolean, path: (string | number)[], message: string) => {
      if (!ok) ctx.addIssue({ code: 'custom', path, message });
    };
    check(envelopes.size === b.envelopes.length, ['envelopes'], 'Envelope ids must be unique');
    check(loans.size === b.loans.length, ['loans'], 'Loan ids must be unique');
    b.oneTime.forEach((o, i) =>
      check(o.envelopeId === null || envelopes.has(o.envelopeId), ['oneTime', i, 'envelopeId'], 'Unknown envelope'),
    );
    b.steps.forEach((s, i) => {
      check(envelopes.has(s.envelopeId), ['steps', i, 'envelopeId'], 'Unknown envelope');
      if (s.kind !== 'fill') {
        check(s.whileLoan === null || loans.has(s.whileLoan), ['steps', i, 'whileLoan'], 'Unknown loan');
      }
    });
    b.prepayments.forEach((p, i) => {
      check(envelopes.has(p.envelopeId), ['prepayments', i, 'envelopeId'], 'Unknown envelope');
      check(loans.has(p.loanId), ['prepayments', i, 'loanId'], 'Unknown loan');
    });
  });

export type BudgetLine = z.infer<typeof BudgetLineSchema>;
export type OneTimeItem = z.infer<typeof OneTimeItemSchema>;
export type Envelope = z.infer<typeof EnvelopeSchema>;
export type BudgetLoan = z.infer<typeof BudgetLoanSchema>;
export type BudgetStep = z.infer<typeof BudgetStepSchema>;
export type Prepayment = z.infer<typeof PrepaymentSchema>;
export type Budget = z.infer<typeof BudgetSchema>;

/** "2026-11" plus n months. */
export function addMonths(m: string, n: number): string {
  const [y, mm] = m.split('-').map(Number);
  const k = y * 12 + (mm - 1) + n;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`;
}

/** An empty budget starting this month: the user fills it in. */
export function newBudget(today: Date): Budget {
  const start = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  return {
    name: 'Budget',
    start,
    months: 12,
    incomes: [],
    expenses: [],
    oneTime: [],
    envelopes: [],
    loans: [],
    steps: [],
    prepayments: [],
  };
}
