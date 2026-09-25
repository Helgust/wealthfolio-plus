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

/**
 * Rules for computing year: that year or the latest available before it. Future years get the
 * frozen rules of the last known year (Spanish scales are not indexed automatically).
 */
export function rulesForYear(year: number): IrpfRules {
  const past = RULES.filter((r) => r.year <= year);
  if (past.length === 0) throw new Error(`no tax rules for ${year} or earlier`);
  return past[past.length - 1];
}
