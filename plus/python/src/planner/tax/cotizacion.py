"""Employee's Seguridad Social cotizaciones (rules/<year>/cotizacion.yaml): gastos deducibles of the
rendimientos del trabajo (art. 19.2.a LIRPF).

Arguments are numbers or numpy arrays of the same shape (trajectories).
"""

from __future__ import annotations

import numpy as np

from planner.tax.rules import CotizacionRules


def cotizacion_trabajador(salario, rules: CotizacionRules):
    """Worker's share of the cotizaciones for a year on the salario bruto anual.

    The tipos apply to the salary up to 12 × tope_maximo; the cotización adicional de solidaridad
    applies by tramos to the part above it. The salary is taken as even across the months (pagas
    extra prorated), as the monthly base de cotización is.
    """
    s = np.maximum(np.asarray(salario, dtype=float), 0.0)
    tope = 12 * rules.tope_maximo
    cuota = np.minimum(s, tope) * rules.tipos.total
    desde = tope
    for t in rules.solidaridad:
        hasta = np.inf if t.hasta is None else t.hasta * tope
        cuota = cuota + np.clip(s - desde, 0.0, hasta - desde) * t.tipo
        desde = hasta
    return float(cuota) if np.ndim(cuota) == 0 else cuota
