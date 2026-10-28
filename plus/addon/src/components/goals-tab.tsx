// "Goals" tab: when each savings goal is reached — a loan goal: when the loan is repaid, with
// reducir plazo and reducir cuota side by side; a down payment: when it is ready and what it paid
// at the purchase — and the savings month by month over the near horizon, then year by year.
// Nominal euros: savings are entered so.
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@wealthfolio/ui';
import { Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Account } from '../engine/portfolio';
import { runPlan, type PlanResult, type StartingPoint } from '../engine/run-plan';
import { savingsStepAt, stepTotal, type GoalMonth, type MonthRow } from '../engine/savings';
import { formatMoney, formatMonth } from '../lib/format';
import { goalLabel, loanInterest, loanPayment } from '../lib/goals';
import type { AccountGoal, LoanGoal, Plan } from '../model/plan';
import { EFFECT_LABEL, loanOptions } from './investments-editor';
import type { EditorSection } from './plan-editor';
import { timingLabel } from './timing-input';

/** Months of the near horizon to choose from, from the current month to the end of its year. */
export const HORIZONS = [12, 24, 36] as const;
/** Plan years the engine keeps month by month: the longest horizon from December of the first year. */
export const MONTH_YEARS = HORIZONS.at(-1)! / 12 + 1;

interface Props {
  plan: Plan;
  result: PlanResult;
  start: StartingPoint;
  currency: string;
  onEdit: (section: EditorSection) => void;
  /** Saves a changed plan: "buy in the month the down payment is ready" */
  onPlanChange: (plan: Plan) => Promise<void>;
}

/** A table row: a month of the horizon, the past months of the first year together, or a year after it. */
interface Line {
  key: string;
  label: string;
  freeMoney: number;
  planned: number;
  saved: number;
  deficit: number;
  rest: number;
  goals: Record<string, GoalMonth>;
  /** A year row: balances at its end */
  isYear?: boolean;
}

function sumMonths(label: string, ms: MonthRow[]): Line {
  const sum = (f: (m: MonthRow) => number) => ms.reduce((s, m) => s + f(m), 0);
  const last = ms[ms.length - 1];
  const goals = Object.fromEntries(
    Object.keys(last.goals).map((id) => [
      id,
      { ...last.goals[id], saved: sum((m) => m.goals[id].saved), prepaid: sum((m) => m.goals[id].prepaid ?? 0) },
    ]),
  );
  return {
    key: label,
    label,
    freeMoney: sum((m) => m.freeMoney),
    planned: sum((m) => m.planned),
    saved: sum((m) => m.saved),
    deficit: sum((m) => m.deficit),
    rest: sum((m) => m.rest),
    goals,
  };
}

/** The same plan with this loan goal's other effect: reducir plazo against reducir cuota. */
const otherEffect = (plan: Plan, g: LoanGoal): Plan => ({
  ...plan,
  goals: plan.goals.map((x) => (x.id === g.id ? { ...g, effect: g.effect === 'term' ? 'payment' : 'term' } : x)),
});

/** What a loan goal gives with one effect: the payment now and later, when it is repaid, the interest paid. */
interface LoanOutcome {
  now: number;
  later: number;
  repaid: string;
  interest: number;
}

