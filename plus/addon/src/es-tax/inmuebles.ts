// Port of planner.tax.inmuebles: real estate in IRPF — imputación, rentals, the vivienda habitual
// exemptions — and the taxes on buying a home.
import type { Inmuebles } from './rules';

/**
 * Renta imputada (art. 85 LIRPF) of a property that is not the vivienda habitual, not rented and
 * not used in an activity; it goes to the renta general (art. 45). revisado — the municipality's
 * valores catastrales were revised in the year or the ten before. valorCatastral null — none: the
 * rate applies to a share of the acquisition price. dias — days of the year the property was owned.
 */
export function imputacionRenta(
  valorCatastral: number | null,
  rules: Inmuebles,
  { revisado = false, precioAdquisicion = 0, dias = 365, diasAno = 365 } = {},
): number {
  const i = rules.imputacion;
  const [base, rate] =
    valorCatastral === null
      ? [precioAdquisicion * i.base_sin_valor_catastral, i.sin_valor_catastral]
      : [valorCatastral, revisado ? i.revisado : i.general];
  return (base * rate * dias) / diasAno;
}

/**
 * Exempt part of the gain on selling the vivienda habitual: all of it from exencion_mayores.edad
 * (art. 33.4.b LIRPF); otherwise the share reinvested in a new vivienda habitual (art. 38.1 LIRPF,
 * art. 41 RIRPF) of the amount obtained — valor de transmisión minus the loan principal still owed.
 */
export function gananciaExentaVivienda(
  ganancia: number,
  valorTransmision: number,
  prestamoPendiente: number,
  reinvertido: number,
  edad: number,
  rules: Inmuebles,
): number {
  if (ganancia <= 0) return 0;
  if (edad >= rules.exencion_mayores.edad) return ganancia;
  if (reinvertido <= 0) return 0;
  const obtenido = valorTransmision - prestamoPendiente;
  if (obtenido <= 0) return ganancia;
  return ganancia * Math.min(reinvertido / obtenido, 1);
}

/**
 * Taxes on buying a home. A new one: IVA and AJD on the deed (the reduced AJD rate for the vivienda
 * habitual). A second-hand one: ITP, the high-value rate on the whole price above its threshold.
 * Reduced ITP rates (VPO, first home of those under 35) are not modelled.
 */
export function impuestoCompraVivienda(
  precio: number,
  { nueva, habitual }: { nueva: boolean; habitual: boolean },
  rules: Inmuebles,
): number {
  if (nueva) return precio * (rules.iva_vivienda + (habitual ? rules.ajd.vivienda_habitual : rules.ajd.general));
  const itp = rules.itp;
  return precio * (precio > itp.alto_valor_desde ? itp.alto_valor : itp.general);
}

/** Reducción of art. 23.2 LIRPF (and DT 38ª for contracts before Ley 12/2023). */
export type ReduccionArrendamiento = keyof Inmuebles['arrendamiento']['reduccion'];

/**
 * Amortización of a rented home for a year (art. 23.1.b LIRPF): a share of the greater of the
 * acquisition cost and the valor catastral, without the land. construccion — share of the building
 * in the valor catastral (IBI receipt), applied to both values.
 */
export function amortizacionInmueble(
  costeAdquisicion: number,
  valorCatastral: number | null,
  construccion: number,
  rules: Inmuebles,
): number {
  return Math.max(costeAdquisicion, valorCatastral ?? 0) * construccion * rules.arrendamiento.amortizacion;
}

/** Rendimiento del capital inmobiliario of one home let for a year. */
export interface Arrendamiento {
  ingresos: number;
  /** Interest and repairs deducted, prior years' first */
  financiacion_reparacion: number;
  otros_gastos: number;
  amortizacion: number;
  rendimiento_neto: number;
  reduccion: number;
  rendimiento_neto_reducido: number;
  /** Not yet deducted, by year of origin, oldest first */
  pendientes: number[];
}

/**
 * Rendimiento neto reducido from letting a home (arts. 22–23 LIRPF). financiacionReparacion —
 * interest, financing costs, repairs and maintenance: with prior years' excess (the oldest first)
 * they are deducted up to the ingresos (23.1.a.1º). otrosGastos — IBI, comunidad, insurance: no
 * limit. The reducción applies to a positive rendimiento only. pendientes — last year's state.
 */
export function rendimientoArrendamiento(
  ingresos: number,
  rules: Inmuebles,
  {
    financiacionReparacion = 0,
    otrosGastos = 0,
    amortizacion = 0,
    reduccion = 'general' as ReduccionArrendamiento,
    pendientes = null as number[] | null,
  } = {},
): Arrendamiento {
  const a = rules.arrendamiento;
  const previos = pendientes ?? new Array<number>(a.anos_exceso).fill(0);
  let limite = Math.max(ingresos, 0);
  const restantes = previos.map((p) => {
    const usado = Math.min(p, limite);
    limite -= usado;
    return p - usado;
  });
  const delAno = Math.min(financiacionReparacion, limite);
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const deducido = sum(previos) - sum(restantes) + delAno;
  const rn = ingresos - deducido - otrosGastos - amortizacion;
  const red = a.reduccion[reduccion] * Math.max(rn, 0);
  return {
    ingresos,
    financiacion_reparacion: deducido,
    otros_gastos: otrosGastos,
    amortizacion,
    rendimiento_neto: rn,
    reduccion: red,
    rendimiento_neto_reducido: rn - red,
    pendientes: [...restantes.slice(1), financiacionReparacion - delAno],
  };
}
