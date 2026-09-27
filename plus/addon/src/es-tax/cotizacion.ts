// Port of planner.tax.cotizacion: the employee's Seguridad Social cotizaciones, gastos deducibles of
// the rendimientos del trabajo (art. 19.2.a LIRPF).
import type { CotizacionRules } from './rules';

/**
 * Worker's share of the cotizaciones for a year on the salario bruto anual: the tipos on the salary
 * up to 12 × tope_maximo, plus the cotización adicional de solidaridad by tramos on the part above
 * it. The salary is taken as even across the months (pagas extra prorated).
 */
export function cotizacionTrabajador(salario: number, rules: CotizacionRules): number {
  const s = Math.max(salario, 0);
  const tope = 12 * rules.tope_maximo;
  const t = rules.tipos;
  const tipos = t.contingencias_comunes + t.mei + t.desempleo + t.formacion_profesional;
  let cuota = Math.min(s, tope) * tipos;
  let desde = tope;
  for (const tramo of rules.solidaridad) {
    const hasta = tramo.hasta === null ? Infinity : tramo.hasta * tope;
    cuota += Math.min(Math.max(s - desde, 0), hasta - desde) * tramo.tipo;
    desde = hasta;
  }
  return cuota;
}
