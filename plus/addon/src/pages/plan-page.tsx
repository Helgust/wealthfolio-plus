// Страница плана в раскладке ProjectionLab: график net worth, ключевые метрики, вкладки.
// Фаза 1: работают «Taxes» и «Table», остальные вкладки — заглушки.
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from '@wealthfolio/ui';
import { Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';
import { LedgerTable } from '../components/ledger-table';
import { NetWorthChart } from '../components/net-worth-chart';
import { PlanEditor } from '../components/plan-editor';
import { TaxesTab } from '../components/taxes-tab';
import { runPlan, type PlanResult } from '../engine/run-plan';
import { availableYears } from '../es-tax';
import { formatMoney, inMode, type ValueMode } from '../lib/format';
import { loadStartingPoint } from '../lib/starting-point';
import type { Plan } from '../model/plan';
import { loadPlan, savePlan, type LoadedPlan } from '../model/plan-storage';

const PLAN_KEY = ['planificador-es', 'plan'];
const START_KEY = ['planificador-es', 'start'];
export const CHECKS_ROUTE = '/addons/planificador-es/checks';
const lastRulesYear = availableYears().at(-1);

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
    </div>
  );
}

function Stub({ children }: { children: string }) {
  return (
    <Card>
      <CardContent className="text-muted-foreground py-10 text-center text-sm">{children}</CardContent>
    </Card>
  );
}

export function PlanPage({ ctx }: { ctx: AddonContext }) {
  const firstYear = new Date().getFullYear();
  const queryClient = useQueryClient();
  const start = useQuery({ queryKey: START_KEY, queryFn: () => loadStartingPoint(ctx) });
  const loaded = useQuery({ queryKey: PLAN_KEY, queryFn: () => loadPlan(ctx, firstYear) });
  const [mode, setMode] = useState<ValueMode>('nominal');
  const [editing, setEditing] = useState(false);

  const plan = loaded.data?.plan;
  const result = useMemo(
    () => (plan && start.data ? runPlan(plan, start.data) : null),
    [plan, start.data],
  );
  // Для пары считаем и другой вид декларации — сравнение на вкладке «Taxes».
  const alternative = useMemo<PlanResult | null>(() => {
    if (!plan || !start.data || plan.people.length !== 2) return null;
    return runPlan(plan, start.data, plan.filing === 'joint' ? 'individual' : 'joint');
  }, [plan, start.data]);

  async function save(next: Plan) {
    await savePlan(ctx, next);
    queryClient.setQueryData<LoadedPlan>(PLAN_KEY, { plan: next, isDefault: false });
    setEditing(false);
  }

  const error = start.error ?? loaded.error;
  if (error) {
    return (
      <Page>
        <PageContent>
          <Alert variant="destructive">
            <AlertDescription>Could not load data: {String(error)}</AlertDescription>
          </Alert>
        </PageContent>
      </Page>
    );
  }
  if (!plan || !start.data || !result || !loaded.data) {
    return (
      <Page>
        <PageContent>
          <p className="text-muted-foreground text-sm">Loading…</p>
        </PageContent>
      </Page>
    );
  }

  const currency = start.data.currency ?? 'EUR';
  const rows = result.rows;
  const last = rows[rows.length - 1];
  const taxes = rows.reduce((s, r) => s + inMode(r.irpf + r.reta, r.deflator, mode), 0);
  const cashOut = rows.find((r) => r.cash < 0);

  return (
    <Page>
      <PageHeader
        heading={plan.name}
        text={`${plan.startYear}–${last.year} · ${plan.people.map((p) => p.name).join(' & ')}`}
        actions={
          <div className="flex items-center gap-2">
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(v) => v && setMode(v as ValueMode)}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="nominal">Nominal</ToggleGroupItem>
              <ToggleGroupItem value="today">Today's euros</ToggleGroupItem>
            </ToggleGroup>
            <Button size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" /> Edit plan
            </Button>
          </div>
        }
      />
      <PageContent className="space-y-4">
        {loaded.data.isDefault && (
          <Alert>
            <AlertDescription>
              {loaded.data.error
                ? `The saved plan could not be read (${loaded.data.error}). Showing a template.`
                : 'This is a template plan with placeholder amounts. Edit it to enter your own.'}
            </AlertDescription>
          </Alert>
        )}
        {currency !== 'EUR' && (
          <Alert variant="destructive">
            <AlertDescription>
              Base currency is {currency}; Spanish taxes are computed in euros. Amounts are mixed.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="grid grid-cols-4 gap-6">
              <Metric
                label="Net worth today"
                value={formatMoney(start.data.netWorth, currency)}
                hint={start.data.exact ? 'from Wealthfolio' : 'sum of accounts (no alternative assets)'}
              />
              <Metric
                label={`Net worth in ${last.year}`}
                value={formatMoney(inMode(last.netWorth, last.deflator, mode), currency)}
              />
              <Metric label="IRPF + RETA over the plan" value={formatMoney(taxes, currency)} />
              <Metric
                label="Cash"
                value={cashOut ? `Runs out in ${cashOut.year}` : 'Lasts the whole plan'}
                hint={`starts at ${formatMoney(start.data.cash, currency)} (cash accounts)`}
              />
            </div>
            <NetWorthChart rows={rows} currency={currency} mode={mode} />
          </CardContent>
        </Card>

        <Tabs defaultValue="taxes">
          <TabsList>
            <TabsTrigger value="plan">Plan</TabsTrigger>
            <TabsTrigger value="cashflow">Cash flow</TabsTrigger>
            <TabsTrigger value="taxes">Taxes</TabsTrigger>
            <TabsTrigger value="montecarlo">Monte Carlo</TabsTrigger>
            <TabsTrigger value="table">Table</TabsTrigger>
          </TabsList>
          <TabsContent value="plan">
            <Stub>Income, expense and milestone cards come in phase 3. Use “Edit plan” for now.</Stub>
          </TabsContent>
          <TabsContent value="cashflow">
            <Stub>Cash-flow Sankey comes in phase 3.</Stub>
          </TabsContent>
          <TabsContent value="taxes">
            <TaxesTab result={result} alternative={alternative} currency={currency} mode={mode} />
          </TabsContent>
          <TabsContent value="montecarlo">
            <Stub>Monte Carlo and historical backtesting come in phase 4.</Stub>
          </TabsContent>
          <TabsContent value="table">
            <LedgerTable rows={rows} currency={currency} mode={mode} />
          </TabsContent>
        </Tabs>

        <p className="text-muted-foreground text-xs">
          Phase 1 model: autónomo income, RETA, IRPF and household expenses; investments do not
          grow yet (phase 2). Tax rules after {lastRulesYear} are frozen at {lastRulesYear}.{' '}
          <button className="underline" onClick={() => ctx.api.navigation.navigate(CHECKS_ROUTE)}>
            Sandbox checks
          </button>
        </p>
      </PageContent>
      <PlanEditor plan={plan} open={editing} onOpenChange={setEditing} onSave={save} />
    </Page>
  );
}
