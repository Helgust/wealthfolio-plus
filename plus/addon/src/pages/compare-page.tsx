// Compare page: net worth of up to three plans on one chart and key metrics with the difference to
// plan A. Every plan starts from the same current Wealthfolio data.
import type { AddonContext } from '@wealthfolio/addon-sdk';
import {
  Card,
  CardContent,
  Page,
  PageContent,
  PageHeader,
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
  ToggleGroup,
  ToggleGroupItem,
} from '@wealthfolio/ui';
import { useMemo, useState } from 'react';
import { CompareChart, SLOT_COUNT, SlotColorScope, SlotSwatch, type ComparedRun } from '../components/compare-chart';
import { PageMessage } from '../components/page-message';
import { runPlan } from '../engine/run-plan';
import { usePlannerData } from '../hooks/use-planner-data';
import { commonEndYear, planMetrics, type PlanMetrics } from '../lib/compare';
import { formatMoney, type ValueMode } from '../lib/format';
import type { PlanBook } from '../model/plan-storage';

const NONE = 'none';
const slotName = (i: number) => `Plan ${'ABC'[i]}`;

/** By default: the active plan, then the other plans in order. */
function defaultSlots(book: PlanBook): (string | null)[] {
  const others = book.entries.map((e) => e.id).filter((id) => id !== book.activeId);
  return Array.from({ length: SLOT_COUNT }, (_, i) => (i === 0 ? book.activeId : (others[i - 1] ?? null)));
}

interface MetricRow {
  label: string;
  value: (m: PlanMetrics) => number | null;
  /** Money, shown with the difference to plan A; otherwise a year */
  money: boolean;
  /** Shown for null */
  empty: string;
}

export function ComparePage({ ctx }: { ctx: AddonContext }) {
  const { portfolio, book, start, error } = usePlannerData(ctx);
  const [mode, setMode] = useState<ValueMode>('nominal');
  // null — nothing picked yet: slots follow defaultSlots.
  const [picked, setPicked] = useState<(string | null)[] | null>(null);

  // A picked plan that was deleted since leaves its slot empty.
  const slots = useMemo(() => {
    if (!book) return [];
    return (picked ?? defaultSlots(book)).map((id) => (book.entries.some((e) => e.id === id) ? id : null));
  }, [book, picked]);
  const runs = useMemo<(ComparedRun | null)[]>(
    () =>
      slots.map((id) => {
        const entry = book?.entries.find((e) => e.id === id);
        return entry && start ? { name: entry.plan.name, rows: runPlan(entry.plan, start).rows } : null;
      }),
    [book, start, slots],
  );

  if (error) return <PageMessage error={error} />;
  if (!book || !start || !portfolio) return <PageMessage />;

  const currency = portfolio.currency ?? 'EUR';
  const present = runs.filter((r): r is ComparedRun => r !== null);
  const common = present.length ? commonEndYear(present.map((r) => r.rows)) : 0;
  const metrics = runs.map((r) => (r ? planMetrics(r.rows, mode, common) : null));
  const rows: MetricRow[] = [
    { label: `Net worth in ${common}`, value: (m) => m.netWorthAtCommon, money: true, empty: '—' },
    { label: 'Net worth at the end', value: (m) => m.endNetWorth, money: true, empty: '—' },
    { label: 'Last year', value: (m) => m.endYear, money: false, empty: '—' },
    { label: 'IRPF + RETA over the plan', value: (m) => m.taxes, money: true, empty: '—' },
    { label: 'Household expenses over the plan', value: (m) => m.spending, money: true, empty: '—' },
    { label: 'Cash runs out', value: (m) => m.cashRunsOut, money: false, empty: 'Never' },
  ];

  function pick(slot: number, id: string) {
    const next = [...slots];
    next[slot] = id === NONE ? null : id;
    setPicked(next);
  }

  function cell(row: MetricRow, slot: number) {
    const m = metrics[slot];
    if (!m) return null;
    const v = row.value(m);
    if (v === null) return row.empty;
    if (!row.money) return String(v);
    const base = metrics[0] ? row.value(metrics[0]) : null;
    return (
      <>
        <div>{formatMoney(v, currency)}</div>
        {slot > 0 && base !== null && (
          <div className="text-muted-foreground text-xs">
            {v > base ? '+' : ''}
            {formatMoney(v - base, currency)} vs A
          </div>
        )}
      </>
    );
  }

  return (
    <Page>
      <PageHeader
        heading="Compare plans"
        text="Every plan starts from your current Wealthfolio data."
        actions={
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
        }
      />
      <PageContent>
        <SlotColorScope>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              {slots.map((id, i) => (
                <div key={i} className="space-y-1">
                  <div className="text-muted-foreground flex items-center gap-2 text-xs">
                    <SlotSwatch slot={i} />
                    {slotName(i)}
                    {i === 0 && ' · baseline'}
                  </div>
                  <Select value={id ?? NONE} onValueChange={(v) => pick(i, v)}>
                    <SelectTrigger aria-label={slotName(i)}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {i > 0 && <SelectItem value={NONE}>None</SelectItem>}
                      {book.entries.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.plan.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {book.entries.length < 2 && (
              <p className="text-muted-foreground text-sm">
                There is only one plan. Duplicate it on the plan page, change something, and compare.
              </p>
            )}

            <Card>
              <CardContent className="pt-6">
                <CompareChart runs={runs} currency={currency} mode={mode} />
              </CardContent>
            </Card>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead />
                    {runs.map((r, i) => (
                      <TableHead key={i} className="text-right">
                        {r && (
                          <span className="inline-flex items-center gap-2">
                            <SlotSwatch slot={i} />
                            {slotName(i)} · {r.name}
                          </span>
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.label}>
                      <TableCell>{row.label}</TableCell>
                      {runs.map((_, i) => (
                        <TableCell key={i} className="text-right tabular-nums">
                          {cell(row, i)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </SlotColorScope>
      </PageContent>
    </Page>
  );
}
