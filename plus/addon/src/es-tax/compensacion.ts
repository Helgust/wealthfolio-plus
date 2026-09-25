// Port of planner.tax.compensacion: loss offsetting with a 4-year carry-forward (arts. 49, 50.3 LIRPF).
// State — loss amounts by year of origin, oldest first. The savings base has two baskets:
// [RCM, GP].
import type { Compensacion } from './rules';

export type PendientesGeneral = number[];
export type PendientesAhorro = [number[], number[]];

const RCM = 0;
const GP = 1;

export function pendientesVaciosGeneral(rules: Compensacion): PendientesGeneral {
  return new Array(rules.anos).fill(0);
}

export function pendientesVaciosAhorro(rules: Compensacion): PendientesAhorro {
  return [new Array(rules.anos).fill(0), new Array(rules.anos).fill(0)];
}

/** Consumes up to importe from the baskets (oldest first); returns the amount used per basket. */
function consumir(importe: number, pendientes: number[]): number[] {
  let antes = 0;
  return pendientes.map((p) => {
    const usado = Math.min(Math.max(importe - antes, 0), p);
    antes += p;
    return usado;
  });
}

/** Shifts one year: the oldest drops out, the current year's losses go to the end. */
const avanzar = (pendientes: number[], nuevas: number) => [...pendientes.slice(1), nuevas];

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export interface BaseAhorro {
  base_imponible: number;
  compensado_anteriores: number;
  pendientes: PendientesAhorro;
}

/**
 * Base imponible del ahorro with loss offsetting. Step 1: a loss in one basket is offset by the
 * other basket's positive saldo within limite_cruzado. Step 2: prior losses — against their own
 * basket in full, then against the other within what is left of the same limit.
 */
export function baseImponibleAhorro(
  rcm: number,
  ganancias: number,
  pendientes: PendientesAhorro,
  rules: Compensacion,
): BaseAhorro {
  const pend = pendientes.map((p) => [...p]) as PendientesAhorro;
  const lim = rules.limite_cruzado;
  const saldo = [rcm, ganancias];
  const disponible = [Math.max(rcm, 0), Math.max(ganancias, 0)];
  const cupo = disponible.map((v) => lim * v);
  const otra = (k: number) => 1 - k;

  const nuevas = [0, 0];
  for (const k of [RCM, GP]) {
    const perdida = Math.max(-saldo[k], 0);
    const c = Math.min(perdida, cupo[otra(k)]);
    disponible[otra(k)] -= c;
    cupo[otra(k)] -= c;
    nuevas[k] = perdida - c;
  }

  const compensar = (kPerdida: number, kSaldo: number, tope: number) => {
    const usado = consumir(tope, pend[kPerdida]);
    pend[kPerdida] = pend[kPerdida].map((p, i) => p - usado[i]);
    const s = sum(usado);
    disponible[kSaldo] -= s;
    return s;
  };

  let total = compensar(RCM, RCM, disponible[RCM]);
  total += compensar(GP, GP, disponible[GP]);
  total += compensar(RCM, GP, Math.min(disponible[GP], cupo[GP]));
  total += compensar(GP, RCM, Math.min(disponible[RCM], cupo[RCM]));

  return {
    base_imponible: disponible[RCM] + disponible[GP],
    compensado_anteriores: total,
    pendientes: [avanzar(pend[RCM], nuevas[RCM]), avanzar(pend[GP], nuevas[GP])],
  };
}

export interface BaseGeneral {
  base_liquidable: number; // ≥ 0
  compensado_anteriores: number;
  pendientes: PendientesGeneral;
}

/** A negative base liquidable general is carried forward 4 years (art. 50.3). */
export function compensarBaseLiquidableGeneral(
  baseLiquidable: number,
  pendientes: PendientesGeneral,
): BaseGeneral {
  const positiva = Math.max(baseLiquidable, 0);
  const usado = consumir(positiva, pendientes);
  const s = sum(usado);
  return {
    base_liquidable: positiva - s,
    compensado_anteriores: s,
    pendientes: avanzar(
      pendientes.map((p, i) => p - usado[i]),
      Math.max(-baseLiquidable, 0),
    ),
  };
}
