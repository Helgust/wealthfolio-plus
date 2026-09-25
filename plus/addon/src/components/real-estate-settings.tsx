// Real estate and loans from Wealthfolio (Accounts tab): what the planner needs beyond the value —
// use, owner, valor catastral, IBI, purchase costs; the monthly payment of each loan.
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@wealthfolio/ui';
import type { AlternativeAssetHolding } from '../lib/fork-api';
import { formatMoney, formatPercent } from '../lib/format';
import {
  isLiability,
  isProperty,
  liabilityRate,
  linkedProperty,
  propertySettingFor,
} from '../lib/starting-point';
import type { Owner } from '../model/accounts';
import {
  PropertyUseSchema,
  USE_LABEL,
  type PropertySetting,
  type PropertyUse,
  type RealEstateSettings,
} from '../model/properties';
import { NumberInput } from './form-fields';

interface Props {
  /** null — the official build: no alternative assets in the addon API */
  alternatives: AlternativeAssetHolding[] | null;
  settings: RealEstateSettings;
  people: string[];
  currency: string;
  onChange: (settings: RealEstateSettings) => void;
}

export function RealEstateSettingsTable({ alternatives, settings, people, currency, onChange }: Props) {
  const money = (v: number) => formatMoney(v, currency);
  if (alternatives === null) {
    return (
      <p className="text-muted-foreground text-sm">
        Real estate and debts need portfolio.getAlternativeHoldings, which only this Wealthfolio fork has. In the
        official build they stay in net worth as they are.
      </p>
    );
  }
  const properties = alternatives.filter(isProperty);
  const liabilities = alternatives.filter(isLiability);
  if (!properties.length && !liabilities.length) {
    return <p className="text-muted-foreground text-sm">No real estate or debts in Wealthfolio.</p>;
  }
  const setProperty = (h: AlternativeAssetHolding, patch: Partial<PropertySetting>) =>
    onChange({ ...settings, properties: { ...settings.properties, [h.id]: { ...propertySettingFor(settings, h), ...patch } } });
  const setPayment = (h: AlternativeAssetHolding, monthlyPayment: number) =>
    onChange({ ...settings, loans: { ...settings.loans, [h.id]: { monthlyPayment } } });
  const nameOf = (id: string | null) => properties.find((p) => p.id === id)?.name ?? '—';

  return (
    <div className="space-y-4">
      {properties.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <Table className="text-sm">
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Use</TableHead>
                {people.length > 1 && <TableHead>Owner</TableHead>}
                <TableHead>Valor catastral</TableHead>
                <TableHead>Revised in 10 years</TableHead>
                <TableHead>IBI a year</TableHead>
                <TableHead>Purchase taxes & costs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {properties.map((h) => {
                const s = propertySettingFor(settings, h);
                const off = s.use === 'other';
                return (
                  <TableRow key={h.id}>
                    <TableCell>
                      <div>{h.name}</div>
                      <div className="text-muted-foreground text-xs">
                        {money(Number(h.marketValue))}
                        {h.purchasePrice ? ` · bought for ${money(Number(h.purchasePrice))}` : ' · no purchase price'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select value={s.use} onValueChange={(v) => setProperty(h, { use: v as PropertyUse })}>
                        <SelectTrigger style={{ width: 250 }}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PropertyUseSchema.options.map((u) => (
                            <SelectItem key={u} value={u}>
                              {USE_LABEL[u]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    {people.length > 1 && (
                      <TableCell>
                        <Select
                          value={String(s.owner)}
                          disabled={off}
                          onValueChange={(v) => setProperty(h, { owner: v === 'joint' ? 'joint' : (Number(v) as Owner) })}
                        >
                          <SelectTrigger style={{ width: 130 }}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {people.map((name, i) => (
                              <SelectItem key={i} value={String(i)}>
                                {name}
                              </SelectItem>
                            ))}
                            <SelectItem value="joint">Joint (50/50)</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    )}
                    <TableCell style={{ width: 130 }}>
                      <NumberInput
                        value={s.valorCatastral}
                        step={1000}
                        onChange={(v) => setProperty(h, { valorCatastral: v })}
                      />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={s.catastroRevisado}
                        disabled={off}
                        onCheckedChange={(on) => setProperty(h, { catastroRevisado: on })}
                      />
                    </TableCell>
                    <TableCell style={{ width: 110 }}>
                      <NumberInput value={s.ibi} step={50} onChange={(v) => setProperty(h, { ibi: v ?? 0 })} />
                    </TableCell>
                    <TableCell style={{ width: 130 }}>
                      <NumberInput
                        value={s.acquisitionCosts}
                        step={1000}
                        onChange={(v) => setProperty(h, { acquisitionCosts: v ?? 0 })}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {liabilities.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <Table className="text-sm">
            <TableHeader>
              <TableRow>
                <TableHead>Loan</TableHead>
                <TableHead>Finances</TableHead>
                <TableHead className="text-right">Owed</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>Monthly payment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {liabilities.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>{h.name}</TableCell>
                  <TableCell>{nameOf(linkedProperty(h))}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(Math.abs(Number(h.marketValue)))}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(liabilityRate(h))}</TableCell>
                  <TableCell style={{ width: 150 }}>
                    <NumberInput
                      value={settings.loans[h.id]?.monthlyPayment ?? null}
                      step={50}
                      onChange={(v) => setPayment(h, v ?? 0)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        Real estate grows at the plan's rate. A second home imputes 2 % of its valor catastral to the base general
        (1.1 % after a catastral revision in the last ten years, or 1.1 % of half the price without a valor
        catastral). Rental income is not modelled. A loan is paid as an annuity once its monthly payment is set;
        without it the debt stays constant. “Not modelled” property stays in net worth as it is.
      </p>
    </div>
  );
}
