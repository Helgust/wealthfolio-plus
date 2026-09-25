"""UI tests of the app through the NiceGUI simulated user (no browser)."""

import pytest
from nicegui import ui
from nicegui.testing.user_simulation import user_simulation

from planner.app.main import SECTIONS, root
from planner.app.pages.taxes import _eur
from planner.reports import Household, actividad_breakdown, irpf_anual_breakdown, irpf_breakdown
from planner.tax import Persona


def _set_manual(user) -> None:
    # The simulation does not pass clicks on ui.toggle options — set the value as the client would.
    user.find(kind=ui.toggle).elements.pop().value = "manual"


@pytest.fixture
async def user():
    async with user_simulation(root=root) as u:
        yield u


@pytest.mark.parametrize(("path", "title"), [(s[0], s[2]) for s in SECTIONS])
async def test_every_section_opens(user, path, title):
    await user.open(path)
    await user.should_see(title)


async def test_taxes_page_autonomo_by_default(user):
    await user.open("/taxes")
    act = actividad_breakdown(2026, 50_000, 6_000)
    rn = act.actividad.rendimiento_neto
    irpf = irpf_breakdown(2026, rn, 2_000, Household(contribuyente=Persona(edad=35)))
    await user.should_see(_eur(rn))
    await user.should_see(_eur(act.actividad.cuota_reta))
    await user.should_see(f"tramo {act.reta_tramo_label}")
    await user.should_see(_eur(irpf.cuota.total))


async def test_taxes_page_autonomo_recalculates(user):
    await user.open("/taxes")
    user.find("Выручка за год, €").clear().type("100000")
    act = actividad_breakdown(2026, 100_000, 6_000)
    await user.should_see(f"tramo {act.reta_tramo_label}")
    await user.should_see(_eur(act.actividad.rendimiento_neto))


async def test_taxes_page_manual_base(user):
    await user.open("/taxes")
    _set_manual(user)
    expected = irpf_breakdown(2026, 40_000, 2_000, Household(contribuyente=Persona(edad=35)))
    await user.should_see(_eur(expected.cuota.total))


async def test_taxes_page_recalculates_on_input(user):
    await user.open("/taxes")
    _set_manual(user)
    user.find("Rendimiento neto actividad, €").clear().type("30000")
    user.find("Дивиденды и проценты, €").clear().type("0")
    await user.should_see(_eur(3_055.5 + 2_856.76))


async def test_taxes_page_rejects_bad_ages(user):
    await user.open("/taxes")
    user.find("Дети: возрасты через запятую").type("пять")
    await user.should_see("Возрасты — целые числа через запятую")


async def test_taxes_page_pension_contribution_lowers_tax(user):
    await user.open("/taxes")
    _set_manual(user)
    user.find("Взносы в план пенсий, €").clear().type("1500")
    expected = irpf_anual_breakdown(
        2026,
        Household(contribuyente=Persona(edad=35)),
        rendimiento_actividad=40_000,
        rcm=2_000,
        aportacion_pensiones=1_500,
    )
    await user.should_see(_eur(expected.cuota.total))
    rows = [r["name"] for t in user.find(kind=ui.table).elements for r in t.rows]
    assert "Reducción planes de pensiones" in rows
