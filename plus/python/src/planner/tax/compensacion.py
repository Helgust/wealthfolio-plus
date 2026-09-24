"""Compensación de rentas negativas с переносом на следующие годы (arts. 49 и 50.3 LIRPF).

Состояние переноса — массив сумм убытков (положительные числа) по годам происхождения,
от старшего к младшему; последняя ось длиной `anos` (4). Для базы сбережений перед ней ещё
ось из двух корзин: [RCM — rendimientos del capital mobiliario, GP — ganancias y pérdidas].
Функции возвращают новое состояние для следующего года: старший год выбывает, в конец
добавляются несписанные убытки текущего года.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from planner.tax.rules import Compensacion

RCM, GP = 0, 1


def _out(x):
    return float(x) if np.ndim(x) == 0 else x


def pendientes_vacios(rules: Compensacion, shape: tuple[int, ...] = (), ahorro: bool = True):
    """Нулевое состояние переноса: (..., 2, anos) для ahorro или (..., anos) для general."""
    return np.zeros((*shape, 2, rules.anos) if ahorro else (*shape, rules.anos))


def _consumir(importe, pendientes):
    """Списать до importe из корзин pendientes (старшие первыми); списанное по корзинам."""
    importe = np.asarray(importe, dtype=float)[..., None]
    antes = np.cumsum(pendientes, axis=-1) - pendientes
    return np.clip(importe - antes, 0.0, pendientes)


def _avanzar(pendientes, nuevas):
    """Сдвиг на год: старший год выбывает, в конец — убытки текущего года."""
    return np.concatenate([pendientes[..., 1:], np.asarray(nuevas)[..., None]], axis=-1)


@dataclass(frozen=True, slots=True)
class BaseAhorro:
    base_imponible: float
    compensado_anteriores: float  # списано убытков прошлых лет
    pendientes: np.ndarray  # состояние на следующий год, (..., 2, anos)


def base_imponible_ahorro(rcm, ganancias, pendientes, rules: Compensacion) -> BaseAhorro:
    """Base imponible del ahorro за год с зачётом убытков (art. 49; порядок — Manual práctico).

    rcm — saldo rendimientos del capital mobiliario года (проценты, дивиденды), может быть < 0.
    ganancias — saldo ganancias y pérdidas patrimoniales года, может быть < 0.

    Фаза 1: отрицательный saldo одной корзины гасится положительным другой, но не больше
    limite_cruzado от него. Фаза 2: убытки прошлых лет сначала гасятся своей корзиной целиком,
    затем другой — в пределах остатка того же limite_cruzado (он общий с фазой 1).
    """
    rcm = np.asarray(rcm, dtype=float)
    gp = np.asarray(ganancias, dtype=float)
    pend = np.array(pendientes, dtype=float, copy=True)
    lim = rules.limite_cruzado

    disponible = {RCM: np.maximum(rcm, 0.0), GP: np.maximum(gp, 0.0)}
    # Сколько убытков другой корзины можно зачесть в эту (25 % её положительного saldo).
    cupo = {k: lim * v for k, v in disponible.items()}
    otra = {RCM: GP, GP: RCM}

    # Фаза 1: убытки текущего года зачитываются другой корзиной в пределах cupo.
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

    # Фаза 2.1: убытки прошлых лет — своей корзиной без ограничения.
    total = compensar(RCM, RCM, disponible[RCM]) + compensar(GP, GP, disponible[GP])
    # Фаза 2.2: остаток — другой корзиной в пределах оставшегося cupo.
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
    base_liquidable: float  # после зачёта отрицательных баз прошлых лет, ≥ 0
    compensado_anteriores: float
    pendientes: np.ndarray  # (..., anos)


def compensar_base_liquidable_general(base_liquidable, pendientes, rules: Compensacion):
    """Отрицательная base liquidable general переносится на 4 года (art. 50.3 LIRPF)."""
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
