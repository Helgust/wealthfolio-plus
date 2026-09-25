"""Real estate in IRPF and the taxes on buying a home (rules/<year>/inmuebles.yaml)."""

from __future__ import annotations

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
