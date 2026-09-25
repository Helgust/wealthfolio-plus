// Port of planner.tax.autonomo: rendimiento neto (estimación directa simplificada) and RETA cuota.
// A full year in alta; amounts are yearly, except the RETA base (euros per month, as in the tables).
import type { ActividadRules, IrpfRules, RetaRules } from './rules';

/** Provisiones + gastos de difícil justificación (art. 30.2.2.ª RIRPF). */
export function gastosDificilJustificacion(rendimientoPrevio: number, rules: ActividadRules) {
  const g = rules.gastos_dificil_justificacion;
  return Math.min(g.rate * Math.max(rendimientoPrevio, 0), g.limit);
}

/**
 * IRPF rendimiento neto. gastos — all deductible expenses of the year, including the RETA cuota.
 * gastosDificil=false — without gastos de difícil justificación (under reducción art. 32.2.1º).
 */
export function rendimientoNeto(
  ingresos: number,
  gastos: number,
  rules: ActividadRules,
  gastosDificil = true,
): number {
  const previo = ingresos - gastos;
  return gastosDificil ? previo - gastosDificilJustificacion(previo, rules) : previo;
}

/** Index of the tramo in rules.tramos for a monthly rendimiento computable. */
export function retaTramo(rendimientoMensual: number, rules: RetaRules): number {
  let idx = 0;
  for (const t of rules.tramos.slice(0, -1)) {
    if (t.inclusive ? rendimientoMensual > t.upto! : rendimientoMensual >= t.upto!) idx++;
  }
  return idx;
}

export function retaTiposTotal(rules: RetaRules): number {
  const t = rules.tipos;
  return (
    t.contingencias_comunes +
    t.contingencias_profesionales +
    t.cese_actividad +
    t.formacion_profesional +
    t.mei
  );
}

/** Year result of the autónomo activity. */
export interface Actividad {
  ingresos: number;
  gastos: number; // excluding RETA
  cuota_reta: number; // per year
  gastos_dificil_justificacion: number;
  rendimiento_neto: number; // IRPF, goes to the general base
  rendimiento_computable: number; // for RETA, per year (after gastos genéricos)
  reta_tramo: number; // index into rules.reta.tramos
  reta_base: number; // euros per month
}

/**
 * Rendimiento neto and RETA cuota for the year, accounting for their mutual dependency: the cuota
 * is a gasto deducible, while the tramo is chosen by rendimiento computable = (rendimiento neto +
 * cuota) × (1 − gastos genéricos) / 12 (art. 308.1.c LGSS). Tries the tramos and takes the first
 * consistent one (details in the Python reference docstring).
 *
 * baseElegida — monthly base chosen by the autónomo (null — the minimum); clamped to the tramo.
 * gastos — expenses excluding the RETA cuota.
 */
export function actividad(
  ingresos: number,
  gastos: number,
  rules: IrpfRules,
  baseElegida: number | null = null,
  gastosDificil = true,
): Actividad {
  const reta = rules.reta;
  const antesReta = ingresos - gastos;
  const tipos = retaTiposTotal(reta);

  const candidatos = reta.tramos.map((t) => {
    const base =
      baseElegida === null ? t.base_min : Math.min(Math.max(baseElegida, t.base_min), t.base_max);
    const cuota = base * 12 * tipos;
    const neto = rendimientoNeto(antesReta, cuota, rules.actividad, gastosDificil);
    const computable = (neto + cuota) * (1 - reta.gastos_genericos);
    return { base, cuota, neto, computable };
  });
  // Like np.argmax: if no tramo is consistent, the first one is taken.
  const k = Math.max(
    0,
    candidatos.findIndex((c, i) => retaTramo(c.computable / 12, reta) === i),
  );
  const c = candidatos[k];
  return {
    ingresos,
    gastos,
    cuota_reta: c.cuota,
    gastos_dificil_justificacion: ingresos - gastos - c.cuota - c.neto,
    rendimiento_neto: c.neto,
    rendimiento_computable: c.computable,
    reta_tramo: k,
    reta_base: c.base,
  };
}
