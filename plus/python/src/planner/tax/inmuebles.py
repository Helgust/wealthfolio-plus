"""Real estate in IRPF — imputación, rentals, the vivienda habitual exemptions — and the taxes on
buying a home (rules/<year>/inmuebles.yaml)."""

from __future__ import annotations

from dataclasses import dataclass

from planner.tax.rules import Inmuebles


def imputacion_renta(
    valor_catastral: float | None,
    rules: Inmuebles,
    *,
    revisado: bool = False,
    precio_adquisicion: float = 0.0,
    dias: int = 365,
    dias_ano: int = 365,
) -> float:
    """Renta imputada (art. 85 LIRPF) of a property that is not the vivienda habitual, not rented
    and not used in an activity; it goes to the renta general (art. 45).

    revisado — the municipality's valores catastrales were revised in the year or the ten before.
    valor_catastral None — the property has none: the rate applies to a share of the acquisition
    price. dias — days of the year the property was owned.
    """
    i = rules.imputacion
    if valor_catastral is None:
        base, rate = precio_adquisicion * i.base_sin_valor_catastral, i.sin_valor_catastral
    else:
        base, rate = valor_catastral, i.revisado if revisado else i.general
    return base * rate * dias / dias_ano


def ganancia_exenta_vivienda(
    ganancia: float,
    valor_transmision: float,
    prestamo_pendiente: float,
    reinvertido: float,
    edad: int,
    rules: Inmuebles,
) -> float:
    """Exempt part of the gain on selling the vivienda habitual.

    All of it when the seller is at least exencion_mayores.edad (art. 33.4.b LIRPF). Otherwise the
    share reinvested in a new vivienda habitual (art. 38.1 LIRPF, art. 41 RIRPF) of the amount
    obtained — valor de transmisión minus the loan principal still owed.
    """
    if ganancia <= 0:
        return 0.0
    if edad >= rules.exencion_mayores.edad:
        return ganancia
    if reinvertido <= 0:
        return 0.0
    obtenido = valor_transmision - prestamo_pendiente
    if obtenido <= 0:
        return ganancia
    return ganancia * min(reinvertido / obtenido, 1.0)


def impuesto_compra_vivienda(
    precio: float, *, nueva: bool, habitual: bool, rules: Inmuebles
) -> float:
    """Taxes on buying a home. A new one: IVA and AJD on the deed (the reduced AJD rate for the
    vivienda habitual). A second-hand one: ITP, the high-value rate on the whole price above its
    threshold. Reduced ITP rates (VPO, first home of those under 35) are not modelled.
    """
    if nueva:
        ajd = rules.ajd.vivienda_habitual if habitual else rules.ajd.general
        return precio * (rules.iva_vivienda + ajd)
    itp = rules.itp
    return precio * (itp.alto_valor if precio > itp.alto_valor_desde else itp.general)


REDUCCIONES_ARRENDAMIENTO = (
    "general",
    "rehabilitacion",
    "joven_o_social",
    "rebaja_tensionada",
    "anterior_2023",
)


def amortizacion_inmueble(
    coste_adquisicion: float, valor_catastral: float | None, construccion: float, rules: Inmuebles
) -> float:
    """Amortización of a rented home for a year (art. 23.1.b LIRPF): a share of the greater of the
    acquisition cost (price plus taxes and costs of the purchase) and the valor catastral, without
    the land. construccion — share of the building in the valor catastral (IBI receipt), applied to
    both values.
    """
    base = max(coste_adquisicion, valor_catastral or 0.0) * construccion
    return base * rules.arrendamiento.amortizacion


@dataclass(frozen=True, slots=True)
class Arrendamiento:
    """Rendimiento del capital inmobiliario of one home let for a year."""

    ingresos: float
    financiacion_reparacion: float  # interest and repairs deducted, prior years' first
    otros_gastos: float
    amortizacion: float
    rendimiento_neto: float
    reduccion: float
    rendimiento_neto_reducido: float
    pendientes: list[float]  # not yet deducted, by year of origin, oldest first (anos_exceso)


def rendimiento_arrendamiento(
    ingresos: float,
    rules: Inmuebles,
    *,
    financiacion_reparacion: float = 0.0,
    otros_gastos: float = 0.0,
    amortizacion: float = 0.0,
    reduccion: str = "general",
    pendientes: list[float] | None = None,
) -> Arrendamiento:
    """Rendimiento neto reducido from letting a home (arts. 22–23 LIRPF).

    financiacion_reparacion — interest and other financing costs of the loan on the home, repairs
    and maintenance: together with prior years' excess they are deducted up to the ingresos
    (23.1.a.1º); the law sets no order, prior years' go first, the oldest first, so that the least
    expires.
    otros_gastos — IBI and other taxes, comunidad, insurance, services: no limit, they can make the
    rendimiento negative. reduccion — a key of rules.arrendamiento.reduccion (art. 23.2, DT 38ª); it
    applies to a positive rendimiento only. pendientes — the state from the previous year.
    """
    a = rules.arrendamiento
    previos = list(pendientes) if pendientes is not None else [0.0] * a.anos_exceso
    limite = max(ingresos, 0.0)
    restantes = []
    for p in previos:
        usado = min(p, limite)
        limite -= usado
        restantes.append(p - usado)
    del_ano = min(financiacion_reparacion, limite)
    deducido = sum(previos) - sum(restantes) + del_ano
    rn = ingresos - deducido - otros_gastos - amortizacion
    red = getattr(a.reduccion, reduccion) * max(rn, 0.0)
    return Arrendamiento(
        ingresos=ingresos,
        financiacion_reparacion=deducido,
        otros_gastos=otros_gastos,
        amortizacion=amortizacion,
        rendimiento_neto=rn,
        reduccion=red,
        rendimiento_neto_reducido=rn - red,
        pendientes=[*restantes[1:], financiacion_reparacion - del_ano],
    )
