"""Разделы, которые появятся на следующих шагах дорожной карты (docs/architecture.md)."""

from __future__ import annotations

from nicegui import ui


def _stub(title: str, step: str, bullets: list[str]) -> None:
    ui.label(title).classes("text-2xl font-semibold")
    with ui.card().classes("w-full"):
        ui.label(f"В разработке — {step}").classes("text-sm text-gray-500")
        for b in bullets:
            ui.label(f"• {b}")


def overview() -> None:
    _stub(
        "Обзор",
        "шаг 5",
        [
            "Net worth по годам, номинально и в «евро сегодня»",
            "Ключевые milestones плана и вероятность успеха",
        ],
    )
    ui.link("Уже работает: калькулятор IRPF →", "/taxes").classes("mt-2")


def current_finances() -> None:
    _stub(
        "Текущие финансы",
        "шаги 5 и 7",
        [
            "Счета: cash, fondos de inversión, брокерский (ETF/акции), plan de pensiones",
            "Недвижимость и долги (ипотека)",
            "Импорт позиций из Wealthfolio",
        ],
    )


def plans() -> None:
    _stub(
        "Планы",
        "шаг 5",
        [
            "Доходы (autónomo, пенсия, аренда) и расходы (essential / discretionary)",
            "Milestones, приоритеты распределения денег, стратегия изъятий",
            "Сравнение планов бок о бок",
        ],
    )


def monte_carlo() -> None:
    _stub(
        "Monte Carlo",
        "шаг 6",
        [
            "Тысячи траекторий доходностей и инфляции, вероятность успеха",
            "Исторические последовательности (backtesting)",
        ],
    )
