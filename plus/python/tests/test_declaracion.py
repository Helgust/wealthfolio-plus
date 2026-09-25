"""Reference test: the model against the user's real tax return (tests/data/declaracion_*.yaml).

Files with personal data are in .gitignore; without them the test is skipped. Template and fields:
tests/data/declaracion.example.yaml.
"""

from pathlib import Path

import pytest
import yaml
from pydantic import BaseModel, ConfigDict

from planner.tax import (
    Familiar,
    IrpfAnual,
    Mitades,
    Persona,
    irpf_anual,
    load_irpf_rules,
    minimo_personal_familiar,
    rendimiento_neto,
)

DATA = Path(__file__).parent / "data"


class _Strict(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class Actividad(_Strict):
    ingresos: float
    gastos: float
    cuota_reta: float
    dependiente: bool = False
    inicio_actividad: bool = False


class Deducciones(_Strict):
    estatal: float = 0
    autonomica: float = 0


class Esperado(_Strict):
    rendimiento_neto_actividad: float | None = None
    base_liquidable_general: float | None = None
    base_liquidable_ahorro: float | None = None
    cuota_integra_estatal: float | None = None
    cuota_integra_autonomica: float | None = None
    cuota_liquida_estatal: float | None = None
    cuota_liquida_autonomica: float | None = None


class Declaracion(_Strict):
    year: int
    contribuyente: Persona
    descendientes: list[Familiar] = []
    ascendientes: list[Familiar] = []
    actividad: Actividad
    rendimientos_trabajo: float = 0
    rcm: float = 0
    ganancias: float = 0
    aportacion_pensiones: float = 0
    aportacion_pensiones_autonomo: float = 0
    deducciones: Deducciones = Deducciones()
    esperado: Esperado


def calcular(d: Declaracion) -> tuple[float, IrpfAnual]:
    """rendimiento neto from the actual RETA cuota in the return, then IRPF for the year."""
    rules = load_irpf_rules(d.year)
    a = d.actividad
    rn = rendimiento_neto(
        a.ingresos, a.gastos + a.cuota_reta, rules.actividad, gastos_dificil=not a.dependiente
    )
    minimo = minimo_personal_familiar(d.contribuyente, rules, d.descendientes, d.ascendientes)
    res = irpf_anual(
        rules,
        minimo,
        rendimiento_actividad=rn,
        rendimientos_trabajo=d.rendimientos_trabajo,
        rcm=d.rcm,
        ganancias=d.ganancias,
        aportacion_pensiones=d.aportacion_pensiones,
        aportacion_pensiones_autonomo=d.aportacion_pensiones_autonomo,
        deducciones=Mitades(estatal=d.deducciones.estatal, autonomica=d.deducciones.autonomica),
        dependiente=a.dependiente,
        discapacidad=d.contribuyente.discapacidad,
        inicio_actividad=a.inicio_actividad,
    )
    return rn, res


def _load(path: Path) -> Declaracion:
    return Declaracion.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))


def test_example_template_is_valid():
    d = _load(DATA / "declaracion.example.yaml")
    rn, res = calcular(d)
    assert rn == 0
    assert res.cuota_liquida.total == 0


DECLARACIONES = sorted(DATA.glob("declaracion_*.yaml"))


@pytest.mark.skipif(not DECLARACIONES, reason="no tests/data/declaracion_<year>.yaml")
@pytest.mark.parametrize("path", DECLARACIONES, ids=lambda p: p.stem)
def test_model_matches_declaracion(path):
    d = _load(path)
    rn, res = calcular(d)
    got = {
        "rendimiento_neto_actividad": rn,
        "base_liquidable_general": res.base_liquidable_general,
        "base_liquidable_ahorro": res.base_liquidable_ahorro,
        "cuota_integra_estatal": res.cuota_integra.estatal,
        "cuota_integra_autonomica": res.cuota_integra.autonomica,
        "cuota_liquida_estatal": res.cuota_liquida.estatal,
        "cuota_liquida_autonomica": res.cuota_liquida.autonomica,
    }
    # The return rounds to the cent at every step — tolerance 1 €.
    mismatches = {
        k: (got[k], v)
        for k, v in d.esperado.model_dump().items()
        if v is not None and abs(got[k] - v) > 1.0
    }
    assert not mismatches, f"model ≠ tax return (model, return): {mismatches}"
