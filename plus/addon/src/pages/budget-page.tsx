// Budget page: a month-by-month short-term plan — key dates, plan vs Wealthfolio for this month and,
// for past months, in the chart and the table; envelope and loan balances, the table by month; a
// draft proposed through MCP to preview, accept or reject; this month's deposits to record as
// transfers.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddonContext } from '@wealthfolio/addon-sdk';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Page,
  PageContent,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@wealthfolio/ui';
import { Check, Eye, EyeOff, Pencil, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { BudgetChart } from '../components/budget-chart';
import { BudgetEditor, type SpendingDraft } from '../components/budget-editor';
import { PageMessage } from '../components/page-message';
import { PlanSwitcher } from '../components/plan-switcher';
import { RecordTransfersDialog } from '../components/record-transfers-dialog';
import { runBudget, type BudgetMonth } from '../engine/budget';
import { PORTFOLIO_KEY } from '../hooks/use-planner-data';
import {
  lastMonths,
  loadBudgetFact,
  monthEnd,
  spendingLines,
  withGoalTargets,
  type BudgetFact,
} from '../lib/budget-fact';
import { getSpendingReport } from '../lib/fork-api';
import { formatMoney } from '../lib/format';
import { isLiability, loadPortfolio, type LoadedPortfolio } from '../lib/starting-point';
import { newBudget, type Budget } from '../model/budget';
import {
  activeBudget,
  addBudget,
  applyDraft,
  BUDGETS_KEY,
  deleteBudget,
  discardDraft,
  DRAFT_KEY,
  loadBudgets,
  loadDraft,
  loadRecorded,
  MAX_BUDGETS,
  saveBudgets,
  setBudget,
  type BudgetBook,
  type BudgetDraft,
  type LoadedBudgets,
} from '../model/budget-storage';

const QUERY_KEY = ['planificador-es', BUDGETS_KEY];
const DRAFT_QUERY_KEY = ['planificador-es', DRAFT_KEY];
const GOALS_KEY = ['planificador-es', 'goals'];
const FACT_KEY = ['planificador-es', 'budget-fact'];
const RECORDED_KEY = ['planificador-es', 'budget-transfers'];
/** The MCP server writes drafts while the page is open: check for one this often. */
const DRAFT_POLL_MS = 10_000;

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function Metric({ label, value, hint, action }: { label: string; value: string; hint?: string; action?: ReactNode }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
      {action}
    </div>
  );
}

