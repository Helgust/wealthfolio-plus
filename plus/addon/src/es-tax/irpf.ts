// Порт planner.tax.irpf: cuota íntegra по половинам и полный расчёт года, individual и conjunta.
import {
  baseImponibleAhorro,
  compensarBaseLiquidableGeneral,
  pendientesVaciosAhorro,
  pendientesVaciosGeneral,
  type PendientesAhorro,
  type PendientesGeneral,
} from './compensacion';
import type { Discapacidad, Mitades } from './minimos';
import { reduccionActividad, reduccionPrevisionSocial, rendimientoTrabajo } from './reducciones';
import type { IrpfRules, Scale } from './rules';
import { applyScale } from './scale';

/**
 * Cuota íntegra одной половины. Mínimo не вычитается из базы: он относится сначала к общей
 * базе, остаток — к базе сбережений; шкала применяется к базе и к части mínimo, второе
 * вычитается из первого (arts. 56.2, 63, 66 LIRPF).
 */
export function cuotaIntegraMitad(
  baseGeneral: number,
  baseAhorro: number,
  minimo: number,
  scaleGeneral: Scale,
  scaleAhorro: Scale,
): number {
  const minimoGeneral = Math.min(minimo, baseGeneral);
  const minimoAhorro = Math.min(minimo - minimoGeneral, baseAhorro);
  return (
    applyScale(scaleGeneral, baseGeneral) -
    applyScale(scaleGeneral, minimoGeneral) +
    (applyScale(scaleAhorro, baseAhorro) - applyScale(scaleAhorro, minimoAhorro))
  );
}

export function cuotaIntegra(
  baseGeneral: number,
  baseAhorro: number,
  minimo: Mitades,
  rules: IrpfRules,
): Mitades {
  const { estatal: e, autonomica: a } = rules;
  return {
    estatal: cuotaIntegraMitad(baseGeneral, baseAhorro, minimo.estatal, e.general, e.ahorro),
    autonomica: cuotaIntegraMitad(baseGeneral, baseAhorro, minimo.autonomica, a.general, a.ahorro),
  };
}

/** Полный расчёт IRPF за год. */
export interface IrpfAnual {
  rendimiento_actividad: number; // rendimiento neto до reducciones art. 32
  reduccion_actividad: number;
  gastos_trabajo: number; // otros gastos art. 19.2.f с trabajo_integro
  reduccion_trabajo: number; // art. 20 с trabajo_integro
  base_imponible_general: number;
  base_imponible_ahorro: number;
  compensado_ahorro_anteriores: number;
  reduccion_conjunta: number; // art. 84.2.3º, с общей базы и базы сбережений
  reduccion_prevision_social: number;
  compensado_general_anteriores: number;
  base_liquidable_general: number;
  base_liquidable_ahorro: number;
  minimo: Mitades;
  cuota_integra: Mitades;
  deducciones: Mitades;
  cuota_liquida: Mitades;
  pendientes_general: PendientesGeneral; // состояние переноса на следующий год
  pendientes_ahorro: PendientesAhorro;
}

/** Rentas одного налогоплательщика (или супруга в conjunta). Смысл — как в Python-эталоне. */
export interface Rentas {
  rendimiento_actividad?: number;
  /** Rendimientos netos reducidos del trabajo — уже после arts. 19–20, как в декларации */
  rendimientos_trabajo?: number;
  /**
   * Rendimientos íntegros del trabajo без взносов в Seguridad Social: выплаты планов пенсий,
   * пенсии. К ним применяются 19.2.f и art. 20; с rendimientos_trabajo не смешивать.
   */
  trabajo_integro?: number;
  otras_rentas_general?: number;
  rcm?: number; // saldo, может быть < 0
  ganancias?: number; // saldo, может быть < 0
  aportacion_pensiones?: number;
  aportacion_pensiones_autonomo?: number;
}

export interface IrpfOpts {
  deducciones?: Mitades; // сумма по половинам, вводит пользователь
  dependiente?: boolean;
  discapacidad?: Discapacidad;
  inicio_actividad?: boolean;
  pendientes_general?: PendientesGeneral;
  pendientes_ahorro?: PendientesAhorro;
}

/** IRPF за год, tributación individual: от rendimientos до cuota líquida. */
export function irpfAnual(
  rules: IrpfRules,
  minimo: Mitades,
  rentas: Rentas,
  opts: IrpfOpts = {},
): IrpfAnual {
  const ps = rules.reducciones.prevision_social;
  return irpf(rules, minimo, rentas, opts, 0, (rnReducido, trabajo) =>
    reduccionPrevisionSocial(
      rentas.aportacion_pensiones ?? 0,
      rentas.aportacion_pensiones_autonomo ?? 0,
      rnReducido + trabajo,
      ps,
    ),
  );
}

/**
 * IRPF за год в tributación conjunta, unidad familiar biparental (arts. 82.1.1.ª, 84 LIRPF):
 * rentas складываются, reducciones art. 32 — одна на unidad familiar, лимиты планов пенсий —
 * по каждому супругу, до них база уменьшается на reduccion_biparental. minimo — из minimoConjunta.
 */
