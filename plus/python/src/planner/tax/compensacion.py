"""Compensación de rentas negativas with carry-forward to later years (arts. 49 and 50.3 LIRPF).

The carry-forward state is an array of loss amounts (positive numbers) by year of origin,
oldest first; the last axis has length `anos` (4). For the savings base there is one more axis
before it with two baskets: [RCM — rendimientos del capital mobiliario, GP — ganancias y pérdidas].
Functions return the new state for the next year: the oldest year drops out, the current year's
unused losses are appended.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from planner.tax.rules import Compensacion

RCM, GP = 0, 1


def _out(x):
    return float(x) if np.ndim(x) == 0 else x


def pendientes_vacios(rules: Compensacion, shape: tuple[int, ...] = (), ahorro: bool = True):
    """Empty carry-forward state: (..., 2, anos) for ahorro or (..., anos) for general."""
    return np.zeros((*shape, 2, rules.anos) if ahorro else (*shape, rules.anos))


def _consumir(importe, pendientes):
    """Consumes up to importe from pendientes (oldest first); returns the amount used per basket."""
    importe = np.asarray(importe, dtype=float)[..., None]
    antes = np.cumsum(pendientes, axis=-1) - pendientes
    return np.clip(importe - antes, 0.0, pendientes)


def _avanzar(pendientes, nuevas):
    """Shifts one year: the oldest year drops out, the current year's losses go to the end."""
    return np.concatenate([pendientes[..., 1:], np.asarray(nuevas)[..., None]], axis=-1)


@dataclass(frozen=True, slots=True)
class BaseAhorro:
    base_imponible: float
    compensado_anteriores: float  # prior-year losses used this year
    pendientes: np.ndarray  # state for the next year, (..., 2, anos)


def base_imponible_ahorro(rcm, ganancias, pendientes, rules: Compensacion) -> BaseAhorro:
    """Base imponible del ahorro for the year with loss offsetting (art. 49; order per the
    Manual práctico).

    rcm — saldo of rendimientos del capital mobiliario (interest, dividends); may be < 0.
    ganancias — saldo of ganancias y pérdidas patrimoniales for the year; may be < 0.

    Step 1: a negative saldo in one basket is offset by the other basket's positive saldo, but by
    no more than limite_cruzado of it. Step 2: prior-year losses are offset against their own
    basket in full first, then against the other within what is left of the same limite_cruzado
    (shared with step 1).
    """
    rcm = np.asarray(rcm, dtype=float)
    gp = np.asarray(ganancias, dtype=float)
    pend = np.array(pendientes, dtype=float, copy=True)
    lim = rules.limite_cruzado

    disponible = {RCM: np.maximum(rcm, 0.0), GP: np.maximum(gp, 0.0)}
    # How much of the other basket's losses can be offset here (25 % of its positive saldo).
    cupo = {k: lim * v for k, v in disponible.items()}
    otra = {RCM: GP, GP: RCM}

    # Step 1: current-year losses are offset by the other basket within cupo.
    nuevas = {}
    for k, saldo in ((RCM, rcm), (GP, gp)):
        perdida = np.maximum(-saldo, 0.0)
        c = np.minimum(perdida, cupo[otra[k]])
        disponible[otra[k]] = disponible[otra[k]] - c
        cupo[otra[k]] = cupo[otra[k]] - c
        nuevas[k] = perdida - c

    def compensar(k_perdida: int, k_saldo: int, tope) -> np.ndarray:
        usado = _consumir(tope, pend[..., k_perdida, :])
        pend[..., k_perdida, :] -= usado
        s = usado.sum(axis=-1)
        disponible[k_saldo] = disponible[k_saldo] - s
        return s

    # Step 2.1: prior-year losses — against their own basket without limit.
    total = compensar(RCM, RCM, disponible[RCM]) + compensar(GP, GP, disponible[GP])
    # Step 2.2: the rest — against the other basket within the remaining cupo.
    total = total + compensar(RCM, GP, np.minimum(disponible[GP], cupo[GP]))
    total = total + compensar(GP, RCM, np.minimum(disponible[RCM], cupo[RCM]))

    shape = np.broadcast_shapes(rcm.shape, gp.shape)
    nuevas_arr = np.stack([np.broadcast_to(nuevas[k], shape) for k in (RCM, GP)], axis=-1)
    return BaseAhorro(
        base_imponible=_out(disponible[RCM] + disponible[GP]),
        compensado_anteriores=_out(total),
        pendientes=_avanzar(pend, nuevas_arr),
    )


@dataclass(frozen=True, slots=True)
class BaseGeneral:
    base_liquidable: float  # after offsetting prior negative bases, ≥ 0
    compensado_anteriores: float
    pendientes: np.ndarray  # (..., anos)


def compensar_base_liquidable_general(base_liquidable, pendientes, rules: Compensacion):
    """A negative base liquidable general is carried forward 4 years (art. 50.3 LIRPF)."""
    blg = np.asarray(base_liquidable, dtype=float)
    pend = np.asarray(pendientes, dtype=float)
    positiva = np.maximum(blg, 0.0)
    usado = _consumir(positiva, pend)
    s = usado.sum(axis=-1)
    return BaseGeneral(
        base_liquidable=_out(positiva - s),
        compensado_anteriores=_out(s),
        pendientes=_avanzar(pend - usado, np.maximum(-blg, 0.0)),
    )
