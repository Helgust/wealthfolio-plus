// Порт planner.tax.autonomo: rendimiento neto (estimación directa simplificada) и cuota RETA.
// Полный год в alta; суммы годовые, кроме базы RETA (евро в месяц, как в таблицах).
import type { ActividadRules, IrpfRules, RetaRules } from './rules';

/** Provisiones + gastos de difícil justificación (art. 30.2.2.ª RIRPF). */
export function gastosDificilJustificacion(rendimientoPrevio: number, rules: ActividadRules) {
  const g = rules.gastos_dificil_justificacion;
  return Math.min(g.rate * Math.max(rendimientoPrevio, 0), g.limit);
}

/**
 * Rendimiento neto IRPF. gastos — все вычитаемые расходы года, включая cuota RETA.
 * gastosDificil=false — без gastos de difícil justificación (при reducción art. 32.2.1º).
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

/** Индекс tramo в rules.tramos для rendimiento computable в месяц. */
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

/** Итог года по деятельности autónomo. */
export interface Actividad {
  ingresos: number;
  gastos: number; // без RETA
  cuota_reta: number; // в год
  gastos_dificil_justificacion: number;
  rendimiento_neto: number; // IRPF, идёт в общую базу
  rendimiento_computable: number; // для RETA, в год (после gastos genéricos)
  reta_tramo: number; // индекс в rules.reta.tramos
  reta_base: number; // евро в месяц
}

/**
 * Rendimiento neto и cuota RETA за год с учётом их взаимной зависимости: cuota — gasto
 * deducible, а tramo выбирается по rendimiento computable = (rendimiento neto + cuota) ×
 * (1 − gastos genéricos) / 12 (art. 308.1.c LGSS). Перебираем tramos и берём первый
 * согласованный (подробно — в docstring Python-эталона).
 *
 * baseElegida — база в месяц, выбранная autónomo (null — минимальная); прижимается к tramo.
 * gastos — расходы без cuota RETA.
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
  // Как np.argmax: если согласованного tramo нет, берётся первый.
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
