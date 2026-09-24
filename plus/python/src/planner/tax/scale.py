"""Прогрессивные шкалы и загрузка налоговых правил из rules/."""

from __future__ import annotations

from functools import cached_property
from itertools import pairwise
from pathlib import Path
from typing import overload

import numpy as np
import yaml
from pydantic import BaseModel, ConfigDict, model_validator

# src/planner/tax/scale.py -> корень проекта
RULES_DIR = Path(__file__).resolve().parents[3] / "rules"


class Bracket(BaseModel):
    model_config = ConfigDict(frozen=True)

    upto: float | None  # верхняя граница ступени, None = без ограничения
    rate: float


class Scale(BaseModel):
    """Прогрессивная шкала. Работает и с числом, и с numpy-массивом баз
    (массив нужен для Monte Carlo: одна база на траекторию)."""

    model_config = ConfigDict(frozen=True)

    brackets: list[Bracket]

    @model_validator(mode="after")
    def _check_order(self) -> Scale:
        bounds = [b.upto for b in self.brackets]
        if bounds[-1] is not None or None in bounds[:-1]:
            raise ValueError("только последняя ступень может быть без верхней границы")
        if any(a >= b for a, b in pairwise(bounds[:-1])):
            raise ValueError("границы ступеней должны строго возрастать")
        return self

    @cached_property
    def _arrays(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        uppers = np.array([b.upto if b.upto is not None else np.inf for b in self.brackets])
        lowers = np.concatenate(([0.0], uppers[:-1]))
        rates = np.array([b.rate for b in self.brackets])
        return lowers, uppers, rates

    @overload
    def apply(self, base: float) -> float: ...
    @overload
    def apply(self, base: np.ndarray) -> np.ndarray: ...

    def apply(self, base):
        """Налог по прогрессивной шкале на сумму base (евро). Отрицательная база = 0."""
        lowers, uppers, rates = self._arrays
        b = np.asarray(base, dtype=float)[..., None]
        tax = (np.clip(b, lowers, uppers) - lowers) @ rates
        return float(tax) if np.ndim(base) == 0 else tax

    def marginal_rate(self, base: float) -> float:
        """Ставка ступени, в которую попадает следующий евро сверх base."""
        for b in self.brackets:
            if b.upto is None or base < b.upto:
                return b.rate
        raise AssertionError("unreachable")

    def scaled(self, factor: float) -> Scale:
        """Шкала с границами, умноженными на factor (индексация на инфляцию)."""
        return Scale(
            brackets=[
                Bracket(upto=None if b.upto is None else b.upto * factor, rate=b.rate)
                for b in self.brackets
            ]
        )


def rules_path(year: int, name: str) -> Path:
    return RULES_DIR / str(year) / f"{name}.yaml"


def load_rules(year: int, name: str) -> dict:
    return yaml.safe_load(rules_path(year, name).read_text(encoding="utf-8"))


def load_scale(year: int, name: str, key: str = "scale") -> Scale:
    """Загружает шкалу из rules/<year>/<name>.yaml по ключу key."""
    return Scale(brackets=load_rules(year, name)[key])
