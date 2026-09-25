// TS port against the Python reference: fixtures/golden.json is exported by `python -m planner.export_ts`.
import { describe, expect, it } from 'vitest';
import golden from './fixtures/golden.json';
import {
  actividad,
  indexRules,
  irpfAnual,
  irpfConjunta,
  loadIrpfRules,
  minimoConjunta,
  minimoPersonalFamiliar,
  type Familiar,
  type IrpfOpts,
  type Persona,
  type Rentas,
} from './index';

const TOL = 0.01; // euros

interface Hogar {
  contribuyentes: Persona[];
  descendientes: Familiar[];
  ascendientes: Familiar[];
}

/** Recursively compares numbers with a tolerance; returns the path of the first mismatch. */
function diff(got: unknown, want: unknown, path = ''): string | null {
  if (typeof want === 'number') {
    return typeof got === 'number' && Math.abs(got - want) <= TOL
      ? null
      : `${path}: got ${String(got)}, want ${want}`;
  }
  if (want !== null && typeof want === 'object') {
    for (const [k, v] of Object.entries(want)) {
      const d = diff((got as Record<string, unknown>)?.[k], v, `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return got === want ? null : `${path}: got ${String(got)}, want ${String(want)}`;
}

function opts(input: Record<string, unknown>): IrpfOpts {
  const { dependiente, discapacidad, inicio_actividad, deducciones } = input;
  return { dependiente, discapacidad, inicio_actividad, deducciones } as IrpfOpts;
}

describe('golden fixtures from the Python reference', () => {
  it('diff catches mismatches', () => {
    expect(diff({ a: [1, { b: 2 }] }, { a: [1, { b: 2.005 }] })).toBeNull();
    expect(diff({ a: [1, { b: 2 }] }, { a: [1, { b: 2.02 }] })).toBe('.a.1.b: got 2, want 2.02');
    expect(diff({}, { a: 1 })).not.toBeNull();
  });

  it.each(golden.actividad.map((c, i) => [i, c] as const))('actividad #%i', (_, c) => {
    const inp = c.input as Record<string, number | boolean | undefined>;
    const got = actividad(
      inp.ingresos as number,
      inp.gastos as number,
      loadIrpfRules(c.year),
      (inp.base_elegida as number | undefined) ?? null,
      (inp.gastos_dificil as boolean | undefined) ?? true,
    );
    expect(diff(got, c.expected)).toBeNull();
  });

  it.each(golden.irpf_anual.map((c, i) => [i, c] as const))('irpf_anual #%i', (_, c) => {
    const rules = loadIrpfRules(c.year);
    const h = c.hogar_input as Hogar;
    const minimo = minimoPersonalFamiliar(h.contribuyentes[0], rules, h.descendientes, h.ascendientes);
    const got = irpfAnual(rules, minimo, c.input as Rentas, opts(c.input));
    expect(diff(got, c.expected)).toBeNull();
  });

  it.each(golden.irpf_cadena.map((c, i) => [i, c] as const))('irpf chain #%i', (_, c) => {
    const rules = loadIrpfRules(c.year);
    const minimo = minimoPersonalFamiliar((c.hogar_input as Hogar).contribuyentes[0], rules);
    let prev: ReturnType<typeof irpfAnual> | undefined;
    for (const ano of c.anos) {
      prev = irpfAnual(rules, minimo, ano.input as Rentas, {
        pendientes_general: prev?.pendientes_general,
        pendientes_ahorro: prev?.pendientes_ahorro,
      });
      expect(diff(prev, ano.expected)).toBeNull();
    }
  });

  it.each(golden.rules_indexed.map((c, i) => [i, c] as const))('rules indexed #%i', (_, c) => {
    const got = indexRules(loadIrpfRules(c.year), c.factor);
    expect(diff(got, c.expected)).toBeNull();
    // And nothing more: the same set of fields at the top level.
    expect(JSON.stringify(Object.keys(got).sort())).toBe(JSON.stringify(Object.keys(c.expected).sort()));
  });

  it.each(golden.irpf_conjunta.map((c, i) => [i, c] as const))('irpf_conjunta #%i', (_, c) => {
    const rules = loadIrpfRules(c.year);
    const h = c.hogar_input as Hogar;
    const minimo = minimoConjunta(h.contribuyentes, rules, h.descendientes, h.ascendientes);
    const got = irpfConjunta(rules, minimo, c.miembros as Rentas[]);
    expect(diff(got, c.expected)).toBeNull();
  });
});
