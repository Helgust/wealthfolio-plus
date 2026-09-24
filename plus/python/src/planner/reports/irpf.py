"""Отчёты по IRPF для UI: разбивка налога за год и кривые ставок. Без зависимостей от UI."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from planner.tax import (
    Familiar,
    IrpfAnual,
    IrpfRules,
    Mitades,
    Persona,
    cuota_integra,
    irpf_anual,
    load_irpf_rules,
    minimo_personal_familiar,
)


@dataclass(frozen=True, slots=True)
class Household:
    """Состав семьи для расчёта mínimo одного налогоплательщика."""

    contribuyente: Persona
    descendientes: tuple[Familiar, ...] = ()
    ascendientes: tuple[Familiar, ...] = ()

    def minimo(self, rules: IrpfRules) -> Mitades:
        return minimo_personal_familiar(
            self.contribuyente, rules, list(self.descendientes), list(self.ascendientes)
        )


@dataclass(frozen=True, slots=True)
class IrpfBreakdown:
    year: int
    base_general: float
    base_ahorro: float
    minimo: Mitades
    cuota: Mitades
    marginal_general: float  # estatal + autonómica, следующий евро общей базы
    marginal_ahorro: float

    @property
    def effective_rate(self) -> float:
        total_base = self.base_general + self.base_ahorro
        return self.cuota.total / total_base if total_base > 0 else 0.0

    def rows(self) -> list[dict]:
        """Строки таблицы «показатель / estatal / autonómica / итого»."""

        def row(name: str, m: Mitades) -> dict:
            return {
                "name": name,
                "estatal": m.estatal,
                "autonomica": m.autonomica,
                "total": m.total,
            }

        return [row("Mínimo personal y familiar", self.minimo), row("Cuota íntegra", self.cuota)]


def _marginal(rules: IrpfRules, base_general: float, base_ahorro: float) -> tuple[float, float]:
    g = rules.estatal.general.marginal_rate(base_general)
    g += rules.autonomica.general.marginal_rate(base_general)
    a = rules.estatal.ahorro.marginal_rate(base_ahorro)
    a += rules.autonomica.ahorro.marginal_rate(base_ahorro)
    return g, a


def irpf_breakdown(
    year: int, base_general: float, base_ahorro: float, household: Household
) -> IrpfBreakdown:
    rules = load_irpf_rules(year)
    minimo = household.minimo(rules)
    mg, ma = _marginal(rules, base_general, base_ahorro)
    return IrpfBreakdown(
        year=year,
        base_general=base_general,
        base_ahorro=base_ahorro,
        minimo=minimo,
        cuota=cuota_integra(base_general, base_ahorro, minimo, rules),
        marginal_general=mg,
        marginal_ahorro=ma,
    )


def general_rate_curve(year: int, household: Household, bases: np.ndarray) -> pd.DataFrame:
    """Эффективная и предельная ставка по общей базе (без базы сбережений)."""
    rules = load_irpf_rules(year)
    total = cuota_integra(bases, 0.0, household.minimo(rules), rules).total
    marginal = [_marginal(rules, b, 0.0)[0] for b in bases]
    return pd.DataFrame(
        {
            "base": bases,
            "effective": np.divide(total, bases, out=np.zeros_like(total), where=bases > 0),
            "marginal": marginal,
        }
    )


@dataclass(frozen=True, slots=True)
class IrpfAnualBreakdown:
    """Полный IRPF за год для экрана: цепочка баз и таблица по половинам."""

    year: int
    irpf: IrpfAnual
    marginal_general: float
    marginal_ahorro: float

    @property
    def cuota(self) -> Mitades:
        return self.irpf.cuota_liquida

    @property
    def effective_rate(self) -> float:
        """Cuota líquida от суммы bases imponibles (до reducciones по планам пенсий)."""
        r = self.irpf
        total = max(r.base_imponible_general, 0.0) + r.base_imponible_ahorro
        return self.cuota.total / total if total > 0 else 0.0

    def base_rows(self) -> list[dict]:
        """От rendimientos к bases liquidables; вычеты со знаком минус, нулевые строки скрыты."""
        r = self.irpf
        rows = [
            ("Rendimiento neto actividad", r.rendimiento_actividad, True),
            ("Reducción art. 32 LIRPF", -r.reduccion_actividad, False),
            ("Base imponible general", r.base_imponible_general, True),
            ("Reducción planes de pensiones", -r.reduccion_prevision_social, False),
            ("Bases negativas de años anteriores", -r.compensado_general_anteriores, False),
            ("Base liquidable general", r.base_liquidable_general, True),
            ("Base liquidable del ahorro", r.base_liquidable_ahorro, True),
        ]
        return [{"name": n, "amount": v} for n, v, always in rows if always or v != 0]

    def rows(self) -> list[dict]:
        """Строки «показатель / estatal / autonómica / итого»."""

        def row(name: str, m: Mitades) -> dict:
            return {
                "name": name,
                "estatal": m.estatal,
                "autonomica": m.autonomica,
                "total": m.total,
            }

        r = self.irpf
        return [
            row("Mínimo personal y familiar", r.minimo),
            row("Cuota íntegra", r.cuota_integra),
            row("Deducciones", r.deducciones),
            row("Cuota líquida", r.cuota_liquida),
        ]


def irpf_anual_breakdown(
    year: int,
    household: Household,
    *,
    rendimiento_actividad: float = 0.0,
    rcm: float = 0.0,
    ganancias: float = 0.0,
    aportacion_pensiones: float = 0.0,
    aportacion_pensiones_autonomo: float = 0.0,
    deducciones: Mitades | None = None,
    dependiente: bool = False,
    inicio_actividad: bool = False,
) -> IrpfAnualBreakdown:
    """Один год без переноса убытков из прошлых лет (это состояние носит движок)."""
    rules = load_irpf_rules(year)
    res = irpf_anual(
        rules,
        household.minimo(rules),
        rendimiento_actividad=rendimiento_actividad,
        rcm=rcm,
        ganancias=ganancias,
        aportacion_pensiones=aportacion_pensiones,
        aportacion_pensiones_autonomo=aportacion_pensiones_autonomo,
        deducciones=deducciones,
        dependiente=dependiente,
        discapacidad=household.contribuyente.discapacidad,
        inicio_actividad=inicio_actividad,
    )
    mg, ma = _marginal(rules, res.base_liquidable_general, res.base_liquidable_ahorro)
    return IrpfAnualBreakdown(year=year, irpf=res, marginal_general=mg, marginal_ahorro=ma)
