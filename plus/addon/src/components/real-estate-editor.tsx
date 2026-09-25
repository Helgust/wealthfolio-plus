// Plan editor section: sales of Wealthfolio properties and purchases of homes.
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
import type { Owner } from '../model/accounts';
import type { Plan, PropertyPurchase, PropertySale } from '../model/plan';
import { Field, NumberInput, PercentInput } from './form-fields';
import { TimingInput } from './timing-input';

interface Props {
  draft: Plan;
  set: (patch: Partial<Plan>) => void;
  /** Modelled properties from Wealthfolio — the ones that can be sold */
  properties: Property[];
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
            {p.mortgage && (
              <div className="grid grid-cols-3 gap-2">
                <Field label="Amount">
                  <NumberInput
                    value={p.mortgage.amount}
                    step={5000}
                    onChange={(v) => setPurchase(i, { mortgage: { ...p.mortgage!, amount: v ?? 0 } })}
                  />
                </Field>
                <Field label="Rate, %">
                  <PercentInput
                    value={p.mortgage.rate}
                    onChange={(v) => setPurchase(i, { mortgage: { ...p.mortgage!, rate: v } })}
                  />
                </Field>
                <Field label="Years">
                  <NumberInput
                    value={p.mortgage.years}
                    onChange={(v) => setPurchase(i, { mortgage: { ...p.mortgage!, years: v ?? 1 } })}
                  />
                </Field>
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
    </div>
  );
}
