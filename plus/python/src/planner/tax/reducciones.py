"""General base reducciones: rendimientos del trabajo (arts. 19.2.f, 20), actividades (art. 32),
pension plans (arts. 51–52).

Arguments are numbers or numpy arrays of the same shape (trajectories).
"""

from __future__ import annotations

import numpy as np

from planner.tax.minimos import Discapacidad
from planner.tax.rules import PrevisionSocial, ReduccionesActividad, Trabajo


def _out(x):
    return float(x) if np.ndim(x) == 0 else x


def _tramo_decreciente(x, plano_hasta: float, importe: float, pendiente: float):
    """importe up to plano_hasta, then decreases linearly to 0."""
    return np.clip(importe - pendiente * np.maximum(x - plano_hasta, 0.0), 0.0, importe)


def rendimiento_trabajo(integro, otras_rentas, rules: Trabajo):
    """Rendimiento neto reducido del trabajo without Seguridad Social contributions (pension
    plan payouts, pensions): íntegro − otros gastos (art. 19.2.f) − reducción (art. 20).

    otras_rentas — algebraic sum of other rentas no exentas (for the art. 20 threshold).
    Returns (otros_gastos, reduccion, neto_reducido). Gastos 19.2.a–e are zero for this income,
    so the rendimiento for the art. 20 thresholds equals the íntegro.
    """
    integro = np.asarray(integro, dtype=float)
    otras = np.asarray(otras_rentas, dtype=float)
    positivo = np.maximum(integro, 0.0)
    gastos = np.minimum(rules.otros_gastos, positivo)
    r = rules.reduccion
    red = np.where(
        integro <= r.plano_hasta,
        r.importe,
        np.where(
            integro <= r.quiebra,
            r.importe - r.pendiente * (integro - r.plano_hasta),
            r.importe_quiebra - r.pendiente_quiebra * (integro - r.quiebra),
        ),
    )
    red = np.where((integro < r.rend_max) & (otras <= r.otras_rentas_max), red, 0.0)
    # Art. 20: the saldo after the reducción cannot be negative.
    red = np.clip(red, 0.0, positivo - gastos)
    return _out(gastos), _out(red), _out(integro - gastos - red)


def reduccion_actividad(
    rendimiento_neto,
    rules: ReduccionesActividad,
    *,
    otras_rentas=0.0,
    dependiente: bool = False,
    discapacidad: Discapacidad = Discapacidad.NINGUNA,
    inicio_actividad: bool = False,
):
    """Sum of the art. 32.2 and 32.3 LIRPF reducciones on rendimiento neto de actividades.

    otras_rentas — rentas no exentas besides the activity (for the 6,500 and 12,000 € thresholds).
    dependiente — all 32.2.2º requirements are met (then the rendimiento must be computed
    without gastos de difícil justificación). inicio_actividad — first year with a positive
    rendimiento or the one after it (32.3).
    The result is not above the positive rendimiento: the reducción cannot make it negative.
    """
    rn = np.asarray(rendimiento_neto, dtype=float)
    otras = np.asarray(otras_rentas, dtype=float)
    positivo = np.maximum(rn, 0.0)

    if dependiente:
        d = rules.dependiente
        a = d.adicional
        red = d.general + np.where(
            (rn < a.rend_max) & (otras <= a.otras_rentas_max),
            _tramo_decreciente(rn, a.plano_hasta, a.importe, a.pendiente),
            0.0,
        )
        # TODO: verify — whether 32.2.1º.b adds to .a (we read «adicionalmente» as yes).
        if discapacidad == Discapacidad.GRADO_65:
            red = red + d.discapacidad_65
        elif discapacidad == Discapacidad.GRADO_33:
            red = red + d.discapacidad_33
    else:
        b = rules.rentas_bajas
        rentas = rn + otras  # «incluidas las de la propia actividad»
        red = np.where(
            rentas < b.rentas_max,
            _tramo_decreciente(rentas, b.plano_hasta, b.importe, b.pendiente),
            0.0,
        )
    red = np.minimum(red, positivo)  # 32.2.4º

    if inicio_actividad:
        i = rules.inicio_actividad
        red = red + i.rate * np.minimum(positivo - red, i.base_max)
    return _out(red)


def reduccion_prevision_social(
    aportacion, aportacion_autonomo, rendimientos_trabajo_actividad, rules: PrevisionSocial
):
    """Reducción por aportaciones a planes de pensiones (arts. 51.6, 52.1 LIRPF).

    aportacion — to regular plans (individual etc.), limit limite_general.
    aportacion_autonomo — to planes de empleo simplificados / sectoriales for autónomos:
    fills its own incremento first, the rest goes to the general limit.
    The total is not above porcentaje_rendimientos of rendimientos netos trabajo + actividades.
    Anything above the limits is lost (the 5-year carry-forward of art. 52.2 is not modelled yet).
    """
    general = np.asarray(aportacion, dtype=float)
    autonomo = np.asarray(aportacion_autonomo, dtype=float)
    en_incremento = np.minimum(autonomo, rules.incremento_autonomo)
    en_general = np.minimum(general + autonomo - en_incremento, rules.limite_general)
    tope = rules.porcentaje_rendimientos * np.maximum(rendimientos_trabajo_actividad, 0.0)
    return _out(np.minimum(en_incremento + en_general, tope))
