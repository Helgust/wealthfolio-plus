// Tax rules of a year. The only source is plus/python/rules/<year>/*.yaml; the JSON next to this
// file is their pydantic-validated copy (`python -m planner.export_ts`). Only types and year selection here.
import rules2025 from './rules/2025.json';
import rules2026 from './rules/2026.json';

export interface Bracket {
  upto: number | null; // upper bound of the bracket, null — unbounded
  rate: number;
}

export interface Scale {
  brackets: Bracket[];
}

export interface DiscapacidadAmounts {
  grado_33: number;
  grado_65: number;
  asistencia: number;
}

export interface MinimoAmounts {
  contribuyente: { general: number; mayor_65: number; mayor_75: number };
  descendientes: { por_orden: number[]; menor_3: number };
  ascendientes: { general: number; mayor_75: number };
  discapacidad: DiscapacidadAmounts;
}

export interface IrpfHalf {
  general: Scale;
  ahorro: Scale;
  minimos: MinimoAmounts;
}

export interface MinimoConditions {
  edad_mayor_65: number;
  edad_mayor_75: number;
  descendiente_edad_max: number;
  descendiente_menor: number;
  renta_max_familiar: number;
}

export interface ActividadRules {
  gastos_dificil_justificacion: { rate: number; limit: number };
}

export interface RetaTramo {
  tabla: 'reducida' | 'general';
  tramo: number;
  upto: number | null; // euros per month
  inclusive: boolean;
  base_min: number;
  base_max: number;
}

export interface RetaRules {
  gastos_genericos: number;
  base_maxima: number;
  tipos: {
    contingencias_comunes: number;
    contingencias_profesionales: number;
    cese_actividad: number;
    formacion_profesional: number;
    mei: number;
  };
  tramos: RetaTramo[];
}

export interface TramoDecreciente {
  plano_hasta: number;
  importe: number;
  pendiente: number;
}

export interface ReduccionesActividad {
  dependiente: {
    general: number;
    adicional: TramoDecreciente & { rend_max: number; otras_rentas_max: number };
    discapacidad_33: number;
    discapacidad_65: number;
  };
  rentas_bajas: TramoDecreciente & { rentas_max: number };
  inicio_actividad: { rate: number; base_max: number };
}

/** Art. 20 LIRPF: a plateau, then two linear declines to 0 at rend_max. */
export interface ReduccionTrabajo {
  rend_max: number;
  otras_rentas_max: number;
  plano_hasta: number;
  importe: number;
  pendiente: number;
  quiebra: number;
  importe_quiebra: number;
  pendiente_quiebra: number;
}

/** Rendimientos del trabajo: otros gastos (art. 19.2.f) and reducción art. 20. */
export interface Trabajo {
  otros_gastos: number;
  reduccion: ReduccionTrabajo;
}

export interface PrevisionSocial {
  limite_general: number;
  incremento_autonomo: number;
  porcentaje_rendimientos: number;
}

export interface Compensacion {
  limite_cruzado: number;
  anos: number;
}

/** Real estate: imputación de rentas and vivienda habitual exemptions, taxes on buying a home. */
export interface Inmuebles {
  imputacion: { general: number; revisado: number; sin_valor_catastral: number; base_sin_valor_catastral: number };
  reinversion: { plazo_anos: number };
  exencion_mayores: { edad: number };
  itp: { general: number; alto_valor: number; alto_valor_desde: number };
  iva_vivienda: number;
  ajd: { vivienda_habitual: number; general: number };
}

export interface IrpfRules {
  year: number; // year the rules come from (not necessarily the tax year)
  estatal: IrpfHalf;
  autonomica: IrpfHalf;
  condiciones: MinimoConditions;
  actividad: ActividadRules;
  reducciones: {
    actividad: ReduccionesActividad;
    trabajo: Trabajo;
    prevision_social: PrevisionSocial;
    compensacion: Compensacion;
    tributacion_conjunta: { reduccion_biparental: number };
  };
  reta: RetaRules;
  inmuebles: Inmuebles;
}

const RULES: IrpfRules[] = [rules2025 as IrpfRules, rules2026 as IrpfRules];

export function availableYears(): number[] {
  return RULES.map((r) => r.year);
}

