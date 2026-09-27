"""Real estate rules: imputación de rentas, vivienda habitual exemptions, taxes on buying a home."""

import pytest

from planner.tax import load_irpf_rules
from planner.tax.inmuebles import (
    amortizacion_inmueble,
    ganancia_exenta_vivienda,
    impuesto_compra_vivienda,
    imputacion_renta,
    rendimiento_arrendamiento,
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


class TestArrendamiento:
    def test_amortizacion_three_percent_of_the_greater_value_without_land(self):
        assert amortizacion_inmueble(200_000, 120_000, 0.6, R26) == pytest.approx(3_600)
        assert amortizacion_inmueble(100_000, 150_000, 0.5, R26) == pytest.approx(2_250)
        assert amortizacion_inmueble(100_000, None, 0.5, R26) == pytest.approx(1_500)

    def test_rendimiento_and_the_general_reduccion(self):
        a = rendimiento_arrendamiento(
            12_000, R26, financiacion_reparacion=3_000, otros_gastos=1_500, amortizacion=2_000
        )
        assert a.rendimiento_neto == pytest.approx(5_500)
        assert a.reduccion == pytest.approx(2_750)
        assert a.rendimiento_neto_reducido == pytest.approx(2_750)

    @pytest.mark.parametrize(
        ("clave", "share"),
        [
            ("rebaja_tensionada", 0.9),
            ("joven_o_social", 0.7),
            ("rehabilitacion", 0.6),
            ("general", 0.5),
            ("anterior_2023", 0.6),
        ],
    )
    def test_reducciones(self, clave, share):
        a = rendimiento_arrendamiento(10_000, R26, reduccion=clave)
        assert a.reduccion == pytest.approx(10_000 * share)

    def test_no_reduccion_on_a_loss(self):
        a = rendimiento_arrendamiento(5_000, R26, otros_gastos=4_000, amortizacion=3_000)
        assert a.rendimiento_neto == pytest.approx(-2_000)
        assert a.reduccion == 0

    def test_interest_and_repairs_up_to_the_rent_and_the_excess_carries_forward(self):
        a = rendimiento_arrendamiento(4_000, R26, financiacion_reparacion=6_000, otros_gastos=1_000)
        assert a.financiacion_reparacion == pytest.approx(4_000)
        assert a.rendimiento_neto == pytest.approx(-1_000)  # other gastos are not limited
        assert a.pendientes == [0, 0, 0, pytest.approx(2_000)]
        # Next year: last year's excess first, then this year's, together up to the rent.
        b = rendimiento_arrendamiento(
            4_000, R26, financiacion_reparacion=3_000, pendientes=a.pendientes
        )
        assert b.financiacion_reparacion == pytest.approx(4_000)
        assert b.pendientes == [0, 0, 0, pytest.approx(1_000)]

    def test_the_excess_expires_after_four_years(self):
        p = rendimiento_arrendamiento(0, R26, financiacion_reparacion=1_000).pendientes
        for _ in range(4):
            p = rendimiento_arrendamiento(0, R26, pendientes=p).pendientes
        assert sum(p) == 0

    def test_a_sold_home_rented_out_before_counts_as_habitual_for_two_years(self):
        assert R26.habitual_hasta_anos == 2