export function GoalsTab({ plan, result, start, currency, onEdit, onPlanChange }: Props) {
  const [horizon, setHorizon] = useState<number>(24);
  const money = (v: number) => formatMoney(v, currency);
  const goals = plan.goals;
  const accountName = (g: AccountGoal) => start.accounts.find((a: Account) => a.id === g.accountId)?.name;
  const loanName = (g: LoanGoal) => loanOptions(plan, start.loans ?? []).find((l) => l.id === g.loanId)?.name;
  const lastYear = result.rows.at(-1)!.year;

  // Months of the first year before the current one are shown as one row: they are the past.
  const now = new Date();
  const past = plan.startYear === now.getFullYear() ? now.getMonth() : 0;
  // The horizon runs from the current month to the end of a year: years follow whole.
  const shown = result.months.slice(0, Math.ceil((past + horizon) / 12) * 12);
  const lines: Line[] = [
    ...(past > 1 ? [sumMonths(`Jan–${formatMonth(plan.startYear, past)}`, shown.slice(0, past))] : []),
    ...shown.slice(past > 1 ? past : 0).map((m): Line => ({ ...m, key: `${m.year}-${m.month}`, label: formatMonth(m.year, m.month) })),
    ...result.rows
      .filter((r) => r.year >= plan.startYear + shown.length / 12)
      .map(
        (r): Line => ({
          key: String(r.year),
          label: String(r.year),
          freeMoney: r.netCashFlow,
          planned: r.savings?.planned ?? 0,
          saved: r.savings?.saved ?? 0,
          deficit: r.savings?.deficit ?? 0,
          rest: r.netCashFlow - (r.savings?.saved ?? 0),
          goals: r.savings?.goals ?? {},
          isYear: true,
        }),
      ),
  ];
  const ahead = shown.slice(past);
  const deficitMonths = ahead.filter((m) => m.deficit > 0.005);
  const step = savingsStepAt(plan, now.getFullYear(), now.getMonth() + 1) ?? plan.savings[0] ?? null;

  // Reducir plazo against reducir cuota: every loan goal with its other effect.
  const later = { year: plan.startYear + 1, month: 12 };
  const outcomes = useMemo(() => {
    const outcome = (r: PlanResult, g: LoanGoal): LoanOutcome => ({
      now: r.months[past]?.goals[g.id]?.payment ?? 0,
      later: loanPayment(r, g, later.year, later.month) ?? 0,
      repaid: goalLabel(r, g) ?? `not by ${lastYear}`,
      interest: loanInterest(r, g),
    });
    return new Map(
      goals
        .filter((g): g is LoanGoal => g.kind === 'loan')
        .map((g) => {
          const other = runPlan(otherEffect(plan, g), start, plan.filing, undefined, MONTH_YEARS);
          const mine = outcome(result, g);
          const theirs = outcome(other, g);
          return [g.id, g.effect === 'term' ? { term: mine, payment: theirs } : { term: theirs, payment: mine }];
        }),
    );
  }, [plan, start, result, past, lastYear, later.year, later.month]);

  const purchaseOf = (g: AccountGoal) => {
    const t = g.target;
    return t?.kind === 'purchase' ? plan.propertyPurchases.find((p) => p.id === t.purchaseId) : undefined;
  };
  /** The month the down payment is ready, unless the purchase is already then */
  const readyToBuy = (g: AccountGoal) => {
    const r = result.goalsReached[g.id];
    const pp = purchaseOf(g);
    if (!r || !pp || result.downPayments.some((d) => d.goalId === g.id && d.year === r.year && d.month === r.month)) return null;
    return pp.timing.kind === 'year' && pp.timing.year === r.year && pp.month === r.month ? null : r;
  };

  function accountStatus(g: AccountGoal): string {
    const reached = result.goalsReached[g.id];
    const bought = result.downPayments.find((d) => d.goalId === g.id);
    if (!accountName(g)) return 'The account is not modelled: the goal gets nothing';
    if (!g.target) return `No target · ${money(result.rows.at(-1)!.savings?.goals[g.id]?.balance ?? 0)} at the end of the plan`;
    if (bought) return `Bought in ${formatMonth(bought.year, bought.month)}`;
    if (reached) return `${g.target.kind === 'purchase' ? 'Ready' : 'Reached'} in ${formatMonth(reached.year, reached.month)}`;
    return `Not ${g.target.kind === 'purchase' ? 'ready' : 'reached'} by ${lastYear}`;
  }

  /** What the goal paid towards its purchase, and what it was short. */
  function downPaymentLine(g: AccountGoal): string | null {
    const d = result.downPayments.find((x) => x.goalId === g.id);
    if (!d) return null;
    const short = d.needed - d.paid;
    return short > 0.5
      ? `The goal paid ${money(d.paid)} of the ${money(d.needed)} down payment: ${money(short)} short, taken from cash`
      : `The goal paid all the ${money(d.needed)} down payment`;
  }

  /** Moves the purchase to the month its down payment is ready. */
  function buyWhenReady(g: AccountGoal) {
    const pp = purchaseOf(g);
    const reached = result.goalsReached[g.id];
    if (!pp || !reached) return;
    void onPlanChange({
      ...plan,
      propertyPurchases: plan.propertyPurchases.map((p) =>
        p.id === pp.id ? { ...p, timing: { kind: 'year', year: reached.year }, month: reached.month } : p,
      ),
    });
  }

  function loanStatus(g: LoanGoal): string {
    if (!loanName(g)) return 'The loan is missing: the goal gets nothing';
    const repaid = goalLabel(result, g);
    return repaid ? `Repaid in ${repaid}` : `Not repaid by ${lastYear}`;
  }

  function prepayLabel(g: LoanGoal): string {
    const p = g.prepay;
    if (p.kind === 'monthly') return 'prepaid every month';
    if (p.kind === 'threshold') return `prepaid once ${money(p.amount)} is held`;
    return `prepaid in ${p.months.map((m) => formatMonth(2000, m).slice(0, 3)).join(', ')}`;
  }

  function goalCell(g: (typeof goals)[number], x: GoalMonth | undefined) {
    if (!x) return '—';
    const extra: string[] = [];
    if (g.kind === 'loan') {
      if ((x.payment ?? 0) > 0.005) extra.push(`pays ${money(x.payment!)}`);
      if ((x.prepaid ?? 0) > 0.005) extra.push(`prepaid ${money(x.prepaid!)}`);
      if ((x.held ?? 0) > 0.005) extra.push(`held ${money(x.held!)}`);
    } else if (x.saved > 0.005) extra.push(`+${money(x.saved)}`);
    return (
      <>
        {money(x.balance)}
        {extra.map((e) => (
          <div key={e} className="text-muted-foreground">
            {e}
          </div>
        ))}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        {goals.map((g) => (
          <Card key={g.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{g.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {g.kind === 'account' ? (
                <>
                  <div className="text-lg font-semibold">{accountStatus(g)}</div>
                  <div className="text-muted-foreground text-xs">
                    {accountName(g) ?? 'missing account'}
                    {g.target?.kind === 'amount' ? ` · target ${money(g.target.amount)}` : ''}
                    {g.target?.kind === 'purchase' ? ` · down payment of ${purchaseOf(g)?.name ?? 'a missing purchase'}` : ''}
                    {g.end ? ` · stops ${timingLabel(g.end, plan, result.milestoneYears)}` : ''}
                  </div>
                  {downPaymentLine(g) && <div className="text-xs">{downPaymentLine(g)}</div>}
                  {readyToBuy(g) && (
                    <Button variant="outline" size="sm" onClick={() => buyWhenReady(g)}>
                      Buy in {formatMonth(readyToBuy(g)!.year, readyToBuy(g)!.month)}
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <div className="text-lg font-semibold">{loanStatus(g)}</div>
                  <div className="text-muted-foreground text-xs">
                    {loanName(g) ?? 'missing loan'} · {prepayLabel(g)}
                    {g.fee > 0 ? `, fee ${(g.fee * 100).toFixed(2)} %` : ''}
                    {g.end ? ` · stops ${timingLabel(g.end, plan, result.milestoneYears)}` : ''}
                  </div>
                  {outcomes.get(g.id) && (
                    <LoanComparison
                      goal={g}
                      outcomes={outcomes.get(g.id)!}
                      nowLabel={ahead[0] ? formatMonth(ahead[0].year, ahead[0].month) : 'now'}
                      laterLabel={formatMonth(later.year, later.month)}
                      money={money}
                    />
                  )}
                </>
              )}
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">Savings</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => onEdit('goals')}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {goals.length === 0 ? (
              <p className="text-muted-foreground">
                No goals yet. Add goals — a cushion, a down payment, a fund, a loan to prepay — and how much to save each
                month to see when each is reached.
              </p>
            ) : (
              <>
                <div className="text-lg font-semibold">
                  {step ? `${money(stepTotal(step))}/month` : 'No savings planned'}
                </div>
                <div className="text-muted-foreground text-xs">
                  {step && `from ${formatMonth(step.from.year, step.from.month)}; `}
                  {deficitMonths.length
                    ? `short in ${deficitMonths.length} of the next ${ahead.length} months, ${money(deficitMonths.reduce((s, m) => s + m.deficit, 0))} in all`
                    : `paid in full over the next ${ahead.length} months`}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-xs">
          Months of the near horizon, then years; nominal euros. Free money — income less spending, loan payments and the
          taxes paid; what is left after the savings stays in cash, a minus comes out of it. A loan goal shows what is
          still owed.
        </p>
        <div style={{ width: 150, flex: 'none' }}>
          <Select value={String(horizon)} onValueChange={(v) => setHorizon(Number(v))}>
            <SelectTrigger aria-label="Months shown">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HORIZONS.map((h) => (
                <SelectItem key={h} value={String(h)}>
                  {h} months
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead className="text-right whitespace-nowrap">Free money</TableHead>
              <TableHead className="text-right whitespace-nowrap">Savings</TableHead>
              <TableHead className="text-right whitespace-nowrap">Saved</TableHead>
              <TableHead className="text-right whitespace-nowrap">Savings deficit</TableHead>
              <TableHead className="text-right whitespace-nowrap">Left in cash</TableHead>
              {goals.map((g) => (
                <TableHead key={g.id} className="text-right whitespace-nowrap">
                  {g.name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.key} className={l.isYear ? 'text-muted-foreground' : undefined}>
                <TableCell className="whitespace-nowrap">{l.label}</TableCell>
                <TableCell className="text-right tabular-nums">{money(l.freeMoney)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(l.planned)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(l.saved)}</TableCell>
                <TableCell className={`text-right tabular-nums ${l.deficit > 0.005 ? 'text-destructive' : ''}`}>
                  {l.deficit > 0.005 ? money(l.deficit) : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(l.rest)}</TableCell>
                {goals.map((g) => (
                  <TableCell key={g.id} className="text-right whitespace-nowrap tabular-nums">
                    {goalCell(g, l.goals[g.id])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function LoanComparison({
  goal,
  outcomes,
  nowLabel,
  laterLabel,
  money,
}: {
  goal: LoanGoal;
  outcomes: Record<LoanGoal['effect'], LoanOutcome>;
  nowLabel: string;
  laterLabel: string;
  money: (v: number) => string;
}) {
  const rows: [string, (o: LoanOutcome) => string][] = [
    [`Payment in ${nowLabel}`, (o) => money(o.now)],
    [`Payment in ${laterLabel}`, (o) => money(o.later)],
    ['Repaid', (o) => o.repaid],
    ['Interest paid', (o) => money(o.interest)],
  ];
  const effects: LoanGoal['effect'][] = ['term', 'payment'];
  return (
    <table className="mt-2 w-full text-xs">
      <thead>
        <tr className="text-muted-foreground">
          <th />
          {effects.map((e) => (
            <th key={e} className={`text-right font-normal ${e === goal.effect ? 'text-foreground font-medium' : ''}`}>
              {EFFECT_LABEL[e].replace(/ \(.*\)/, '')}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td className="text-muted-foreground">{label}</td>
            {effects.map((e) => (
              <td key={e} className={`text-right tabular-nums ${e === goal.effect ? 'font-medium' : 'text-muted-foreground'}`}>
                {value(outcomes[e])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
