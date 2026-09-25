# Передача контекста: следующие шаги

Документ для нового чата с Claude. `CLAUDE.md` и `docs/architecture.md` подгружаются автоматически —
здесь только то, чего в них нет: состояние на 2026-09-24, решения, ловушки окружения и план.

> **2026-09-24: направление изменено.** Пользователь решил не писать планировщик с нуля, а дорабатывать
> существующий проект. Основа — Wealthfolio: испанский планировщик — его аддон на TypeScript, а то, что
> аддону недоступно, — в своём тонком форке Wealthfolio. План — `docs/wealthfolio-plan.md`, следующая
> задача — его фаза 0. Репозиторий — форк `github.com/Helgust/wealthfolio_plus`: первым делом проект
> переезжает в его папку `plus/` (раздел «Репозиторий и рабочий процесс» плана). Шаг 5 на Python ниже больше не делаем; `planner.tax` и `rules/` остаются эталоном
> для порта на TypeScript. Разбор отклонённого варианта — `docs/ignidash-fork-plan.md`.

## Что пользователь хочет (приоритеты)

- **Браузерное приложение на Python**, а не Jupyter-ноутбуки. UI — **NiceGUI** (выбран пользователем).
  Ноутбуки — только для экспериментов, не предлагать их как способ «посмотреть результат».
- **ProjectionLab — главный образец** по UX и модели данных. Перед проектированием любого экрана
  сверяться с таблицей в `docs/architecture.md` §1 и с тем, как это устроено в ProjectionLab.
- Лучшие практики Python: строгие pydantic-модели, чистые функции, тесты на каждое правило, ruff.
- Общение — на русском.

## Решения пользователя (2026-09-24)

- Порядок: сначала налоги (шаги 3–4 — готово), теперь движок (шаг 5).
- Мобильная вёрстка не нужна — только десктоп.
- **Личные данные (декларацию, суммы, счета) пользователь вносит сам.** Не спрашивать их и не
  блокироваться на них: давать шаблон или форму в UI, тесты на личных данных — пропускаемые без файла.
- Сценарии, созданные в UI, хранятся как YAML в `scenarios/` (подтверждено).
- `notebooks/irpf_valencia.py` удалён.

## Что сделано

- **Шаги 1–2**: шкалы IRPF (estatal, Valencia, ahorro), mínimos обеих половин, правила за 2025
  и 2026 (`rules/<год>/`), загрузка по году + индексация (`planner.tax.rules`).
  Шкала Валенсии 2026 — по Ley 5/2026 (ретроактивно с 01.01.2026), сверена с hisenda.gva.es.
- **Шаг 3**: `rules/<год>/reta.yaml` (tramos, bases, tipos — Orden PJC/178/2025 и PJC/297/2026,
  сверено с текстом BOE), `rules/<год>/actividad.yaml` (gastos de difícil justificación 5 % / 2 000 €).
  `planner.tax.actividad()` — rendimiento neto + cuota RETA; их взаимная зависимость решается
  перебором tramos (согласованный tramo всегда существует — монотонность).
- **Шаг 4**: `rules/<год>/reducciones.yaml` (art. 32.2–32.3, лимиты планов пенсий, compensación),
  `planner.tax.reducciones`, `planner.tax.compensacion`, `planner.tax.irpf_anual()` — от rendimientos
  до cuota líquida. Перенос убытков — numpy-состояние `(..., 2, 4)` для ahorro и `(..., 4)` для
  общей базы: функция принимает состояние прошлого года и возвращает новое.
- **UI**: каркас NiceGUI с разделами ProjectionLab; работает раздел **«Налоги»**: режим «Autónomo»
  (выручка/расходы → RETA → rendimiento neto) или «Вручную», база сбережений, блок «Reducciones и
  deducciones», KPI, цепочка «от rendimientos к bases», таблица estatal/autonómica, график ставок.
  Остальные разделы — заглушки.
- **Эталонный тест**: `tests/test_declaracion.py` читает `tests/data/declaracion_<год>.yaml`
  (в .gitignore; шаблон — `declaracion.example.yaml`); без файла тест пропускается.
- 119 тестов (включая UI) + 1 пропущенный, ruff чистый.

## Открытые вопросы (не блокируют шаг 5)

