"""Шаг 4: reducciones (art. 32, 51–52), compensación de rentas (art. 49, 50.3), IRPF за год."""

import numpy as np
import pytest

from planner.tax import (
    Discapacidad,
    Mitades,
    Persona,
    base_imponible_ahorro,
    compensar_base_liquidable_general,
    cuota_integra,
    irpf_anual,
    load_irpf_rules,
    minimo_personal_familiar,
    pendientes_vacios,
    reduccion_actividad,
    reduccion_prevision_social,
)


@pytest.fixture
def r2026():
    return load_irpf_rules(2026)


@pytest.fixture
def comp(r2026):
    return r2026.reducciones.compensacion


# --- Art. 32.2.3º: rentas < 12 000 € ----------------------------------------------


@pytest.mark.parametrize(
    ("rn", "otras", "red"),
    [
        (7_000, 0, 1_620),
        (10_000, 0, 1_620 - 0.405 * 2_000),
        (5_000, 4_000, 1_620 - 0.405 * 1_000),  # считаются все rentas, не только actividad
        (12_000, 0, 0),
        (1_000, 0, 1_000),  # не больше самого rendimiento (32.2.4º)
        (-3_000, 0, 0),
        (30_000, 0, 0),
    ],
)
def test_reduccion_rentas_bajas(r2026, rn, otras, red):
    assert reduccion_actividad(rn, r2026.reducciones.actividad, otras_rentas=otras) == (
        pytest.approx(red)
    )


# --- Art. 32.2.1º: autónomo dependiente -------------------------------------------


@pytest.mark.parametrize(
    ("rn", "otras", "disc", "red"),
    [
        (10_000, 0, Discapacidad.NINGUNA, 2_000 + 6_498),
        (16_000, 0, Discapacidad.NINGUNA, 2_000 + 6_498 - 1.14 * (16_000 - 14_047.5)),
        (19_747.5, 0, Discapacidad.NINGUNA, 2_000),
        (10_000, 7_000, Discapacidad.NINGUNA, 2_000),  # прочие rentas > 6 500
        (40_000, 0, Discapacidad.GRADO_33, 2_000 + 3_500),
        (40_000, 0, Discapacidad.GRADO_65, 2_000 + 7_750),
        (3_000, 0, Discapacidad.NINGUNA, 3_000),
    ],
)
def test_reduccion_dependiente(r2026, rn, otras, disc, red):
    got = reduccion_actividad(
        rn, r2026.reducciones.actividad, otras_rentas=otras, dependiente=True, discapacidad=disc
    )
    assert got == pytest.approx(red)


# --- Art. 32.3: inicio de actividad ------------------------------------------------


def test_reduccion_inicio_actividad(r2026):
    ra = r2026.reducciones.actividad
    assert reduccion_actividad(50_000, ra, inicio_actividad=True) == pytest.approx(10_000)
    assert reduccion_actividad(250_000, ra, inicio_actividad=True) == pytest.approx(20_000)
    # 20 % считается от rendimiento после 32.2: 10 000 − 810 = 9 190.
    assert reduccion_actividad(10_000, ra, inicio_actividad=True) == pytest.approx(
        810 + 0.2 * 9_190
    )


# --- Arts. 51–52: planes de pensiones ----------------------------------------------


@pytest.mark.parametrize(
    ("general", "autonomo", "rend", "red"),
    [
        (1_500, 0, 50_000, 1_500),
        (3_000, 0, 50_000, 1_500),  # сверх 1 500 € не уменьшает базу
        (0, 5_000, 50_000, 5_000),  # 4 250 в incremento + 750 в общий лимит
        (2_000, 5_000, 50_000, 4_250 + 1_500),
        (0, 10_000, 50_000, 5_750),  # максимум 1 500 + 4 250
        (1_500, 0, 4_000, 1_200),  # не больше 30 % rendimientos
    ],
)
def test_reduccion_prevision_social(r2026, general, autonomo, rend, red):
    got = reduccion_prevision_social(general, autonomo, rend, r2026.reducciones.prevision_social)
    assert got == pytest.approx(red)


# --- Art. 49: base imponible del ahorro -----------------------------------------------


def _pend(comp, rcm=(0, 0, 0, 0), gp=(0, 0, 0, 0)):
    p = pendientes_vacios(comp)
    p[0], p[1] = rcm, gp
    return p


def test_ahorro_plain_sum(comp):
    b = base_imponible_ahorro(1_000, 2_000, pendientes_vacios(comp), comp)
    assert b.base_imponible == 3_000
    assert not b.pendientes.any()


def test_ahorro_current_rcm_loss_capped_at_25pct_of_gains(comp):
    b = base_imponible_ahorro(-1_000, 2_000, pendientes_vacios(comp), comp)
    assert b.base_imponible == 1_500  # зачтено 500 = 25 % от 2 000
    assert b.pendientes.tolist() == [[0, 0, 0, 500], [0, 0, 0, 0]]


def test_ahorro_current_gp_loss_capped_at_25pct_of_rcm(comp):
    b = base_imponible_ahorro(1_000, -3_000, pendientes_vacios(comp), comp)
    assert b.base_imponible == 750
    assert b.pendientes.tolist() == [[0, 0, 0, 0], [0, 0, 0, 2_750]]