export function BudgetPage({ ctx }: { ctx: AddonContext }) {
  const queryClient = useQueryClient();
  const portfolio = useQuery({ queryKey: PORTFOLIO_KEY, queryFn: () => loadPortfolio(ctx) });
  const loaded = useQuery({ queryKey: QUERY_KEY, queryFn: () => loadBudgets(ctx.api.storage) });
  const draftQuery = useQuery({
    queryKey: DRAFT_QUERY_KEY,
    queryFn: () => loadDraft(ctx.api.storage),
    refetchInterval: DRAFT_POLL_MS,
  });
  const goals = useQuery({
    queryKey: GOALS_KEY,
    queryFn: () =>
      ctx.api.goals.getAll().catch((e) => {
        ctx.api.logger.warn(`goals.getAll unavailable: ${String(e)}`);
        return [];
      }),
  });
  const recorded = useQuery({
    queryKey: RECORDED_KEY,
    queryFn: () => loadRecorded(ctx.api.storage),
  });
  const [editing, setEditing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const book = loaded.data?.book;
  const active = book && activeBudget(book);
  const draft = draftQuery.data ?? null;
  const preview = previewing && draft?.budget ? draft.budget : null;
  // What the page shows: the draft while previewing it, otherwise the active budget.
  const saved = preview ?? active?.budget;
  // shortcut: the MCP forecast runs the saved targets; it catches up with the goals on the next save.
  const budget = useMemo(() => saved && withGoalTargets(saved, goals.data ?? []), [saved, goals.data]);
  const rows = useMemo(() => (budget ? runBudget(budget) : null), [budget]);
  const today = thisMonth();
  const factQuery = useQuery({
    queryKey: [...FACT_KEY, budget?.start, budget?.months, budget?.envelopes, budget?.loans, today],
    queryFn: () => loadBudgetFact(ctx, budget!, today),
    enabled: !!budget,
  });
  const fact = factQuery.data ?? { envelopes: {}, loans: {} };

  const spendingDraft: SpendingDraft = async (months) => {
    const { startDate, endDate } = lastMonths(today, months);
    const [report, categories] = await Promise.all([
      getSpendingReport(ctx, startDate, endDate),
      ctx.api.spending.getCategories(),
    ]);
    const names = new Map(categories.map((c) => [c.categoryId, c.name]));
    return spendingLines(report, names, months, { incomes: 30, expenses: 30 });
  };

  async function setGoalDate(goalId: string, month: string) {
    setActionError(null);
    const goal = goals.data?.find((g) => g.id === goalId);
    try {
      if (goal) await ctx.api.goals.update({ ...goal, targetDate: monthEnd(month) });
      await queryClient.invalidateQueries({ queryKey: GOALS_KEY });
    } catch (e) {
      setActionError(String(e));
    }
  }

  /** true — saved */
  async function change(op: (b: BudgetBook) => BudgetBook): Promise<boolean> {
    setActionError(null);
    try {
      const next = await saveBudgets(ctx.api.storage, op(book!));
      // A saved book is readable: the unreadable-record warning goes.
      queryClient.setQueryData<LoadedBudgets>(QUERY_KEY, { book: next });
      return true;
    } catch (e) {
      setActionError(String(e));
      return false;
    }
  }

  async function settleDraft(accept: boolean) {
    if (accept && !(await change((b) => applyDraft(b, draft!)))) return;
    await discardDraft(ctx.api.storage);
    queryClient.setQueryData<BudgetDraft | null>(DRAFT_QUERY_KEY, null);
    setPreviewing(false);
  }

  const error = portfolio.error ?? loaded.error;
  if (error) return <PageMessage error={error} />;
  if (!portfolio.data || !book || !active || !budget || !rows) return <PageMessage />;

  const currency = portfolio.data.currency ?? 'EUR';
  const current = rows.find((r) => r.month === today);
  const interest = rows.reduce((s, r) => s + r.interest, 0);
  const shortfall = rows.find((r) => r.unallocated < -0.5);

  return (
    <Page>
      <PageHeader
        heading={budget.name}
        text={`${rows[0].month} – ${rows.at(-1)!.month} · ${budget.months} months`}
        actions={
          <div className="flex items-center gap-2">
            <PlanSwitcher
              disabled={preview !== null}
              items={book.entries.map((e) => ({ id: e.id, name: e.budget.name }))}
              activeId={book.activeId}
              max={MAX_BUDGETS}
              noun="budget"
              onSelect={(id) => change((b) => ({ ...b, activeId: id }))}
              onNew={() =>
                change((b) =>
                  addBudget(b, {
                    ...newBudget(new Date()),
                    name: `Budget ${b.entries.length + 1}`,
                  }),
                )
              }
              onDuplicate={() =>
                change((b) => addBudget(b, { ...active.budget, name: `${active.budget.name.slice(0, 53)} (copy)` }))
              }
              onDelete={() => change((b) => deleteBudget(b, active.id))}
            />
            <Button size="sm" disabled={preview !== null} onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" /> Edit budget
            </Button>
          </div>
        }
      />
      <PageContent className="space-y-4">
        {draft && (
          <DraftCard
            draft={draft}
            target={book.entries.find((e) => e.id === draft.target)?.budget.name ?? null}
            previewing={preview !== null}
            onPreview={() => setPreviewing((p) => !p)}
            onAccept={() => settleDraft(true)}
            onReject={() => settleDraft(false)}
          />
        )}
        {actionError && (
          <Alert variant="destructive">
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        )}
        {loaded.data?.error && (
          <Alert variant="destructive">
            <AlertDescription>
              The saved budgets could not be read ({loaded.data.error}). They are kept in the addon storage under
              budgets.v1.unreadable; showing an empty budget.
            </AlertDescription>
          </Alert>
        )}
        {shortfall && (
          <Alert variant="destructive">
            <AlertDescription>
              Money runs short in {shortfall.month}: {formatMoney(-shortfall.unallocated, currency)} not covered.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="grid grid-cols-4 gap-6">
              {budget.loans.map((l) => {
                const repaid = rows.find((r) => r.loans[l.id].balance === 0);
                return (
                  <Metric
                    key={l.id}
                    label={`${l.name} repaid`}
                    value={repaid ? repaid.month : 'Not in the budget'}
                    hint={`interest ${formatMoney(
                      rows.reduce((s, r) => s + r.loans[l.id].interest, 0),
                      currency,
                    )}`}
                  />
                );
              })}
              {budget.steps.flatMap((s) => {
                if (s.kind !== 'fill') return [];
                const e = budget.envelopes.find((x) => x.id === s.envelopeId)!;
                const reached = rows.find((r) => r.balances[e.id] >= s.target - 0.5);
                const goal = goals.data?.find((g) => g.id === s.goalId);
                const date = reached && monthEnd(reached.month);
                return [
                  <Metric
                    key={`${e.id}-${s.target}`}
                    label={`${goal ? goal.title : e.name} at ${formatMoney(s.target, currency)}`}
                    value={reached ? reached.month : 'Not in the budget'}
                    hint={goal && `goal date ${goal.targetDate?.slice(0, 10) ?? 'not set'}`}
                    action={
                      goal &&
                      date &&
                      goal.targetDate?.slice(0, 10) !== date &&
                      preview === null && (
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs"
                          onClick={() => setGoalDate(goal.id, reached.month)}
                        >
                          Set goal date to {date}
                        </Button>
                      )
                    }
                  />,
                ];
              })}
              {budget.loans.length > 1 && (
                <Metric label="Interest, all loans" value={formatMoney(interest, currency)} />
              )}
            </div>
            <BudgetChart budget={budget} rows={rows} fact={fact} currency={currency} today={today} />
          </CardContent>
        </Card>

        <FactCard
          budget={budget}
          current={current}
          portfolio={portfolio.data}
          currency={currency}
          today={today}
          onRecord={preview === null ? () => setRecording(true) : undefined}
        />
        <MonthTable budget={budget} rows={rows} fact={fact} currency={currency} today={today} />

        <p className="text-muted-foreground text-xs">
          Net euros, no taxes, returns or inflation: the yearly plan models those. Loan interest accrues monthly on the
          balance; reducir cuota recomputes the payment over the whole payments left.
        </p>
      </PageContent>
      <BudgetEditor
        budget={active.budget}
        open={editing}
        portfolio={portfolio.data}
        goals={goals.data ?? []}
        currency={currency}
        spendingDraft={spendingDraft}
        onClose={() => setEditing(false)}
        onSave={async (next: Budget) => {
          await change((b) => setBudget(b, active.id, next));
          setEditing(false);
        }}
      />
      {current && recorded.data && (
        <RecordTransfersDialog
          key={`${active.id}/${today}/${recording}`}
          ctx={ctx}
          budgetId={active.id}
          budget={budget}
          row={current}
          accounts={portfolio.data.accounts}
          currency={currency}
          recorded={recorded.data}
          open={recording}
          onClose={() => setRecording(false)}
          onRecorded={() =>
            Promise.all(
              [RECORDED_KEY, PORTFOLIO_KEY, FACT_KEY].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
            )
          }
        />
      )}
    </Page>
  );
}

interface DraftCardProps {
  draft: BudgetDraft;
  /** Name of the budget it replaces; null — a new budget (or its budget was deleted since) */
  target: string | null;
  previewing: boolean;
  onPreview: () => void;
  onAccept: () => void;
  onReject: () => void;
}

/** A budget proposed through MCP: it is saved only when accepted here. */
function DraftCard({ draft, target, previewing, onPreview, onAccept, onReject }: DraftCardProps) {
  const created = draft.createdAt ? new Date(draft.createdAt).toLocaleString('en-GB') : null;
  return (
    <Alert variant={draft.budget ? 'default' : 'destructive'}>
      <AlertDescription className="space-y-2">
        <div className="font-medium">
          {target ? `Proposed changes to “${target}”` : 'Proposed new budget'}
          {draft.budget && ` — “${draft.budget.name}”`}
          {created && <span className="text-muted-foreground font-normal"> · {created}</span>}
        </div>
        {draft.note && <p>{draft.note}</p>}
        {draft.budget ? (
          previewing && <p>The page shows the draft. Accept it to save, or reject it to go back.</p>
        ) : (
          <div>
            <p>The draft does not pass validation and cannot be accepted:</p>
            <ul className="list-disc pl-5">
              {draft.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-2">
          {draft.budget && (
            <>
              <Button size="sm" variant="outline" onClick={onPreview}>
                {previewing ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {previewing ? 'Hide preview' : 'Preview'}
              </Button>
              <Button size="sm" onClick={onAccept}>
                <Check className="h-4 w-4" /> Accept
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={onReject}>
            <X className="h-4 w-4" /> Reject
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

interface FactProps {
  budget: Budget;
  /** This month's row; undefined — this month is outside the budget */
  current: BudgetMonth | undefined;
  portfolio: LoadedPortfolio;
  currency: string;
  today: string;
  /** Opens the dialog that records this month's deposits; undefined — not while previewing a draft */
  onRecord?: () => void;
}

/** Plan at the end of this month next to Wealthfolio now, for envelopes and loans linked to it. */
function FactCard({ budget, current, portfolio, currency, today, onRecord }: FactProps) {
  const liabilities = (portfolio.alternatives ?? []).filter(isLiability);
  const lines = [
    ...budget.envelopes.flatMap((e) => {
      const a = portfolio.accounts.find((x) => x.id === e.accountId);
      return a && current ? [{ name: e.name, plan: current.balances[e.id], fact: a.wfValue }] : [];
    }),
    ...budget.loans.flatMap((l) => {
      const h = liabilities.find((x) => x.id === l.liabilityId);
      return h && current
        ? [{ name: `${l.name} (owed)`, plan: current.loans[l.id].balance, fact: Math.abs(Number(h.marketValue)) }]
        : [];
    }),
  ];
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Plan vs Wealthfolio, {today}</h3>
          {current && onRecord && (
            <Button size="sm" variant="outline" onClick={onRecord}>
              Record this month's transfers…
            </Button>
          )}
        </div>
        {!current ? (
          <p className="text-muted-foreground text-sm">This month is outside the budget.</p>
        ) : !lines.length ? (
          <p className="text-muted-foreground text-sm">
            Link envelopes to accounts and loans to liabilities in the editor to compare them with Wealthfolio.
          </p>
        ) : (
          <Table className="text-sm">
            <TableHeader>
              <TableRow>
                <TableHead />
                <TableHead className="text-right">Plan, end of month</TableHead>
                <TableHead className="text-right">Wealthfolio now</TableHead>
                <TableHead className="text-right">Difference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.name}>
                  <TableCell>{l.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(l.plan, currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(l.fact, currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(l.fact - l.plan, currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

interface Column {
  label: string;
  /** undefined — no fact for the month */
  value: (r: BudgetMonth) => number | undefined;
}

function MonthTable({
  budget,
  rows,
  fact,
  currency,
  today,
}: {
  budget: Budget;
  rows: BudgetMonth[];
  fact: BudgetFact;
  currency: string;
  today: string;
}) {
  const sum = (x: Record<string, number>) => Object.values(x).reduce((s, v) => s + v, 0);
  const columns: Column[] = [
    { label: 'Income', value: (r) => r.income + r.oneTimeIncome },
    { label: 'Expenses', value: (r) => r.expenses + r.oneTimeExpenses },
    { label: 'Loan payments', value: (r) => r.loanPayments },
    { label: 'Free', value: (r) => r.free },
    ...budget.envelopes.map((e) => ({ label: `→ ${e.name}`, value: (r: BudgetMonth) => r.deposits[e.id] ?? 0 })),
    { label: 'Paid from envelopes', value: (r) => sum(r.withdrawn) },
    { label: 'Prepaid', value: (r) => sum(r.prepaid) },
    { label: 'Unallocated', value: (r) => r.unallocated },
    ...budget.envelopes.flatMap((e) => [
      { label: e.name, value: (r: BudgetMonth) => r.balances[e.id] },
      ...(fact.envelopes[e.id]
        ? [{ label: `${e.name} fact`, value: (r: BudgetMonth) => fact.envelopes[e.id][r.month] }]
        : []),
    ]),
    ...budget.loans.flatMap((l) => [
      { label: `${l.name} owed`, value: (r: BudgetMonth) => r.loans[l.id].balance },
      ...(fact.loans[l.id]
        ? [{ label: `${l.name} owed, fact`, value: (r: BudgetMonth) => fact.loans[l.id][r.month] }]
        : []),
      { label: `${l.name} next payment`, value: (r: BudgetMonth) => r.loans[l.id].payment },
    ]),
  ];
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>Month</TableHead>
            {columns.map((c) => (
              <TableHead key={c.label} className="text-right whitespace-nowrap">
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.month} className={r.month === today ? 'bg-muted/50' : undefined}>
              <TableCell className="whitespace-nowrap">{r.month}</TableCell>
              {columns.map((c) => {
                const v = c.value(r);
                return (
                  <TableCell key={c.label} className="text-right tabular-nums">
                    {v === undefined ? '—' : formatMoney(v, currency)}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
