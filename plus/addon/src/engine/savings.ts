// Savings by goals, month by month inside a plan year. The free money of a month — income less
// spending and the taxes paid in it — pays the month's planned savings, up to them: what it cannot
// pay is the savings deficit, and it is not caught up later. The savings go to the active goals in
// proportion to their amounts; what a goal cannot take (a target reached, no deductible room left,
// a loan repaid) goes to the other active goals, and with none left — to cash. What the month has
// beyond the savings stays in cash, a minus comes out of it; the year's rest goes through the flows
// at its end. Loans of loan goals are paid here month by month, and prepaid after the month's
// payment. A goal saving for the down payment of a purchase pays it in the purchase month, before
// the month's savings, and ends. Amounts are nominal euros.
import type { AccountGoal, Goal, LoanGoal, Plan, SavingsStep } from '../model/plan';
import { accountValue, deposit, type Account } from './portfolio';
import { amortizeMonth, prepayLoan, type Loan } from './real-estate';
import { timingYear } from './timing';

/** Below this, money is rounding noise. */
const EPS = 1e-9;

export interface GoalMonth {
  /** Received in the month (in a year row — in the year) */
  saved: number;
  /** At the end of the month (of the year): the account's balance, or the loan still owed */
  balance: number;
  /** Loan goals: the month's payment, interest and principal (in a year row — December's) */
  payment?: number;
  /** Loan goals: interest paid in the month (the year) */
  interest?: number;
  /** Loan goals: amortización anticipada in the month (the year), without the fee */
  prepaid?: number;
  /** Loan goals: money held for the next prepayment at the end of the month (the year) */
  held?: number;
}

export interface MonthRow {
  year: number;
  /** 1 — January */
  month: number;
  /** Income − spending − taxes paid in the month, before savings */
  freeMoney: number;
  /** Savings of the schedule */
  planned: number;
  /** Savings paid: planned, or all the free money when it is less */
  saved: number;
  /** planned − saved: the savings deficit */
  deficit: number;
  /** Part of saved that no active goal could take: to cash */
  toCash: number;
  /** Paid towards purchases out of the goals saving for their down payment */
  fromGoals: number;
  /** freeMoney + fromGoals − saved: stays in cash (> 0) or comes out of it (< 0) */
  rest: number;
  goals: Record<string, GoalMonth>;
}

/** The year's savings: sums of its months; goal balances at the end of the year. */
export interface SavingsYear {
  planned: number;
  saved: number;
  deficit: number;
  toCash: number;
  goals: Record<string, GoalMonth>;
}

/** What the loans paid month by month did in the year. */
export interface MonthlyLoans {
  interest: number;
  principal: number;
  prepaid: number;
  fees: number;
  /** Taken out of the goals' held money for prepayments, fees included */
  fromHeld: number;
}

/** Month a goal first reached its target (a loan goal — the loan repaid). */
export interface Reached {
  year: number;
  month: number;
}

/** A down payment due this year out of the goal that saves for it. */
export interface DownPaymentDue {
  goalId: string;
  month: number;
  /** The down payment: price − mortgage + purchase tax + costs */
  needed: number;
}

/** A down payment paid: how much of it the goal's account had. */
export interface DownPaymentPaid extends DownPaymentDue {
  year: number;
  paid: number;
}

/** The step of the savings schedule in force in a month; null — none has started. */
export function savingsStepAt(plan: Plan, year: number, month: number): SavingsStep | null {
  let step: SavingsStep | null = null;
  for (const s of plan.savings) {
    if (s.from.year < year || (s.from.year === year && s.from.month <= month)) step = s;
  }
  return step;
}

export const stepTotal = (s: SavingsStep | null) =>
  s ? Object.values(s.amounts).reduce((sum, x) => sum + x, 0) : 0;

/** Id of the account that holds a loan goal's money between prepayments. */
export const heldId = (g: LoanGoal) => `goal:${g.id}`;

/** A loan goal that keeps its money until a prepayment: threshold or months. */
export const holds = (g: Goal): g is LoanGoal => g.kind === 'loan' && g.prepay.kind !== 'monthly';

