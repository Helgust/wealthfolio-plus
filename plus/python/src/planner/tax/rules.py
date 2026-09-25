"""IRPF tax rules for a year as a typed object + projection to future years.

Numbers live only in rules/<year>/*.yaml. For a year missing from rules/, the latest available
year is used; whether to index its thresholds to inflation is a scenario decision (Spanish scales
are not indexed automatically), so only the `indexed(factor)` mechanism lives here.
"""

from __future__ import annotations

from functools import cache
from itertools import pairwise
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

from planner.tax.scale import RULES_DIR, Scale, load_rules


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class DiscapacidadAmounts(_Frozen):
    grado_33: float
    grado_65: float
    asistencia: float


class ContribuyenteAmounts(_Frozen):
    general: float
    mayor_65: float
    mayor_75: float


class DescendientesAmounts(_Frozen):
    por_orden: list[float]  # the last element is for the 4th and all following
    menor_3: float


class AscendientesAmounts(_Frozen):
    general: float
    mayor_75: float


class MinimoAmounts(_Frozen):
    """Mínimo personal y familiar amounts of one IRPF half."""

    contribuyente: ContribuyenteAmounts
    descendientes: DescendientesAmounts
    ascendientes: AscendientesAmounts
    discapacidad: DiscapacidadAmounts

    def scaled(self, f: float) -> MinimoAmounts:
        c, d, a, x = self.contribuyente, self.descendientes, self.ascendientes, self.discapacidad
        return MinimoAmounts(
            contribuyente=ContribuyenteAmounts(
                general=c.general * f, mayor_65=c.mayor_65 * f, mayor_75=c.mayor_75 * f
            ),
            descendientes=DescendientesAmounts(
                por_orden=[v * f for v in d.por_orden], menor_3=d.menor_3 * f
            ),
            ascendientes=AscendientesAmounts(general=a.general * f, mayor_75=a.mayor_75 * f),
            discapacidad=DiscapacidadAmounts(
                grado_33=x.grado_33 * f, grado_65=x.grado_65 * f, asistencia=x.asistencia * f
            ),
        )


class MinimoConditions(_Frozen):
    edad_mayor_65: int
    edad_mayor_75: int
    descendiente_edad_max: int
    descendiente_menor: int
    renta_max_familiar: float


class IrpfHalf(_Frozen):
    """One IRPF half: general and savings base scales + mínimo amounts."""

    general: Scale
    ahorro: Scale
    minimos: MinimoAmounts

    def indexed(self, f: float) -> IrpfHalf:
        return IrpfHalf(
            general=self.general.scaled(f),
            ahorro=self.ahorro.scaled(f),
            minimos=self.minimos.scaled(f),
        )


class GastosDificilJustificacion(_Frozen):
    rate: float  # share of rendimiento neto (without this concepto itself)
    limit: float  # euros per year


class ActividadRules(_Frozen):
    """Rendimiento neto de actividades económicas, estimación directa simplificada."""

    gastos_dificil_justificacion: GastosDificilJustificacion

    def indexed(self, f: float) -> ActividadRules:
        g = self.gastos_dificil_justificacion
        return ActividadRules(
            gastos_dificil_justificacion=g.model_copy(update={"limit": g.limit * f})
        )


class RetaTramo(_Frozen):
    """Tramo de rendimientos netos. All amounts are euros per month."""

    tabla: Literal["reducida", "general"]
    tramo: int
    upto: float | None  # upper bound of the rendimiento; None — unbounded
    inclusive: bool = True  # «≤ upto»; False — «< upto»
    base_min: float
    base_max: float

    @property
    def label(self) -> str:
        return f"{self.tabla} {self.tramo}"


class RetaTipos(_Frozen):
    contingencias_comunes: float
    contingencias_profesionales: float
    cese_actividad: float
    formacion_profesional: float
    mei: float

    @property
    def total(self) -> float:
        return sum(self.model_dump().values())