export function irpfConjunta(
  rules: IrpfRules,
  minimo: Mitades,
  miembros: Rentas[],
  opts: IrpfOpts = {},
): IrpfAnual {
  const suma = (k: keyof Rentas) => miembros.reduce((s, m) => s + (m[k] ?? 0), 0);
  const ps = rules.reducciones.prevision_social;
  const rentas: Rentas = {
    rendimiento_actividad: suma('rendimiento_actividad'),
    rendimientos_trabajo: suma('rendimientos_trabajo'),
    trabajo_integro: suma('trabajo_integro'),
    otras_rentas_general: suma('otras_rentas_general'),
    rcm: suma('rcm'),
    ganancias: suma('ganancias'),
  };
  // TODO: verify — 30 % (art. 52.1.a) от собственных rendimientos супруга без reducciones
  // arts. 20 и 32: в conjunta они одни на всю unidad familiar. 19.2.f и art. 20 — тоже одни
  // на unidad familiar (Manual práctico 2025, cap. 3).
  const prevision = () =>
    miembros.reduce(
      (s, m) =>
        s +
        reduccionPrevisionSocial(
          m.aportacion_pensiones ?? 0,
          m.aportacion_pensiones_autonomo ?? 0,
          (m.rendimiento_actividad ?? 0) + (m.rendimientos_trabajo ?? 0) + (m.trabajo_integro ?? 0),
          ps,
        ),
      0,
    );
  const conj = rules.reducciones.tributacion_conjunta.reduccion_biparental;
  return irpf(rules, minimo, rentas, opts, conj, prevision);
}

function irpf(
  rules: IrpfRules,
  minimo: Mitades,
  rentas: Rentas,
  opts: IrpfOpts,
  reduccionConjunta: number,
  prevision: (rnReducido: number, trabajo: number) => number,
): IrpfAnual {
  const r = rules.reducciones;
  const pendGeneral = opts.pendientes_general ?? pendientesVaciosGeneral(r.compensacion);
  const pendAhorro = opts.pendientes_ahorro ?? pendientesVaciosAhorro(r.compensacion);
  const deducciones = opts.deducciones ?? { estatal: 0, autonomica: 0 };

  const rn = rentas.rendimiento_actividad ?? 0;
  const otrasGeneral = rentas.otras_rentas_general ?? 0;
  const rcm = rentas.rcm ?? 0;
  const ganancias = rentas.ganancias ?? 0;
  // Порог art. 20 — алгебраическая сумма прочих rentas, actividades без reducciones art. 32
  // (Manual práctico 2025, cap. 3, fase 3).
  const trab = rendimientoTrabajo(
    rentas.trabajo_integro ?? 0,
    rn + otrasGeneral + rcm + ganancias,
    r.trabajo,
  );
  const trabajo = (rentas.rendimientos_trabajo ?? 0) + trab.neto_reducido;
  const otrasRentas =
    Math.max(trabajo, 0) + Math.max(otrasGeneral, 0) + Math.max(rcm, 0) + Math.max(ganancias, 0);
  const redAct = reduccionActividad(rn, r.actividad, {
    otrasRentas,
    dependiente: opts.dependiente,
    discapacidad: opts.discapacidad,
    inicioActividad: opts.inicio_actividad,
  });
  const rnReducido = rn - redAct;

  // Art. 48.a: rendimientos общей базы компенсируются между собой без ограничений.
  const big = rnReducido + trabajo + otrasGeneral;
  const ahorro = baseImponibleAhorro(rcm, ganancias, pendAhorro, r.compensacion);

  // Art. 84.2.3º: сначала общая база (не ниже 0), остаток — база сбережений (не ниже 0).
  const conjGeneral = Math.min(reduccionConjunta, Math.max(big, 0));
  const conjAhorro = Math.min(reduccionConjunta - conjGeneral, ahorro.base_imponible);
  const bigReducida = big - conjGeneral;

  // Art. 50.1: reducciones не могут сделать базу отрицательной.
  // TODO: verify — 30 % (art. 52.1.a) от trabajo после reducción art. 20, как у actividad.
  const redPs = Math.min(prevision(rnReducido, trabajo), Math.max(bigReducida, 0));
  const general = compensarBaseLiquidableGeneral(bigReducida - redPs, pendGeneral);

  const blg = general.base_liquidable;
  const bla = ahorro.base_imponible - conjAhorro;
  const ci = cuotaIntegra(blg, bla, minimo, rules);
  return {
    rendimiento_actividad: rn,
    reduccion_actividad: redAct,
    gastos_trabajo: trab.otros_gastos,
    reduccion_trabajo: trab.reduccion,
    base_imponible_general: big,
    base_imponible_ahorro: ahorro.base_imponible,
    compensado_ahorro_anteriores: ahorro.compensado_anteriores,
    reduccion_conjunta: conjGeneral + conjAhorro,
    reduccion_prevision_social: redPs,
    compensado_general_anteriores: general.compensado_anteriores,
    base_liquidable_general: blg,
    base_liquidable_ahorro: bla,
    minimo,
    cuota_integra: ci,
    deducciones,
    // Cuota líquida каждой половины не может быть отрицательной.
    cuota_liquida: {
      estatal: Math.max(ci.estatal - deducciones.estatal, 0),
      autonomica: Math.max(ci.autonomica - deducciones.autonomica, 0),
    },
    pendientes_general: general.pendientes,
    pendientes_ahorro: ahorro.pendientes,
  };
}