/**
 * Splits amount in proportion to weights, each part up to its capacity; what a full part cannot
 * take goes to the others. Returns the parts; amount − their sum is what nobody could take.
 */
export function allocate(amount: number, weights: number[], capacity: number[]): number[] {
  const take = weights.map(() => 0);
  const cap = [...capacity];
  const open = weights.map((w, i) => w > 0 && cap[i] > EPS);
  let left = amount;
  // Every round either gives all that is left or fills a part.
  for (let round = 0; round <= weights.length && left > EPS; round++) {
    const total = weights.reduce((s, w, i) => s + (open[i] ? w : 0), 0);
    if (total <= 0) break;
    let given = 0;
    weights.forEach((w, i) => {
      if (!open[i]) return;
      const x = Math.min((left * w) / total, cap[i]);
      take[i] += x;
      cap[i] -= x;
      given += x;
      if (cap[i] <= EPS) open[i] = false;
    });
    left -= given;
  }
  return take;
}

export interface SavingsContext {
  plan: Plan;
  year: number;
  /** Milestones reached so far: when goals end */
  reached: ReadonlyMap<string, number>;
  /** Free money of each month of the year, before the payments of the loans paid here */
  freeMoney: number[];
  accounts: Account[];
  /** The account that takes the rest: what the months leave or take is counted in it */
  sink: Account;
  /** Price growth of each account this year: the engine credits it at the start of the year */
  growth: ReadonlyMap<string, number>;
  /** How much more an account can take this year (a pension plan: its deductible room) */
  room: (a: Account) => number;
  /** Books money put into an account in a month: the deposit itself is made here */
  put: (a: Account, amount: number, month: number) => void;
  /** Loans of loan goals owed at the start of the year: paid here month by month */
  loans: Loan[];
  /** Target balance of an account goal this year; null — none */
  target: (g: AccountGoal) => number | null;
  /** Down payments due this year */
  purchases: DownPaymentDue[];
  /** Goals whose purchase was in an earlier year: they have ended */
  bought: ReadonlySet<string>;
  /** Takes up to amount out of an account in a month; returns what it gave */
  take: (a: Account, amount: number, month: number) => number;
  /** Month each goal first reached its target; updated */
  firstReached: Map<string, Reached>;
  /** Keep the rows of the months */
  record: boolean;
}

/**
 * One year of savings, month by month. Deposits go through put; the result is the year's sums,
 * what the loans paid here did, and, when recorded, the months. It runs for every year of every
 * Monte Carlo trial, so what does not change within the year is worked out once.
 */
