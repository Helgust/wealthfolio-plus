"""Mínimo personal y familiar (arts. 56–61 LIRPF) по составу домохозяйства."""

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
    """Возраст — на 31 декабря года расчёта (дата devengo, art. 61 LIRPF)."""

    model_config = ConfigDict(frozen=True)

    edad: int = Field(ge=0)
    discapacidad: Discapacidad = Discapacidad.NINGUNA
    asistencia: bool = False  # нужна помощь третьих лиц / ограниченная мобильность


class Familiar(Persona):
    """Descendiente или ascendiente, живущий с налогоплательщиком."""

    renta_anual: float = 0.0  # доходы иждивенца без exentas; выше лимита — права нет
    # Доля, приходящаяся на этого налогоплательщика: при нескольких правообладателях
    # (например, оба родителя декларируют по отдельности) mínimo делится поровну (art. 61).
    share: float = Field(default=1.0, gt=0, le=1)


@dataclass(frozen=True, slots=True)
class Mitades:
    """Величина, считаемая отдельно для государственной и автономной половины IRPF."""

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
    # Прибавка за gastos de asistencia: помощь третьих лиц, мобильность или grado ≥ 65 % (art. 60).
    return base + (a.asistencia if p.asistencia or grado_65 else 0.0)


def _incrementos_contribuyente(p: Persona, a: MinimoAmounts, c: MinimoConditions) -> float:
    """Прибавки к mínimo del contribuyente за возраст (art. 57.2) и discapacidad (art. 60.1)."""
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
    # Общая сумма — одна на декларацию и в conjunta; прибавки — по каждому супругу (art. 84.2.2º).
    total = a.contribuyente.general
    total += sum(_incrementos_contribuyente(p, a, c) for p in contribuyentes)

    # Descendientes: младше 25 или с discapacidad; доходы не выше лимита. Порядок — по возрасту
    # (старший — «первый»), сумма зависит от номера ребёнка (art. 58.1).
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

    # Ascendientes: старше 65 или с discapacidad; доходы не выше лимита (art. 59).
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
    """Mínimo personal y familiar отдельно для государственной и автономной половины.

    Условия «живёт вместе» и прочие неденежные проверяет вызывающий: сюда передаются
    только те родственники, по которым налогоплательщик вообще может претендовать на mínimo.
    """
    return _minimo([contribuyente], rules, descendientes, ascendientes)


def minimo_conjunta(
    conyuges: list[Persona],
    rules: IrpfRules,
    descendientes: list[Familiar] | None = None,
    ascendientes: list[Familiar] | None = None,
) -> Mitades:
    """Mínimo personal y familiar в tributación conjunta (art. 84.2.2º LIRPF).

    Mínimo del contribuyente (art. 57.1) — один на unidad familiar; прибавки за возраст
    и discapacidad — по обстоятельствам каждого супруга. Дети передаются как descendientes
    (share=1: вся сумма в одной декларации), mínimo del contribuyente на них не положен.
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
