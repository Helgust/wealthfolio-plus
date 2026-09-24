import numpy as np
import pytest
from pydantic import ValidationError

from planner.tax import Scale, cuota_integra_mitad, load_scale

YEAR = 2026


@pytest.fixture
def general_estatal():
    return load_scale(YEAR, "general_estatal")


@pytest.fixture
def ahorro_estatal():
    return load_scale(YEAR, "ahorro", key="estatal")


@pytest.fixture
def ahorro_autonomica():
    return load_scale(YEAR, "ahorro", key="autonomica")


def test_zero_base(general_estatal):
    assert general_estatal.apply(0) == 0


def test_negative_base_is_zero(general_estatal):
    assert general_estatal.apply(-1_000) == 0


def test_general_estatal_30k(general_estatal):
    # 12450*0.095 + 7750*0.12 + 9800*0.15
    assert general_estatal.apply(30_000) == pytest.approx(3582.75)


def test_bracket_boundary(general_estatal):
    assert general_estatal.apply(12_450) == pytest.approx(12_450 * 0.095)


def test_apply_vectorized(general_estatal):
    # Накопленные cuotas из таблицы AEAT (art. 63.1 LIRPF)
    bases = np.array([0, 12_450, 30_000, 300_000])
    expected = [0, 1182.75, 3582.75, 62950.75]
    np.testing.assert_allclose(general_estatal.apply(bases), expected)


def test_apply_scalar_returns_float(general_estatal):
    assert isinstance(general_estatal.apply(1_000), float)


def test_marginal_rate(general_estatal):
    assert general_estatal.marginal_rate(0) == 0.095
    assert general_estatal.marginal_rate(12_450) == 0.12  # следующий евро — уже 2-я ступень
    assert general_estatal.marginal_rate(1e9) == 0.245


def test_scaled_moves_bounds_not_rates(general_estatal):
    s = general_estatal.scaled(2.0)
    assert s.brackets[0].upto == 24_900
    assert s.brackets[-1].upto is None
    assert [b.rate for b in s.brackets] == [b.rate for b in general_estatal.brackets]


@pytest.mark.parametrize(
    "brackets",
    [
        [{"upto": 100, "rate": 0.1}],  # последняя ступень ограничена
        [{"upto": 200, "rate": 0.1}, {"upto": 100, "rate": 0.2}, {"upto": None, "rate": 0.3}],
        [{"upto": None, "rate": 0.1}, {"upto": None, "rate": 0.2}],
    ],
)
def test_invalid_scale_rejected(brackets):
    with pytest.raises(ValidationError):
        Scale(brackets=brackets)


def test_ahorro_total_10k(ahorro_estatal, ahorro_autonomica):
    # 6000*0.19 + 4000*0.21 в сумме двух половин
    total = ahorro_estatal.apply(10_000) + ahorro_autonomica.apply(10_000)
    assert total == pytest.approx(1980.0)


def test_minimo_applies_to_general_first(general_estatal, ahorro_estatal):
    # 3582.75 - 5550*0.095
    cuota = cuota_integra_mitad(30_000, 0, 5_550, general_estatal, ahorro_estatal)
    assert cuota == pytest.approx(3055.5)


def test_minimo_remainder_goes_to_ahorro(general_estatal, ahorro_estatal):
    # Общей базы нет -> весь mínimo уходит в базу сбережений: 990 - 527.25
    cuota = cuota_integra_mitad(0, 10_000, 5_550, general_estatal, ahorro_estatal)
    assert cuota == pytest.approx(462.75)


def test_cuota_mitad_vectorized(general_estatal, ahorro_estatal):
    cuota = cuota_integra_mitad(
        np.array([30_000, 0]), np.array([0, 10_000]), 5_550, general_estatal, ahorro_estatal
    )
    np.testing.assert_allclose(cuota, [3055.5, 462.75])
