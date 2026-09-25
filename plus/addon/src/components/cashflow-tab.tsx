// "Cash flow" tab: where the money of a year came from and where it went — a Sankey through the
// household cash flow, and the same numbers as a table. Both sides add up (lib/cashflow.ts).
import {
  Button,
  Card,
  CardContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@wealthfolio/ui';
import { ChartContainer, ChartStyle, Sankey, type ChartConfig } from '@wealthfolio/ui/chart';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { LedgerRow } from '../engine/run-plan';
import { yearFlows, type FlowGroup, type FlowItem } from '../lib/cashflow';
import { formatMoney, type ValueMode } from '../lib/format';
import { FOREST, OCHRE, TERRACOTTA } from './palette';

// Uses are colored by group, in the column order taxes → spending → saving (adjacent pairs pass;
// terracotta and forest are never neighbors). Sources and the hub stay neutral: labels name them.
const config = {
  taxes: { label: 'Taxes', theme: TERRACOTTA },
  spending: { label: 'Spending', theme: OCHRE },
  saving: { label: 'Saving', theme: FOREST },
} satisfies ChartConfig;

const NEUTRAL = 'var(--muted-foreground)';
const groupColor = (g: FlowGroup | 'hub') => (g === 'taxes' || g === 'spending' || g === 'saving' ? `var(--color-${g})` : NEUTRAL);

interface Props {
  rows: LedgerRow[];
  currency: string;
  mode: ValueMode;
}

interface SankeyNodeData {
  name: string;
  group: FlowGroup | 'hub';
  side: 'source' | 'hub' | 'use';
}

export function CashflowTab({ rows, currency, mode }: Props) {
  const [year, setYear] = useState(rows[0].year);
  const i = Math.max(rows.findIndex((r) => r.year === year), 0);
  const row = rows[i];
  const flows = yearFlows(row, mode);
  const money = (v: number) => formatMoney(v, currency);

  const nodes: SankeyNodeData[] = [
    ...flows.sources.map((s) => ({ name: s.label, group: s.group, side: 'source' as const })),
    { name: 'Cash flow', group: 'hub', side: 'hub' },
    ...flows.uses.map((u) => ({ name: u.label, group: u.group, side: 'use' as const })),
  ];
  const hub = flows.sources.length;
  const links = [
    ...flows.sources.map((s, k) => ({ source: k, target: hub, value: s.value })),
    ...flows.uses.map((u, k) => ({ source: hub, target: hub + 1 + k, value: u.value })),
  ];

  return (
    // The group colors are defined for the whole tab: the tables below use them too.
    <div className="space-y-4" data-chart="cashflow-groups">
      <ChartStyle id="cashflow-groups" config={config} />
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous year" disabled={i === 0} onClick={() => setYear(rows[i - 1].year)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Select value={String(row.year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger aria-label="Year" style={{ width: 160 }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {rows.map((r) => (
              <SelectItem key={r.year} value={String(r.year)}>
                {r.year} · age {r.people.map((p) => p.age).join(' / ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next year"
          disabled={i === rows.length - 1}
          onClick={() => setYear(rows[i + 1].year)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="text-muted-foreground text-sm">
          {money(flows.total)} moved in {row.year}
          {mode === 'today' ? ', euros of the first year' : ''}
        </span>
      </div>

      <Card>
        <CardContent className="pt-6">
          {flows.total <= 0 ? (
            <p className="text-muted-foreground py-10 text-center text-sm">No money moved in {row.year}.</p>
          ) : (
            <ChartContainer config={config} className="aspect-auto w-full" style={{ height: 420 }}>
              <Sankey
                data={{ nodes, links }}
                sort={false}
                nodeWidth={10}
                nodePadding={18}
                margin={{ top: 16, right: 220, bottom: 16, left: 220 }}
                node={(p) => {
                  const d = p.payload as unknown as SankeyNodeData & { value: number };
                  const left = d.side === 'source';
                  const x = left ? p.x - 8 : p.x + p.width + 8;
                  return (
                    <g>
                      <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={2} fill={groupColor(d.group)} />
                      {d.side !== 'hub' && (
                        <text x={x} y={p.y + p.height / 2} dy="0.35em" textAnchor={left ? 'end' : 'start'} fontSize={12}>
                          <tspan fill="var(--foreground)">{d.name}</tspan>
                          <tspan fill="var(--muted-foreground)"> {money(d.value)}</tspan>
                        </text>
                      )}
                    </g>
                  );
                }}
                link={(p) => {
                  const target = p.payload.target as unknown as SankeyNodeData;
                  return (
                    <path
                      d={`M${p.sourceX},${p.sourceY} C${p.sourceControlX},${p.sourceY} ${p.targetControlX},${p.targetY} ${p.targetX},${p.targetY}`}
                      fill="none"
                      stroke={groupColor(target.side === 'use' ? target.group : 'hub')}
                      strokeOpacity={target.side === 'use' ? 0.4 : 0.2}
                      strokeWidth={Math.max(p.linkWidth, 1)}
                    />
                  );
                }}
              />
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <FlowTable title="Came from" items={flows.sources} total={flows.total} money={money} />
        <FlowTable title="Went to" items={flows.uses} total={flows.total} money={money} />
      </div>
    </div>
  );
}

function FlowTable({
  title,
  items,
  total,
  money,
}: {
  title: string;
  items: FlowItem[];
  total: number;
  money: (v: number) => string;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-6 text-sm">
        <div className="text-muted-foreground text-xs font-medium">{title}</div>
        {items.map((x) => (
          <div key={x.key} className="flex justify-between gap-4">
            <span className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: groupColor(x.group) }} />
              {x.label}
            </span>
            <span className="tabular-nums">{money(x.value)}</span>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t pt-1 font-medium">
          <span>Total</span>
          <span className="tabular-nums">{money(total)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
