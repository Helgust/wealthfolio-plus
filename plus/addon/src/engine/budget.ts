// Month-by-month run of a short-term budget. Order within a month:
//   1. incomes − expenses − loan payments (interest accrues on the balance at the start);
//   2. prepayment envelopes of repaid loans return to the free money;
//   3. one-time incomes and one-time expenses without an envelope;
//   4. the queue shares out the free money;
//   5. one-time expenses with an envelope are paid from it — after the month's deposit, as money
//      is moved at the start of a month and spent during it; what the envelope lacks comes from
//      what the queue left. The rest is unallocated (negative — a shortfall);
//   6. prepayment envelopes are swept into their loans.
import { addMonths, type Budget, type BudgetLine } from '../model/budget';
import { annuityMonthly, monthsToRepay, type Loan } from './real-estate';

export interface BudgetMonth {
  month: string;
  income: number;
  expenses: number;
  /** Scheduled loan payments, interest included */
  loanPayments: number;
  interest: number;
  oneTimeIncome: number;
  /** One-time expenses, paid from envelopes or from the free money */
  oneTimeExpenses: number;
  /** Money of the month before the queue */
  free: number;
  /** Left after the queue; negative — expenses not covered */
  unallocated: number;
  /** Per envelope: paid in by the queue, paid out (one-time expenses, returns to the free money), swept into loans */
  deposits: Record<string, number>;
  withdrawn: Record<string, number>;
  prepaid: Record<string, number>;
  /** Per envelope, at the end of the month */
  balances: Record<string, number>;
  /** Per loan: the month's interest, the balance at the end of the month, the payment due next month */
  loans: Record<string, { interest: number; balance: number; payment: number }>;
}

const EPS = 1e-6;

const lineInMonth = (l: BudgetLine, m: string) =>
  (l.from === null || l.from <= m) && (l.to === null || m < l.to) ? l.amount : 0;

export function runBudget(b: Budget): BudgetMonth[] {
  const balances: Record<string, number> = Object.fromEntries(b.envelopes.map((e) => [e.id, e.balance]));
  const loans: Record<string, Loan> = Object.fromEntries(
    b.loans.map((l) => [
      l.id,
      {
        id: l.id,
        name: l.name,
        balance: l.balance,
        rate: l.rate,
        monthlyPayment: l.payment,
        propertyId: null,
      },
    ]),
  );
  const rows: BudgetMonth[] = [];

  for (let i = 0; i < b.months; i++) {
    const m = addMonths(b.start, i);
    const calendarMonth = Number(m.slice(5));
    const open = (loanId: string | null) => loanId === null || loans[loanId].balance > EPS;
    const deposits: Record<string, number> = {};
    const withdrawn: Record<string, number> = {};
    const prepaid: Record<string, number> = {};
    const add = (r: Record<string, number>, k: string, v: number) => (r[k] = (r[k] ?? 0) + v);

    const income = b.incomes.reduce((s, l) => s + lineInMonth(l, m), 0);
    const expenses = b.expenses.reduce((s, l) => s + lineInMonth(l, m), 0);
    let interest = 0;
    let loanPayments = 0;
    const loanInterest: Record<string, number> = {};
    for (const l of Object.values(loans)) {
      if (l.balance <= EPS) continue;
      const due = (l.balance * l.rate) / 12;
      const pay = Math.min(l.monthlyPayment, l.balance + due);
      loanInterest[l.id] = due;
      interest += due;
      loanPayments += pay;
      l.balance += due - pay;
      if (l.balance <= EPS) l.balance = 0;
    }
    let free = income - expenses - loanPayments;

    for (const p of b.prepayments) {
      if (open(p.loanId) || balances[p.envelopeId] <= EPS) continue;
      free += balances[p.envelopeId];
      add(withdrawn, p.envelopeId, balances[p.envelopeId]);
      balances[p.envelopeId] = 0;
    }

    const oneTime = b.oneTime.filter((o) => o.month === m);
    const oneTimeIncome = oneTime.reduce((s, o) => s + (o.kind === 'income' ? o.amount : 0), 0);
    const oneTimeExpenses = oneTime.reduce((s, o) => s + (o.kind === 'expense' ? o.amount : 0), 0);
    free += oneTimeIncome;
    for (const o of oneTime) if (o.kind === 'expense' && o.envelopeId === null) free -= o.amount;
    const before = free;

    for (const s of b.steps) {
      if (free <= EPS) break;
      if (s.kind !== 'fill' && !open(s.whileLoan)) continue;
      const room =
        s.kind === 'fixed'
          ? Math.min(s.amount, s.cap === null ? Infinity : s.cap - balances[s.envelopeId])
          : s.kind === 'fill'
            ? s.target - balances[s.envelopeId]
            : Infinity;
      const amount = Math.max(0, Math.min(free, room));
      if (amount <= EPS) continue;
      balances[s.envelopeId] += amount;
      add(deposits, s.envelopeId, amount);
      free -= amount;
    }

    for (const o of oneTime) {
      if (o.kind !== 'expense' || o.envelopeId === null) continue;
      const fromEnvelope = Math.min(o.amount, balances[o.envelopeId]);
      balances[o.envelopeId] -= fromEnvelope;
      add(withdrawn, o.envelopeId, fromEnvelope);
      free -= o.amount - fromEnvelope;
    }

    for (const p of b.prepayments) {
      const l = loans[p.loanId];
      const have = balances[p.envelopeId];
      if (l.balance <= EPS || have <= EPS) continue;
      if (!p.months.includes(calendarMonth) && have < l.balance - EPS) continue;
      const amount = Math.min(have, l.balance);
      // A bank recomputes reducir cuota over the whole number of payments left.
      const left = Math.ceil(monthsToRepay(l.balance, l.rate, l.monthlyPayment) - EPS);
      l.balance -= amount;
      if (l.balance <= EPS) l.balance = 0;
      else if (p.effect === 'payment' && Number.isFinite(left)) {
        l.monthlyPayment = annuityMonthly(l.balance, l.rate, left);
      }
      balances[p.envelopeId] -= amount;
      add(prepaid, p.envelopeId, amount);
    }

    rows.push({
      month: m,
      income,
      expenses,
      loanPayments,
      interest,
      oneTimeIncome,
      oneTimeExpenses,
      free: before,
      unallocated: free,
      deposits,
      withdrawn,
      prepaid,
      balances: { ...balances },
      loans: Object.fromEntries(
        Object.values(loans).map((l) => [
          l.id,
          { interest: loanInterest[l.id] ?? 0, balance: l.balance, payment: l.balance > EPS ? l.monthlyPayment : 0 },
        ]),
      ),
    });
  }
  return rows;
}
