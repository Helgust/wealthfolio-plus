"""Точка входа и общий каркас: шапка + навигация по разделам в духе ProjectionLab."""

from __future__ import annotations

import os

from nicegui import ui

from planner.app.pages import placeholder, taxes

# (путь, иконка Material, название, страница)
SECTIONS = [
    ("/", "dashboard", "Обзор", placeholder.overview),
    ("/current", "account_balance", "Текущие финансы", placeholder.current_finances),
    ("/plans", "timeline", "Планы", placeholder.plans),
    ("/taxes", "receipt_long", "Налоги", taxes.page),
    ("/montecarlo", "casino", "Monte Carlo", placeholder.monte_carlo),
]


def root() -> None:
    with ui.header(elevated=True).classes("items-center bg-white text-gray-900"):
        ui.button(icon="menu", on_click=lambda: drawer.toggle()).props("flat round color=grey-8")
        ui.label("spain-planner").classes("text-lg font-semibold")
        ui.label("Comunitat Valenciana · autónomo").classes("text-sm text-gray-500 max-sm:hidden")

    with ui.left_drawer(bordered=True).classes("bg-gray-50") as drawer:
        for path, icon, title, _ in SECTIONS:
            with (
                ui.link(target=path).classes("no-underline text-gray-800 w-full"),
                ui.row().classes("items-center gap-3 px-3 py-2 rounded hover:bg-gray-200"),
            ):
                ui.icon(icon).classes("text-xl text-gray-600")
                ui.label(title)

    with ui.column().classes("w-full max-w-6xl mx-auto p-4"):
        ui.sub_pages({path: page for path, _, _, page in SECTIONS})


def main() -> None:
    ui.run(
        root,
        title="spain-planner",
        host="127.0.0.1",  # личные финансы — только локально, не в сеть
        port=int(os.environ.get("PLANNER_PORT", "8080")),
        language="ru",
        reload=False,
        show=os.environ.get("PLANNER_NO_BROWSER") is None,
    )
