"""IRPF calculation: cuota íntegra by half and the full year (bases → cuota líquida)."""

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
    """Cuota íntegra of one IRPF half (state or regional).

    The mínimo personal y familiar is NOT subtracted from the base. It is allocated to the
    general base first, the rest to the savings base (art. 56.2 LIRPF). Then the scale is
    applied to the base and separately to the mínimo part, and the second is subtracted
    from the first (arts. 63, 66 LIRPF). Call separately for each half: they have
    different scales and different mínimos.

    Arguments are numbers or numpy arrays of the same shape (Monte Carlo trajectories).
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
    """Cuota íntegra estatal and autonómica. Bases are liquidables (after reducciones)."""
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
    """Full IRPF calculation for a year. Fields are numbers or arrays (trajectories)."""

    rendimiento_actividad: float  # rendimiento neto before art. 32 reducciones
    reduccion_actividad: float
    gastos_trabajo: float  # otros gastos art. 19.2.f on trabajo_integro
    reduccion_trabajo: float  # art. 20 on trabajo_integro
    base_imponible_general: float
    base_imponible_ahorro: float
    compensado_ahorro_anteriores: float  # prior-year losses used this year
    reduccion_conjunta: float  # art. 84.2.3º: total, from the general and savings bases
    reduccion_prevision_social: float
    compensado_general_anteriores: float  # prior-year negative bases liquidables
    base_liquidable_general: float
    base_liquidable_ahorro: float
    minimo: Mitades
    cuota_integra: Mitades
    deducciones: Mitades
    cuota_liquida: Mitades
    pendientes_general: np.ndarray  # carry-forward state for the next year
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
    """IRPF for a year from rendimientos to cuota líquida (estatal + autonómica), individual.

    rendimiento_actividad — autónomo rendimiento neto (`planner.tax.actividad`); with
    dependiente=True it must be computed without gastos de difícil justificación.
    rendimientos_trabajo — rendimientos netos reducidos del trabajo, already after arts. 19–20
    (as in the tax return).
    trabajo_integro — rendimientos íntegros del trabajo without Seguridad Social contributions:
    pension plan payouts, pensions. Otros gastos (19.2.f) and reducción art. 20 are subtracted;
    the art. 20 threshold uses only them, so do not mix with rendimientos_trabajo.
    otras_rentas_general — anything else in the general base (e.g. rendimiento inmobiliario).
    rcm, ganancias — savings base saldos for the year (may be < 0).
    deducciones — deducciones summed by half (estatal / autonómica), entered by the user.
    pendientes_* — loss carry-forward from prior years (`pendientes_vacios`); None — none.

    Not modelled: reducción art. 32.1 (rentas irregulares), ganancias in the general base,
    carry-forward of unused aportaciones (art. 52.2), pensiones compensatorias (art. 55).
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
    """Rentas of one spouse for `irpf_conjunta`. Fields mean the same as in `irpf_anual`."""

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
    """IRPF for a year in tributación conjunta, unidad familiar biparental (arts. 82.1.1.ª, 84).

    Spouses' rentas are added up (84.5); limits are not multiplied by the number of members
    (84.2), so art. 32 reducciones are computed once on the sum of rendimientos. The exception
    is pension plan limits: they apply to each member separately (84.2.1º). Before the
    arts. 51–54 reducciones the base is reduced by reduccion_biparental (84.2.3º).
    minimo — from `minimo_conjunta`.
    dependiente, discapacidad, inicio_actividad — for the art. 32 reducción of the whole unit.
    pendientes_* — shared loss carry-forward of the unidad familiar (84.3).
    trabajo_integro — one otros gastos 19.2.f and one reducción art. 20 on the unit's total
    (84.2; Manual práctico 2025, cap. 3: «se aplican por unidad familiar», reducción «en
    función de la cuantía conjunta» without multiplying by the number of members).
    """
    ps = rules.reducciones.prevision_social

    def total(campo: str):
        return sum(np.asarray(getattr(m, campo), dtype=float) for m in miembros)

    def prevision(_rn_reducido, _trabajo):
        # TODO: verify — 30 % (art. 52.1.a) of each spouse's own rendimientos without the
        # arts. 20 and 32 reducciones: in conjunta they apply once per unidad familiar.
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
    """Shared individual and conjunta calculation. prevision(rn_reducido, trabajo) — reducción
    por planes de pensiones before the base cap; reduccion_conjunta — art. 84.2.3º (0 in
    individual)."""
    r = rules.reducciones
    if pendientes_general is None:
        pendientes_general = pendientes_vacios(r.compensacion, ahorro=False)
    if pendientes_ahorro is None:
        pendientes_ahorro = pendientes_vacios(r.compensacion)
    if deducciones is None:
        deducciones = Mitades(estatal=0.0, autonomica=0.0)

    rn = np.asarray(rendimiento_actividad, dtype=float)
    # Art. 20 threshold — algebraic sum of other rentas, actividades before art. 32 reducciones
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

    # Art. 48.a: rendimientos of the general base offset each other without limit.
    big = rn_reducido + trabajo + otras_rentas_general
    ahorro = base_imponible_ahorro(rcm, ganancias, pendientes_ahorro, r.compensacion)

    # Art. 84.2.3º: general base first (not below 0), the rest from the savings base (not below 0).
    conj_general = np.minimum(reduccion_conjunta, np.maximum(big, 0.0))
    conj_ahorro = np.minimum(reduccion_conjunta - conj_general, ahorro.base_imponible)
    big_reducida = big - conj_general

    # Art. 50.1: reducciones cannot make the base negative.
    # TODO: verify — 30 % (art. 52.1.a) of trabajo after the art. 20 reducción, as for actividad.
    red_ps = np.minimum(prevision(rn_reducido, trabajo), np.maximum(big_reducida, 0.0))
    general = compensar_base_liquidable_general(
        big_reducida - red_ps, pendientes_general, r.compensacion
    )

    blg = general.base_liquidable
    bla = _out(ahorro.base_imponible - conj_ahorro)
    ci = cuota_integra(blg, bla, minimo, rules)
    # The cuota líquida of each half cannot be negative.
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
