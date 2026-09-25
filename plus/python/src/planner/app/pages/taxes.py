"""«Taxes» section: autónomo (rendimiento neto + RETA) and IRPF for a year by both halves."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import plotly.graph_objects as go
from nicegui import ui

from planner.app import theme
from planner.reports import (
    ActividadBreakdown,
    Household,
    actividad_breakdown,
    general_rate_curve,
    irpf_anual_breakdown,
)
from planner.tax import Discapacidad, Familiar, Mitades, Persona, available_years

DISCAPACIDAD_LABELS = {
    Discapacidad.NINGUNA: "нет",
    Discapacidad.GRADO_33: "33–64 %",
    Discapacidad.GRADO_65: "≥ 65 %",
}


@dataclass
class TaxForm:
    """Form state of one browser tab."""

    year: int
    fuente: str = "autonomo"  # rendimiento neto: "autonomo" — from revenue, "manual" — entered
    ingresos: float = 50_000
    gastos: float = 6_000  # excluding the RETA cuota
    base_reta: float | None = None  # monthly RETA base; empty — the tramo minimum
    rendimiento: float = 40_000  # rendimiento neto actividad in manual mode
    rcm: float = 2_000  # dividends and interest
    ganancias: float = 0  # gain / loss from sales
    aportacion_pensiones: float = 0
    aportacion_pensiones_autonomo: float = 0
    deduccion_estatal: float = 0
    deduccion_autonomica: float = 0
    dependiente: bool = False  # art. 32.2.1º LIRPF
    inicio_actividad: bool = False  # art. 32.3 LIRPF
    edad: int = 35
    discapacidad: Discapacidad = Discapacidad.NINGUNA
    hijos: str = ""  # comma-separated ages
    hijos_compartidos: bool = True  # both parents file separately → mínimo split 50/50
    padres: str = ""


def _ages(text: str) -> list[int]:
    parts = [p.strip() for p in text.replace(";", ",").split(",") if p.strip()]
    ages = [int(p) for p in parts]  # ValueError on garbage — shown in the form
    if any(a < 0 or a > 120 for a in ages):
        raise ValueError("возраст вне диапазона")
    return ages


def _household(f: TaxForm) -> Household:
    share = 0.5 if f.hijos_compartidos else 1.0
    return Household(
        contribuyente=Persona(edad=int(f.edad or 0), discapacidad=f.discapacidad),
        descendientes=tuple(Familiar(edad=a, share=share) for a in _ages(f.hijos)),
        ascendientes=tuple(Familiar(edad=a) for a in _ages(f.padres)),
    )


def _eur(x: float) -> str:
    return f"{x:,.0f} €".replace(",", " ")


def _kpi(title: str, value: str, hint: str = "") -> None:
    with ui.card().classes("w-full"):
        ui.label(title).classes("text-sm text-gray-500")
        ui.label(value).classes("text-2xl font-semibold")
        if hint:
            ui.label(hint).classes("text-xs text-gray-500")


def _rate_chart(year: int, household: Household, base_general: float) -> go.Figure:
    top = max(150_000.0, base_general * 1.5)
    df = general_rate_curve(year, household, np.linspace(1_000, top, 300))
    fig = go.Figure()
    fig.add_scatter(
        x=df["base"],
        y=df["effective"] * 100,
        name="Эффективная",
        line={"color": theme.SERIES[0], "width": 2},
        hovertemplate="%{y:.1f} %",
    )
    fig.add_scatter(
        x=df["base"],
        y=df["marginal"] * 100,
        name="Предельная",
        line={"color": theme.SERIES[1], "width": 2, "shape": "hv"},
        hovertemplate="%{y:.1f} %",
    )
    fig.add_vline(x=base_general, line={"color": theme.TEXT_SECONDARY, "width": 1, "dash": "dot"})
    fig.add_annotation(
        x=base_general, y=0.98, yref="paper", text="ваша база", showarrow=False,
        xanchor="left", yanchor="top", xshift=4, font={"color": theme.TEXT_SECONDARY, "size": 12},
    )  # fmt: skip
    fig.update_layout(
        **theme.PLOTLY_LAYOUT,
        xaxis_title="Base liquidable general, €",
        yaxis_title="Ставка IRPF, %",
        height=380,
    )
    fig.update_xaxes(tickformat=",.0f", gridcolor=theme.GRID)
    fig.update_yaxes(ticksuffix=" %", rangemode="tozero", gridcolor=theme.GRID)
    return fig


def _actividad_block(act: ActividadBreakdown, irpf: float) -> None:
    a = act.actividad
    with ui.element("div").classes("w-full grid grid-cols-2 lg:grid-cols-4 gap-3"):
        _kpi("Rendimiento neto", _eur(a.rendimiento_neto), "в общую базу IRPF")
        _kpi(
            "Cuota RETA",
            _eur(a.cuota_reta),
            f"{_eur(a.cuota_reta / 12)}/мес · tramo {act.reta_tramo_label}",
        )
        _kpi(
            "Base RETA, в месяц",
            _eur(a.reta_base),
            f"rendimiento для tramo: {_eur(act.reta_rendimiento_mensual)}/мес",
        )
        share = (irpf + a.cuota_reta) / a.ingresos if a.ingresos > 0 else 0.0
        _kpi("IRPF + RETA от выручки", f"{share:.1%}", _eur(irpf + a.cuota_reta))

    ui.table(
        columns=[
            {"name": "name", "label": "От выручки к rendimiento neto", "field": "name",
             "align": "left"},
            {"name": "amount", "label": "€ за год", "field": "amount"},
        ],
        rows=[{"name": r["name"], "amount": _eur(r["amount"])} for r in act.rows()],
        row_key="name",
    ).props("flat bordered dense").classes("w-full")  # fmt: skip


def page() -> None:
    years = available_years()
    form = TaxForm(year=years[-1])

    ui.label("Налоги: autónomo и IRPF за год").classes("text-2xl font-semibold")
    ui.label(
        "Rendimiento neto (estimación directa simplificada) и cuota RETA по реальным доходам; "
        "IRPF за год по двум половинам — estatal и Comunitat Valenciana: reducciones, mínimo "
        "personal y familiar, deducciones → cuota líquida. Без переноса убытков прошлых лет."
    ).classes("text-sm text-gray-500")

    with ui.row().classes("w-full items-start gap-4 flex-wrap md:flex-nowrap"):
        with ui.card().classes("w-full md:w-80 shrink-0"):
            ui.label("Входные данные").classes("font-semibold")
            inputs = [
                ui.select(years, label="Налоговый год").bind_value(form, "year"),
                ui.toggle({"autonomo": "Autónomo", "manual": "Вручную"}).bind_value(
                    form, "fuente"
                ),
                ui.number("Выручка за год, €", min=0, step=1000, format="%.0f")
                .bind_value(form, "ingresos")
                .bind_visibility_from(form, "fuente", value="autonomo")
                .tooltip("Ingresos de la actividad без IVA"),
                ui.number("Расходы за год, €", min=0, step=500, format="%.0f")
                .bind_value(form, "gastos")
                .bind_visibility_from(form, "fuente", value="autonomo")
                .tooltip("Gastos deducibles без cuota RETA — она считается сама"),
                ui.number("База RETA, €/мес", min=0, step=50, format="%.2f")
                .bind_value(form, "base_reta")
                .bind_visibility_from(form, "fuente", value="autonomo")
                .tooltip("Пусто — минимальная база своего tramo. Выше — больше пенсия и cuota"),
                ui.number("Rendimiento neto actividad, €", step=1000, format="%.0f")
                .bind_value(form, "rendimiento")
                .bind_visibility_from(form, "fuente", value="manual")
                .tooltip("Rendimiento neto после всех gastos и RETA; может быть отрицательным"),
                ui.number("Дивиденды и проценты, €", step=500, format="%.0f")
                .bind_value(form, "rcm")
                .tooltip("Rendimientos del capital mobiliario — база сбережений"),
                ui.number("Прирост / убыток от продаж, €", step=500, format="%.0f")
                .bind_value(form, "ganancias")
                .tooltip("Saldo ganancias y pérdidas patrimoniales — база сбережений"),
                ui.number("Ваш возраст на 31.12", min=0, max=120, format="%.0f").bind_value(
                    form, "edad"
                ),
                ui.select(DISCAPACIDAD_LABELS, label="Discapacidad").bind_value(
                    form, "discapacidad"
                ),
                ui.input("Дети: возрасты через запятую", placeholder="5, 2").bind_value(
                    form, "hijos"
                ),
                ui.checkbox("Делить mínimo по детям с партнёром 50/50").bind_value(
                    form, "hijos_compartidos"
                ),
                ui.input("Родители на иждивении: возрасты", placeholder="72").bind_value(
                    form, "padres"
                ),
            ]
            with ui.expansion("Reducciones и deducciones").classes("w-full"):
                extra = [
                    ui.number("Взносы в план пенсий, €", min=0, step=500, format="%.0f")
                    .bind_value(form, "aportacion_pensiones")
                    .tooltip("Обычные планы: уменьшают базу до 1 500 € в год"),
                    ui.number("Взносы в план для autónomos, €", min=0, step=500, format="%.0f")
                    .bind_value(form, "aportacion_pensiones_autonomo")
                    .tooltip("Plan de empleo simplificado: ещё до 4 250 € сверх 1 500"),
                    ui.number("Deducciones estatal, €", min=0, step=100, format="%.0f").bind_value(
                        form, "deduccion_estatal"
                    ),
                    ui.number("Deducciones autonómica, €", min=0, step=100, format="%.0f")
                    .bind_value(form, "deduccion_autonomica")
                    .tooltip("Deducciones Comunitat Valenciana — сумма из Renta Web"),
                    ui.checkbox("Autónomo dependiente (art. 32.2.1º)")
                    .bind_value(form, "dependiente")
                    .tooltip(
                        "Один клиент, расходы ≤ 30 %, ≥ 70 % выручки с retención. "
                        "Тогда без gastos de difícil justificación"
                    ),
                    ui.checkbox("Первые 2 года деятельности (art. 32.3)").bind_value(
                        form, "inicio_actividad"
                    ),
                ]
            inputs += extra
            for el in inputs:
                el.classes("w-full")

        results_col = ui.column().classes("flex-1 min-w-0 w-full")

    @ui.refreshable
    def results() -> None:
        try:
            household = _household(form)
        except ValueError:
            ui.label("Возрасты — целые числа через запятую, например «5, 2».").classes(
                "text-red-600"
            )
            return
        year = int(form.year)
        act = None
        if form.fuente == "autonomo":
            base_reta = float(form.base_reta) if form.base_reta else None
            act = actividad_breakdown(
                year,
                float(form.ingresos or 0),
                float(form.gastos or 0),
                base_reta,
                gastos_dificil=not form.dependiente,
            )
            rendimiento = act.actividad.rendimiento_neto
        else:
            rendimiento = float(form.rendimiento or 0)
        b = irpf_anual_breakdown(
            year,
            household,
            rendimiento_actividad=rendimiento,
            rcm=float(form.rcm or 0),
            ganancias=float(form.ganancias or 0),
            aportacion_pensiones=float(form.aportacion_pensiones or 0),
            aportacion_pensiones_autonomo=float(form.aportacion_pensiones_autonomo or 0),
            deducciones=Mitades(
                estatal=float(form.deduccion_estatal or 0),
                autonomica=float(form.deduccion_autonomica or 0),
            ),
            dependiente=form.dependiente,
            inicio_actividad=form.inicio_actividad,
        )

        if act is not None:
            _actividad_block(act, b.cuota.total)

        with ui.element("div").classes("w-full grid grid-cols-2 lg:grid-cols-4 gap-3"):
            _kpi("IRPF (cuota líquida)", _eur(b.cuota.total), f"за {b.year} год")
            _kpi("Эффективная ставка", f"{b.effective_rate:.1%}", "от bases imponibles")
            _kpi("Предельная, общая база", f"{b.marginal_general:.1%}", "следующий евро")
            _kpi("Предельная, сбережения", f"{b.marginal_ahorro:.1%}", "следующий евро")

        ui.table(
            columns=[
                {"name": "name", "label": "От rendimientos к bases", "field": "name",
                 "align": "left"},
                {"name": "amount", "label": "€ за год", "field": "amount"},
            ],
            rows=[{"name": r["name"], "amount": _eur(r["amount"])} for r in b.base_rows()],
            row_key="name",
        ).props("flat bordered dense").classes("w-full")  # fmt: skip

        ui.table(
            columns=[
                {"name": "name", "label": "", "field": "name", "align": "left"},
                {"name": "estatal", "label": "Estatal", "field": "estatal"},
                {"name": "autonomica", "label": "Autonómica (CV)", "field": "autonomica"},
                {"name": "total", "label": "Итого", "field": "total"},
            ],
            rows=[{k: (v if k == "name" else _eur(v)) for k, v in r.items()} for r in b.rows()],
            row_key="name",
        ).props("flat bordered dense").classes("w-full")

        with ui.card().classes("w-full"):
            ui.label("Ставки по общей базе").classes("font-semibold")
            ui.plotly(_rate_chart(b.year, household, b.irpf.base_liquidable_general)).classes(
                "w-full"
            )

    with results_col:
        results()

    # Any form change recomputes the result (it takes milliseconds).
    for el in inputs:
        el.on_value_change(results.refresh)
