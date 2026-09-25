"""Шаг 4: reducciones (arts. 19.2.f, 20, 32, 51–52), compensación de rentas (art. 49, 50.3),
IRPF за год."""

import numpy as np
import pytest

from planner.tax import (
    Discapacidad,
    Familiar,
    Mitades,
    Persona,
    RentasMiembro,
    base_imponible_ahorro,
    compensar_base_liquidable_general,
    cuota_integra,
    irpf_anual,
    irpf_conjunta,
    load_irpf_rules,
    minimo_conjunta,
    minimo_personal_familiar,
    pendientes_vacios,
    reduccion_actividad,
    reduccion_prevision_social,
    rendimiento_trabajo,
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


# --- Trabajo sin cotizaciones: otros gastos (19.2.f) и reducción art. 20 ----------------


@pytest.mark.parametrize(
    ("integro", "otras", "gastos", "red"),
    [
        (10_000, 0, 2_000, 7_302),
        (14_852, 0, 2_000, 7_302),  # 20.a — граница плато включительно
        (16_000, 0, 2_000, 7_302 - 1.75 * (16_000 - 14_852)),  # 20.b
        (17_673.52, 0, 2_000, 2_364.34),  # стык 20.b и 20.c
        (18_500, 0, 2_000, 2_364.34 - 1.14 * (18_500 - 17_673.52)),  # 20.c
        (19_747.5, 0, 2_000, 0),  # «inferiores a 19.747,5»
        (40_000, 0, 2_000, 0),
        (8_000, 6_500, 2_000, 6_000),  # прочие rentas ровно 6 500 € — ещё можно; saldo ≥ 0
        (10_000, 6_500.01, 2_000, 0),  # больше 6 500 € — reducción нет
        (10_000, -3_000, 2_000, 7_302),  # алгебраическая сумма: убыток не мешает
        (1_500, 0, 1_500, 0),  # gastos не больше íntegro, saldo не отрицательный
        (0, 0, 0, 0),
    ],
)
def test_rendimiento_trabajo(r2026, integro, otras, gastos, red):
    g, r, neto = rendimiento_trabajo(integro, otras, r2026.reducciones.trabajo)
    assert g == pytest.approx(gastos)
    assert r == pytest.approx(red)
    assert neto == pytest.approx(integro - gastos - red)
    assert neto >= 0


def test_reduccion_trabajo_continuous_and_indexed(r2026):
    t = r2026.reducciones.trabajo
    x = np.linspace(0, 25_000, 2_501)
    _, red, _ = rendimiento_trabajo(x, 0.0, t)
    assert np.max(np.abs(np.diff(red))) < 1.75 * 10 + 1e-6  # без скачков на стыках
    # Индексация: все пороги × f, наклоны прежние — форма сохраняется.
    ti = r2026.indexed(1.1).reducciones.trabajo
    _, red_i, _ = rendimiento_trabajo(x * 1.1, 0.0, ti)
    assert red_i == pytest.approx(red * 1.1, abs=1e-6)


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


def test_irpf_anual_pension_payout_gets_trabajo_reductions(r2026, minimo):
    res = irpf_anual(r2026, minimo, trabajo_integro=16_000)
    assert res.gastos_trabajo == 2_000
    assert res.reduccion_trabajo == pytest.approx(7_302 - 1.75 * 1_148)
    assert res.base_imponible_general == pytest.approx(16_000 - 2_000 - res.reduccion_trabajo)


def test_irpf_anual_trabajo_threshold_counts_actividad_before_art32(r2026, minimo):
    # Прочие rentas = rendimiento actividad до reducción art. 32 + база сбережений.
    res = irpf_anual(r2026, minimo, trabajo_integro=12_000, rendimiento_actividad=4_000, rcm=2_600)
    assert res.reduccion_trabajo == 0
    res = irpf_anual(r2026, minimo, trabajo_integro=12_000, rendimiento_actividad=4_000, rcm=2_500)
    assert res.reduccion_trabajo == pytest.approx(7_302)


def test_irpf_anual_vectorized(r2026, minimo):
    rn = np.array([9_000.0, 30_000.0, 80_000.0])
    vec = irpf_anual(r2026, minimo, rendimiento_actividad=rn, aportacion_pensiones=1_500)
    for i in range(3):
        one = irpf_anual(r2026, minimo, rendimiento_actividad=rn[i], aportacion_pensiones=1_500)
        assert vec.cuota_liquida.total[i] == pytest.approx(one.cuota_liquida.total)


# --- Tributación conjunta (art. 84) ---------------------------------------------------


def test_minimo_conjunta_one_general_amount_increments_per_spouse(r2026):
    got = minimo_conjunta([Persona(edad=70), Persona(edad=40)], r2026)
    assert got.estatal == 5_550 + 1_150
    assert got.autonomica == 6_105 + 1_265
    single = minimo_personal_familiar(Persona(edad=40), r2026)
    assert minimo_conjunta([Persona(edad=40)], r2026) == single


def test_minimo_conjunta_children_counted_in_full(r2026):
    hijos = [Familiar(edad=5), Familiar(edad=2)]
    got = minimo_conjunta([Persona(edad=40), Persona(edad=40)], r2026, descendientes=hijos)
    assert got.estatal == 5_550 + 2_400 + 2_700 + 2_800


def test_irpf_conjunta_reduccion_general_first(r2026, minimo):
    res = irpf_conjunta(
        r2026,
        minimo,
        [RentasMiembro(rendimiento_actividad=30_000), RentasMiembro(rendimiento_actividad=10_000)],
    )
    assert res.base_imponible_general == 40_000
    assert res.reduccion_conjunta == 3_400
    assert res.base_liquidable_general == 36_600


def test_irpf_conjunta_reduccion_remainder_to_ahorro(r2026, minimo):
    res = irpf_conjunta(
        r2026, minimo, [RentasMiembro(otras_rentas_general=-1_000, rcm=5_000), RentasMiembro()]
    )
    assert res.base_liquidable_general == 0
    assert res.base_imponible_ahorro == 5_000
    assert res.base_liquidable_ahorro == 1_600
    assert res.reduccion_conjunta == 3_400
    # Отрицательная база переносится целиком: 84.2.3º не делает её ещё меньше.
    assert res.pendientes_general[-1] == 1_000


def test_irpf_conjunta_ahorro_not_negative(r2026, minimo):
    res = irpf_conjunta(r2026, minimo, [RentasMiembro(otras_rentas_general=1_000, rcm=500)])
    assert res.base_liquidable_general == 0
    assert res.base_liquidable_ahorro == 0
    assert res.reduccion_conjunta == 1_500


def test_irpf_conjunta_pension_limits_per_member(r2026, minimo):
    # 84.2.1º: у каждого свой лимит 1 500 € и свои 30 %.
    miembros = [
        RentasMiembro(rendimiento_actividad=40_000, aportacion_pensiones=1_500),
        RentasMiembro(rendimiento_actividad=4_000, aportacion_pensiones=1_500),
    ]
    res = irpf_conjunta(r2026, minimo, miembros)
    assert res.reduccion_prevision_social == pytest.approx(1_500 + 0.3 * 4_000)


def test_irpf_conjunta_actividad_reduction_on_unit_total(r2026, minimo):
    # 84.2: лимит art. 32.2.3º не умножается: считается по rentas всей unidad familiar.
    miembros = [RentasMiembro(rendimiento_actividad=7_000)] * 2
    assert irpf_conjunta(r2026, minimo, miembros).reduccion_actividad == 0


def test_irpf_conjunta_trabajo_once_per_unit(r2026, minimo):
    # Manual práctico 2025, cap. 3: 19.2.f «por unidad familiar», art. 20 — по сумме rendimientos.
    miembros = [RentasMiembro(trabajo_integro=9_000), RentasMiembro(trabajo_integro=9_000)]
    res = irpf_conjunta(r2026, minimo, miembros)
    assert res.gastos_trabajo == 2_000
    assert res.reduccion_trabajo == pytest.approx(2_364.34 - 1.14 * (18_000 - 17_673.52))


def test_irpf_conjunta_vectorized(r2026, minimo):
    rn = np.array([9_000.0, 30_000.0, 80_000.0])
    vec = irpf_conjunta(r2026, minimo, [RentasMiembro(rendimiento_actividad=rn), RentasMiembro()])
    for i in range(3):
        one = irpf_conjunta(r2026, minimo, [RentasMiembro(rendimiento_actividad=rn[i])])
        assert vec.cuota_liquida.total[i] == pytest.approx(one.cuota_liquida.total)