def test_ahorro_prior_losses_own_basket_first_then_cross(comp):
    # Убыток GP 5 000 прошлого года: гасит все 3 000 ganancias, затем 25 % rcm.
    b = base_imponible_ahorro(1_000, 3_000, _pend(comp, gp=(0, 0, 0, 5_000)), comp)
    assert b.base_imponible == 750
    assert b.compensado_anteriores == 3_250
    assert b.pendientes.tolist() == [[0, 0, 0, 0], [0, 0, 1_750, 0]]


def test_ahorro_cross_cap_shared_between_current_and_prior(comp):
    # Лимит 25 % от rcm (250) общий: 200 ушло на убыток GP этого года, 50 — на прошлые.
    b = base_imponible_ahorro(1_000, -200, _pend(comp, gp=(0, 0, 0, 1_000)), comp)
    assert b.base_imponible == 750
    assert b.pendientes[1].tolist() == [0, 0, 950, 0]


def test_ahorro_oldest_losses_first_and_expire_after_4_years(comp):
    b = base_imponible_ahorro(150, 0, _pend(comp, rcm=(100, 200, 0, 0)), comp)
    assert b.base_imponible == 0
    assert b.pendientes[0].tolist() == [150, 0, 0, 0]  # 2-й год: 200 − 50; 1-й списан
    # Через год без доходов самый старый остаток (150) сгорает.
    b2 = base_imponible_ahorro(0, 0, b.pendientes, comp)
    assert not b2.pendientes.any()


def test_ahorro_vectorized_matches_scalar(comp):
    rcm = np.array([1_000.0, -1_000.0, 500.0])
    gp = np.array([-3_000.0, 2_000.0, 800.0])
    pend = np.stack([_pend(comp, gp=(0, 0, 100, 0))] * 3)
    vec = base_imponible_ahorro(rcm, gp, pend, comp)
    for i in range(3):
        one = base_imponible_ahorro(rcm[i], gp[i], pend[i], comp)
        assert vec.base_imponible[i] == pytest.approx(one.base_imponible)
        assert np.allclose(vec.pendientes[i], one.pendientes)


# --- Art. 50.3: отрицательная base liquidable general ------------------------------------


def test_negative_general_base_carried_forward(comp):
    g1 = compensar_base_liquidable_general(-5_000, pendientes_vacios(comp, ahorro=False), comp)
    assert g1.base_liquidable == 0
    assert g1.pendientes.tolist() == [0, 0, 0, 5_000]
    g2 = compensar_base_liquidable_general(8_000, g1.pendientes, comp)
    assert g2.base_liquidable == 3_000
    assert g2.compensado_anteriores == 5_000
    assert not g2.pendientes.any()


# --- IRPF за год ------------------------------------------------------------------------


@pytest.fixture
def minimo(r2026):
    return minimo_personal_familiar(Persona(edad=40), r2026)


def test_irpf_anual_without_reductions_equals_cuota_integra(r2026, minimo):
    res = irpf_anual(r2026, minimo, rendimiento_actividad=30_000, rcm=500)
    ci = cuota_integra(30_000, 500, minimo, r2026)
    assert res.cuota_liquida.estatal == pytest.approx(ci.estatal)
    assert res.cuota_liquida.autonomica == pytest.approx(ci.autonomica)
    assert res.base_liquidable_general == 30_000


def test_irpf_anual_pension_contribution_reduces_general_base(r2026, minimo):
    res = irpf_anual(
        r2026, minimo, rendimiento_actividad=40_000, aportacion_pensiones_autonomo=5_000
    )
    assert res.reduccion_prevision_social == 5_000
    assert res.base_liquidable_general == 35_000


def test_irpf_anual_low_income_reduction(r2026, minimo):
    res = irpf_anual(r2026, minimo, rendimiento_actividad=9_000)
    assert res.reduccion_actividad == pytest.approx(1_620 - 0.405 * 1_000)
    assert res.base_imponible_general == pytest.approx(9_000 - res.reduccion_actividad)


def test_irpf_anual_deducciones_floor_at_zero_per_half(r2026, minimo):
    ded = Mitades(estatal=100.0, autonomica=1e6)
    res = irpf_anual(r2026, minimo, rendimiento_actividad=30_000, deducciones=ded)
    assert res.cuota_liquida.estatal == pytest.approx(res.cuota_integra.estatal - 100)
    assert res.cuota_liquida.autonomica == 0


def test_irpf_anual_carries_loss_to_next_year(r2026, minimo):
    y1 = irpf_anual(r2026, minimo, rendimiento_actividad=-4_000, ganancias=-1_000)
    assert y1.cuota_liquida.total == 0
    y2 = irpf_anual(
        r2026,
        minimo,
        rendimiento_actividad=30_000,
        ganancias=3_000,
        pendientes_general=y1.pendientes_general,
        pendientes_ahorro=y1.pendientes_ahorro,
    )
    assert y2.base_liquidable_general == 26_000
    assert y2.base_liquidable_ahorro == 2_000


def test_irpf_anual_vectorized(r2026, minimo):
    rn = np.array([9_000.0, 30_000.0, 80_000.0])
    vec = irpf_anual(r2026, minimo, rendimiento_actividad=rn, aportacion_pensiones=1_500)
    for i in range(3):
        one = irpf_anual(r2026, minimo, rendimiento_actividad=rn[i], aportacion_pensiones=1_500)
        assert vec.cuota_liquida.total[i] == pytest.approx(one.cuota_liquida.total)
