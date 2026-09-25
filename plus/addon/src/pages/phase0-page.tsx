// Фаза 0: learning tests песочницы аддона (см. plus/docs/wealthfolio-plan.md, «Фаза 0»).
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
  if (isLoading) return <Section title="1. Данные Wealthfolio">Загрузка…</Section>;
  if (error) return <Section title="1. Данные Wealthfolio">Ошибка: {String(error)}</Section>;
  if (!data) return null;
  return (
    <Section title="1. Данные Wealthfolio">
      <p>
        Счетов: {data.perAccount.length}; дней истории стоимости: {data.valuations}; периодов
        доходов: {data.income.length}
      </p>
      <ul className="list-disc pl-5">
        {data.perAccount.map(({ account, holdings, lots }) => (
          <li key={account.id}>
            {account.name} ({account.accountType}, {account.trackingMode}): позиций {holdings},
            лотов {lots}
          </li>
        ))}
      </ul>
      {data.alternatives === null ? (
        <p className="text-muted-foreground">
          Альтернативные активы и долги: метод недоступен — официальная сборка без правки форка.
        </p>
      ) : (
        <>
          <p>Альтернативных активов и долгов: {data.alternatives.length}</p>
          <ul className="list-disc pl-5">
            {data.alternatives.map((a) => (
              <li key={a.id}>
                {a.name} ({a.kind}): {a.marketValue} {a.currency} на {a.valuationDate}
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

// Похоже на будущий план: массив строк с числами. ~40 байт на строку.
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
    <Section title={`2. storage: JSON на ${BLOB_BYTES / 1000} КБ`}>
      <Button onClick={run}>Записать и прочитать</Button>
      {error && <p className="text-destructive">Ошибка: {error}</p>}
      {result && (
        <>
          <p>
            Запись и чтение: <Verdict ok={result.roundTripOk} /> за {result.ms.toFixed(0)} мс
          </p>
          <p>
            Прошлый запуск: {result.previousRun ?? 'нет (первый запуск)'}
            {result.previousRun && (
              <>
                {' '}
                — данные с прошлого запуска целы: <Verdict ok={result.previousBlobOk} />
              </>
            )}
          </p>
        </>
      )}
      <p className="text-muted-foreground">
        Переживание перезапуска: нажать, перезапустить Wealthfolio, нажать снова.
      </p>
    </Section>
  );
}

function BenchSection() {
  const [runs, setRuns] = useState<BenchResult[]>([]);
  const last = runs[runs.length - 1];
  return (
    <Section title="3. Черновой движок: 1 000 траекторий × 40 лет">
      <Button onClick={() => setRuns([...runs, runBench()])}>Запустить</Button>
      {last && (
        <p>
          Запуск №{runs.length}: {last.ms.toFixed(0)} мс (бюджет 2 000):{' '}
          <Verdict ok={last.ms < 2_000} />
          {runs.length > 1 && <> · все запуски, мс: {runs.map((r) => r.ms.toFixed(0)).join(', ')}</>}
        </p>
      )}
      <p className="text-muted-foreground">
        Нагрузка условная (seed фиксирован), важно только время. Главный поток занят ровно это время.
      </p>
    </Section>
  );
}

function LanguageSection() {
  const { t, language } = useAddonTranslation();
  return (
    <Section title="4. Локализация">
      <p>
        Язык хоста: <code>{language}</code>; строка: «{t('phase0.greeting')}»
      </p>
      <p className="text-muted-foreground">
        Хост знает только en, fr, de, es, pt, zh, zh-Hant, ja, ko, it: пакет <code>ru</code>{' '}
        зарегистрирован, но не выбирается.
      </p>
    </Section>
  );
}

export function Phase0Page({ ctx }: { ctx: AddonContext }) {
  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Planificador ES — проверки фазы 0</h1>
      <DataSection ctx={ctx} />
      <StorageSection ctx={ctx} />
      <BenchSection />
      <LanguageSection />
    </div>
  );
}