export function savingsYear(ctx: SavingsContext): {
  year: SavingsYear;
  loans: MonthlyLoans;
  downPayments: DownPaymentPaid[];
  months: MonthRow[];
} {
  const { plan, year, sink } = ctx;
  const goals = plan.goals;
  const n = goals.length;
  // Each goal's account (a loan goal's: its held money) and loan, and whether it has ended.
  const accountFor = goals.map((g) => ctx.accounts.find((a) => a.id === (g.kind === 'account' ? g.accountId : heldId(g))));
  const loanFor = goals.map((g) => (g.kind === 'loan' ? ctx.loans.find((l) => l.id === g.loanId) : undefined));
  const endedFor = goals.map((g) => {
    const end = g.end ? timingYear(g.end, plan, ctx.reached) : null;
    return (end !== null && year >= end) || ctx.bought.has(g.id);
  });
  const targetFor = goals.map((g) => (g.kind === 'account' ? ctx.target(g) : null));
  // The schedule's step of every month: its total and each goal's amount.
  const steps: { total: number; weights: number[] }[] = [];
  let last: SavingsStep | null | undefined;
  for (let month = 1; month <= 12; month++) {
    const step = savingsStepAt(plan, year, month);
    steps.push(
      month > 1 && step === last
        ? steps[month - 2]
        : { total: stepTotal(step), weights: goals.map((g) => step?.amounts[g.id] ?? 0) },
    );
    last = step;
  }
  const downPayments: DownPaymentPaid[] = [];
  /** What the months so far left in cash (or took from it) */
  let running = 0;
  // Account values, kept up to date here: summing lots every month is slow.
  const values = new Map<string, number>();
  const valueOf = (a: Account) => {
    let v = values.get(a.id);
    if (v === undefined) values.set(a.id, (v = accountValue(a)));
    return v;
  };
  const changed = (a: Account, delta: number) => {
    const v = values.get(a.id);
    if (v !== undefined) values.set(a.id, v + delta);
  };
  // Money for a fund or a brokerage account waits for one deposit a year: its price does not change
  // within the year, and a deposit sums the account's lots.
  const pending = new Map<Account, number>();
  const put = (a: Account, x: number, month: number) => {
    ctx.put(a, x, month);
    // The value before the deposit, then with it: a pending one is not in the account yet.
    values.set(a.id, valueOf(a) + x);
    if (a.kind === 'cash') deposit(a, x, '');
    else pending.set(a, (pending.get(a) ?? 0) + x);
  };
  const flush = (a?: Account) => {
    for (const [p, x] of pending) {
      if (a && p !== a) continue;
      // A year's savings: one lot per position, bought mid-year for FIFO.
      deposit(p, x, `${year}-06-30`, true);
      pending.delete(p);
    }
  };
  // Growth is credited at the start of the year; within it, the balance earns it month by month.
  const balance = (a: Account, month: number) =>
    a.id === sink.id ? valueOf(a) + running : valueOf(a) - ((ctx.growth.get(a.id) ?? 0) * (12 - month)) / 12;
  /** A loan goal that can no longer prepay gives its held money back to cash. */
  const release = (i: number) => {
    const h = holds(goals[i]) ? accountFor[i] : undefined;
    if (h && h.cash > 0) {
      changed(sink, h.cash);
      changed(h, -h.cash);
      sink.cash += h.cash;
      h.cash = 0;
    }
  };

  const out: SavingsYear = { planned: 0, saved: 0, deficit: 0, toCash: 0, goals: {} };
  const loans: MonthlyLoans = { interest: 0, principal: 0, prepaid: 0, fees: 0, fromHeld: 0 };
  for (const g of goals) out.goals[g.id] = g.kind === 'loan' ? { saved: 0, balance: 0, interest: 0, prepaid: 0 } : { saved: 0, balance: 0 };
  const months: MonthRow[] = [];
  const zeros: number[] = new Array(n).fill(0);
  const capacity: number[] = new Array(n).fill(0);
  /** The month's payment and interest of each goal's loan, and what it prepaid */
  const payment: number[] = new Array(n).fill(0);
  const interest: number[] = new Array(n).fill(0);
  const prepaid: number[] = new Array(n).fill(0);
  for (let month = 1; month <= 12; month++) {
    // The month's payments of the loans paid here.
    let payments = 0;
    for (const l of ctx.loans) {
      const a = amortizeMonth(l);
      loans.interest += a.interest;
      loans.principal += a.principal;
      payments += a.interest + a.principal;
      for (let i = 0; i < n; i++) {
        if (loanFor[i] !== l) continue;
        payment[i] = a.interest + a.principal;
        interest[i] = a.interest;
      }
    }
    const free = ctx.freeMoney[month - 1] - payments;
    // A purchase this month is paid first out of the goal saving for its down payment.
    let fromGoals = 0;
    for (const due of ctx.purchases) {
      if (due.month !== month) continue;
      const i = goals.findIndex((x) => x.id === due.goalId);
      const a = accountFor[i];
      if (a) flush(a);
      const paidOut = a ? ctx.take(a, Math.min(due.needed, Math.max(valueOf(a), 0)), month) : 0;
      if (a) changed(a, -paidOut);
      fromGoals += paidOut;
      downPayments.push({ ...due, year, paid: paidOut });
      if (i >= 0) endedFor[i] = true;
    }
    const { total: planned, weights } = steps[month - 1];
    const saved = Math.min(planned, Math.max(free + fromGoals, 0));
    for (let i = 0; i < n; i++) {
      const g = goals[i];
      capacity[i] = 0;
      if (endedFor[i]) continue;
      if (g.kind === 'loan') {
        const l = loanFor[i];
        if (!l || l.balance <= EPS) continue;
        const owed = l.balance * (1 + g.fee);
        capacity[i] = holds(g) ? Math.max(owed - (accountFor[i]?.cash ?? 0), 0) : owed;
        continue;
      }
      const a = accountFor[i];
      if (!a) continue;
      const room = ctx.room(a);
      const target = targetFor[i];
      capacity[i] = target === null ? room : Math.min(Math.max(target - balance(a, month), 0), room);
    }
    const parts = saved > 0 ? allocate(saved, weights, capacity) : zeros;
    let toCash = saved;
    prepaid.fill(0);
    for (let i = 0; i < n; i++) {
      const g = goals[i];
      toCash -= parts[i];
      if (g.kind === 'account') {
        const a = accountFor[i];
        if (a && parts[i] > 0) put(a, parts[i], month);
        continue;
      }
      const l = loanFor[i];
      if (!l || endedFor[i]) {
        release(i);
        continue;
      }
      const prepay = (x: number) => {
        prepayLoan(l, x, g.effect);
        loans.prepaid += x;
        loans.fees += x * g.fee;
        prepaid[i] += x;
      };
      const p = g.prepay;
      if (p.kind === 'monthly') {
        if (parts[i] > 0) prepay(parts[i] / (1 + g.fee));
      } else {
        const h = accountFor[i]!;
        if (parts[i] > 0) put(h, parts[i], month);
        const owed = l.balance * (1 + g.fee);
        const due = p.kind === 'threshold' ? h.cash >= p.amount - EPS : p.months.includes(month);
        if (l.balance > EPS && h.cash > EPS && (due || h.cash >= owed - EPS)) {
          const x = Math.min(h.cash / (1 + g.fee), l.balance);
          h.cash -= x * (1 + g.fee);
          changed(h, -x * (1 + g.fee));
          loans.fromHeld += x * (1 + g.fee);
          prepay(x);
        }
      }
      if (l.balance <= EPS) {
        release(i);
        if (!ctx.firstReached.has(g.id)) ctx.firstReached.set(g.id, { year, month });
      }
    }
    if (toCash > EPS) put(sink, toCash, month);
    else toCash = 0;
    const rest = free + fromGoals - saved;
    running += rest;
    const row: MonthRow | null = ctx.record
      ? { year, month, freeMoney: free, planned, saved, deficit: planned - saved, toCash, fromGoals, rest, goals: {} }
      : null;
    for (let i = 0; i < n; i++) {
      const g = goals[i];
      const y = out.goals[g.id];
      y.saved += parts[i];
      if (g.kind === 'loan') {
        const l = loanFor[i];
        const paidNow = l ? payment[i] : 0;
        const interestNow = l ? interest[i] : 0;
        const held = accountFor[i]?.cash ?? 0;
        y.interest! += interestNow;
        y.prepaid! += prepaid[i];
        y.payment = paidNow;
        y.held = held;
        y.balance = l?.balance ?? 0;
        if (row) {
          row.goals[g.id] = { saved: parts[i], balance: y.balance, payment: paidNow, interest: interestNow, prepaid: prepaid[i], held };
        }
        continue;
      }
      const a = accountFor[i];
      // A target is checked every month: growth alone can reach it.
      const target = endedFor[i] ? null : targetFor[i];
      if (!row && month < 12 && (target === null || ctx.firstReached.has(g.id))) continue;
      const b = a ? balance(a, month) : 0;
      y.balance = b;
      if (target !== null && a && b >= target - EPS && !ctx.firstReached.has(g.id)) {
        ctx.firstReached.set(g.id, { year, month });
      }
      if (row) row.goals[g.id] = { saved: parts[i], balance: b };
    }
    out.planned += planned;
    out.saved += saved;
    out.deficit += planned - saved;
    out.toCash += toCash;
    if (row) months.push(row);
  }
  flush();
  return { year: out, loans, downPayments, months };
}
