"""Phase 5: salaries — the employee's cotizaciones (art. 19.2.a LIRPF) and the rendimiento neto del
trabajo after them."""

import numpy as np
import pytest

from planner.tax import (
    Persona,
    RentasMiembro,
    cotizacion_trabajador,
    irpf_anual,
    irpf_conjunta,
    load_irpf_rules,
    minimo_conjunta,
    minimo_personal_familiar,
    rendimiento_trabajo,
)


@pytest.fixture
def r2026():
    return load_irpf_rules(2026)


def test_tipos_por_ano():
    # CC 4,70 + MEI 0,13 / 0,15 + desempleo 1,55 + FP 0,10 (Órdenes PJC/178/2025 and PJC/297/2026)
    assert load_irpf_rules(2025).cotizacion.tipos.total == pytest.approx(0.0648)
    assert load_irpf_rules(2026).cotizacion.tipos.total == pytest.approx(0.065)


@pytest.mark.parametrize(
    ("salario", "cuota"),
    [
        (0, 0),
        (-5_000, 0),
        (30_000, 30_000 * 0.065),
        (61_214.40, 61_214.40 * 0.065),  # 12 × 5 101,20 — the tope, no solidaridad yet
        # Above the tope: 10 % at 0,19 %, up to 50 % at 0,21 %, the rest at 0,24 %.
        (
            100_000,
            61_214.40 * 0.065
            + (67_335.84 - 61_214.40) * 0.0019
            + (91_821.60 - 67_335.84) * 0.0021
            + (100_000 - 91_821.60) * 0.0024,
        ),
    ],
)
def test_cotizacion_2026(r2026, salario, cuota):
    assert cotizacion_trabajador(salario, r2026.cotizacion) == pytest.approx(cuota)


def test_cotizacion_2025_y_arrays():
    c = load_irpf_rules(2025).cotizacion
    tope = 12 * 4_909.50
    got = cotizacion_trabajador(np.array([20_000.0, tope * 1.2]), c)
    want = [20_000 * 0.0648, tope * 0.0648 + tope * 0.1 * 0.0015 + tope * 0.1 * 0.0017]
    assert got == pytest.approx(want)


def test_indexed_rules_move_the_tope(r2026):
    c = r2026.indexed(1.1).cotizacion
    assert c.tope_maximo == pytest.approx(5_101.20 * 1.1)
    assert c.tipos == r2026.cotizacion.tipos
    assert c.solidaridad == r2026.cotizacion.solidaridad


def test_cotizaciones_lower_the_rendimiento_for_the_art_20_thresholds(r2026):
    t = r2026.reducciones.trabajo
    # Without cotizaciones 20 000 € is past the art. 20 reducción; minus 1 300 € it is not.
    assert rendimiento_trabajo(20_000, 0, t)[1] == 0
    otros, red, neto = rendimiento_trabajo(20_000, 0, t, 1_300)
    assert otros == 2_000
    assert red == pytest.approx(2_364.34 - 1.14 * (18_700 - 17_673.52))
    assert neto == pytest.approx(18_700 - 2_000 - red)


def test_otros_gastos_are_capped_after_the_cotizaciones(r2026):
    otros, red, neto = rendimiento_trabajo(1_500, 0, r2026.reducciones.trabajo, 100)
    assert (otros, red, neto) == (pytest.approx(1_400), 0, pytest.approx(0))


def test_irpf_with_a_salary(r2026):
    salario = 35_000.0
    cot = cotizacion_trabajador(salario, r2026.cotizacion)
    minimo = minimo_personal_familiar(Persona(edad=40), r2026)
    res = irpf_anual(r2026, minimo, trabajo_integro=salario, cotizaciones_trabajo=cot)
    assert res.gastos_trabajo == 2_000
    assert res.reduccion_trabajo == 0
    assert res.base_imponible_general == pytest.approx(salario - cot - 2_000)


def test_pension_limit_uses_the_salary_net_of_cotizaciones(r2026):
    salario = 4_000.0
    cot = cotizacion_trabajador(salario, r2026.cotizacion)
    minimo = minimo_personal_familiar(Persona(edad=40), r2026)
    res = irpf_anual(
        r2026,
        minimo,
        trabajo_integro=salario,
        cotizaciones_trabajo=cot,
        rendimiento_actividad=10_000,
        aportacion_pensiones=1_500,
    )
    trabajo = salario - cot - res.gastos_trabajo - res.reduccion_trabajo
    rn_reducido = 10_000 - res.reduccion_actividad
    assert res.reduccion_prevision_social == pytest.approx(
        min(1_500, 0.3 * (rn_reducido + trabajo))
    )


def test_conjunta_adds_up_the_cotizaciones(r2026):
    c = r2026.cotizacion
    minimo = minimo_conjunta([Persona(edad=40), Persona(edad=42)], r2026)
    a = RentasMiembro(trabajo_integro=30_000, cotizaciones_trabajo=cotizacion_trabajador(30_000, c))
    b = RentasMiembro(trabajo_integro=12_000, cotizaciones_trabajo=cotizacion_trabajador(12_000, c))
    res = irpf_conjunta(r2026, minimo, [a, b])
    previo = 42_000 - a.cotizaciones_trabajo - b.cotizaciones_trabajo
    assert res.base_imponible_general == pytest.approx(previo - 2_000)
