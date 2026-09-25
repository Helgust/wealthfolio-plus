// Port of planner.tax.irpf: cuota íntegra by half and the full year calculation, individual and conjunta.
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
 * Cuota íntegra of one half. The mínimo is not subtracted from the base: it is allocated to the
 * general base first, the rest to the savings base; the scale is applied to the base and to the
 * mínimo part, and the second is subtracted from the first (arts. 56.2, 63, 66 LIRPF).
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

/** Full IRPF calculation for a year. */
export interface IrpfAnual {
  rendimiento_actividad: number; // rendimiento neto before art. 32 reducciones
  reduccion_actividad: number;
  gastos_trabajo: number; // otros gastos art. 19.2.f on trabajo_integro
  reduccion_trabajo: number; // art. 20 on trabajo_integro
  base_imponible_general: number;
  base_imponible_ahorro: number;
  compensado_ahorro_anteriores: number;
  reduccion_conjunta: number; // art. 84.2.3º, from the general and savings bases
  reduccion_prevision_social: number;
  compensado_general_anteriores: number;
  base_liquidable_general: number;
  base_liquidable_ahorro: number;
  minimo: Mitades;
  cuota_integra: Mitades;
  deducciones: Mitades;
  cuota_liquida: Mitades;
  pendientes_general: PendientesGeneral; // carry-forward state for the next year
  pendientes_ahorro: PendientesAhorro;
}

/** Rentas of one taxpayer (or a spouse in conjunta). Same meaning as in the Python reference. */
export interface Rentas {
  rendimiento_actividad?: number;
  /** Rendimientos netos reducidos del trabajo — already after arts. 19–20, as in the tax return */
  rendimientos_trabajo?: number;
  /**
   * Rendimientos íntegros del trabajo without Seguridad Social contributions: pension plan payouts,
   * pensions. 19.2.f and art. 20 apply to them; do not mix with rendimientos_trabajo.
   */
  trabajo_integro?: number;
  otras_rentas_general?: number;
  rcm?: number; // saldo, may be < 0
  ganancias?: number; // saldo, may be < 0
  aportacion_pensiones?: number;
  aportacion_pensiones_autonomo?: number;
}

export interface IrpfOpts {
  deducciones?: Mitades; // sum by half, entered by the user
  dependiente?: boolean;
  discapacidad?: Discapacidad;
  inicio_actividad?: boolean;
  pendientes_general?: PendientesGeneral;
  pendientes_ahorro?: PendientesAhorro;
}

/** IRPF for a year, tributación individual: from rendimientos to cuota líquida. */
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
 * IRPF for a year in tributación conjunta, unidad familiar biparental (arts. 82.1.1.ª, 84 LIRPF):
 * rentas are added up, art. 32 reducciones are applied once per unidad familiar, pension plan
 * limits per spouse, and before them the base is reduced by reduccion_biparental. minimo — from minimoConjunta.
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
  // TODO: verify — 30 % (art. 52.1.a) of the spouse's own rendimientos without the arts. 20 and 32
  // reducciones: in conjunta they are applied once per unidad familiar. 19.2.f and art. 20 are also
  // applied once per unidad familiar (Manual práctico 2025, cap. 3).
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
  // Art. 20 threshold — algebraic sum of other rentas, actividades before art. 32 reducciones
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

  // Art. 48.a: rendimientos of the general base offset each other without limit.
  const big = rnReducido + trabajo + otrasGeneral;
  const ahorro = baseImponibleAhorro(rcm, ganancias, pendAhorro, r.compensacion);

  // Art. 84.2.3º: general base first (not below 0), the rest from the savings base (not below 0).
  const conjGeneral = Math.min(reduccionConjunta, Math.max(big, 0));
  const conjAhorro = Math.min(reduccionConjunta - conjGeneral, ahorro.base_imponible);
  const bigReducida = big - conjGeneral;

  // Art. 50.1: reducciones cannot make the base negative.
  // TODO: verify — 30 % (art. 52.1.a) of trabajo after the art. 20 reducción, as for actividad.
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
    // The cuota líquida of each half cannot be negative.
    cuota_liquida: {
      estatal: Math.max(ci.estatal - deducciones.estatal, 0),
      autonomica: Math.max(ci.autonomica - deducciones.autonomica, 0),
    },
    pendientes_general: general.pendientes,
    pendientes_ahorro: ahorro.pendientes,
  };
}
