"""Autónomo: rendimiento neto (estimación directa simplificada) и cuota RETA."""

import numpy as np
import pytest
from pydantic import ValidationError

from planner.tax import (
    RetaRules,
    actividad,
    gastos_dificil_justificacion,
    load_irpf_rules,
    rendimiento_neto,
    reta_tramo,
)


@pytest.fixture
def r2026():
    return load_irpf_rules(2026)


# --- Правила из BOE ------------------------------------------------------------


@pytest.mark.parametrize(
    ("year", "tipo", "base_maxima"),
    [
        (2025, 0.314, 4_909.50),  # Orden PJC/178/2025: MEI 0,80 %
        (2026, 0.315, 5_101.20),  # Orden PJC/297/2026: MEI 0,90 %
    ],
)
def test_reta_total_rate_and_max_base(year, tipo, base_maxima):
    reta = load_irpf_rules(year).reta
    assert reta.tipos.total == pytest.approx(tipo)
    assert reta.base_maxima == base_maxima
    assert reta.tramos[-1].base_max == base_maxima
    assert len(reta.tramos) == 15


def test_reta_minimum_monthly_cuota_2026(r2026):
    # Tabla reducida, tramo 1: 653,59 × 31,5 % = 205,88 €/мес.
    assert round(r2026.reta.tramos[0].base_min * r2026.reta.tipos.total, 2) == 205.88


# --- Выбор tramo на границах ----------------------------------------------------


@pytest.mark.parametrize(
    ("rend", "label"),
    [
        (-500, "reducida 1"),
        (670, "reducida 1"),  # «≤ 670»
        (670.01, "reducida 2"),
        (900, "reducida 2"),
        (1_166.69, "reducida 3"),
        (1_166.70, "general 1"),  # reducida 3 — «< 1.166,70», general 1 — «≥ 1.166,70»
        (1_300, "general 1"),
        (6_000, "general 11"),
        (6_000.01, "general 12"),
        (1e6, "general 12"),
    ],
)
def test_reta_tramo_boundaries(r2026, rend, label):
    assert r2026.reta.tramos[reta_tramo(rend, r2026.reta)].label == label


def test_reta_tramo_vectorized(r2026):
    idx = reta_tramo(np.array([670, 1_166.70, 6_000.01]), r2026.reta)
    assert idx.tolist() == [0, 3, 14]


def test_reta_rules_reject_decreasing_bases(r2026):
    data = r2026.reta.model_dump()
    data["tramos"][5]["base_min"] = 100
    with pytest.raises(ValidationError, match="base_min"):
        RetaRules.model_validate(data)


# --- Gastos de difícil justificación и rendimiento neto -------------------------


@pytest.mark.parametrize(
    ("previo", "gdj"),
    [(-1_000, 0), (0, 0), (20_000, 1_000), (40_000, 2_000), (100_000, 2_000)],
)
def test_gastos_dificil_justificacion_rate_and_cap(r2026, previo, gdj):
    # 5 % от положительного rendimiento, не больше 2 000 € (art. 30.2.2.ª RIRPF).
    assert gastos_dificil_justificacion(previo, r2026.actividad) == pytest.approx(gdj)


def test_rendimiento_neto_can_be_negative(r2026):
    assert rendimiento_neto(10_000, 12_000, r2026.actividad) == -2_000


# --- Rendimiento neto + RETA вместе ------------------------------------------


def test_actividad_hand_calculation(r2026):
    a = actividad(40_000, 5_000, r2026)
    cuota = 1_356.21 * 12 * 0.315  # general 7: 2 330 < rend/мес ≤ 2 760
    previo = 40_000 - 5_000 - cuota
    neto = previo * 0.95
    assert r2026.reta.tramos[a.reta_tramo].label == "general 7"
    assert a.reta_base == 1_356.21
    assert a.cuota_reta == pytest.approx(cuota)
    assert a.gastos_dificil_justificacion == pytest.approx(previo * 0.05)
    assert a.rendimiento_neto == pytest.approx(neto)
    assert a.rendimiento_computable == pytest.approx((neto + cuota) * 0.93)


def test_actividad_tramo_is_consistent_with_its_own_cuota(r2026):
    ingresos = np.linspace(0, 150_000, 1_501)
    a = actividad(ingresos, np.full_like(ingresos, 3_000), r2026)
    assert (reta_tramo(a.rendimiento_computable / 12, r2026.reta) == a.reta_tramo).all()
    assert np.all(np.diff(a.cuota_reta) >= 0)  # больше выручка — не меньше cuota


def test_actividad_vectorized_matches_scalar(r2026):
    ingresos = np.array([8_000.0, 30_000.0, 90_000.0])
    gastos = np.array([1_000.0, 4_000.0, 10_000.0])
    vec = actividad(ingresos, gastos, r2026)
    for i in range(3):
        one = actividad(ingresos[i], gastos[i], r2026)
        assert vec.rendimiento_neto[i] == pytest.approx(one.rendimiento_neto)
        assert vec.cuota_reta[i] == pytest.approx(one.cuota_reta)
        assert vec.reta_tramo[i] == one.reta_tramo


def test_actividad_loss_pays_minimum_cuota(r2026):
    a = actividad(5_000, 9_000, r2026)
    assert a.reta_tramo == 0
    assert a.cuota_reta == pytest.approx(653.59 * 12 * 0.315)
    assert a.gastos_dificil_justificacion == 0
    assert a.rendimiento_neto == pytest.approx(5_000 - 9_000 - a.cuota_reta)


@pytest.mark.parametrize(
    ("base_elegida", "expected"),
    [
        (2_000, 2_000),  # внутри [base_min, base_max] tramo — остаётся
        (500, None),  # ниже минимума — прижимается к base_min
        (50_000, None),  # выше максимума — прижимается к base_max
    ],
)
def test_actividad_chosen_base_clipped_to_tramo(r2026, base_elegida, expected):
    a = actividad(60_000, 5_000, r2026, base_elegida=base_elegida)
    t = r2026.reta.tramos[a.reta_tramo]
    assert t.base_min <= a.reta_base <= t.base_max
    if expected is not None:
        assert a.reta_base == expected
    assert a.cuota_reta == pytest.approx(a.reta_base * 12 * r2026.reta.tipos.total)


def test_indexed_scales_reta_and_actividad(r2026):
    ix = r2026.indexed(1.1)
    assert ix.reta.base_maxima == pytest.approx(5_101.20 * 1.1)
    assert ix.reta.tramos[0].upto == pytest.approx(670 * 1.1)
    assert ix.reta.tramos[0].base_min == pytest.approx(653.59 * 1.1)
    assert ix.reta.tipos == r2026.reta.tipos
    assert ix.actividad.gastos_dificil_justificacion.limit == pytest.approx(2_200)
    assert ix.actividad.gastos_dificil_justificacion.rate == 0.05
