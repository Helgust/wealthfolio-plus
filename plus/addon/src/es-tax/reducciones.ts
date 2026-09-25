// Порт planner.tax.reducciones: reducciones общей базы (art. 32, arts. 51–52 LIRPF).
import type { Discapacidad } from './minimos';
import type { PrevisionSocial, ReduccionesActividad, TramoDecreciente } from './rules';

const clip = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/** importe до plano_hasta, затем линейно убывает до 0. */
function tramoDecreciente(x: number, t: TramoDecreciente): number {
  return clip(t.importe - t.pendiente * Math.max(x - t.plano_hasta, 0), 0, t.importe);
}

export interface ReduccionActividadOpts {
  otrasRentas?: number; // rentas no exentas помимо деятельности
  dependiente?: boolean; // выполнены требования 32.2.2º
  discapacidad?: Discapacidad;
  inicioActividad?: boolean; // 32.3
}

/** Сумма reducciones art. 32.2 и 32.3; не больше положительного rendimiento. */
export function reduccionActividad(
  rendimientoNeto: number,
  rules: ReduccionesActividad,
  { otrasRentas = 0, dependiente = false, discapacidad = 'ninguna', inicioActividad = false }:
    ReduccionActividadOpts = {},
): number {
  const positivo = Math.max(rendimientoNeto, 0);
  let red: number;
  if (dependiente) {
    const d = rules.dependiente;
    const a = d.adicional;
    red =
      d.general +
      (rendimientoNeto < a.rend_max && otrasRentas <= a.otras_rentas_max
        ? tramoDecreciente(rendimientoNeto, a)
        : 0);
    // TODO: verify — суммируется ли 32.2.1º.b с .a (как в Python-эталоне).
    if (discapacidad === 'grado_65') red += d.discapacidad_65;
    else if (discapacidad === 'grado_33') red += d.discapacidad_33;
  } else {
    const b = rules.rentas_bajas;
    const rentas = rendimientoNeto + otrasRentas; // «incluidas las de la propia actividad»
    red = rentas < b.rentas_max ? tramoDecreciente(rentas, b) : 0;
  }
  red = Math.min(red, positivo); // 32.2.4º

  if (inicioActividad) {
    const i = rules.inicio_actividad;
    red += i.rate * Math.min(positivo - red, i.base_max);
  }
  return red;
}

/**
 * Reducción por aportaciones a planes de pensiones (arts. 51.6, 52.1). aportacionAutonomo —
 * в planes de empleo simplificados: сначала свой incremento, остаток — в общий лимит.
 */
export function reduccionPrevisionSocial(
  aportacion: number,
  aportacionAutonomo: number,
  rendimientosTrabajoActividad: number,
  rules: PrevisionSocial,
): number {
  const enIncremento = Math.min(aportacionAutonomo, rules.incremento_autonomo);
  const enGeneral = Math.min(
    aportacion + aportacionAutonomo - enIncremento,
    rules.limite_general,
  );
  const tope = rules.porcentaje_rendimientos * Math.max(rendimientosTrabajoActividad, 0);
  return Math.min(enIncremento + enGeneral, tope);
}
