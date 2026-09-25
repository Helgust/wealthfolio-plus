"""Real estate rules: imputación de rentas, vivienda habitual exemptions, taxes on buying a home."""

import pytest

from planner.tax import load_irpf_rules
from planner.tax.inmuebles import (
    ganancia_exenta_vivienda,
    impuesto_compra_vivienda,
    imputacion_renta,
)

R25 = load_irpf_rules(2025).inmuebles
R26 = load_irpf_rules(2026).inmuebles


def exenta(ganancia, valor, prestamo, reinvertido, edad):
    return ganancia_exenta_vivienda(ganancia, valor, prestamo, reinvertido, edad, R26)


def compra(precio, nueva, habitual, rules=R26):
    return impuesto_compra_vivienda(precio, nueva=nueva, habitual=habitual, rules=rules)


class TestImputacion:
    def test_two_percent_of_the_valor_catastral(self):
        assert imputacion_renta(100_000, R26) == pytest.approx(2_000)

    def test_revised_valores_catastrales(self):
        assert imputacion_renta(100_000, R26, revisado=True) == pytest.approx(1_100)

    def test_without_valor_catastral_half_the_price(self):
        assert imputacion_renta(None, R26, precio_adquisicion=200_000) == pytest.approx(1_100)

    def test_pro_rata_by_days(self):
        assert imputacion_renta(100_000, R26, dias=73) == pytest.approx(400)


class TestExencionVivienda:
    def test_full_reinvestment_of_the_amount_obtained(self):
        # Sold for 300,000 with 100,000 still owed: 200,000 obtained, all reinvested.
        assert exenta(50_000, 300_000, 100_000, 200_000, 50) == 50_000

    def test_partial_reinvestment_exempts_the_share(self):
        assert exenta(50_000, 300_000, 100_000, 50_000, 50) == pytest.approx(12_500)

    def test_no_reinvestment(self):
        assert exenta(50_000, 300_000, 0, 0, 50) == 0

    def test_over_65_exempt_without_reinvestment(self):
        assert exenta(50_000, 300_000, 0, 0, 65) == 50_000
        assert exenta(50_000, 300_000, 0, 0, 64) == 0

    def test_a_loss_has_nothing_to_exempt(self):
        assert exenta(-10_000, 300_000, 0, 300_000, 70) == 0

    def test_loan_above_the_price(self):
        assert exenta(5_000, 100_000, 120_000, 1, 40) == 5_000


class TestCompraVivienda:
    def test_second_hand_itp(self):
        assert compra(200_000, False, True) == pytest.approx(18_000)
        assert compra(200_000, False, True, R25) == pytest.approx(20_000)

    def test_high_value_rate_on_the_whole_price(self):
        assert compra(1_000_000, False, False) == pytest.approx(90_000)
        assert compra(1_200_000, False, False) == pytest.approx(132_000)

    def test_new_home_iva_and_ajd(self):
        assert compra(200_000, True, True) == pytest.approx(20_200)
        assert compra(200_000, True, False) == pytest.approx(22_800)
        assert compra(200_000, True, False, R25) == pytest.approx(23_000)


def test_indexing_scales_only_the_itp_threshold():
    rules = load_irpf_rules(2026)
    ix = rules.indexed(1.1).inmuebles
    assert ix.itp.alto_valor_desde == pytest.approx(1_100_000)
    assert ix.itp.general == R26.itp.general
    assert ix.imputacion == R26.imputacion
