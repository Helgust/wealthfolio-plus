// Phase 0: learning tests of the addon sandbox (see plus/docs/wealthfolio-plan.md, phase 0 section).
import { useQuery } from '@tanstack/react-query';
import type { AddonContext } from '@wealthfolio/addon-sdk';
import { useAddonTranslation } from '@wealthfolio/addon-sdk';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@wealthfolio/ui';
import { useState } from 'react';
import { getAlternativeHoldings } from '../lib/fork-api';
import { runBench, type BenchResult } from '../lib/phase0-bench';

const BLOB_KEY = 'phase0.blob';
const LAST_RUN_KEY = 'phase0.lastRun';
const BLOB_BYTES = 100_000;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">{children}</CardContent>
    </Card>
  );
}

function Verdict({ ok }: { ok: boolean }) {
  return <Badge variant={ok ? 'default' : 'destructive'}>{ok ? 'OK' : 'FAIL'}</Badge>;
}

async function loadPortfolio(ctx: AddonContext) {
  const accounts = await ctx.api.accounts.getAll();
  const perAccount = await Promise.all(
    accounts.map(async (account) => {
      const holdings = await ctx.api.portfolio.getHoldings(account.id);
      const lots = holdings.reduce((n, h) => n + (h.lots?.length ?? 0), 0);
      return { account, holdings: holdings.length, lots };
    }),
  );
  const valuations = await ctx.api.portfolio.getHistoricalValuations();
  const income = await ctx.api.portfolio.getIncomeSummary();
  const alternatives = await getAlternativeHoldings(ctx);
  return { perAccount, valuations: valuations.length, income, alternatives };
}

function DataSection({ ctx }: { ctx: AddonContext }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['phase0', 'portfolio'],
    queryFn: () => loadPortfolio(ctx),
  });
  if (isLoading) return <Section title="1. Wealthfolio data">Loading…</Section>;
  if (error) return <Section title="1. Wealthfolio data">Error: {String(error)}</Section>;
  if (!data) return null;
  return (
    <Section title="1. Wealthfolio data">
      <p>
        Accounts: {data.perAccount.length}; days of valuation history: {data.valuations}; income
        periods: {data.income.length}
      </p>
      <ul className="list-disc pl-5">
        {data.perAccount.map(({ account, holdings, lots }) => (
          <li key={account.id}>
            {account.name} ({account.accountType}, {account.trackingMode}): holdings {holdings},
            lots {lots}
          </li>
        ))}
      </ul>
      {data.alternatives === null ? (
        <p className="text-muted-foreground">
          Alternative assets and debts: method unavailable — official build without the fork change.
        </p>
      ) : (
        <>
          <p>Alternative assets and debts: {data.alternatives.length}</p>
          <ul className="list-disc pl-5">
            {data.alternatives.map((a) => (
              <li key={a.id}>
                {a.name} ({a.kind}): {a.marketValue} {a.currency} as of {a.valuationDate}
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

interface StorageCheck {
  previousRun: string | null;
  previousBlobOk: boolean;
  roundTripOk: boolean;
  ms: number;
}

// Resembles a future plan: an array of rows with numbers. ~40 bytes per row.
function makeBlob(): string {
  const rows = Array.from({ length: BLOB_BYTES / 40 }, (_, i) => ({
    year: 2026 + i,
    value: i * 1234.5678,
  }));
  return JSON.stringify({ rows });
}

async function checkStorage(ctx: AddonContext): Promise<StorageCheck> {
  const t0 = performance.now();
  const previousRun = await ctx.api.storage.get(LAST_RUN_KEY);
  const previousBlob = await ctx.api.storage.get(BLOB_KEY);
  const blob = makeBlob();
  await ctx.api.storage.set(BLOB_KEY, blob);
  const readBack = await ctx.api.storage.get(BLOB_KEY);
  await ctx.api.storage.set(LAST_RUN_KEY, new Date().toISOString());
  return {
    previousRun,
    previousBlobOk: previousBlob === blob,
    roundTripOk: readBack === blob,
    ms: performance.now() - t0,
  };
}

function StorageSection({ ctx }: { ctx: AddonContext }) {
  const [result, setResult] = useState<StorageCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    setError(null);
    checkStorage(ctx).then(setResult, (e) => setError(String(e)));
  };
  return (
    <Section title={`2. storage: ${BLOB_BYTES / 1000} KB of JSON`}>
      <Button onClick={run}>Write and read</Button>
      {error && <p className="text-destructive">Error: {error}</p>}
      {result && (
        <>
          <p>
            Write and read: <Verdict ok={result.roundTripOk} /> in {result.ms.toFixed(0)} ms
          </p>
          <p>
            Previous run: {result.previousRun ?? 'none (first run)'}
            {result.previousRun && (
              <>
                {' '}
                — data from the previous run is intact: <Verdict ok={result.previousBlobOk} />
              </>
            )}
          </p>
        </>
      )}
      <p className="text-muted-foreground">
        Survives a restart: click, restart Wealthfolio, click again.
      </p>
    </Section>
  );
}

function BenchSection() {
  const [runs, setRuns] = useState<BenchResult[]>([]);
  const last = runs[runs.length - 1];
  return (
    <Section title="3. Draft engine: 1,000 trajectories × 40 years">
      <Button onClick={() => setRuns([...runs, runBench()])}>Run</Button>
      {last && (
        <p>
          Run #{runs.length}: {last.ms.toFixed(0)} ms (budget 2,000):{' '}
          <Verdict ok={last.ms < 2_000} />
          {runs.length > 1 && <> · all runs, ms: {runs.map((r) => r.ms.toFixed(0)).join(', ')}</>}
        </p>
      )}
      <p className="text-muted-foreground">
        Synthetic load (fixed seed); only the time matters. The main thread is busy for exactly that time.
      </p>
    </Section>
  );
}

function LanguageSection() {
  const { t, language } = useAddonTranslation();
  return (
    <Section title="4. Localization">
      <p>
        Host language: <code>{language}</code>; string: "{t('phase0.greeting')}"
      </p>
      <p className="text-muted-foreground">
        The host knows only en, fr, de, es, pt, zh, zh-Hant, ja, ko, it: the <code>ru</code>{' '}
        bundle is registered but never selected.
      </p>
    </Section>
  );
}

export function Phase0Page({ ctx }: { ctx: AddonContext }) {
  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Planificador ES — phase 0 checks</h1>
      <DataSection ctx={ctx} />
      <StorageSection ctx={ctx} />
      <BenchSection />
      <LanguageSection />
    </div>
  );
}