1. Нужно ли моделировать конкретные deducciones Валенсии (сейчас — сумма вручную по половинам).
2. Два пункта `TODO: verify` в `reducciones.yaml`: применяется ли 30 % лимит планов пенсий вместе
   с incremento 4 250 €; складываются ли 32.2.1º.a и .b.

## Окружение — ловушки

Форк и аддон (фаза 0):

- **pnpm — только standalone `pnpm.exe`** (`winget install pnpm.pnpm --version 10.33.4`). Скрипты upstream
  (`apps/frontend/scripts/dev-addon-sandbox.mjs`) и dev-server из `@wealthfolio/addon-dev-tools` делают
  `spawn("pnpm")` без shell; `pnpm.cmd` из npm Node 24 так не запускает (`spawn pnpm ENOENT`).
  `WinGet\Links` в PATH стоит раньше `AppData\Roaming\npm`.
- `~/.cargo/bin` может не быть в PATH Bash-инструмента: `export PATH="$HOME/.cargo/bin:$PATH"`.
- Запуск форка: `VITE_ENABLE_ADDON_DEV_MODE=true pnpm tauri dev --config plus/tauri.dev.conf.json`;
  аддон: `pnpm dev:server` в `plus/addon`. `tauri dev` перезаписывает окончания строк в
  `apps/tauri/Cargo.toml` — в коммит не брать.
- `plus/addon` — отдельный pnpm-workspace (свой `pnpm-workspace.yaml`): `.npmrc` с `ignore-workspace`
  pnpm 10 игнорирует и ставит корневой workspace.
- Шаблон аддона 3.8.0 задавал `build.watch` в `vite.config.ts`, из-за чего `pnpm build` не завершался;
  убрано.
- API аддона в песочнице — Proxy: у него есть любое свойство. Наличие метода проверять только вызовом
  (неизвестный метод хост отклоняет).
- Node 24 запускает `.ts` напрямую: `node --input-type=module -e "await import('./src/x.ts')"`.
- **Tailwind в аддоне — только классы, которые уже есть в CSS хоста.** Собственный CSS аддона в iframe
  не подключается: `h-[300px]` работает (хост его использует), `h-[320px]` — нет, элемент получает
  высоту 0. Произвольные размеры задавать через `style`.
- Скриншот запущенного форка: запускать с `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`,
  затем `chromium.connectOverCDP('http://127.0.0.1:9222')` из `@playwright/test` корня. Страница аддона —
  второй frame (`about:srcdoc`). Маршрут менять через `history.pushState` + `popstate`. В Git Bash
  пути вида `/addons/...` в аргументах превращаются в пути Windows — `MSYS_NO_PATHCONV=1`.
- Не собирать аддон (`pnpm build`) при запущенном `pnpm dev:server`: оба пишут в `dist`, и хост на
  время ловит «Failed to start add-on».
- `pnpm test` в `plus/addon` — vitest (golden-фикстуры, движок); `pnpm type-check` — tsc.

Python-эталон:

- **`uv` не установлен.** `.venv` создан через `python -m venv`. Команды:
  `.venv\Scripts\python -m pytest`, `.venv\Scripts\python -m ruff check .`,
  `.venv\Scripts\python -m planner.app`. После `winget install astral-sh.uv` заработает `uv sync`.
  Новые зависимости добавлять в `pyproject.toml` **и** ставить `pip install -e .` в `.venv`.
- Windows-консоль: при запуске скриптов с кириллицей в выводе — `PYTHONIOENCODING=utf-8`.
- Bash-инструмент иногда ломается на длинных heredoc с кириллицей/кавычками («unexpected EOF»):
  такие правки писать скриптом через Write в scratchpad и запускать `python <script>`.
- Приложение: `PLANNER_PORT` (по умолчанию 8080), `PLANNER_NO_BROWSER=1` — не открывать браузер.
  `reload=False`: после правок перезапускать процесс. Слушает только `127.0.0.1` — так и оставить.
- NiceGUI **3.x**: SPA через `ui.run(root)` + `ui.sub_pages({...})`, новые разделы — строка в
  `SECTIONS` в `src/planner/app/main.py`.
- UI-тесты: фикстура `user_simulation(root=root)` из `nicegui.testing.user_simulation`,
  `pytest-asyncio` в режиме `asyncio_mode = "auto"`. Пример — `tests/test_app.py`. Особенности:
  клик по опции `ui.toggle` не срабатывает — ставить `element.value` (см. `_set_manual`);
  `should_see` не видит текст внутри `ui.table` — проверять `table.rows`.
