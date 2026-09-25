// Налоговые правила года. Единственный источник — plus/python/rules/<год>/*.yaml; JSON рядом —
// их копия, проверенная pydantic (`python -m planner.export_ts`). Здесь только типы и выбор года.
import rules2025 from './rules/2025.json';
import rules2026 from './rules/2026.json';

export interface Bracket {
  upto: number | null; // верхняя граница ступени, null — без ограничения
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
  upto: number | null; // евро в месяц
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
  year: number; // год, из которого взяты правила (не обязательно год расчёта)
  estatal: IrpfHalf;
  autonomica: IrpfHalf;
  condiciones: MinimoConditions;
  actividad: ActividadRules;
  reducciones: {
    actividad: ReduccionesActividad;
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

/** Правила ровно за year. */
export function loadIrpfRules(year: number): IrpfRules {
  const rules = RULES.find((r) => r.year === year);
  if (!rules) throw new Error(`no tax rules for ${year}`);
  return rules;
}

/**
 * Правила для расчёта года year: сам год или последний доступный до него. Будущие годы получают
 * замороженные правила последнего известного года (шкалы в Испании сами не индексируются).
 */
export function rulesForYear(year: number): IrpfRules {
  const past = RULES.filter((r) => r.year <= year);
  if (past.length === 0) throw new Error(`no tax rules for ${year} or earlier`);
  return past[past.length - 1];
}