class RetaRules(_Frozen):
    """Cotización RETA por rendimientos reales (art. 308 LGSS)."""

    gastos_genericos: float  # deducción from rendimiento computable
    base_maxima: float  # euros per month
    tipos: RetaTipos
    tramos: list[RetaTramo]  # ascending by rendimientos: reducida 1–3, general 1–12

    @model_validator(mode="after")
    def _check_tramos(self) -> RetaRules:
        uptos = [t.upto for t in self.tramos]
        if uptos[-1] is not None or None in uptos[:-1]:
            raise ValueError("only the last tramo may have no upper bound")
        if any(a >= b for a, b in pairwise(uptos[:-1])):
            raise ValueError("tramo bounds must be strictly increasing")
        # Bases must not decrease across tramos so the tramo choice is unique (autonomo.reta).
        for key in ("base_min", "base_max"):
            vals = [getattr(t, key) for t in self.tramos]
            if any(a > b for a, b in pairwise(vals)):
                raise ValueError(f"{key} must not decrease across tramos")
        return self

    def indexed(self, f: float) -> RetaRules:
        return self.model_copy(
            update={
                "base_maxima": self.base_maxima * f,
                "tramos": [
                    t.model_copy(
                        update={
                            "upto": None if t.upto is None else t.upto * f,
                            "base_min": t.base_min * f,
                            "base_max": t.base_max * f,
                        }
                    )
                    for t in self.tramos
                ],
            }
        )


def _scaled(m: _Frozen, f: float, *fields: str) -> _Frozen:
    """Copy of the model with the money fields in fields multiplied by f."""
    return m.model_copy(update={k: getattr(m, k) * f for k in fields})


class ReduccionAdicional(_Frozen):
    rend_max: float
    otras_rentas_max: float
    plano_hasta: float
    importe: float
    pendiente: float


class ReduccionDependiente(_Frozen):
    """Art. 32.2.1º LIRPF."""

    general: float
    adicional: ReduccionAdicional
    discapacidad_33: float
    discapacidad_65: float


class ReduccionRentasBajas(_Frozen):
    """Art. 32.2.3º LIRPF."""

    rentas_max: float
    plano_hasta: float
    importe: float
    pendiente: float


class ReduccionInicio(_Frozen):
    """Art. 32.3 LIRPF."""

    rate: float
    base_max: float


class ReduccionesActividad(_Frozen):
    dependiente: ReduccionDependiente
    rentas_bajas: ReduccionRentasBajas
    inicio_actividad: ReduccionInicio

    def indexed(self, f: float) -> ReduccionesActividad:
        d, a = self.dependiente, self.dependiente.adicional
        return ReduccionesActividad(
            dependiente=ReduccionDependiente(
                general=d.general * f,
                adicional=_scaled(a, f, "rend_max", "otras_rentas_max", "plano_hasta", "importe"),
                discapacidad_33=d.discapacidad_33 * f,
                discapacidad_65=d.discapacidad_65 * f,
            ),
            rentas_bajas=_scaled(self.rentas_bajas, f, "rentas_max", "plano_hasta", "importe"),
            inicio_actividad=_scaled(self.inicio_actividad, f, "base_max"),
        )


class PrevisionSocial(_Frozen):
    """Limits of the reducción por aportaciones a planes de pensiones (arts. 51.6, 52.1)."""

    limite_general: float
    incremento_autonomo: float
    porcentaje_rendimientos: float

    def indexed(self, f: float) -> PrevisionSocial:
        return _scaled(self, f, "limite_general", "incremento_autonomo")


class ReduccionTrabajo(_Frozen):
    """Art. 20 LIRPF: three segments — a plateau, then two linear declines to 0 at rend_max."""

    rend_max: float
    otras_rentas_max: float
    plano_hasta: float
    importe: float
    pendiente: float
    quiebra: float
    importe_quiebra: float
    pendiente_quiebra: float


