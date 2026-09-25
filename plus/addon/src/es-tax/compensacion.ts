// Порт planner.tax.compensacion: зачёт убытков с переносом на 4 года (arts. 49, 50.3 LIRPF).
// Состояние — суммы убытков по годам происхождения, от старшего к младшему. Для базы
// сбережений — две корзины: [RCM, GP].
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

/** Списать до importe из корзин (старшие первыми); списанное по корзинам. */
function consumir(importe: number, pendientes: number[]): number[] {
  let antes = 0;
  return pendientes.map((p) => {
    const usado = Math.min(Math.max(importe - antes, 0), p);
    antes += p;
    return usado;
  });
}

/** Сдвиг на год: старший выбывает, в конец — убытки текущего года. */
const avanzar = (pendientes: number[], nuevas: number) => [...pendientes.slice(1), nuevas];

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export interface BaseAhorro {
  base_imponible: number;
  compensado_anteriores: number;
  pendientes: PendientesAhorro;
}

/**
 * Base imponible del ahorro с зачётом убытков. Фаза 1: убыток одной корзины гасится
 * положительным saldo другой в пределах limite_cruzado. Фаза 2: прошлые убытки — своей
 * корзиной целиком, затем другой в пределах остатка того же лимита.
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

/** Отрицательная base liquidable general переносится на 4 года (art. 50.3). */
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
