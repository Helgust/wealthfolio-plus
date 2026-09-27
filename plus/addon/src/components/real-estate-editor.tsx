// Plan editor section: sales of Wealthfolio properties, purchases of homes and rentals.
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@wealthfolio/ui';
import { Plus, Trash2 } from 'lucide-react';
import type { Property } from '../engine/real-estate';
import { rulesForYear } from '../es-tax';
import { formatPercent } from '../lib/format';
import type { Owner } from '../model/accounts';
import { WITH_INFLATION, type Plan, type PropertyPurchase, type PropertySale, type Rental } from '../model/plan';
import { AmountInput, GrowthInput } from './amount-input';
import { Field, NumberInput, PercentInput } from './form-fields';
import { TimingInput } from './timing-input';

interface Props {
  draft: Plan;
  set: (patch: Partial<Plan>) => void;
  /** Modelled properties from Wealthfolio — the ones that can be sold */
  properties: Property[];
}

export const REDUCTION_LABEL: Record<Rental['reduction'], string> = {
  general: 'general',
  rehabilitacion: 'rehabilitated in the 2 years before',
  joven_o_social: 'tenant 18–35 in a zona tensionada, or social rent',
  rebaja_tensionada: 'zona tensionada, rent cut by more than 5 %',
  anterior_2023: 'contract before 26.05.2023',
};

/** Homes a plan can let: modelled Wealthfolio properties and the plan's purchases. */
export function rentableHomes(plan: Plan, properties: Property[]): { id: string; name: string }[] {
  return [
    ...properties.map((p) => ({ id: p.id, name: p.name })),
    ...plan.propertyPurchases.map((p) => ({ id: `purchase:${p.id}`, name: p.name })),
  ];
}

type Mortgage = NonNullable<PropertyPurchase['mortgage']>;
type RateType = 'fixed' | 'variable' | 'mixed';

const rateTypeOf = (m: Mortgage): RateType => (!m.variable ? 'fixed' : m.variable.fixedYears === 0 ? 'variable' : 'mixed');

function withRateType(m: Mortgage, t: RateType): Mortgage {
  const { variable, ...fixed } = m;
  if (t === 'fixed') return fixed;
  const diferencial = variable?.diferencial ?? 0.01;
  return { ...fixed, variable: { diferencial, fixedYears: t === 'variable' ? 0 : variable?.fixedYears || 10 } };
}

const newPurchase = (plan: Plan): PropertyPurchase => ({
  id: `p${Date.now().toString(36)}`,
  name: 'New home',
  timing: { kind: 'year', year: plan.startYear + 5 },
  price: 300_000,
  newBuild: false,
  habitual: true,
  owner: plan.people.length > 1 ? 'joint' : 0,
  ibi: 0,
  mortgage: null,
});

