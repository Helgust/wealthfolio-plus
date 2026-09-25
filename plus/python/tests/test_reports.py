import numpy as np
import pytest

from planner.reports import (
    Household,
    actividad_breakdown,
    general_rate_curve,
    irpf_anual_breakdown,
    irpf_breakdown,
)
from planner.tax import Familiar, Persona

SINGLE = Household(contribuyente=Persona(edad=40))


def test_breakdown_matches_core_calculation():
    b = irpf_breakdown(2026, 30_000, 0, SINGLE)
    assert b.cuota.estatal == pytest.approx(3_055.5)
    assert b.cuota.autonomica == pytest.approx(2_856.76)
    assert b.effective_rate == pytest.approx((3_055.5 + 2_856.76) / 30_000)
    assert b.marginal_general == pytest.approx(0.15 + 0.146)
    assert b.marginal_ahorro == pytest.approx(0.19)


def test_breakdown_rows_total_column():
    rows = irpf_breakdown(2026, 30_000, 0, SINGLE).rows()
    assert rows[0] == {
        "name": "Mínimo personal y familiar",
        "estatal": 5_550,
        "autonomica": 6_105,
        "total": 11_655,
    }


def test_household_children_reduce_tax():
    kids = Household(contribuyente=Persona(edad=40), descendientes=(Familiar(edad=5),))
    assert (
        irpf_breakdown(2026, 30_000, 0, kids).cuota.total
        < irpf_breakdown(2026, 30_000, 0, SINGLE).cuota.total
    )


def test_zero_bases_give_zero_effective_rate():
    assert irpf_breakdown(2026, 0, 0, SINGLE).effective_rate == 0


def test_rate_curve_shape_and_monotonic_marginal():
    df = general_rate_curve(2026, SINGLE, np.linspace(0, 100_000, 51))
    assert list(df.columns) == ["base", "effective", "marginal"]
    assert df.loc[0, "effective"] == 0
    assert df["marginal"].is_monotonic_increasing
    assert (df["effective"] <= df["marginal"]).all()


def test_actividad_breakdown_chain_sums_to_rendimiento_neto():
    b = actividad_breakdown(2026, 40_000, 5_000)
    rows = b.rows()
    assert sum(r["amount"] for r in rows[:-1]) == pytest.approx(rows[-1]["amount"])
    assert rows[-1]["amount"] == pytest.approx(b.actividad.rendimiento_neto)
    assert b.reta_tramo_label == "general 7"
    assert 2_330 < b.reta_rendimiento_mensual <= 2_760


def test_irpf_anual_breakdown_rows():
    b = irpf_anual_breakdown(
        2026, SINGLE, rendimiento_actividad=40_000, rcm=1_000, aportacion_pensiones=1_500
    )
    names = [r["name"] for r in b.base_rows()]
    assert "Reducción planes de pensiones" in names
    assert "Reducción art. 32 LIRPF" not in names  # zero deductions are hidden
    bases = {r["name"]: r["amount"] for r in b.base_rows()}
    assert bases["Base liquidable general"] == 38_500
    assert b.rows()[-1]["name"] == "Cuota líquida"
    assert b.cuota.total == pytest.approx(irpf_breakdown(2026, 38_500, 1_000, SINGLE).cuota.total)
