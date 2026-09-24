"""Reducciones общей базы: по rendimientos de actividades (art. 32) и планам пенсий (arts. 51–52).

Аргументы — числа или numpy-массивы одинаковой формы (траектории).
"""

from __future__ import annotations

import numpy as np

from planner.tax.minimos import Discapacidad
from planner.tax.rules import PrevisionSocial, ReduccionesActividad


def _out(x):
    return float(x) if np.ndim(x) == 0 else x


def _tramo_decreciente(x, plano_hasta: float, importe: float, pendiente: float):
    """importe до plano_hasta, затем линейно убывает до 0."""
    return np.clip(importe - pendiente * np.maximum(x - plano_hasta, 0.0), 0.0, importe)


def reduccion_actividad(
    rendimiento_neto,
    rules: ReduccionesActividad,
    *,
    otras_rentas=0.0,
    dependiente: bool = False,
    discapacidad: Discapacidad = Discapacidad.NINGUNA,
    inicio_actividad: bool = False,
):
    """Сумма reducciones art. 32.2 и 32.3 LIRPF к rendimiento neto de actividades.

    otras_rentas — rentas no exentas помимо деятельности (для порогов 6 500 и 12 000 €).
    dependiente — выполнены все требования 32.2.2º (тогда rendimiento должен быть посчитан
    без gastos de difícil justificación). inicio_actividad — первый год с положительным
    rendimiento или следующий за ним (32.3).
    Результат не больше положительного rendimiento: reducción не делает его отрицательным.
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
        # TODO: verify — суммируется ли 32.2.1º.b с .a (читаем «adicionalmente» как да).
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

    aportacion — в обычные планы (индивидуальные и т. п.), лимит limite_general.
    aportacion_autonomo — в planes de empleo simplificados / sectoriales для autónomos:
    сначала заполняют свой incremento, остаток помещается в общий лимит.
    Итог не больше porcentaje_rendimientos от rendimientos netos trabajo + actividades.
    Остаток сверх лимитов пропадает (перенос art. 52.2 на 5 лет пока не моделируется).
    """
    general = np.asarray(aportacion, dtype=float)
    autonomo = np.asarray(aportacion_autonomo, dtype=float)
    en_incremento = np.minimum(autonomo, rules.incremento_autonomo)
    en_general = np.minimum(general + autonomo - en_incremento, rules.limite_general)
    tope = rules.porcentaje_rendimientos * np.maximum(rendimientos_trabajo_actividad, 0.0)
    return _out(np.minimum(en_incremento + en_general, tope))
