"""Расчёт IRPF: cuota íntegra по половинам и полный расчёт года (bases → cuota líquida)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from planner.tax.compensacion import (
    base_imponible_ahorro,
    compensar_base_liquidable_general,
    pendientes_vacios,
)
from planner.tax.minimos import Discapacidad, Mitades
from planner.tax.reducciones import (
    reduccion_actividad,
    reduccion_prevision_social,
    rendimiento_trabajo,
)
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
    gastos_trabajo: float  # otros gastos art. 19.2.f с trabajo_integro
    reduccion_trabajo: float  # art. 20 с trabajo_integro
    base_imponible_general: float
    base_imponible_ahorro: float
    compensado_ahorro_anteriores: float  # убытки прошлых лет, списанные в этом году
    reduccion_conjunta: float  # art. 84.2.3º: всего, с общей базы и базы сбережений
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
    trabajo_integro=0.0,
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
    """IRPF за год от rendimientos до cuota líquida (estatal + autonómica), tributación individual.

    rendimiento_actividad — rendimiento neto autónomo (`planner.tax.actividad`); при
    dependiente=True он должен быть посчитан без gastos de difícil justificación.
    rendimientos_trabajo — rendimientos netos reducidos del trabajo, уже после arts. 19–20
    (как в декларации).
    trabajo_integro — rendimientos íntegros del trabajo без взносов в Seguridad Social: выплаты
    планов пенсий, пенсии. Из них вычитаются otros gastos (19.2.f) и reducción art. 20; порог
    art. 20 считается только по ним, поэтому с rendimientos_trabajo их не смешивать.
    otras_rentas_general — прочее в общей базе (например, rendimiento inmobiliario).
    rcm, ganancias — saldos базы сбережений года (могут быть < 0).
    deducciones — сумма deducciones по половинам (estatal / autonómica), вводит пользователь.
    pendientes_* — перенос убытков с прошлых лет (`pendientes_vacios`); None — нет переноса.

    Не моделируется: reducción art. 32.1 (rentas irregulares), ganancias в общей базе,
    перенос неиспользованных aportaciones (art. 52.2), pensiones compensatorias (art. 55).
    """
    ps = rules.reducciones.prevision_social

    def prevision(rn_reducido, trabajo):
        return reduccion_prevision_social(
            aportacion_pensiones, aportacion_pensiones_autonomo, rn_reducido + trabajo, ps
        )

    return _irpf(
        rules,
        minimo,
        rendimiento_actividad=rendimiento_actividad,
        rendimientos_trabajo=rendimientos_trabajo,
        trabajo_integro=trabajo_integro,
        otras_rentas_general=otras_rentas_general,
        rcm=rcm,
        ganancias=ganancias,
        prevision=prevision,
        reduccion_conjunta=0.0,
        deducciones=deducciones,
        dependiente=dependiente,
        discapacidad=discapacidad,
        inicio_actividad=inicio_actividad,
        pendientes_general=pendientes_general,
        pendientes_ahorro=pendientes_ahorro,
    )


@dataclass(frozen=True, slots=True)
class RentasMiembro:
    """Rentas одного супруга для `irpf_conjunta`. Смысл полей — как в `irpf_anual`."""

    rendimiento_actividad: float = 0.0
    rendimientos_trabajo: float = 0.0
    trabajo_integro: float = 0.0
    otras_rentas_general: float = 0.0
    rcm: float = 0.0
    ganancias: float = 0.0
    aportacion_pensiones: float = 0.0
    aportacion_pensiones_autonomo: float = 0.0


def irpf_conjunta(
    rules: IrpfRules,
    minimo: Mitades,
    miembros: list[RentasMiembro],
    *,
    deducciones: Mitades | None = None,
    dependiente: bool = False,
    discapacidad: Discapacidad = Discapacidad.NINGUNA,
    inicio_actividad: bool = False,
    pendientes_general=None,
    pendientes_ahorro=None,
) -> IrpfAnual:
    """IRPF за год в tributación conjunta, unidad familiar biparental (arts. 82.1.1.ª, 84 LIRPF).

    Rentas супругов складываются (84.5); лимиты не умножаются на число членов (84.2), поэтому
    reducciones art. 32 считаются один раз по сумме rendimientos. Исключение — лимиты планов
    пенсий: они применяются к каждому участнику отдельно (84.2.1º). До reducciones arts. 51–54
    база уменьшается на reduccion_biparental (84.2.3º). minimo — из `minimo_conjunta`.
    dependiente, discapacidad, inicio_actividad — для reducción art. 32 всей unidad familiar.
    pendientes_* — общий перенос убытков unidad familiar (84.3).
    trabajo_integro — один otros gastos 19.2.f и одна reducción art. 20 на сумму unidad familiar
    (84.2; Manual práctico 2025, cap. 3: «se aplican por unidad familiar», reducción — «en
    función de la cuantía conjunta» без умножения на число членов).
    """
    ps = rules.reducciones.prevision_social

    def total(campo: str):
        return sum(np.asarray(getattr(m, campo), dtype=float) for m in miembros)

    def prevision(_rn_reducido, _trabajo):
        # TODO: verify — 30 % (art. 52.1.a) считаем от собственных rendimientos каждого
        # супруга без reducciones arts. 20 и 32: в conjunta они одни на всю unidad familiar.
        return sum(
            reduccion_prevision_social(
                m.aportacion_pensiones,
                m.aportacion_pensiones_autonomo,
                np.asarray(m.rendimiento_actividad, dtype=float)
                + m.rendimientos_trabajo
                + m.trabajo_integro,
                ps,
            )
            for m in miembros
        )

    return _irpf(
        rules,
        minimo,
        rendimiento_actividad=total("rendimiento_actividad"),
        rendimientos_trabajo=total("rendimientos_trabajo"),
        trabajo_integro=total("trabajo_integro"),
        otras_rentas_general=total("otras_rentas_general"),
        rcm=total("rcm"),
        ganancias=total("ganancias"),
        prevision=prevision,
        reduccion_conjunta=rules.reducciones.tributacion_conjunta.reduccion_biparental,
        deducciones=deducciones,
        dependiente=dependiente,
        discapacidad=discapacidad,
        inicio_actividad=inicio_actividad,
        pendientes_general=pendientes_general,
        pendientes_ahorro=pendientes_ahorro,
    )


def _irpf(
    rules: IrpfRules,
    minimo: Mitades,
    *,
    rendimiento_actividad,
    rendimientos_trabajo,
    trabajo_integro,
    otras_rentas_general,
    rcm,
    ganancias,
    prevision: Callable,
    reduccion_conjunta: float,
    deducciones: Mitades | None,
    dependiente: bool,
    discapacidad: Discapacidad,
    inicio_actividad: bool,
    pendientes_general,
    pendientes_ahorro,
) -> IrpfAnual:
    """Общий расчёт individual и conjunta. prevision(rn_reducido, trabajo) — reducción por
    planes de pensiones до ограничения базой; reduccion_conjunta — art. 84.2.3º (0 в individual)."""
    r = rules.reducciones
    if pendientes_general is None:
        pendientes_general = pendientes_vacios(r.compensacion, ahorro=False)
    if pendientes_ahorro is None:
        pendientes_ahorro = pendientes_vacios(r.compensacion)
    if deducciones is None:
        deducciones = Mitades(estatal=0.0, autonomica=0.0)

    rn = np.asarray(rendimiento_actividad, dtype=float)
    # Порог art. 20 — алгебраическая сумма прочих rentas, actividades без reducciones art. 32
    # (Manual práctico 2025, cap. 3, fase 3).
    gastos_trab, red_trab, trabajo_reducido = rendimiento_trabajo(
        trabajo_integro, rn + otras_rentas_general + rcm + ganancias, r.trabajo
    )
    trabajo = np.asarray(rendimientos_trabajo, dtype=float) + trabajo_reducido
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

    # Art. 84.2.3º: сначала общая база (не ниже 0), остаток — база сбережений (не ниже 0).
    conj_general = np.minimum(reduccion_conjunta, np.maximum(big, 0.0))
    conj_ahorro = np.minimum(reduccion_conjunta - conj_general, ahorro.base_imponible)
    big_reducida = big - conj_general

    # Art. 50.1: reducciones не могут сделать базу отрицательной.
    # TODO: verify — 30 % (art. 52.1.a) от trabajo после reducción art. 20, как у actividad.
    red_ps = np.minimum(prevision(rn_reducido, trabajo), np.maximum(big_reducida, 0.0))
    general = compensar_base_liquidable_general(
        big_reducida - red_ps, pendientes_general, r.compensacion
    )

    blg = general.base_liquidable
    bla = _out(ahorro.base_imponible - conj_ahorro)
    ci = cuota_integra(blg, bla, minimo, rules)
    # Cuota líquida каждой половины не может быть отрицательной.
    cl = Mitades(
        estatal=_out(np.maximum(ci.estatal - deducciones.estatal, 0.0)),
        autonomica=_out(np.maximum(ci.autonomica - deducciones.autonomica, 0.0)),
    )
    return IrpfAnual(
        rendimiento_actividad=_out(rn),
        reduccion_actividad=red_act,
        gastos_trabajo=gastos_trab,
        reduccion_trabajo=red_trab,
        base_imponible_general=_out(big),
        base_imponible_ahorro=ahorro.base_imponible,
        compensado_ahorro_anteriores=ahorro.compensado_anteriores,
        reduccion_conjunta=_out(conj_general + conj_ahorro),
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
