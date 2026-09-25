// Порт planner.tax.reducciones: reducciones общей базы (arts. 19.2.f, 20, 32, 51–52 LIRPF).
import type { Discapacidad } from './minimos';
import type { PrevisionSocial, ReduccionesActividad, Trabajo, TramoDecreciente } from './rules';

const clip = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/** importe до plano_hasta, затем линейно убывает до 0. */
function tramoDecreciente(x: number, t: TramoDecreciente): number {
  return clip(t.importe - t.pendiente * Math.max(x - t.plano_hasta, 0), 0, t.importe);
}

export interface RendimientoTrabajo {
  otros_gastos: number;
  reduccion: number;
  neto_reducido: number;
}

/**
 * Rendimiento neto reducido del trabajo без взносов в Seguridad Social (выплаты планов пенсий,
 * пенсии): íntegro − otros gastos (art. 19.2.f) − reducción (art. 20). otrasRentas —
 * алгебраическая сумма прочих rentas no exentas (порог art. 20).
 */
export function rendimientoTrabajo(
  integro: number,
  otrasRentas: number,
  rules: Trabajo,
): RendimientoTrabajo {
  const positivo = Math.max(integro, 0);
  const gastos = Math.min(rules.otros_gastos, positivo);
  const r = rules.reduccion;
  let red =
    integro <= r.plano_hasta
      ? r.importe
      : integro <= r.quiebra
        ? r.importe - r.pendiente * (integro - r.plano_hasta)
        : r.importe_quiebra - r.pendiente_quiebra * (integro - r.quiebra);
  if (!(integro < r.rend_max && otrasRentas <= r.otras_rentas_max)) red = 0;
  // Art. 20: saldo после reducción не может быть отрицательным.
  red = clip(red, 0, positivo - gastos);
  return { otros_gastos: gastos, reduccion: red, neto_reducido: integro - gastos - red };
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
