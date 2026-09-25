// Порт planner.tax.minimos: mínimo personal y familiar (arts. 56–61, 84.2.2º LIRPF).
import type { DiscapacidadAmounts, IrpfRules, MinimoAmounts, MinimoConditions } from './rules';

export type Discapacidad = 'ninguna' | 'grado_33' | 'grado_65';

/** Возраст — на 31 декабря года расчёта (art. 61 LIRPF). */
export interface Persona {
  edad: number;
  discapacidad: Discapacidad;
  asistencia: boolean; // помощь третьих лиц / ограниченная мобильность
}

/** Descendiente или ascendiente, живущий с налогоплательщиком. */
export interface Familiar extends Persona {
  renta_anual: number; // выше лимита — права на mínimo нет
  share: number; // доля этого налогоплательщика, 0.5 — если детей декларируют оба родителя
}

/** Величина, считаемая отдельно для государственной и автономной половины IRPF. */
export interface Mitades {
  estatal: number;
  autonomica: number;
}

export const total = (m: Mitades) => m.estatal + m.autonomica;

function discapacidad(p: Persona, a: DiscapacidadAmounts): number {
  if (p.discapacidad === 'ninguna') return 0;
  const grado65 = p.discapacidad === 'grado_65';
  return (grado65 ? a.grado_65 : a.grado_33) + (p.asistencia || grado65 ? a.asistencia : 0);
}

function incrementosContribuyente(p: Persona, a: MinimoAmounts, c: MinimoConditions): number {
  let t = discapacidad(p, a.discapacidad);
  if (p.edad >= c.edad_mayor_65) t += a.contribuyente.mayor_65;
  if (p.edad >= c.edad_mayor_75) t += a.contribuyente.mayor_75;
  return t;
}

function minimoMitad(
  contribuyentes: Persona[],
  descendientes: Familiar[],
  ascendientes: Familiar[],
  a: MinimoAmounts,
  c: MinimoConditions,
): number {
  // Общая сумма — одна на декларацию и в conjunta; прибавки — по каждому супругу (84.2.2º).
  let t = a.contribuyente.general;
  for (const p of contribuyentes) t += incrementosContribuyente(p, a, c);

  // Descendientes: младше 25 или с discapacidad, доходы не выше лимита; старший — «первый».
  const eligible = descendientes
    .filter(
      (d) =>
        (d.edad < c.descendiente_edad_max || d.discapacidad !== 'ninguna') &&
        d.renta_anual <= c.renta_max_familiar,
    )
    .sort((x, y) => y.edad - x.edad);
  const porOrden = a.descendientes.por_orden;
  eligible.forEach((d, i) => {
    let amount = porOrden[Math.min(i, porOrden.length - 1)];
    if (d.edad < c.descendiente_menor) amount += a.descendientes.menor_3;
    t += (amount + discapacidad(d, a.discapacidad)) * d.share;
  });

  // Ascendientes: старше 65 или с discapacidad, доходы не выше лимита (art. 59).
  for (const p of ascendientes) {
    if (p.renta_anual > c.renta_max_familiar) continue;
    if (p.edad < c.edad_mayor_65 && p.discapacidad === 'ninguna') continue;
    let amount = a.ascendientes.general;
    if (p.edad >= c.edad_mayor_75) amount += a.ascendientes.mayor_75;
    t += (amount + discapacidad(p, a.discapacidad)) * p.share;
  }
  return t;
}

function minimo(
  contribuyentes: Persona[],
  rules: IrpfRules,
  descendientes: Familiar[] = [],
  ascendientes: Familiar[] = [],
): Mitades {
  const c = rules.condiciones;
  return {
    estatal: minimoMitad(contribuyentes, descendientes, ascendientes, rules.estatal.minimos, c),
    autonomica: minimoMitad(
      contribuyentes,
      descendientes,
      ascendientes,
      rules.autonomica.minimos,
      c,
    ),
  };
}

/** Mínimo одного налогоплательщика (tributación individual). */
export function minimoPersonalFamiliar(
  contribuyente: Persona,
  rules: IrpfRules,
  descendientes?: Familiar[],
  ascendientes?: Familiar[],
): Mitades {
  return minimo([contribuyente], rules, descendientes, ascendientes);
}

/**
 * Mínimo в tributación conjunta (art. 84.2.2º): mínimo del contribuyente — один на unidad
 * familiar, прибавки за возраст и discapacidad — по каждому супругу; дети с share=1.
 */
export function minimoConjunta(
  conyuges: Persona[],
  rules: IrpfRules,
  descendientes?: Familiar[],
  ascendientes?: Familiar[],
): Mitades {
  return minimo(conyuges, rules, descendientes, ascendientes);
}
