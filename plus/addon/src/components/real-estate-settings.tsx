// Real estate and loans from Wealthfolio (Accounts tab): what the planner needs beyond the value —
// use, owner, valor catastral, IBI, purchase costs; the payment or term and the rate type of each loan.
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
  type LoanSetting,
  type PropertySetting,
  type PropertyUse,
  type RealEstateSettings,
} from '../model/properties';
import { NumberInput, PercentInput } from './form-fields';

interface Props {
  /** null — Wealthfolio before 3.9: no alternative assets in the addon API */
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
        Real estate and debts need alternativeAssets.getAll from Wealthfolio 3.9. In older versions they stay in
        net worth as they are.
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
  const loanOf = (h: AlternativeAssetHolding): LoanSetting => settings.loans[h.id] ?? { monthlyPayment: 0 };
  const setLoan = (h: AlternativeAssetHolding, next: LoanSetting) =>
    onChange({ ...settings, loans: { ...settings.loans, [h.id]: next } });
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
                <TableHead>Comunidad a year</TableHead>
                <TableHead>Insurance a year</TableHead>
                <TableHead>Building share, %</TableHead>
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
                    <TableCell style={{ width: 110 }}>
                      <NumberInput
                        value={s.community ?? null}
                        step={50}
                        onChange={(v) => setProperty(h, { community: v ?? undefined })}
                      />
                    </TableCell>
                    <TableCell style={{ width: 110 }}>
                      <NumberInput
                        value={s.insurance ?? null}
                        step={50}
                        onChange={(v) => setProperty(h, { insurance: v ?? undefined })}
                      />
                    </TableCell>
                    <TableCell style={{ width: 100 }}>
                      <NumberInput
                        value={s.constructionShare === undefined ? null : Math.round(s.constructionShare * 10000) / 100}
                        step={1}
                        onChange={(v) => setProperty(h, { constructionShare: v === null ? undefined : v / 100 })}
                      />
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
                <TableHead>Payment</TableHead>
                <TableHead>Rate type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {liabilities.map((h) => {
                const l = loanOf(h);
                const byYears = l.years !== undefined;
                return (
                  <TableRow key={h.id}>
                    <TableCell>{h.name}</TableCell>
                    <TableCell>{nameOf(linkedProperty(h))}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(Math.abs(Number(h.marketValue)))}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(liabilityRate(h))}</TableCell>
                    <TableCell style={{ width: 250 }}>
                      <div className="flex gap-2">
                        <NumberInput
                          value={byYears ? l.years! : l.monthlyPayment || null}
                          step={byYears ? 1 : 50}
                          onChange={(v) =>
                            setLoan(h, byYears ? { ...l, years: Math.max(v ?? 1, 1) } : { ...l, monthlyPayment: v ?? 0 })
                          }
                        />
                        <div style={{ width: 120, flex: 'none' }}>
                          <Select
                            value={byYears ? 'years' : 'payment'}
                            onValueChange={(v) => {
                              const { years: _, ...rest } = l;
                              setLoan(h, v === 'years' ? { ...rest, years: 20 } : rest);
                            }}
                          >
                            <SelectTrigger style={{ minWidth: 0 }}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="payment">€ a month</SelectItem>
                              <SelectItem value="years">years left</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell style={{ width: 330 }}>
                      <div className="flex items-center gap-2">
                        <div style={{ width: 110, flex: 'none' }}>
                          <Select
                            value={l.variable ? 'variable' : 'fixed'}
                            onValueChange={(v) => {
                              const { variable: _, ...rest } = l;
                              setLoan(h, v === 'variable' ? { ...rest, variable: { diferencial: 0.01, variableFrom: null } } : rest);
                            }}
                          >
                            <SelectTrigger style={{ minWidth: 0 }}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="fixed">Fixed</SelectItem>
                              <SelectItem value="variable">Variable</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {l.variable && (
                          <>
                            <span className="text-muted-foreground text-xs whitespace-nowrap">Euríbor +</span>
                            <div style={{ width: 64, flex: 'none' }}>
                              <PercentInput
                                value={l.variable.diferencial}
                                onChange={(diferencial) => setLoan(h, { ...l, variable: { ...l.variable!, diferencial } })}
                              />
                            </div>
                            <span className="text-muted-foreground text-xs">from</span>
                            <div style={{ width: 80, flex: 'none' }}>
                              <NumberInput
                                value={l.variable.variableFrom}
                                onChange={(variableFrom) => setLoan(h, { ...l, variable: { ...l.variable!, variableFrom } })}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        Real estate grows at the plan's rate. A second home imputes 2 % of its valor catastral to the base general
        (1.1 % after a catastral revision in the last ten years, or 1.1 % of half the price without a valor
        catastral). Comunidad and insurance are paid every year; the building share of the valor catastral (IBI
        receipt: valor de la construcción ÷ valor catastral) gives the amortización when the home is let — a rental is
        set in the plan's Real estate section. A loan is paid as an annuity once its monthly payment or the years
        left are set; without them the debt stays constant. A variable rate is revised once a year to Euríbor +
        diferencial from the year given (empty — from the plan's second year), keeping the months left; Euríbor is an
        assumption of the plan. “Not modelled” property stays in net worth as it is.
      </p>
    </div>
  );
}
