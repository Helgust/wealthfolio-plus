"""Расчёт IRPF: cuota íntegra по половинам и полный расчёт года (bases → cuota líquida)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from planner.tax.compensacion import (
    base_imponible_ahorro,
    compensar_base_liquidable_general,
    pendientes_vacios,
)
from planner.tax.minimos import Discapacidad, Mitades
from planner.tax.reducciones import reduccion_actividad, reduccion_prevision_social
from planner.tax.rules import IrpfRules
from planner.tax.scale import Scale


def cuota_integra_mitad(
    base_general,
    base_ahorro,
    minimo,
    scale_general: Scale,
    scale_ahorro: Scale,
):
    """Cuota íntegra одной половины IRPF (государственной или автономной).

    Mínimo personal y familiar НЕ вычитается из базы. Он сначала относится
    к общей базе, остаток — к базе сбережений (art. 56.2 LIRPF). Затем шкала
    применяется к базе и отдельно к части mínimo, и второе вычитается
    из первого (arts. 63, 66 LIRPF). Вызывать отдельно для каждой половины:
    у них разные шкалы и разные mínimos.

    Аргументы — числа или numpy-массивы одинаковой формы (траектории Monte Carlo).
    """
    minimo_general = np.minimum(minimo, base_general)
    minimo_ahorro = np.minimum(minimo - minimo_general, base_ahorro)

    cuota_general = scale_general.apply(base_general) - scale_general.apply(minimo_general)
    cuota_ahorro = scale_ahorro.apply(base_ahorro) - scale_ahorro.apply(minimo_ahorro)
    result = cuota_general + cuota_ahorro
    return float(result) if np.ndim(result) == 0 else result


def cuota_integra(
    base_general: float,
    base_ahorro: float,
    minimo: Mitades,
    rules: IrpfRules,
) -> Mitades:
    """Cuota íntegra estatal и autonómica. Bases — liquidables (после reducciones)."""
    return Mitades(
        estatal=cuota_integra_mitad(
            base_general, base_ahorro, minimo.estatal, rules.estatal.general, rules.estatal.ahorro
        ),
        autonomica=cuota_integra_mitad(
            base_general,
            base_ahorro,
            minimo.autonomica,
            rules.autonomica.general,
            rules.autonomica.ahorro,
        ),
    )


@dataclass(frozen=True, slots=True)
class IrpfAnual:
    """Полный расчёт IRPF за год. Поля — числа или массивы (траектории)."""

    rendimiento_actividad: float  # rendimiento neto до reducciones art. 32
    reduccion_actividad: float
    base_imponible_general: float
    base_imponible_ahorro: float
    compensado_ahorro_anteriores: float  # убытки прошлых лет, списанные в этом году
    reduccion_prevision_social: float
    compensado_general_anteriores: float  # отрицательные bases liquidables прошлых лет
    base_liquidable_general: float
    base_liquidable_ahorro: float
    minimo: Mitades
    cuota_integra: Mitades
    deducciones: Mitades
    cuota_liquida: Mitades
    pendientes_general: np.ndarray  # состояние переноса на следующий год
    pendientes_ahorro: np.ndarray


def irpf_anual(
    rules: IrpfRules,
    minimo: Mitades,
    *,
    rendimiento_actividad=0.0,
    rendimientos_trabajo=0.0,
    otras_rentas_general=0.0,
    rcm=0.0,
    ganancias=0.0,
    aportacion_pensiones=0.0,
    aportacion_pensiones_autonomo=0.0,
    deducciones: Mitades | None = None,
    dependiente: bool = False,
    discapacidad: Discapacidad = Discapacidad.NINGUNA,
    inicio_actividad: bool = False,
    pendientes_general=None,
    pendientes_ahorro=None,
) -> IrpfAnual:
    """IRPF за год от rendimientos до cuota líquida (estatal + autonómica).

    rendimiento_actividad — rendimiento neto autónomo (`planner.tax.actividad`); при
    dependiente=True он должен быть посчитан без gastos de difícil justificación.
    rendimientos_trabajo — rendimientos netos del trabajo (в т. ч. выплаты из plan de pensiones).
    otras_rentas_general — прочее в общей базе (например, rendimiento inmobiliario).
    rcm, ganancias — saldos базы сбережений года (могут быть < 0).
    deducciones — сумма deducciones по половинам (estatal / autonómica), вводит пользователь.
    pendientes_* — перенос убытков с прошлых лет (`pendientes_vacios`); None — нет переноса.

    Не моделируется: reducción art. 32.1 (rentas irregulares), ganancias в общей базе,
    перенос неиспользованных aportaciones (art. 52.2), pensiones compensatorias (art. 55).
    """
    r = rules.reducciones
    if pendientes_general is None:
        pendientes_general = pendientes_vacios(r.compensacion, ahorro=False)
    if pendientes_ahorro is None:
        pendientes_ahorro = pendientes_vacios(r.compensacion)
    if deducciones is None:
        deducciones = Mitades(estatal=0.0, autonomica=0.0)

    rn = np.asarray(rendimiento_actividad, dtype=float)
    trabajo = np.asarray(rendimientos_trabajo, dtype=float)
    otras_rentas = (
        np.maximum(trabajo, 0.0)
        + np.maximum(otras_rentas_general, 0.0)
        + np.maximum(rcm, 0.0)
        + np.maximum(ganancias, 0.0)
    )
    red_act = reduccion_actividad(
        rn,
        r.actividad,
        otras_rentas=otras_rentas,
        dependiente=dependiente,
        discapacidad=discapacidad,
        inicio_actividad=inicio_actividad,
    )
    rn_reducido = rn - red_act

    # Art. 48.a: rendimientos общей базы компенсируются между собой без ограничений.
    big = rn_reducido + trabajo + otras_rentas_general
    ahorro = base_imponible_ahorro(rcm, ganancias, pendientes_ahorro, r.compensacion)

    # Art. 50.1: reducciones не могут сделать базу отрицательной.
    red_ps = reduccion_prevision_social(
        aportacion_pensiones,
        aportacion_pensiones_autonomo,
        rn_reducido + trabajo,
        r.prevision_social,
    )
    red_ps = np.minimum(red_ps, np.maximum(big, 0.0))
    general = compensar_base_liquidable_general(big - red_ps, pendientes_general, r.compensacion)

    blg, bla = general.base_liquidable, ahorro.base_imponible
    ci = cuota_integra(blg, bla, minimo, rules)
    # Cuota líquida каждой половины не может быть отрицательной.
    cl = Mitades(
        estatal=_out(np.maximum(ci.estatal - deducciones.estatal, 0.0)),
        autonomica=_out(np.maximum(ci.autonomica - deducciones.autonomica, 0.0)),
    )
    return IrpfAnual(
        rendimiento_actividad=_out(rn),
        reduccion_actividad=red_act,
        base_imponible_general=_out(big),
        base_imponible_ahorro=bla,
        compensado_ahorro_anteriores=ahorro.compensado_anteriores,
        reduccion_prevision_social=_out(red_ps),
        compensado_general_anteriores=general.compensado_anteriores,
        base_liquidable_general=blg,
        base_liquidable_ahorro=bla,
        minimo=minimo,
        cuota_integra=ci,
        deducciones=deducciones,
        cuota_liquida=cl,
        pendientes_general=general.pendientes,
        pendientes_ahorro=ahorro.pendientes,
    )


def _out(x):
    return float(x) if np.ndim(x) == 0 else x
