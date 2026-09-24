# spain-planner — Python-эталон

Налоговое ядро испанского планировщика: IRPF по двум базам и двум половинам, mínimos, reducciones,
перенос убытков, autónomo + RETA. Правила по годам — в `rules/`. С этим кодом сверяется порт на
TypeScript в `../addon/`. Приложение на NiceGUI (`src/planner/app`) заморожено.

## Окружение и проверки

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -e . pytest pytest-asyncio ruff
.venv\Scripts\python -m pytest
.venv\Scripts\python -m ruff check .
```

Приложение: `.venv\Scripts\python -m planner.app` — откроется http://127.0.0.1:8080
(порт — переменная `PLANNER_PORT`).

Контекст и решения — `../CLAUDE.md` и `../docs/`.
