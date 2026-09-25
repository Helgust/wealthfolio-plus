// Port of planner.tax.inmuebles: real estate in IRPF and the taxes on buying a home.
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
