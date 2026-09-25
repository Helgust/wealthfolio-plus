// Real estate and loans in the projection: value growth, IBI, imputación de rentas, loan
// annuities, sales (with the vivienda habitual exemption) and purchases (with ITP or IVA + AJD).
// Amounts are nominal euros. Year granularity: a property counts for IBI and imputación in a year
// if it is owned at the start of it; a purchase counts from the next year.
import {
  gananciaExentaVivienda,
  impuestoCompraVivienda,
  imputacionRenta,
  type IrpfRules,
} from '../es-tax';
import type { Owner } from '../model/accounts';
import type { Plan, PropertyPurchase } from '../model/plan';
import type { PropertyUse } from '../model/properties';
import type { MarketYear } from './market';
import { timingYear } from './timing';

export interface Property {
  id: string;
  name: string;
  value: number;
  use: Exclude<PropertyUse, 'other'>;
  owner: Owner;
  valorCatastral: number | null;
  catastroRevisado: boolean;
  /** IBI per year in first-year prices */
  ibi: number;
  /** Valor de adquisición (art. 35 LIRPF): price plus the taxes and costs of the purchase */
  acquisitionValue: number;
}

export interface Loan {
  id: string;
  name: string;
  balance: number;
  /** Annual interest rate */
  rate: number;
  monthlyPayment: number;
  /** The property it financed; repaid when that property is sold */
  propertyId: string | null;
}

/** What real estate and loans did in a year; all amounts nominal. */
export interface RealEstateYear {
  /** Appreciation of the properties */
  growth: number;
  ibi: number;
  /** Renta imputada per person (art. 85 LIRPF) — renta general */
  imputedRent: number[];
  loanInterest: number;
  loanPrincipal: number;
  /** Value of the properties sold, before selling costs */
  saleValue: number;
  /** What the sales brought in after selling costs */
  saleProceeds: number;
  /** Loans on the sold properties, repaid from the proceeds */
  loanRepaidAtSale: number;
  /** Gain on the sales per person, after exemptions — savings base */
  gains: number[];
  /** Exempt part of the gains (reinvestment, over 65) */
  exemptGains: number;
  purchaseCost: number;
  purchaseTax: number;
  newLoans: number;
}

/** People's shares in a property: a joint one splits equally. */
function shares(owner: Owner, n: number): number[] {
  if (owner === 'joint') return new Array(n).fill(1 / n);
  const i = owner < n ? owner : 0;
  return Array.from({ length: n }, (_, j) => (j === i ? 1 : 0));
}

/** Monthly payment of an annuity loan. */
export function annuityPayment(amount: number, rate: number, years: number): number {
  const n = years * 12;
  const r = rate / 12;
  return r === 0 ? amount / n : (amount * r) / (1 - (1 + r) ** -n);
}

/** Twelve monthly payments; a payment below the interest pays the interest only. */
function amortize(loan: Loan): { interest: number; principal: number } {
  let interest = 0;
  let principal = 0;
  for (let m = 0; m < 12 && loan.balance > 1e-9; m++) {
    const i = (loan.balance * loan.rate) / 12;
    const p = Math.min(Math.max(loan.monthlyPayment - i, 0), loan.balance);
    loan.balance -= p;
    interest += i;
    principal += p;
  }
  return { interest, principal };
}

/** Year a purchase happens, if known by now (a milestone not reached yet is not). */
function purchaseYear(p: PropertyPurchase, plan: Plan, reached: ReadonlyMap<string, number>): number | null {
  return timingYear(p.timing, plan, reached);
}

/**
 * One year of real estate: grows values, charges IBI and loan payments, imputes rent, carries out
 * the plan's sales and purchases of this year. Mutates properties and loans.
 * market — the year's returns; deflatorAt — price level of a calendar year in first-year prices.
 */
