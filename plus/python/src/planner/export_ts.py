"""Export for the TypeScript addon: rules by year as JSON and golden fixtures.

Rules stay in rules/<year>/*.yaml; the JSON is their pydantic-validated copy for the addon.
Fixtures are inputs and results of `actividad`, `minimo_*`, `irpf_anual`, `irpf_conjunta` on a
grid: the TS port must match them to 0.01 €.

Run from plus/python: .venv\\Scripts\\python -m planner.export_ts
tests/test_export_ts.py fails if the export is stale.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from itertools import product
from pathlib import Path

import numpy as np

from planner.tax import (
    Discapacidad,
    Familiar,
    Mitades,
    Persona,
    RentasMiembro,
    actividad,
    available_years,
    irpf_anual,
    irpf_conjunta,
    load_irpf_rules,
    minimo_conjunta,
    minimo_personal_familiar,
)

ADDON_TAX_DIR = Path(__file__).resolve().parents[3] / "addon" / "src" / "es-tax"
RULES_OUT = ADDON_TAX_DIR / "rules"
FIXTURES_OUT = ADDON_TAX_DIR / "fixtures" / "golden.json"


def _json(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=1) + "\n"


def rules_files() -> dict[Path, str]:
    return {
        RULES_OUT / f"{y}.json": _json(load_irpf_rules(y).model_dump(mode="json"))
        for y in available_years()
    }


def _persona(p: Persona) -> dict:
    return {"edad": p.edad, "discapacidad": str(p.discapacidad), "asistencia": p.asistencia}


def _familiar(f: Familiar) -> dict:
    return _persona(f) | {"renta_anual": f.renta_anual, "share": f.share}


def _plain(x):
    if isinstance(x, np.ndarray):
        return x.tolist()
    if isinstance(x, Mitades):
        return {"estatal": x.estatal, "autonomica": x.autonomica}
    return x


def _irpf_out(res) -> dict:
    return {k: _plain(getattr(res, k)) for k in res.__dataclass_fields__}


INGRESOS = [0, 6_000, 14_000, 22_000, 35_000, 50_000, 75_000, 120_000, 250_000]
GASTOS_RATIO = [0.0, 0.3, 1.2]  # 1.2 — a loss

HOGARES = {
    "solo_40": ([Persona(edad=40)], [], []),
    "solo_70_disc": ([Persona(edad=70, discapacidad=Discapacidad.GRADO_33)], [], []),
    "hijos_mitad": (
        [Persona(edad=38)],
        [Familiar(edad=6, share=0.5), Familiar(edad=1, share=0.5)],
        [],
    ),
    "hijos_y_ascendiente": (
        [Persona(edad=45)],
        [Familiar(edad=10), Familiar(edad=15), Familiar(edad=19), Familiar(edad=24)],
        [Familiar(edad=80, discapacidad=Discapacidad.GRADO_65)],
    ),
}

PAREJAS = {
    "pareja_40": ([Persona(edad=40), Persona(edad=42)], [], []),
    "pareja_hijos": (
        [Persona(edad=36), Persona(edad=66, discapacidad=Discapacidad.GRADO_65)],
        [Familiar(edad=2), Familiar(edad=7), Familiar(edad=30, renta_anual=9_000)],
        [],
    ),
}

AHORRO = [(0.0, 0.0), (1_200.0, -3_000.0), (-500.0, 8_000.0)]  # (rcm, ganancias)


def _actividad_cases(year: int, rules) -> list[dict]:
    cases = []
    for ingresos, ratio, dificil in product(INGRESOS, GASTOS_RATIO, (True, False)):
        gastos = ingresos * ratio
        a = actividad(ingresos, gastos, rules, gastos_dificil=dificil)
        cases.append(
            {
                "year": year,
                "input": {"ingresos": ingresos, "gastos": gastos, "gastos_dificil": dificil},
                "expected": asdict(a),
            }
        )
    for base in (1_000.0, 3_000.0):  # base elegida — clamped to the tramo
        a = actividad(60_000, 10_000, rules, base_elegida=base)
        cases.append(
            {
                "year": year,
                "input": {"ingresos": 60_000, "gastos": 10_000, "base_elegida": base},
                "expected": asdict(a),
            }
        )
    return cases


def _hogar_json(contribuyentes, desc, asc) -> dict:
    return {
        "contribuyentes": [_persona(p) for p in contribuyentes],
        "descendientes": [_familiar(f) for f in desc],
        "ascendientes": [_familiar(f) for f in asc],
    }


def _individual_cases(year: int, rules) -> list[dict]:
    cases = []
    for (name, (conts, desc, asc)), ingresos, (rcm, gan) in product(
        HOGARES.items(), INGRESOS, AHORRO
    ):
        minimo = minimo_personal_familiar(conts[0], rules, desc, asc)
        rn = actividad(ingresos, ingresos * 0.3, rules).rendimiento_neto
        kwargs = {
            "rendimiento_actividad": rn,
            "rcm": rcm,
            "ganancias": gan,
            "aportacion_pensiones": 1_000.0 if ingresos > 20_000 else 0.0,
            "aportacion_pensiones_autonomo": 5_000.0 if ingresos > 60_000 else 0.0,
        }
        res = irpf_anual(rules, minimo, **kwargs)
        cases.append(
            {
                "year": year,
                "hogar": name,
                "hogar_input": _hogar_json(conts, desc, asc),
                "input": kwargs,
                "expected": _irpf_out(res),
            }
        )
    # Pension plan payouts and pensions: otros gastos 19.2.f and reducción art. 20 by segment.
    conts = [Persona(edad=70, discapacidad=Discapacidad.GRADO_33)]
    minimo = minimo_personal_familiar(conts[0], rules)
    for integro, rn, (rcm, gan) in product(
        (1_500.0, 9_000.0, 14_852.0, 16_500.0, 18_500.0, 30_000.0), (0.0, 3_000.0), AHORRO
    ):
        kwargs = {
            "trabajo_integro": integro,
            "rendimiento_actividad": rn,
            "rcm": rcm,
            "ganancias": gan,
        }
        res = irpf_anual(rules, minimo, **kwargs)
        cases.append(
            {
                "year": year,
                "hogar": "solo_70_disc",
                "hogar_input": _hogar_json(conts, [], []),
                "input": kwargs,
                "expected": _irpf_out(res),
            }
        )
    # Special modes: dependiente, inicio_actividad, deducciones.
    minimo = minimo_personal_familiar(Persona(edad=40), rules)
    for rn, flags in product(
        (9_000.0, 16_000.0, 40_000.0),
        (
            {"dependiente": True},
            {"dependiente": True, "discapacidad": "grado_33"},
            {"inicio_actividad": True},
            {"deducciones": {"estatal": 300.0, "autonomica": 150.0}},
        ),
    ):
        kw = dict(flags)
        if "discapacidad" in kw:
            kw["discapacidad"] = Discapacidad(kw["discapacidad"])
        if "deducciones" in kw:
            kw["deducciones"] = Mitades(**kw["deducciones"])
        res = irpf_anual(rules, minimo, rendimiento_actividad=rn, **kw)
        cases.append(
            {
                "year": year,
                "hogar": "solo_40",
                "hogar_input": _hogar_json([Persona(edad=40)], [], []),
                "input": {"rendimiento_actividad": rn, **flags},
                "expected": _irpf_out(res),
            }
        )
    return cases


def _cadena_cases(year: int, rules) -> list[dict]:
    """Several years in a row with loss carry-forward: pendientes from year to year."""
    minimo = minimo_personal_familiar(Persona(edad=40), rules)
    anos = [
        {"rendimiento_actividad": -6_000.0, "rcm": -800.0, "ganancias": -2_000.0},
        {"rendimiento_actividad": 3_000.0, "rcm": 400.0, "ganancias": 500.0},
        {"rendimiento_actividad": 30_000.0, "rcm": 1_000.0, "ganancias": 6_000.0},
        {"rendimiento_actividad": 30_000.0, "rcm": 0.0, "ganancias": -9_000.0},
        {"rendimiento_actividad": 30_000.0, "rcm": 5_000.0, "ganancias": 0.0},
        {"rendimiento_actividad": 30_000.0, "rcm": 0.0, "ganancias": 20_000.0},
    ]
    pg = pa = None
    out = []
    for kw in anos:
        res = irpf_anual(rules, minimo, **kw, pendientes_general=pg, pendientes_ahorro=pa)
        pg, pa = res.pendientes_general, res.pendientes_ahorro
        out.append({"input": kw, "expected": _irpf_out(res)})
    return [{"year": year, "hogar_input": _hogar_json([Persona(edad=40)], [], []), "anos": out}]


def _conjunta_cases(year: int, rules) -> list[dict]:
    cases = []
    for (name, (conyuges, desc, asc)), (ing1, ing2), (rcm, gan) in product(
        PAREJAS.items(),
        ((0, 0), (14_000, 0), (35_000, 14_000), (75_000, 50_000), (250_000, 6_000)),
        AHORRO,
    ):
        minimo = minimo_conjunta(conyuges, rules, desc, asc)
        miembros = [
            RentasMiembro(
                rendimiento_actividad=actividad(ing1, ing1 * 0.3, rules).rendimiento_neto,
                rcm=rcm,
                ganancias=gan,
                aportacion_pensiones=1_500.0,
            ),
            RentasMiembro(
                rendimiento_actividad=actividad(ing2, ing2 * 0.3, rules).rendimiento_neto,
                aportacion_pensiones_autonomo=4_000.0,
                trabajo_integro=9_000.0 if ing2 == 0 else 0.0,
            ),
        ]
        res = irpf_conjunta(rules, minimo, miembros)
        cases.append(
            {
                "year": year,
                "hogar": name,
                "hogar_input": _hogar_json(conyuges, desc, asc),
                "miembros": [asdict(m) for m in miembros],
                "expected": _irpf_out(res),
            }
        )
    return cases


INDEX_FACTORS = [1.0, 1.1, 1.3721]


def _indexed_cases(year: int, rules) -> list[dict]:
    """IrpfRules.indexed: the projection of the rules to later years when a plan indexes them."""
    return [
        {"year": year, "factor": f, "expected": rules.indexed(f).model_dump(mode="json")}
        for f in INDEX_FACTORS
    ]


def fixtures() -> dict:
    out: dict[str, list] = {
        "actividad": [],
        "irpf_anual": [],
        "irpf_cadena": [],
        "irpf_conjunta": [],
        "rules_indexed": [],
    }
    for year in available_years():
        rules = load_irpf_rules(year)
        out["actividad"] += _actividad_cases(year, rules)
        out["irpf_anual"] += _individual_cases(year, rules)
        out["irpf_cadena"] += _cadena_cases(year, rules)
        out["irpf_conjunta"] += _conjunta_cases(year, rules)
        out["rules_indexed"] += _indexed_cases(year, rules)
    return out


def all_files() -> dict[Path, str]:
    compact = json.dumps(fixtures(), ensure_ascii=False, separators=(",", ":")) + "\n"
    return rules_files() | {FIXTURES_OUT: compact}


def main() -> None:
    for path, text in all_files().items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
        print(path)


if __name__ == "__main__":
    main()