class Trabajo(_Frozen):
    """Rendimientos del trabajo: otros gastos (art. 19.2.f) and reducción art. 20."""

    otros_gastos: float
    reduccion: ReduccionTrabajo

    def indexed(self, f: float) -> Trabajo:
        return Trabajo(
            otros_gastos=self.otros_gastos * f,
            reduccion=_scaled(
                self.reduccion,
                f,
                "rend_max",
                "otras_rentas_max",
                "plano_hasta",
                "importe",
                "quiebra",
                "importe_quiebra",
            ),
        )


class Compensacion(_Frozen):
    """Compensación de rentas negativas (arts. 48–50)."""

    limite_cruzado: float
    anos: int


class TributacionConjunta(_Frozen):
    """Art. 84.2.3º LIRPF."""

    reduccion_biparental: float


class Reducciones(_Frozen):
    actividad: ReduccionesActividad
    trabajo: Trabajo
    prevision_social: PrevisionSocial
    compensacion: Compensacion
    tributacion_conjunta: TributacionConjunta

    def indexed(self, f: float) -> Reducciones:
        return Reducciones(
            actividad=self.actividad.indexed(f),
            trabajo=self.trabajo.indexed(f),
            prevision_social=self.prevision_social.indexed(f),
            compensacion=self.compensacion,
            tributacion_conjunta=_scaled(self.tributacion_conjunta, f, "reduccion_biparental"),
        )


class IrpfRules(_Frozen):
    """All tax rules of a year: IRPF (two halves, mínimos, actividad, reducciones) and RETA."""

    year: int  # year the rules come from (not necessarily the tax year)
    estatal: IrpfHalf
    autonomica: IrpfHalf
    condiciones: MinimoConditions
    actividad: ActividadRules
    reducciones: Reducciones
    reta: RetaRules

    def indexed(self, f: float) -> IrpfRules:
        """All money thresholds × f (ages are left alone). f=1 — rules as is."""
        if f == 1.0:
            return self
        c = self.condiciones
        return IrpfRules(
            year=self.year,
            estatal=self.estatal.indexed(f),
            autonomica=self.autonomica.indexed(f),
            condiciones=c.model_copy(update={"renta_max_familiar": c.renta_max_familiar * f}),
            actividad=self.actividad.indexed(f),
            reducciones=self.reducciones.indexed(f),
            reta=self.reta.indexed(f),
        )


def available_years() -> list[int]:
    return sorted(int(p.name) for p in RULES_DIR.iterdir() if p.is_dir() and p.name.isdigit())


@cache
def load_irpf_rules(year: int) -> IrpfRules:
    """Rules for exactly year. FileNotFoundError if rules/<year>/ is not filled in."""
    ahorro = load_rules(year, "ahorro")
    minimos = load_rules(year, "minimos")
    return IrpfRules(
        year=year,
        estatal=IrpfHalf(
            general=Scale(brackets=load_rules(year, "general_estatal")["scale"]),
            ahorro=Scale(brackets=ahorro["estatal"]),
            minimos=minimos["estatal"],
        ),
        autonomica=IrpfHalf(
            general=Scale(brackets=load_rules(year, "general_valencia")["scale"]),
            ahorro=Scale(brackets=ahorro["autonomica"]),
            minimos=minimos["autonomica"],
        ),
        condiciones=minimos["condiciones"],
        actividad=load_rules(year, "actividad")["estimacion_directa_simplificada"],
        reducciones=load_rules(year, "reducciones"),
        reta=load_rules(year, "reta"),
    )


def rules_for_year(year: int) -> IrpfRules:
    """Rules for computing year: that year or the latest available before it.

    Future years get the frozen rules of the last known year; indexing (if the scenario
    wants it) is done by the caller via `.indexed(factor)`.
    """
    past = [y for y in available_years() if y <= year]
    if not past:
        raise ValueError(f"no tax rules for {year} or earlier (available: {available_years()})")
    return load_irpf_rules(past[-1])
