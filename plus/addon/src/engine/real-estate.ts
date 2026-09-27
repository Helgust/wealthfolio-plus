// Real estate and loans in the projection: value growth, IBI, imputación de rentas, loan
// annuities at a fixed or variable rate, prepayments, sales (with the vivienda habitual exemption)
// and purchases (with ITP or IVA + AJD).
// Amounts are nominal euros. Year granularity: a property counts for IBI and imputación in a year
// if it is owned at the start of it; a purchase counts from the next year.
import {
  amortizacionInmueble,
  gananciaExentaVivienda,
  impuestoCompraVivienda,
  imputacionRenta,
  rendimientoArrendamiento,
  type IrpfRules,
} from '../es-tax';
import type { Owner } from '../model/accounts';
import type { Plan, PropertyPurchase, Rental } from '../model/plan';
import type { PropertyUse } from '../model/properties';
import { amountInYear } from './amounts';
import type { MarketYear } from './market';
import { isActive, timingYear } from './timing';

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
  /** Comunidad and insurance per year in first-year prices */
  community?: number;
  insurance?: number;
  /** Share of the building in the value, for the amortización of a rental; absent — none */
  constructionShare?: number;
  /** Interest and repairs of a rental not deducted yet (art. 23.1.a.1º), oldest first */
  rentalPending?: number[];
  /** First year of the current or last rental: the home stopped being the vivienda habitual */
  rentedSince?: number;
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
  /**
   * From fromYear on the rate is the year's Euríbor + diferencial, revised once a year, and the
   * payment is recomputed over the months left; null — from the plan's second year. Absent — fixed.
   */
  variable?: { diferencial: number; fromYear: number | null };
}

