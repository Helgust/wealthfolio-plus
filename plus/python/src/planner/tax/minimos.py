"""Mínimo personal y familiar (arts. 56–61 LIRPF) by household composition."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from planner.tax.rules import DiscapacidadAmounts, IrpfRules, MinimoAmounts, MinimoConditions


class Discapacidad(StrEnum):
    NINGUNA = "ninguna"
    GRADO_33 = "grado_33"  # 33 % ≤ grado < 65 %
    GRADO_65 = "grado_65"  # grado ≥ 65 %


class Persona(BaseModel):
    """Age on 31 December of the tax year (devengo date, art. 61 LIRPF)."""

    model_config = ConfigDict(frozen=True)

    edad: int = Field(ge=0)
    discapacidad: Discapacidad = Discapacidad.NINGUNA
    asistencia: bool = False  # needs third-party assistance / reduced mobility


class Familiar(Persona):
    """Descendiente or ascendiente living with the taxpayer."""

    renta_anual: float = 0.0  # dependant's income excluding exentas; above the limit, no right
    # Share attributable to this taxpayer: with several eligible taxpayers
    # (e.g. both parents file separately) the mínimo is split equally (art. 61).
    share: float = Field(default=1.0, gt=0, le=1)


@dataclass(frozen=True, slots=True)
class Mitades:
    """An amount computed separately for the state and regional halves of IRPF."""

    estatal: float
    autonomica: float

    @property
    def total(self) -> float:
        return self.estatal + self.autonomica


def _discapacidad(p: Persona, a: DiscapacidadAmounts) -> float:
    if p.discapacidad == Discapacidad.NINGUNA:
        return 0.0
    grado_65 = p.discapacidad == Discapacidad.GRADO_65
    base = a.grado_65 if grado_65 else a.grado_33
    # Increment for gastos de asistencia: third-party help, mobility or grado ≥ 65 % (art. 60).
    return base + (a.asistencia if p.asistencia or grado_65 else 0.0)


def _incrementos_contribuyente(p: Persona, a: MinimoAmounts, c: MinimoConditions) -> float:
    """Increments to the mínimo del contribuyente for age (art. 57.2) and discapacidad
    (art. 60.1)."""
    total = _discapacidad(p, a.discapacidad)
    if p.edad >= c.edad_mayor_65:
        total += a.contribuyente.mayor_65
    if p.edad >= c.edad_mayor_75:
        total += a.contribuyente.mayor_75
    return total


def _minimo_mitad(
    contribuyentes: list[Persona],
    descendientes: list[Familiar],
    ascendientes: list[Familiar],
    a: MinimoAmounts,
    c: MinimoConditions,
) -> float:
    # The general amount is one per return, in conjunta too; increments per spouse (art. 84.2.2º).
    total = a.contribuyente.general
    total += sum(_incrementos_contribuyente(p, a, c) for p in contribuyentes)

    # Descendientes: under 25 or with discapacidad; income within the limit. Ordered by age
    # (the oldest is the "first"); the amount depends on the child's number (art. 58.1).
    eligible = sorted(
        (
            d
            for d in descendientes
            if (d.edad < c.descendiente_edad_max or d.discapacidad != Discapacidad.NINGUNA)
            and d.renta_anual <= c.renta_max_familiar
        ),
        key=lambda d: d.edad,
        reverse=True,
    )
    por_orden = a.descendientes.por_orden
    for i, d in enumerate(eligible):
        amount = por_orden[min(i, len(por_orden) - 1)]
        if d.edad < c.descendiente_menor:
            amount += a.descendientes.menor_3
        total += (amount + _discapacidad(d, a.discapacidad)) * d.share

    # Ascendientes: over 65 or with discapacidad; income within the limit (art. 59).
    for p in ascendientes:
        if p.renta_anual > c.renta_max_familiar:
            continue
        if p.edad < c.edad_mayor_65 and p.discapacidad == Discapacidad.NINGUNA:
            continue
        amount = a.ascendientes.general
        if p.edad >= c.edad_mayor_75:
            amount += a.ascendientes.mayor_75
        total += (amount + _discapacidad(p, a.discapacidad)) * p.share

    return total


def minimo_personal_familiar(
    contribuyente: Persona,
    rules: IrpfRules,
    descendientes: list[Familiar] | None = None,
    ascendientes: list[Familiar] | None = None,
) -> Mitades:
    """Mínimo personal y familiar separately for the state and regional halves.

    "Lives together" and other non-monetary conditions are checked by the caller: pass only
    relatives for whom the taxpayer can claim the mínimo at all.
    """
    return _minimo([contribuyente], rules, descendientes, ascendientes)


def minimo_conjunta(
    conyuges: list[Persona],
    rules: IrpfRules,
    descendientes: list[Familiar] | None = None,
    ascendientes: list[Familiar] | None = None,
) -> Mitades:
    """Mínimo personal y familiar in tributación conjunta (art. 84.2.2º LIRPF).

    The mínimo del contribuyente (art. 57.1) is one per unidad familiar; age and discapacidad
    increments follow each spouse's circumstances. Children are passed as descendientes
    (share=1: the whole amount in one return); no mínimo del contribuyente is due for them.
    """
    return _minimo(conyuges, rules, descendientes, ascendientes)


def _minimo(
    contribuyentes: list[Persona],
    rules: IrpfRules,
    descendientes: list[Familiar] | None,
    ascendientes: list[Familiar] | None,
) -> Mitades:
    desc, asc = descendientes or [], ascendientes or []
    c = rules.condiciones
    return Mitades(
        estatal=_minimo_mitad(contribuyentes, desc, asc, rules.estatal.minimos, c),
        autonomica=_minimo_mitad(contribuyentes, desc, asc, rules.autonomica.minimos, c),
    )
