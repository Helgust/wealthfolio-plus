"""Autónomo: rendimiento neto (estimación directa simplificada) и cuota RETA за год.

Всё считается за полный год в alta; суммы годовые, кроме базы RETA (евро в месяц,
как в таблицах). Аргументы — числа или numpy-массивы одинаковой формы (траектории).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from planner.tax.rules import ActividadRules, IrpfRules, RetaRules


def _out(x):
    return float(x) if np.ndim(x) == 0 else x


def gastos_dificil_justificacion(rendimiento_previo, rules: ActividadRules):
    """Provisiones + gastos de difícil justificación (art. 30.2.2.ª RIRPF).

    Процент от положительного rendimiento neto «без этого concepto», не больше лимита.
    """
    g = rules.gastos_dificil_justificacion
    return _out(np.minimum(g.rate * np.maximum(rendimiento_previo, 0.0), g.limit))


def rendimiento_neto(ingresos, gastos, rules: ActividadRules, gastos_dificil: bool = True):
    """Rendimiento neto IRPF в estimación directa simplificada.

    gastos — все вычитаемые расходы года, включая cuota RETA (она gasto deducible).
    gastos_dificil=False — без gastos de difícil justificación (обязательно при reducción
    art. 32.2.1º LIRPF). Может быть отрицательным.
    """
    previo = np.asarray(ingresos, dtype=float) - gastos
    if not gastos_dificil:
        return _out(previo)
    return _out(previo - gastos_dificil_justificacion(previo, rules))


def reta_tramo(rendimiento_mensual, rules: RetaRules):
    """Индекс tramo в `rules.tramos` для rendimiento computable в месяц."""
    r = np.asarray(rendimiento_mensual, dtype=float)[..., None]
    bounds = rules.tramos[:-1]
    uppers = np.array([t.upto for t in bounds])
    inclusive = np.array([t.inclusive for t in bounds])
    # Номер tramo = сколько верхних границ rendimiento уже превысил.
    exceeded = np.where(inclusive, r > uppers, r >= uppers)
    idx = exceeded.sum(axis=-1)
    return int(idx) if np.ndim(rendimiento_mensual) == 0 else idx


@dataclass(frozen=True, slots=True)
class Actividad:
    """Итог года по деятельности autónomo. Поля — числа или массивы (траектории)."""

    ingresos: float
    gastos: float  # без RETA
    cuota_reta: float  # в год
    gastos_dificil_justificacion: float
    rendimiento_neto: float  # IRPF, идёт в общую базу
    rendimiento_computable: float  # для RETA, в год (после gastos genéricos)
    reta_tramo: int  # индекс в rules.reta.tramos
    reta_base: float  # евро в месяц


def actividad(
    ingresos, gastos, rules: IrpfRules, base_elegida=None, gastos_dificil: bool = True
) -> Actividad:
    """Rendimiento neto и cuota RETA за год с учётом их взаимной зависимости.

    cuota RETA — gasto deducible, поэтому уменьшает rendimiento neto; а tramo RETA
    выбирается по rendimiento computable = (rendimiento neto + cuota RETA) × (1 − gastos
    genéricos) / 12 (art. 308.1.c LGSS). Круг разрываем перебором: для каждого tramo k
    считаем cuota по его базе и проверяем, что rendimiento попадает в тот же tramo k.
    Выбор tramo не убывает по k (больше cuota → меньше gastos de difícil justificación →
    больше rendimiento computable), поэтому согласованный tramo всегда есть; берём
    наименьший.

    base_elegida — база в месяц, выбранная autónomo (None — минимальная). После
    regularización она прижимается к [base_min, base_max] фактического tramo.
    gastos — расходы без cuota RETA. gastos_dificil — см. `rendimiento_neto`.
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
    k = np.argmax(consistent, axis=-1)  # первый согласованный tramo

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
