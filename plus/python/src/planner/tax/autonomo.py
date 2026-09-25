"""Autónomo: rendimiento neto (estimación directa simplificada) and the RETA cuota for a year.

Everything is computed for a full year in alta; amounts are yearly, except the RETA base
(euros per month, as in the tables). Arguments are numbers or numpy arrays of the same shape
(trajectories).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from planner.tax.rules import ActividadRules, IrpfRules, RetaRules


def _out(x):
    return float(x) if np.ndim(x) == 0 else x


def gastos_dificil_justificacion(rendimiento_previo, rules: ActividadRules):
    """Provisiones + gastos de difícil justificación (art. 30.2.2.ª RIRPF).

    Percentage of the positive rendimiento neto "without this concepto", capped at the limit.
    """
    g = rules.gastos_dificil_justificacion
    return _out(np.minimum(g.rate * np.maximum(rendimiento_previo, 0.0), g.limit))


def rendimiento_neto(ingresos, gastos, rules: ActividadRules, gastos_dificil: bool = True):
    """IRPF rendimiento neto in estimación directa simplificada.

    gastos — all deductible expenses of the year, including the RETA cuota (a gasto deducible).
    gastos_dificil=False — without gastos de difícil justificación (required with reducción
    art. 32.2.1º LIRPF). May be negative.
    """
    previo = np.asarray(ingresos, dtype=float) - gastos
    if not gastos_dificil:
        return _out(previo)
    return _out(previo - gastos_dificil_justificacion(previo, rules))


def reta_tramo(rendimiento_mensual, rules: RetaRules):
    """Index of the tramo in `rules.tramos` for a monthly rendimiento computable."""
    r = np.asarray(rendimiento_mensual, dtype=float)[..., None]
    bounds = rules.tramos[:-1]
    uppers = np.array([t.upto for t in bounds])
    inclusive = np.array([t.inclusive for t in bounds])
    # Tramo number = how many upper bounds the rendimiento has already exceeded.
    exceeded = np.where(inclusive, r > uppers, r >= uppers)
    idx = exceeded.sum(axis=-1)
    return int(idx) if np.ndim(rendimiento_mensual) == 0 else idx


@dataclass(frozen=True, slots=True)
class Actividad:
    """Year result of the autónomo activity. Fields are numbers or arrays (trajectories)."""

    ingresos: float
    gastos: float  # excluding RETA
    cuota_reta: float  # per year
    gastos_dificil_justificacion: float
    rendimiento_neto: float  # IRPF, goes to the general base
    rendimiento_computable: float  # for RETA, per year (after gastos genéricos)
    reta_tramo: int  # index into rules.reta.tramos
    reta_base: float  # euros per month


def actividad(
    ingresos, gastos, rules: IrpfRules, base_elegida=None, gastos_dificil: bool = True
) -> Actividad:
    """Rendimiento neto and RETA cuota for the year, accounting for their mutual dependency.

    The RETA cuota is a gasto deducible, so it lowers the rendimiento neto; the RETA tramo is
    chosen by rendimiento computable = (rendimiento neto + RETA cuota) × (1 − gastos genéricos)
    / 12 (art. 308.1.c LGSS). The loop is broken by enumeration: for each tramo k compute the
    cuota from its base and check that the rendimiento falls into the same tramo k.
    The chosen tramo does not decrease with k (higher cuota → lower gastos de difícil
    justificación → higher rendimiento computable), so a consistent tramo always exists; the
    smallest one is taken.

    base_elegida — monthly base chosen by the autónomo (None — the minimum). After
    regularización it is clamped to [base_min, base_max] of the actual tramo.
    gastos — expenses excluding the RETA cuota. gastos_dificil — see `rendimiento_neto`.
    """
    reta = rules.reta
    ingresos_arr = np.asarray(ingresos, dtype=float)
    antes_reta = (ingresos_arr - np.asarray(gastos, dtype=float))[..., None]  # (..., 1)

    mins = np.array([t.base_min for t in reta.tramos])
    maxs = np.array([t.base_max for t in reta.tramos])
    base_k = mins if base_elegida is None else np.clip(base_elegida, mins, maxs)
    cuota_k = base_k * 12 * reta.tipos.total  # (K,)

    neto_k = rendimiento_neto(antes_reta, cuota_k, rules.actividad, gastos_dificil)  # (..., K)
    computable_k = (neto_k + cuota_k) * (1 - reta.gastos_genericos)
    consistent = reta_tramo(computable_k / 12, reta) == np.arange(len(reta.tramos))
    k = np.argmax(consistent, axis=-1)  # first consistent tramo

    def pick(a):
        a = np.broadcast_to(a, consistent.shape)
        return _out(np.take_along_axis(a, np.asarray(k)[..., None], axis=-1)[..., 0])

    neto = pick(neto_k)
    cuota = pick(cuota_k)
    return Actividad(
        ingresos=_out(ingresos_arr),
        gastos=_out(np.asarray(gastos, dtype=float)),
        cuota_reta=cuota,
        gastos_dificil_justificacion=_out(
            np.asarray(ingresos_arr - gastos - cuota - neto, dtype=float)
        ),
        rendimiento_neto=neto,
        rendimiento_computable=pick(computable_k),
        reta_tramo=int(k) if np.ndim(k) == 0 else k,
        reta_base=pick(base_k),
    )
