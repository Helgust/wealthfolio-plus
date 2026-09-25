// Plan page in the ProjectionLab layout: net worth chart, key metrics, tabs.
// Monte Carlo is a stub.
import { useQueryClient } from '@tanstack/react-query';
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
import { AccountsTab } from '../components/accounts-tab';
import { CashflowTab } from '../components/cashflow-tab';
import { LedgerTable } from '../components/ledger-table';
import { NetWorthChart } from '../components/net-worth-chart';
import { PageMessage } from '../components/page-message';
import { PlanEditor, type EditorSection } from '../components/plan-editor';
import { PlanSwitcher } from '../components/plan-switcher';
import { PlanTab } from '../components/plan-tab';
import { RealEstateSettingsTable } from '../components/real-estate-settings';
import { TaxesTab } from '../components/taxes-tab';
import { YearPanel } from '../components/year-panel';
import { runPlan, type PlanResult } from '../engine/run-plan';
import { availableYears } from '../es-tax';
import { REAL_ESTATE_KEY, SETTINGS_KEY, usePlannerData } from '../hooks/use-planner-data';
import { formatMoney, inMode, type ValueMode } from '../lib/format';
import { saveAccountSettings, type AccountSettings } from '../model/accounts';
import { saveRealEstateSettings, type RealEstateSettings } from '../model/properties';
import { defaultPlan, type Plan } from '../model/plan';
import {
  activeEntry,
  addPlan,
  deletePlan,
  savePlan,
  selectPlan,
  type PlanBook,
} from '../model/plan-storage';

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
  const queryClient = useQueryClient();
  const { portfolio, settings, realEstate, book, start, error, changePlans } = usePlannerData(ctx);
  const [mode, setMode] = useState<ValueMode>('nominal');
  const [editing, setEditing] = useState<EditorSection | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const active = book && activeEntry(book);
  const plan = active?.plan;
  const result = useMemo(() => (plan && start ? runPlan(plan, start) : null), [plan, start]);
  // For a couple, also compute the other filing type — compared on the "Taxes" tab.
  const alternative = useMemo<PlanResult | null>(() => {
    if (!plan || !start || plan.people.length !== 2) return null;
    return runPlan(plan, start, plan.filing === 'joint' ? 'individual' : 'joint');
  }, [plan, start]);

  async function save(next: Plan) {
    await changePlans((b) => savePlan(ctx.api.storage, b, active!.id, next));
    setEditing(null);
  }

  async function run(op: (b: PlanBook) => Promise<PlanBook>) {
    setActionError(null);
    try {
      await changePlans(op);
    } catch (e) {
      setActionError(String(e));
    }
  }

  async function saveSettings(next: AccountSettings) {
    queryClient.setQueryData<AccountSettings>(SETTINGS_KEY, next);
    await saveAccountSettings(ctx, next);
  }

  async function saveRealEstate(next: RealEstateSettings) {
    queryClient.setQueryData<RealEstateSettings>(REAL_ESTATE_KEY, next);
    await saveRealEstateSettings(ctx, next);
  }

  if (error) return <PageMessage error={error} />;
  if (!plan || !active || !book || !start || !portfolio || !settings || !realEstate || !result) {
    return <PageMessage />;
  }

  const currency = portfolio.currency ?? 'EUR';
  const startCash = start.accounts.filter((a) => a.kind === 'cash').reduce((s, a) => s + a.cash, 0);
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
            <PlanSwitcher
              book={book}
              onSelect={(id) => run((b) => selectPlan(ctx.api.storage, b, id))}
              onNew={() =>
                run((b) =>
                  addPlan(ctx.api.storage, b, {
                    ...defaultPlan(new Date().getFullYear()),
                    name: `Plan ${b.entries.length + 1}`,
                  }),
                )
              }
              onDuplicate={() =>
                run((b) => addPlan(ctx.api.storage, b, { ...plan, name: `${plan.name.slice(0, 73)} (copy)` }))
              }
              onDelete={() => run((b) => deletePlan(ctx.api.storage, b, active.id))}
            />
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
            <Button size="sm" onClick={() => setEditing('all')}>
              <Pencil className="h-4 w-4" /> Edit plan
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
        {active.isDefault && (
          <Alert>
            <AlertDescription>
              {active.error
                ? `The saved plan could not be read (${active.error}). Showing a template.`
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
                value={formatMoney(start.netWorth, currency)}
                hint={portfolio.exact ? 'from Wealthfolio' : 'sum of accounts (no alternative assets)'}
              />
              <Metric
                label={`Net worth in ${last.year}`}
                value={formatMoney(inMode(last.netWorth, last.deflator, mode), currency)}
              />
              <Metric label="IRPF + RETA over the plan" value={formatMoney(taxes, currency)} />
              <Metric
                label="Cash"
                value={cashOut ? `Runs out in ${cashOut.year}` : 'Lasts the whole plan'}
                hint={`starts at ${formatMoney(startCash, currency)} (cash accounts)`}
              />
            </div>
            <NetWorthChart
              rows={rows}
              currency={currency}
              mode={mode}
              milestoneNames={Object.fromEntries(plan.milestones.map((m) => [m.id, m.name]))}
              onYearClick={setYear}
            />
          </CardContent>
        </Card>

        <Tabs defaultValue="plan">
          <TabsList>
            <TabsTrigger value="plan">Plan</TabsTrigger>
            <TabsTrigger value="cashflow">Cash flow</TabsTrigger>
            <TabsTrigger value="taxes">Taxes</TabsTrigger>
            <TabsTrigger value="montecarlo">Monte Carlo</TabsTrigger>
            <TabsTrigger value="table">Table</TabsTrigger>
            <TabsTrigger value="accounts">Accounts</TabsTrigger>
          </TabsList>
          <TabsContent value="plan">
            <PlanTab
              plan={plan}
              result={result}
              accounts={start.accounts}
              properties={start.properties ?? []}
              loans={start.loans ?? []}
              currency={currency}
              onEdit={setEditing}
            />
          </TabsContent>
          <TabsContent value="cashflow">
            <CashflowTab rows={rows} currency={currency} mode={mode} />
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
          <TabsContent value="accounts">
            <AccountsTab
              portfolio={portfolio}
              settings={settings}
              people={plan.people.map((p) => p.name)}
              currency={currency}
              onChange={saveSettings}
            />
            <h3 className="pt-6 pb-2 font-medium">Real estate and loans</h3>
            <RealEstateSettingsTable
              alternatives={portfolio.alternatives}
              settings={realEstate}
              people={plan.people.map((p) => p.name)}
              currency={currency}
              onChange={saveRealEstate}
            />
          </TabsContent>
        </Tabs>

        <p className="text-muted-foreground text-xs">
          Deterministic projection with constant returns. Tax rules after {lastRulesYear}:{' '}
          {plan.taxRules === 'indexed' ? 'thresholds indexed to inflation' : `frozen at ${lastRulesYear}`}.{' '}
          <button className="underline" onClick={() => ctx.api.navigation.navigate(CHECKS_ROUTE)}>
            Sandbox checks
          </button>
        </p>
      </PageContent>
      <PlanEditor
        plan={plan}
        accounts={start.accounts}
        properties={start.properties ?? []}
        section={editing}
        onClose={() => setEditing(null)}
        onSave={save}
      />
      <YearPanel
        row={rows.find((r) => r.year === year) ?? null}
        plan={plan}
        currency={currency}
        mode={mode}
        onClose={() => setYear(null)}
      />
    </Page>
  );
}