export function RealEstateEditor({ draft, set, properties }: Props) {
  const setSale = (i: number, patch: Partial<PropertySale>) =>
    set({ propertySales: draft.propertySales.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setPurchase = (i: number, patch: Partial<PropertyPurchase>) =>
    set({ propertyPurchases: draft.propertyPurchases.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const setRental = (i: number, patch: Partial<Rental>) =>
    set({ rentals: draft.rentals.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const homes = rentableHomes(draft, properties);
  const reduccion = rulesForYear(draft.startYear).inmuebles.arrendamiento.reduccion;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="font-medium">Sales</h3>
        <p className="text-muted-foreground text-xs">
          At the projected value, less selling costs (agency, notary, plusvalía municipal). The gain goes to the base
          del ahorro. For the vivienda habitual it is exempt from 65, or in the share reinvested in a new vivienda
          habitual bought up to two years before or after the sale; a loan on the home is repaid from the sale.
        </p>
        {properties.length === 0 && (
          <p className="text-muted-foreground text-xs">No modelled property: set a use on the Accounts tab first.</p>
        )}
        {draft.propertySales.map((s, i) => (
          <div key={i} className="grid items-end gap-2" style={{ gridTemplateColumns: '1fr 1.3fr 6rem auto' }}>
            <Field label="Property">
              <Select value={s.propertyId} onValueChange={(v) => setSale(i, { propertyId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Property" />
                </SelectTrigger>
                <SelectContent>
                  {properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="When">
              <TimingInput value={s.timing} plan={draft} onChange={(t) => t && setSale(i, { timing: t })} />
            </Field>
            <Field label="Costs, %">
              <PercentInput value={s.costs} onChange={(v) => setSale(i, { costs: v })} />
            </Field>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove sale"
              onClick={() => set({ propertySales: draft.propertySales.filter((_, j) => j !== i) })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={properties.length === 0 || draft.propertySales.length >= 10}
          onClick={() =>
            set({
              propertySales: [
                ...draft.propertySales,
                { propertyId: properties[0].id, timing: { kind: 'year', year: draft.startYear + 5 }, costs: 0.05 },
              ],
            })
          }
        >
          <Plus className="h-4 w-4" /> Add sale
        </Button>
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">Purchases</h3>
        <p className="text-muted-foreground text-xs">
          Price in euros of the first year. On top of it: ITP for a second-hand home, IVA and AJD for a new one
          (Comunitat Valenciana rates). The mortgage is paid as an annuity from the next year.
        </p>
        {draft.propertyPurchases.map((p, i) => (
          <div key={p.id} className="space-y-2 rounded-md border p-3">
            <div className="grid items-end gap-2" style={{ gridTemplateColumns: '1fr 1.3fr 8rem auto' }}>
              <Field label="Name">
                <Input value={p.name} onChange={(e) => setPurchase(i, { name: e.target.value })} />
              </Field>
              <Field label="When">
                <TimingInput value={p.timing} plan={draft} onChange={(t) => t && setPurchase(i, { timing: t })} />
              </Field>
              <Field label="Price">
                <NumberInput value={p.price} step={5000} onChange={(v) => setPurchase(i, { price: v ?? 0 })} />
              </Field>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove purchase"
                onClick={() => set({ propertyPurchases: draft.propertyPurchases.filter((_, j) => j !== i) })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex items-center gap-2">
                <Switch checked={p.habitual} onCheckedChange={(on) => setPurchase(i, { habitual: on })} />
                <Label className="text-sm">Vivienda habitual</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={p.newBuild} onCheckedChange={(on) => setPurchase(i, { newBuild: on })} />
                <Label className="text-sm">New build</Label>
              </div>
              {draft.people.length > 1 && (
                <div style={{ width: 150 }}>
                  <Field label="Owner">
                    <Select
                      value={String(p.owner)}
                      onValueChange={(v) => setPurchase(i, { owner: v === 'joint' ? 'joint' : (Number(v) as Owner) })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {draft.people.map((person, k) => (
                          <SelectItem key={k} value={String(k)}>
                            {person.name}
                          </SelectItem>
                        ))}
                        <SelectItem value="joint">Joint (50/50)</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              )}
              <div style={{ width: 110 }}>
                <Field label="IBI a year">
                  <NumberInput value={p.ibi} step={50} onChange={(v) => setPurchase(i, { ibi: v ?? 0 })} />
                </Field>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={p.mortgage !== null}
                  onCheckedChange={(on) =>
                    setPurchase(i, { mortgage: on ? { amount: p.price * 0.8, rate: 0.03, years: 25 } : null })
                  }
                />
                <Label className="text-sm">Mortgage</Label>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Comunidad a year">
                <NumberInput value={p.community ?? 0} step={50} onChange={(v) => setPurchase(i, { community: v ?? 0 })} />
              </Field>
              <Field label="Insurance a year">
                <NumberInput value={p.insurance ?? 0} step={50} onChange={(v) => setPurchase(i, { insurance: v ?? 0 })} />
              </Field>
              <Field label="Building share, % (if let)">
                <PercentInput value={p.constructionShare ?? 0} onChange={(v) => setPurchase(i, { constructionShare: v })} />
              </Field>
            </div>
            {p.mortgage && (
              <div className="grid grid-cols-3 gap-2">
                <Field label="Amount">
                  <NumberInput
                    value={p.mortgage.amount}
                    step={5000}
                    onChange={(v) => setPurchase(i, { mortgage: { ...p.mortgage!, amount: v ?? 0 } })}
                  />
                </Field>
                <Field label="Years">
                  <NumberInput
                    value={p.mortgage.years}
                    onChange={(v) => setPurchase(i, { mortgage: { ...p.mortgage!, years: v ?? 1 } })}
                  />
                </Field>
                <Field label="Rate type">
                  <Select
                    value={rateTypeOf(p.mortgage)}
                    onValueChange={(v) => setPurchase(i, { mortgage: withRateType(p.mortgage!, v as RateType) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">Fixed</SelectItem>
                      <SelectItem value="variable">Variable</SelectItem>
                      <SelectItem value="mixed">Mixed (mixta)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {rateTypeOf(p.mortgage) !== 'variable' && (
                  <Field label={rateTypeOf(p.mortgage) === 'mixed' ? 'Fixed rate, %' : 'Rate, %'}>
                    <PercentInput
                      value={p.mortgage.rate}
                      onChange={(v) => setPurchase(i, { mortgage: { ...p.mortgage!, rate: v } })}
                    />
                  </Field>
                )}
                {p.mortgage.variable && rateTypeOf(p.mortgage) === 'mixed' && (
                  <Field label="Fixed for, years">
                    <NumberInput
                      value={p.mortgage.variable.fixedYears}
                      onChange={(v) =>
                        setPurchase(i, {
                          mortgage: { ...p.mortgage!, variable: { ...p.mortgage!.variable!, fixedYears: Math.max(v ?? 1, 1) } },
                        })
                      }
                    />
                  </Field>
                )}
                {p.mortgage.variable && (
                  <Field label="Euríbor + diferencial, %">
                    <PercentInput
                      value={p.mortgage.variable.diferencial}
                      onChange={(v) =>
                        setPurchase(i, { mortgage: { ...p.mortgage!, variable: { ...p.mortgage!.variable!, diferencial: v } } })
                      }
                    />
                  </Field>
                )}
              </div>
            )}
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={draft.propertyPurchases.length >= 10}
          onClick={() => set({ propertyPurchases: [...draft.propertyPurchases, newPurchase(draft)] })}
        >
          <Plus className="h-4 w-4" /> Add purchase
        </Button>
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">Rentals</h3>
        <p className="text-muted-foreground text-xs">
          While let, a home imputes no rent: its rendimiento — rent less interest and repairs (together up to the rent,
          the excess carries over four years), IBI, comunidad, insurance and 3 % amortización of the building — goes to
          the owners' base general, reduced by art. 23.2 LIRPF when positive. A home let before its sale stays the
          vivienda habitual for the exemptions if sold the next year at the latest.
        </p>
        {draft.rentals.map((r, i) => (
          <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-md border p-3">
            <Field label="Home">
              <Select value={r.propertyId} onValueChange={(v) => setRental(i, { propertyId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Home" />
                </SelectTrigger>
                <SelectContent>
                  {homes.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field label="Reducción (art. 23.2)">
                  <Select value={r.reduction} onValueChange={(v) => setRental(i, { reduction: v as Rental['reduction'] })}>
                    <SelectTrigger style={{ minWidth: 0 }}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(REDUCTION_LABEL) as Rental['reduction'][]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {formatPercent(reduccion[k])} — {REDUCTION_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove rental"
                onClick={() => set({ rentals: draft.rentals.filter((_, j) => j !== i) })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <Field label="Rent">
              <AmountInput value={r.amount} per={r.per} step={50} onChange={(amount, per) => setRental(i, { amount, per })} />
            </Field>
            <Field label="Change per year, %">
              <GrowthInput value={r.growth ?? WITH_INFLATION} onChange={(growth) => setRental(i, { growth })} />
            </Field>
            <Field label="Let, % of the year">
              <PercentInput value={r.occupancy} onChange={(occupancy) => setRental(i, { occupancy })} />
            </Field>
            <Field label="Repairs a year">
              <NumberInput value={r.repairs} step={100} onChange={(v) => setRental(i, { repairs: v ?? 0 })} />
            </Field>
            <Field label="Starts">
              <TimingInput value={r.start} plan={draft} noneLabel="Plan start" onChange={(t) => setRental(i, { start: t })} />
            </Field>
            <Field label="Stops">
              <TimingInput value={r.end} plan={draft} noneLabel="Never" onChange={(t) => setRental(i, { end: t })} />
            </Field>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={homes.length === 0 || draft.rentals.length >= 10}
          onClick={() =>
            set({
              rentals: [
                ...draft.rentals,
                {
                  propertyId: homes[0].id,
                  amount: 0,
                  per: 'month',
                  growth: WITH_INFLATION,
                  occupancy: 1,
                  repairs: 0,
                  reduction: 'general',
                  start: null,
                  end: null,
                },
              ],
            })
          }
        >
          <Plus className="h-4 w-4" /> Add rental
        </Button>
      </section>
    </div>
  );
}