- Визуальная проверка: headless Edge →
  `"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --window-size=1400,1700 --virtual-time-budget=8000 --screenshot=<png> http://127.0.0.1:<port>/taxes`,
  затем открыть PNG. Проверять после каждого нового экрана.
- Графики: палитра и layout в `src/planner/app/theme.py` (цвета в фиксированном порядке, одна ось Y,
  разделитель тысяч — пробел).

## Ловушки источников

- Каждое число в `rules/` — только из официального источника (BOE / AEAT / Seguridad Social / DOGV)
  с комментарием; не нашёл — `TODO: verify`.
- WebFetch пересказывает страницы маленькой моделью — таблицы с цифрами из него не брать.
  Скачивать первоисточник через PowerShell `Invoke-WebRequest` (у curl из Git Bash ошибка SSL
  из-за прокси/антивируса) и разбирать текст самому. Консолидированные тексты: LIRPF —
  `boe.es/buscar/act.php?id=BOE-A-2006-20764`, RIRPF — `BOE-A-2007-6820`, LGSS — `BOE-A-2015-11724`.
  Manual práctico AEAT скачивается так же (sede.agenciatributaria.gob.es).
- Блоги пишут «7 % gastos de difícil justificación в 2026» — в BOE этого нет (только 10 % для Ceuta).

## Налоговое ядро: что не моделируется

- RETA: полный год в alta; без tarifa plana и бонификаций.
- IRPF: art. 32.1 (rentas irregulares), ganancias в общей базе, перенос неиспользованных
  aportaciones на 5 лет (art. 52.2), pensiones compensatorias (art. 55), конкретные deducciones.

## Следующая задача: шаг 5 — модель и движок в духе ProjectionLab (детерминированно)

Делать вертикальными срезами: каждый срез — модель → движок → ledger → экран → тесты + скриншот.
Каждая задача заканчивается зелёными `pytest` и `ruff check`.

1. **Минимальный срез**: `planner.model` (pydantic v2, `frozen`, `extra="forbid"`): `Household`
   (год рождения, состав семьи), `CashAccount`, `AutonomoIncome` (выручка, расходы, рост, start/end),
   `Expense` (essential/discretionary, рост = инфляция), горизонт и инфляция сценария.
   `planner.engine`: годовой цикл по `docs/architecture.md` §3.4 → Ledger (pandas, строка на год):
   доходы, RETA (`planner.tax.actividad`), IRPF (`planner.tax.irpf_anual`, перенос убытков — через
   его `pendientes_*`), траты, баланс, net worth, дефлятор. Векторизовано по траекториям
   (детерминированный прогон = `n_trials=1`). Экран «Обзор»: net worth по годам, номинально /
   «евро сегодня».
2. **Сценарии как данные**: `scenarios/base.yaml` + `extends:`; загрузка/сохранение из UI в
   `scenarios/*.yaml`. Экран «Планы»: доходы, расходы, milestones.
3. **Счета**: `FundAccount` (traspaso без налога), `BrokerageAccount` (ETF, FIFO по лотам, дивиденды
   ежегодно), `PensionPlan` (взносы → `aportacion_pensiones*`, выплаты → `rendimientos_trabajo`).
   Экран «Текущие финансы» — ввод счетов (данные вводит пользователь).
4. **Flows и withdrawal strategy**: приоритеты профицита (`max`, `percent_remaining`, `fixed`,
   `until_balance`), порядок изъятий с gross-up на налог от продажи. Milestones (год / возраст /
   условие).
5. Позже: `RealEstate` + `Loan`, политика проекции шкал `frozen | indexed` в сценарии
   (`IrpfRules.indexed(factor)` уже есть).

## Как проверить, что новый чат понял контекст

Перед первой правкой кода новый чат должен уметь ответить: на чём делается UI и почему
не ноутбуки (NiceGUI — выбор пользователя; нужен браузерный интерфейс); где лежит единственная
точка доступа к налоговым правилам (`planner.tax.rules_for_year`); что следующий шаг — 5, первый
срез (модель → движок → ledger → «Обзор»); что личные данные пользователь вносит сам и их не просят.
