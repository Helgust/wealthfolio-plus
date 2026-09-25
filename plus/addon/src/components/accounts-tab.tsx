// "Accounts" tab: Wealthfolio accounts → Spanish types and owners, summary by type.
// The model value (balance + positions by lots) is checked against the Wealthfolio valuation.
import {
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
import { positionValue } from '../engine/portfolio';
import { formatMoney } from '../lib/format';
import { settingFor, type LoadedPortfolio, type WfAccount } from '../lib/starting-point';
import {
  isPension,
  KIND_LABEL,
  SpanishKindSchema,
  type AccountSettings,
  type Owner,
  type SpanishKind,
} from '../model/accounts';

interface Props {
  portfolio: LoadedPortfolio;
  settings: AccountSettings;
  people: string[];
  currency: string;
  onChange: (settings: AccountSettings) => void;
}

const modelValue = (a: WfAccount) => a.cash + a.positions.reduce((s, p) => s + positionValue(p), 0);
const costBasis = (a: WfAccount) =>
  a.cash + a.positions.reduce((s, p) => s + p.lots.reduce((c, l) => c + l.cost, 0), 0);

/** A difference under half a euro counts as a match. */
const matches = (a: WfAccount) => Math.abs(modelValue(a) - a.wfValue) < 0.5;

export function AccountsTab({ portfolio, settings, people, currency, onChange }: Props) {
  const money = (v: number) => formatMoney(v, currency);
  const update = (a: WfAccount, patch: { kind?: SpanishKind; owner?: Owner }) => {
    const next = { ...settingFor(settings, a), ...patch };
    // A pension plan always belongs to one person.
    if (isPension(next.kind) && next.owner === 'joint') next.owner = 0;
    onChange({ ...settings, [a.id]: next });
  };

  const byKind = new Map<SpanishKind, number>();
  for (const a of portfolio.accounts) {
    const k = settingFor(settings, a).kind;
    byKind.set(k, (byKind.get(k) ?? 0) + a.wfValue);
  }
  const accountsTotal = portfolio.accounts.reduce((s, a) => s + a.wfValue, 0);
  const outside = portfolio.netWorth - accountsTotal;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border">
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Spanish type</TableHead>
              {people.length > 1 && <TableHead>Owner</TableHead>}
              <TableHead className="text-right">Wealthfolio value</TableHead>
              <TableHead className="text-right">Model value</TableHead>
              <TableHead className="text-right">Cost basis</TableHead>
              <TableHead className="text-right">Unrealized gain</TableHead>
              <TableHead className="text-right">Lots</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {portfolio.accounts.map((a) => {
              const s = settingFor(settings, a);
              const lots = a.positions.reduce((n, p) => n + p.lots.length, 0);
              return (
                <TableRow key={a.id}>
                  <TableCell>
                    <div>{a.name}</div>
                    <div className="text-muted-foreground text-xs">{a.accountType}</div>
                  </TableCell>
                  <TableCell>
                    <Select value={s.kind} onValueChange={(v) => update(a, { kind: v as SpanishKind })}>
                      <SelectTrigger className="w-64">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SpanishKindSchema.options.map((k) => (
                          <SelectItem key={k} value={k}>
                            {KIND_LABEL[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  {people.length > 1 && (
                    <TableCell>
                      <Select
                        value={String(s.owner)}
                        onValueChange={(v) => update(a, { owner: v === 'joint' ? 'joint' : (Number(v) as 0 | 1) })}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {people.map((name, i) => (
                            <SelectItem key={i} value={String(i)}>
                              {name}
                            </SelectItem>
                          ))}
                          {!isPension(s.kind) && <SelectItem value="joint">Joint (50/50)</SelectItem>}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  )}
                  <TableCell className="text-right tabular-nums">{money(a.wfValue)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(modelValue(a))}
                    <div className={matches(a) ? 'text-muted-foreground text-xs' : 'text-destructive text-xs'}>
                      {matches(a) ? '✓ matches' : `differs by ${money(modelValue(a) - a.wfValue)}`}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(costBasis(a))}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(modelValue(a) - costBasis(a))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{lots}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="grid grid-cols-4 gap-4 text-sm">
        {SpanishKindSchema.options
          .filter((k) => byKind.has(k))
          .map((k) => (
            <div key={k}>
              <div className="text-muted-foreground text-xs">{KIND_LABEL[k]}</div>
              <div className="font-semibold tabular-nums">{money(byKind.get(k)!)}</div>
            </div>
          ))}
        {Math.abs(outside) >= 0.5 && (
          <div>
            <div className="text-muted-foreground text-xs">Alternative assets and debts</div>
            <div className="font-semibold tabular-nums">{money(outside)}</div>
          </div>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        Cash earns interest and brokerage pays dividends every year (base del ahorro). Fondos only
        grow, and a traspaso between them is not taxed. Pension plans lower the base general when
        you contribute, and payouts are taxed as trabajo. “Not modelled” accounts stay constant;
        real estate and debts are set up below. Gains use the cost basis from Wealthfolio, sold FIFO.
      </p>
    </div>
  );
}