/** What real estate and loans did in a year; all amounts nominal. */
export interface RealEstateYear {
  /** Appreciation of the properties */
  growth: number;
  ibi: number;
  /** Renta imputada per person (art. 85 LIRPF) — renta general */
  imputedRent: number[];
  loanInterest: number;
  /** Principal of the scheduled payments */
  loanPrincipal: number;
  /** Amortización anticipada from the surplus (flows) and its fees */
  loanPrepaid: number;
  prepaymentFees: number;
  /** Value of the properties sold, before selling costs */
  saleValue: number;
  /** Comunidad and insurance of the properties */
  ownershipCosts: number;
  /** Rent received and repairs paid for the homes let */
  rent: number;
  rentalRepairs: number;
  /** Rendimiento neto reducido del capital inmobiliario per person — renta general */
  rentalIncome: number[];
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

/** Monthly payment of an annuity loan over months. */
export function annuityMonthly(amount: number, rate: number, months: number): number {
  const r = rate / 12;
  return r === 0 ? amount / months : (amount * r) / (1 - (1 + r) ** -months);
}

/** Monthly payment of an annuity loan. */
export const annuityPayment = (amount: number, rate: number, years: number) => annuityMonthly(amount, rate, years * 12);

/** Months the payment takes to repay the balance; Infinity when it does not cover the interest. */
export function monthsToRepay(balance: number, rate: number, payment: number): number {
  if (balance <= 1e-9) return 0;
  const r = rate / 12;
  if (r === 0) return payment > 0 ? balance / payment : Infinity;
  const x = 1 - (r * balance) / payment;
  return x <= 0 ? Infinity : -Math.log(x) / Math.log(1 + r);
}

/** A new rate keeps the months left: the payment is recomputed over them. */
function reviseRate(l: Loan, rate: number): void {
  if (rate === l.rate) return;
  const months = monthsToRepay(l.balance, l.rate, l.monthlyPayment);
  l.rate = rate;
  if (Number.isFinite(months) && months > 0) l.monthlyPayment = annuityMonthly(l.balance, rate, months);
}

/**
 * Amortización anticipada at the end of a year. term — reducir plazo: the payment stays, so the
 * loan ends sooner; payment — reducir cuota: the months left stay, the payment is recomputed.
 */
export function prepayLoan(l: Loan, amount: number, effect: 'term' | 'payment'): void {
  const months = monthsToRepay(l.balance, l.rate, l.monthlyPayment);
  l.balance -= amount;
  if (l.balance <= 1e-9) l.balance = 0;
  else if (effect === 'payment' && Number.isFinite(months)) {
    l.monthlyPayment = annuityMonthly(l.balance, l.rate, months);
  }
}

/**
 * Euríbor of the year: the plan's assumption, moved by how far the year's cash return is from the
 * plan's (Monte Carlo). Equal to the assumption on the plan's expected returns.
 */
export const euriborOf = (plan: Plan, market: MarketYear) =>
  plan.euribor + market.cashInterest - plan.returns.cashInterest;

/** Loan rates cannot be negative (art. 21.4 Ley 5/2019). */
const variableRate = (euribor: number, diferencial: number) => Math.max(euribor + diferencial, 0);

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
    ownershipCosts: 0,
    rent: 0,
    rentalRepairs: 0,
    rentalIncome: new Array(n).fill(0),
    imputedRent: new Array(n).fill(0),
    loanInterest: 0,
    loanPrincipal: 0,
    loanPrepaid: 0,
    prepaymentFees: 0,
    saleValue: 0,
    saleProceeds: 0,
    loanRepaidAtSale: 0,
    gains: new Array(n).fill(0),
    exemptGains: 0,
    purchaseCost: 0,
    purchaseTax: 0,
    newLoans: 0,
  };

  // Properties owned at the start of the year: growth, IBI and other costs, imputación unless let.
  const level = deflatorAt(year);
  const rentals = new Map<Property, Rental>();
  for (const p of properties) {
    const g = p.value * market.propertyGrowth;
    p.value += g;
    out.growth += g;
    out.ibi += p.ibi * level;
    out.ownershipCosts += ((p.community ?? 0) + (p.insurance ?? 0)) * level;
    const rental = plan.rentals.find((r) => r.propertyId === p.id && isActive(r.start, r.end, year, plan, reached));
    if (rental) {
      rentals.set(p, rental);
      p.rentedSince ??= year;
    } else if (p.use === 'second') {
      const rent = imputacionRenta(p.valorCatastral, rules.inmuebles, {
        revisado: p.catastroRevisado,
        precioAdquisicion: p.acquisitionValue,
      });
      shares(p.owner, n).forEach((s, i) => (out.imputedRent[i] += rent * s));
    }
  }
  const euribor = euriborOf(plan, market);
  const interestOf = new Map<string, number>();
  for (const l of loans) {
    const v = l.variable;
    if (v && year >= (v.fromYear ?? plan.startYear + 1)) reviseRate(l, variableRate(euribor, v.diferencial));
    const a = amortize(l);
    out.loanInterest += a.interest;
    out.loanPrincipal += a.principal;
    if (l.propertyId) interestOf.set(l.propertyId, (interestOf.get(l.propertyId) ?? 0) + a.interest);
  }

  // Homes let: rent and the rendimiento del capital inmobiliario of each (arts. 22–23 LIRPF).
  for (const [p, r] of rentals) {
    const rent = amountInYear(r.amount, r.per, r.growth, year - plan.startYear, level) * r.occupancy;
    const repairs = r.repairs * level;
    const res = rendimientoArrendamiento(rent, rules.inmuebles, {
      financiacionReparacion: (interestOf.get(p.id) ?? 0) + repairs,
      otrosGastos: (p.ibi + (p.community ?? 0) + (p.insurance ?? 0)) * level,
      amortizacion: p.constructionShare
        ? amortizacionInmueble(p.acquisitionValue, p.valorCatastral, p.constructionShare, rules.inmuebles)
        : 0,
      reduccion: r.reduction,
      pendientes: p.rentalPending ?? null,
    });
    p.rentalPending = res.pendientes;
    out.rent += rent;
    out.rentalRepairs += repairs;
    shares(p.owner, n).forEach((s, i) => (out.rentalIncome[i] += res.rendimiento_neto_reducido * s));
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
    // A home let before the sale is still the vivienda habitual if it was one until any day of the
    // two years before the sale (art. 41 bis.3 RIRPF): it stopped being one at the end of the year
    // before the rental, the sale is mid-year. Moving back in is not modelled.
    const habitual =
      p.use === 'habitual' &&
      (p.rentedSince === undefined || year - p.rentedSince + 1 <= rules.inmuebles.habitual_hasta_anos);
    shares(p.owner, n).forEach((s, i) => {
      const exempt = habitual
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
      ...(pp.community ? { community: pp.community } : {}),
      ...(pp.insurance ? { insurance: pp.insurance } : {}),
      ...(pp.constructionShare ? { constructionShare: pp.constructionShare } : {}),
    });
    const m = pp.mortgage;
    if (m && m.amount > 0) {
      const amount = m.amount * deflatorAt(year);
      out.newLoans += amount;
      // Payments start next year: a variable one at this year's Euríbor, a mixed one at the fixed
      // rate for fixedYears. Revisions follow once a year.
      const v = m.variable;
      const rate = v && v.fixedYears === 0 ? variableRate(euribor, v.diferencial) : m.rate;
      loans.push({
        id: `mortgage:${pp.id}`,
        name: `Mortgage · ${pp.name}`,
        balance: amount,
        rate,
        monthlyPayment: annuityPayment(amount, rate, m.years),
        propertyId: id,
        ...(v ? { variable: { diferencial: v.diferencial, fromYear: year + 1 + v.fixedYears } } : {}),
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
    r.ownershipCosts +
    r.rent -
    r.rentalRepairs -
    r.loanInterest -
    r.loanPrincipal
  );
}

export const propertiesValue = (ps: Property[]) => ps.reduce((s, p) => s + p.value, 0);
export const loansBalance = (ls: Loan[]) => ls.reduce((s, l) => s + l.balance, 0);
