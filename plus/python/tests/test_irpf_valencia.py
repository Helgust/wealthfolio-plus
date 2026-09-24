"""Автономная половина (Comunitat Valenciana), mínimos и загрузка правил по годам."""

import pytest

from planner.tax import (
    Discapacidad,
    Familiar,
    Persona,
    cuota_integra,
    load_irpf_rules,
    minimo_personal_familiar,
    rules_for_year,
)


@pytest.fixture
def r2026():
    return load_irpf_rules(2026)


# --- Шкала Валенсии: накопленные cuotas из официальных таблиц -----------------


@pytest.mark.parametrize(
    ("year", "base", "cuota"),
    [
        # GVA, novetats tributàries 2026 (Ley 5/2026)
        (2026, 12_000, 1_056),
        (2026, 72_000, 11_956),
        (2026, 100_000, 19_264),
        (2026, 200_000, 47_114),
        # AEAT, Manual práctico IRPF 2025
        (2025, 12_000, 1_080),
        (2025, 72_000, 12_280),
        (2025, 100_000, 19_700),
        (2025, 200_000, 47_700),
    ],
)
def test_valencia_scale_matches_official_table(year, base, cuota):
    assert load_irpf_rules(year).autonomica.general.apply(base) == pytest.approx(cuota)


def test_valencia_top_rate_2026(r2026):
    assert r2026.autonomica.general.marginal_rate(1e7) == 0.2935


# --- Mínimo personal y familiar -----------------------------------------------


@pytest.mark.parametrize(
    ("edad", "estatal", "autonomica"),
    [
        (40, 5_550, 6_105),
        (65, 5_550 + 1_150, 6_105 + 1_265),
        (80, 5_550 + 1_150 + 1_400, 6_105 + 1_265 + 1_540),
    ],
)
def test_minimo_contribuyente_by_age(r2026, edad, estatal, autonomica):
    m = minimo_personal_familiar(Persona(edad=edad), r2026)
    assert (m.estatal, m.autonomica) == (estatal, autonomica)


def test_minimo_two_children_shared_between_parents(r2026):
    # Старший (5 лет) — «первый», младший (2 года) — «второй» + прибавка до 3 лет; делится 50/50.
    kids = [Familiar(edad=2, share=0.5), Familiar(edad=5, share=0.5)]
    m = minimo_personal_familiar(Persona(edad=35), r2026, descendientes=kids)
    assert m.estatal == pytest.approx(5_550 + (2_400 + 2_700 + 2_800) * 0.5)
    assert m.autonomica == pytest.approx(6_105 + (2_640 + 2_970 + 3_080) * 0.5)


def test_minimo_fourth_and_later_children_use_last_amount(r2026):
    kids = [Familiar(edad=e) for e in (4, 6, 8, 10, 12)]
    m = minimo_personal_familiar(Persona(edad=45), r2026, descendientes=kids)
    assert m.estatal == 5_550 + 2_400 + 2_700 + 4_000 + 4_500 + 4_500


def test_minimo_descendiente_age_and_income_limits(r2026):
    kids = [
        Familiar(edad=26),  # слишком взрослый
        Familiar(edad=20, renta_anual=9_000),  # доходы выше лимита 8000
        Familiar(edad=30, discapacidad=Discapacidad.GRADO_33),  # есть discapacidad: без лимита
    ]
    m = minimo_personal_familiar(Persona(edad=55), r2026, descendientes=kids)
    assert m.estatal == 5_550 + 2_400 + 3_000


def test_minimo_discapacidad_65_includes_asistencia(r2026):
    m = minimo_personal_familiar(Persona(edad=50, discapacidad=Discapacidad.GRADO_65), r2026)
    assert m.estatal == 5_550 + 9_000 + 3_000
    assert m.autonomica == 6_105 + 9_900 + 3_300


def test_minimo_ascendientes(r2026):
    parents = [
        Familiar(edad=70),  # 1150
        Familiar(edad=80),  # 1150 + 1400
        Familiar(edad=60),  # моложе 65 без discapacidad — не даёт права
        Familiar(edad=70, renta_anual=10_000),  # доходы выше лимита
    ]
    m = minimo_personal_familiar(Persona(edad=45), r2026, ascendientes=parents)
    assert m.estatal == 5_550 + 1_150 + 1_150 + 1_400


# --- Cuota íntegra по двум половинам ------------------------------------------


def test_cuota_integra_autonomo_30k_single(r2026):
    m = minimo_personal_familiar(Persona(edad=40), r2026)
    c = cuota_integra(30_000, 0, m, r2026)
    assert c.estatal == pytest.approx(3_582.75 - 5_550 * 0.095)
    # 12000*0.088 + 10000*0.117 + 8000*0.146 = 3394; mínimo 6105*0.088 = 537.24
    assert c.autonomica == pytest.approx(3_394 - 537.24)
    assert c.total == pytest.approx(3_055.5 + 2_856.76)


# --- Правила по годам ---------------------------------------------------------


def test_future_year_uses_latest_rules():
    assert rules_for_year(2045).year == 2026
    assert rules_for_year(2025).year == 2025


def test_year_before_any_rules_fails():
    with pytest.raises(ValueError, match="нет налоговых правил"):
        rules_for_year(1990)


def test_indexed_scales_money_not_rates_or_ages(r2026):
    ix = r2026.indexed(1.1)
    assert ix.estatal.general.brackets[0].upto == pytest.approx(12_450 * 1.1)
    assert ix.estatal.general.brackets[0].rate == 0.095
    assert ix.autonomica.minimos.contribuyente.general == pytest.approx(6_105 * 1.1)
    assert ix.condiciones.renta_max_familiar == pytest.approx(8_000 * 1.1)
    assert ix.condiciones.edad_mayor_65 == 65
    assert r2026.indexed(1.0) is r2026
