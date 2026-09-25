"""Autónomo activity report for the UI: from revenue to rendimiento neto and RETA."""

from __future__ import annotations

from dataclasses import dataclass

from planner.tax import Actividad, actividad, load_irpf_rules


@dataclass(frozen=True, slots=True)
class ActividadBreakdown:
    year: int
    actividad: Actividad
    reta_tramo_label: str  # «general 7»
    reta_rendimiento_mensual: float  # rendimiento computable / 12 — the tramo is chosen by it

    def rows(self) -> list[dict]:
        """The "revenue → rendimiento neto" chain for a table; expenses with a minus sign."""
        a = self.actividad
        return [
            {"name": "Ingresos (facturación sin IVA)", "amount": a.ingresos},
            {"name": "Gastos deducibles", "amount": -a.gastos},
            {"name": "Cuota RETA", "amount": -a.cuota_reta},
            {
                "name": "Provisiones y gastos de difícil justificación",
                "amount": -a.gastos_dificil_justificacion,
            },
            {"name": "Rendimiento neto (to the IRPF general base)", "amount": a.rendimiento_neto},
        ]


def actividad_breakdown(
    year: int,
    ingresos: float,
    gastos: float,
    base_elegida: float | None = None,
    gastos_dificil: bool = True,
) -> ActividadBreakdown:
    rules = load_irpf_rules(year)
    a = actividad(ingresos, gastos, rules, base_elegida=base_elegida, gastos_dificil=gastos_dificil)
    return ActividadBreakdown(
        year=year,
        actividad=a,
        reta_tramo_label=rules.reta.tramos[a.reta_tramo].label,
        reta_rendimiento_mensual=a.rendimiento_computable / 12,
    )
