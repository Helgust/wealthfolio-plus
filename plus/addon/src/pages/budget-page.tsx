// Budget page: a month-by-month short-term plan — key dates, plan vs Wealthfolio for this month,
// envelope and loan balances, the table by month.
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
import { Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BudgetChart } from '../components/budget-chart';
import { BudgetEditor } from '../components/budget-editor';
import { PageMessage } from '../components/page-message';
import { PlanSwitcher } from '../components/plan-switcher';
import { runBudget, type BudgetMonth } from '../engine/budget';
import { PORTFOLIO_KEY } from '../hooks/use-planner-data';
import { formatMoney } from '../lib/format';
import { isLiability, loadPortfolio, type LoadedPortfolio } from '../lib/starting-point';
import { newBudget, type Budget } from '../model/budget';
import {
  activeBudget,
  addBudget,
  BUDGETS_KEY,
  deleteBudget,
  loadBudgets,
  MAX_BUDGETS,
  saveBudgets,
  setBudget,
  type BudgetBook,
  type LoadedBudgets,
} from '../model/budget-storage';

const QUERY_KEY = ['planificador-es', BUDGETS_KEY];

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
    </div>
  );
}

export function BudgetPage({ ctx }: { ctx: AddonContext }) {
  const queryClient = useQueryClient();
  const portfolio = useQuery({ queryKey: PORTFOLIO_KEY, queryFn: () => loadPortfolio(ctx) });
  const loaded = useQuery({ queryKey: QUERY_KEY, queryFn: () => loadBudgets(ctx.api.storage) });
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const book = loaded.data?.book;
  const active = book && activeBudget(book);
  const budget = active?.budget;
  const rows = useMemo(() => (budget ? runBudget(budget) : null), [budget]);

  async function change(op: (b: BudgetBook) => BudgetBook) {
    setActionError(null);
    try {
      const next = await saveBudgets(ctx.api.storage, op(book!));
      // A saved book is readable: the unreadable-record warning goes.
      queryClient.setQueryData<LoadedBudgets>(QUERY_KEY, { book: next });
    } catch (e) {
      setActionError(String(e));
    }
  }

  const error = portfolio.error ?? loaded.error;
  if (error) return <PageMessage error={error} />;
  if (!portfolio.data || !book || !active || !budget || !rows) return <PageMessage />;

  const currency = portfolio.data.currency ?? 'EUR';
  const today = thisMonth();
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
              onDuplicate={() => change((b) => addBudget(b, { ...budget, name: `${budget.name.slice(0, 53)} (copy)` }))}
              onDelete={() => change((b) => deleteBudget(b, active.id))}
            />
            <Button size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" /> Edit budget
            </Button>
          </div>
        }
      />
      <PageContent className="space-y-4">
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
                return [
                  <Metric
                    key={`${e.id}-${s.target}`}
                    label={`${e.name} at ${formatMoney(s.target, currency)}`}
                    value={reached ? reached.month : 'Not in the budget'}
                  />,
                ];
              })}
              {budget.loans.length > 1 && (
                <Metric label="Interest, all loans" value={formatMoney(interest, currency)} />
              )}
            </div>
            <BudgetChart budget={budget} rows={rows} currency={currency} today={today} />
          </CardContent>
        </Card>

        <FactCard budget={budget} current={current} portfolio={portfolio.data} currency={currency} today={today} />
        <MonthTable budget={budget} rows={rows} currency={currency} today={today} />

        <p className="text-muted-foreground text-xs">
          Net euros, no taxes, returns or inflation: the yearly plan models those. Loan interest accrues monthly on the
          balance; reducir cuota recomputes the payment over the whole payments left.
        </p>
      </PageContent>
      <BudgetEditor
        budget={budget}
        open={editing}
        portfolio={portfolio.data}
        currency={currency}
        onClose={() => setEditing(false)}
        onSave={async (next: Budget) => {
          await change((b) => setBudget(b, active.id, next));
          setEditing(false);
        }}
      />
    </Page>
  );
}

interface FactProps {
  budget: Budget;
  /** This month's row; undefined — this month is outside the budget */
  current: BudgetMonth | undefined;
  portfolio: LoadedPortfolio;
  currency: string;
  today: string;
}

/** Plan at the end of this month next to Wealthfolio now, for envelopes and loans linked to it. */
function FactCard({ budget, current, portfolio, currency, today }: FactProps) {
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
        <h3 className="font-medium">Plan vs Wealthfolio, {today}</h3>
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
  value: (r: BudgetMonth) => number;
}

function MonthTable({
  budget,
  rows,
  currency,
  today,
}: {
  budget: Budget;
  rows: BudgetMonth[];
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
    ...budget.envelopes.map((e) => ({ label: e.name, value: (r: BudgetMonth) => r.balances[e.id] })),
    ...budget.loans.flatMap((l) => [
      { label: `${l.name} owed`, value: (r: BudgetMonth) => r.loans[l.id].balance },
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
              {columns.map((c) => (
                <TableCell key={c.label} className="text-right tabular-nums">
                  {formatMoney(c.value(r), currency)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