/** Rules for exactly year. */
export function loadIrpfRules(year: number): IrpfRules {
  const rules = RULES.find((r) => r.year === year);
  if (!rules) throw new Error(`no tax rules for ${year}`);
  return rules;
}

/** Copy of obj with the listed money fields multiplied by f. */
function scaled<T extends object>(obj: T, f: number, ...keys: (keyof T)[]): T {
  const out = { ...obj };
  for (const k of keys) (out[k] as number) = (obj[k] as number) * f;
  return out;
}

const scaleBounds = (s: Scale, f: number): Scale => ({
  brackets: s.brackets.map((b) => ({ ...b, upto: b.upto === null ? null : b.upto * f })),
});

function indexHalf(h: IrpfHalf, f: number): IrpfHalf {
  const m = h.minimos;
  return {
    general: scaleBounds(h.general, f),
    ahorro: scaleBounds(h.ahorro, f),
    minimos: {
      contribuyente: scaled(m.contribuyente, f, 'general', 'mayor_65', 'mayor_75'),
      descendientes: { por_orden: m.descendientes.por_orden.map((v) => v * f), menor_3: m.descendientes.menor_3 * f },
      ascendientes: scaled(m.ascendientes, f, 'general', 'mayor_75'),
      discapacidad: scaled(m.discapacidad, f, 'grado_33', 'grado_65', 'asistencia'),
    },
  };
}

/**
 * All money thresholds × f; ages, rates and the compensación rules are left alone. Port of
 * IrpfRules.indexed in plus/python (checked against it on golden fixtures). f = 1 — the rules as is.
 */
export function indexRules(r: IrpfRules, f: number): IrpfRules {
  if (f === 1) return r;
  const red = r.reducciones;
  const dep = red.actividad.dependiente;
  return {
    year: r.year,
    estatal: indexHalf(r.estatal, f),
    autonomica: indexHalf(r.autonomica, f),
    condiciones: scaled(r.condiciones, f, 'renta_max_familiar'),
    actividad: {
      gastos_dificil_justificacion: scaled(r.actividad.gastos_dificil_justificacion, f, 'limit'),
    },
    reducciones: {
      actividad: {
        dependiente: {
          general: dep.general * f,
          adicional: scaled(dep.adicional, f, 'rend_max', 'otras_rentas_max', 'plano_hasta', 'importe'),
          discapacidad_33: dep.discapacidad_33 * f,
          discapacidad_65: dep.discapacidad_65 * f,
        },
        rentas_bajas: scaled(red.actividad.rentas_bajas, f, 'rentas_max', 'plano_hasta', 'importe'),
        inicio_actividad: scaled(red.actividad.inicio_actividad, f, 'base_max'),
      },
      trabajo: {
        otros_gastos: red.trabajo.otros_gastos * f,
        reduccion: scaled(
          red.trabajo.reduccion,
          f,
          'rend_max',
          'otras_rentas_max',
          'plano_hasta',
          'importe',
          'quiebra',
          'importe_quiebra',
        ),
      },
      prevision_social: scaled(red.prevision_social, f, 'limite_general', 'incremento_autonomo'),
      compensacion: red.compensacion,
      tributacion_conjunta: scaled(red.tributacion_conjunta, f, 'reduccion_biparental'),
    },
    reta: {
      ...r.reta,
      base_maxima: r.reta.base_maxima * f,
      tramos: r.reta.tramos.map((t) => ({
        ...t,
        upto: t.upto === null ? null : t.upto * f,
        base_min: t.base_min * f,
        base_max: t.base_max * f,
      })),
    },
    inmuebles: { ...r.inmuebles, itp: scaled(r.inmuebles.itp, f, 'alto_valor_desde') },
  };
}

/**
 * Rules for computing year: that year or the latest available before it. Future years get the
 * frozen rules of the last known year (Spanish scales are not indexed automatically); a plan
 * that indexes them applies indexRules on top.
 */
export function rulesForYear(year: number): IrpfRules {
  const past = RULES.filter((r) => r.year <= year);
  if (past.length === 0) throw new Error(`no tax rules for ${year} or earlier`);
  return past[past.length - 1];
}