export function realEstateYear(
  plan: Plan,
  year: number,
  rules: IrpfRules,
  properties: Property[],
  loans: Loan[],
  reached: ReadonlyMap<string, number>,
  ages: number[],
  market: MarketYear,
  deflatorAt: (year: number) => number,
): RealEstateYear {
  const n = plan.people.length;
  const out: RealEstateYear = {
    growth: 0,
    ibi: 0,
    imputedRent: new Array(n).fill(0),
    loanInterest: 0,
    loanPrincipal: 0,
    saleValue: 0,
    saleProceeds: 0,
    loanRepaidAtSale: 0,
    gains: new Array(n).fill(0),
    exemptGains: 0,
    purchaseCost: 0,
    purchaseTax: 0,
    newLoans: 0,
  };

  // Properties owned at the start of the year: growth, IBI, imputación.
  for (const p of properties) {
    const g = p.value * market.propertyGrowth;
    p.value += g;
    out.growth += g;
    out.ibi += p.ibi * deflatorAt(year);
    if (p.use === 'second') {
      const rent = imputacionRenta(p.valorCatastral, rules.inmuebles, {
        revisado: p.catastroRevisado,
        precioAdquisicion: p.acquisitionValue,
      });
      shares(p.owner, n).forEach((s, i) => (out.imputedRent[i] += rent * s));
    }
  }
  for (const l of loans) {
    const a = amortize(l);
    out.loanInterest += a.interest;
    out.loanPrincipal += a.principal;
  }

  // Sales of this year. Reinvestment: habitual purchases within the plazo before or after.
  const plazo = rules.inmuebles.reinversion.plazo_anos;
  const reinvested = plan.propertyPurchases
    .filter((pp) => pp.habitual)
    .map((pp) => ({ pp, y: purchaseYear(pp, plan, reached) }))
    .filter(({ y }) => y !== null && Math.abs(y - year) <= plazo)
    .reduce((s, { pp, y }) => s + pp.price * deflatorAt(y!), 0);
  for (const sale of plan.propertySales) {
    if (timingYear(sale.timing, plan, reached) !== year) continue;
    const k = properties.findIndex((p) => p.id === sale.propertyId);
    if (k < 0) continue;
    const [p] = properties.splice(k, 1);
    const proceeds = p.value * (1 - sale.costs);
    let owed = 0;
    for (let j = loans.length - 1; j >= 0; j--) {
      if (loans[j].propertyId !== p.id) continue;
      owed += loans[j].balance;
      loans.splice(j, 1);
    }
    out.saleValue += p.value;
    out.saleProceeds += proceeds;
    out.loanRepaidAtSale += owed;
    const gain = proceeds - p.acquisitionValue;
    shares(p.owner, n).forEach((s, i) => {
      const exempt =
        p.use === 'habitual'
          ? gananciaExentaVivienda(gain * s, proceeds * s, owed * s, reinvested * s, ages[i], rules.inmuebles)
          : 0;
      out.gains[i] += gain * s - exempt;
      out.exemptGains += exempt;
    });
  }

  // Purchases of this year: price plus purchase tax, less the mortgage.
  plan.propertyPurchases.forEach((pp) => {
    if (purchaseYear(pp, plan, reached) !== year) return;
    const price = pp.price * deflatorAt(year);
    const tax = impuestoCompraVivienda(price, { nueva: pp.newBuild, habitual: pp.habitual }, rules.inmuebles);
    out.purchaseCost += price;
    out.purchaseTax += tax;
    const id = `purchase:${pp.id}`;
    properties.push({
      id,
      name: pp.name,
      value: price,
      use: pp.habitual ? 'habitual' : 'second',
      owner: pp.owner,
      valorCatastral: null,
      catastroRevisado: false,
      ibi: pp.ibi,
      acquisitionValue: price + tax,
    });
    if (pp.mortgage && pp.mortgage.amount > 0) {
      const amount = pp.mortgage.amount * deflatorAt(year);
      out.newLoans += amount;
      loans.push({
        id: `mortgage:${pp.id}`,
        name: `Mortgage · ${pp.name}`,
        balance: amount,
        rate: pp.mortgage.rate,
        monthlyPayment: annuityPayment(amount, pp.mortgage.rate, pp.mortgage.years),
        propertyId: id,
      });
    }
  });
  return out;
}

/** Cash the year's real estate brings in (positive) or takes (negative), before income tax. */
export function realEstateCash(r: RealEstateYear): number {
  return (
    r.saleProceeds -
    r.loanRepaidAtSale +
    r.newLoans -
    r.purchaseCost -
    r.purchaseTax -
    r.ibi -
    r.loanInterest -
    r.loanPrincipal
  );
}

export const propertiesValue = (ps: Property[]) => ps.reduce((s, p) => s + p.value, 0);
export const loansBalance = (ls: Loan[]) => ls.reduce((s, l) => s + l.balance, 0);
