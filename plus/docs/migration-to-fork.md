# Перенос spain-planner в форк wealthfolio-plus

Инструкция для агента Claude Code, запущенного в папке `E:\GameDeveloping\wealthfolio-plus`. Выполни её
целиком и в конце выдай отчёт в формате из раздела «Отчёт». Общайся с пользователем по-русски.

## Задача

Перенести проект spain-planner (Python-эталон налогового ядра, правила, тесты, документы) в папку `plus/`
этого репозитория — в новой ветке `plus` от релизного тега Wealthfolio `v3.8.0` — и опубликовать ветку
на GitHub.

Готово, когда:

- ветка `plus` начинается с `v3.8.0` и содержит ровно три новых коммита из раздела «Сообщения коммитов»;
- вне `plus/` появился только один файл — корневой `CLAUDE.md`;
- в `plus/python` тесты и линтер проходят так же, как в исходном проекте;
- в коммитах нет личных данных;
- ветка `plus` отправлена в `origin`.

## Правила

- Исходная папка `E:\GameDeveloping\BetterFinancePlanner` — только для чтения: копируй из неё, но ничего
  в ней не меняй и не удаляй.
- Не коммить в `main`, не делай rebase и force-push, не трогай другие ветки и теги.
- Всё новое — в `plus/`. Единственное исключение — корневой `CLAUDE.md`. Другие файлы Wealthfolio не правь.
- Репозиторий публичный. Не коммить `tests/data/declaracion_*.yaml` (кроме `declaracion.example.yaml`),
  `*.db`, `*.sqlite`, `.env*`, `.venv`.
- Не используй `--no-verify` и не меняй настройки git.
- Если что-то идёт не так, как описано, — остановись и опиши ситуацию пользователю. Не придумывай обходных
  путей, которые меняют результат.

## Исходные данные

- Репозиторий (текущая папка): `E:\GameDeveloping\wealthfolio-plus`. `origin` —
  `https://github.com/Helgust/wealthfolio-plus.git`, публичный форк.
- Upstream: `https://github.com/wealthfolio/wealthfolio.git`.
- База ветки — тег `v3.8.0`, последний релиз Wealthfolio. От `main` не начинать: там неопубликованные
  изменения и новые миграции базы данных.
- Источник: `E:\GameDeveloping\BetterFinancePlanner` — Python-проект, не git-репозиторий. Внутри:
  `src/planner`, `rules/<год>`, `tests`, `notebooks`, `scenarios`, `pyproject.toml`, `README.md`,
  `.gitignore`, `CLAUDE.md`, `docs/`, а также `.venv` и кэши — их не переносим.
- Python 3.12 доступен как `python`; `uv` и `gh` не установлены.
- Тесты источника на 24.09.2026: `119 passed, 1 skipped`, ruff без замечаний.
- В `.claude/settings.json` Wealthfolio есть хук: после каждой твоей правки файла он запускает
  `npx prettier --write`, а корневые настройки Prettier переносят строки в `.md` по 80 символов. Поэтому
  `plus/.prettierrc.cjs` создаётся раньше остальных файлов.
- Команды ниже — для PowerShell. Переменные между вызовами не сохраняются, поэтому каждый блок выполняй
  одним вызовом.

## Шаги

### 1. Подготовить git

```powershell
git status --porcelain
git remote get-url upstream
```

Если `git status --porcelain` что-то вывел — остановись. Если remote `upstream` нет (вторая команда
завершилась ошибкой), добавь его:

```powershell
git remote add upstream https://github.com/wealthfolio/wealthfolio.git
```

Затем забери теги и проверь базу:

```powershell
git fetch upstream --tags
git rev-parse v3.8.0
git ls-remote --tags upstream v3.8.0
git ls-remote --heads origin plus
git branch --list plus
```

Хеш из `git rev-parse v3.8.0` должен совпасть с хешем `refs/tags/v3.8.0` из `git ls-remote`. Если не
совпал или ветка `plus` уже есть локально или в `origin` — остановись. Иначе:

```powershell
git switch -c plus v3.8.0
```

### 2. Создать `plus/.prettierrc.cjs`

Содержимое — в разделе «Новые файлы».

### 3. Скопировать проект

```powershell
$src = "E:\GameDeveloping\BetterFinancePlanner"
$dst = "E:\GameDeveloping\wealthfolio-plus\plus"
robocopy $src "$dst\python" /E /XD "$src\.venv" "$src\docs" .pytest_cache .ruff_cache __pycache__ .ipynb_checkpoints /XF "$src\CLAUDE.md" *.pyc /NFL /NDL /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy python: код $LASTEXITCODE" }
robocopy "$src\docs" "$dst\docs" /E /NFL /NDL /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy docs: код $LASTEXITCODE" }
$global:LASTEXITCODE = 0
```

У robocopy коды 0–7 означают успех (1 — «файлы скопированы»), поэтому в конце блока код сбрасывается в 0.

Сверь списки файлов — `Compare-Object` не должен ничего вывести, а два числа в конце должны совпасть:

```powershell
$src = "E:\GameDeveloping\BetterFinancePlanner"
$py = "E:\GameDeveloping\wealthfolio-plus\plus\python"
$skip = '\\(\.venv|docs|\.pytest_cache|\.ruff_cache|__pycache__|\.ipynb_checkpoints)(\\|$)'
$a = Get-ChildItem $src -Recurse -File -Force | ForEach-Object { $_.FullName.Substring($src.Length) } |
  Where-Object { $_ -notmatch $skip -and $_ -ne '\CLAUDE.md' -and $_ -notlike '*.pyc' }
$b = Get-ChildItem $py -Recurse -File -Force | ForEach-Object { $_.FullName.Substring($py.Length) }
Compare-Object $a $b
(Get-ChildItem "$src\docs" -File).Count
(Get-ChildItem "E:\GameDeveloping\wealthfolio-plus\plus\docs" -File).Count
```

### 4. Создать остальные файлы

Создай `plus/CLAUDE.md`, `plus/README.md` и корневой `CLAUDE.md`, перезапиши `plus/python/README.md`.
Содержимое — в разделе «Новые файлы». Больше ничего в скопированных файлах не меняй.

### 5. Проверить Python-эталон

```powershell
Push-Location "E:\GameDeveloping\wealthfolio-plus\plus\python"
python -m venv .venv
.venv\Scripts\python -m pip install -e . pytest pytest-asyncio ruff
$env:PYTHONIOENCODING = "utf-8"
.venv\Scripts\python -m pytest -q
.venv\Scripts\python -m ruff check .
Pop-Location
```

Ожидается `119 passed, 1 skipped` и чистый ruff. Если числа другие, запусти тесты в источнике, ничего
в нём не записывая, и сравни:

```powershell
$env:PYTHONDONTWRITEBYTECODE = "1"
$env:PYTHONIOENCODING = "utf-8"
& "E:\GameDeveloping\BetterFinancePlanner\.venv\Scripts\python" -m pytest -q -p no:cacheprovider "E:\GameDeveloping\BetterFinancePlanner\tests"
```

Числа в копии и в источнике должны совпасть; если в копии тест падает, а в источнике нет — остановись.

### 6. Закоммитить

Каждое сообщение из раздела «Сообщения коммитов» запиши в отдельный временный файл вне рабочего дерева
(например, в `$env:TEMP`, кодировка UTF-8) и коммить через `git commit -F <файл>`. Heredoc с кириллицей
в Bash ломается, поэтому сообщения передаём только через файл.

Перед каждым коммитом проверь индекс — команда не должна ничего вывести:

```powershell
git diff --cached --name-only | Select-String -Pattern 'declaracion_(?!example)|\.db$|\.sqlite$|(^|/)\.env|(^|/)\.venv/'
```

Коммиты по порядку:

1. `git add plus/python` — сообщение 1.
2. `git add plus/docs plus/CLAUDE.md plus/README.md plus/.prettierrc.cjs` — сообщение 2.
3. `git add CLAUDE.md` — сообщение 3.

После коммитов:

```powershell
git log --oneline v3.8.0..plus
git diff --stat v3.8.0 plus -- . ":(exclude)plus"
git status --porcelain
```

Должно быть ровно три коммита, вне `plus/` — только `CLAUDE.md`, рабочее дерево чистое.

### 7. Отправить на GitHub

```powershell
git push -u origin plus
```

Git может открыть окно входа в GitHub (Git Credential Manager) — дождись, пока пользователь войдёт. Если
push не прошёл — остановись и покажи ошибку.

Сделать `plus` веткой по умолчанию без `gh` нельзя. Это ручной шаг для пользователя: GitHub →
репозиторий → Settings → General → Default branch → `plus`.

### 8. Инструменты для фазы 0 — только после подтверждения пользователя

Этот шаг ставит программы и вызывает окна UAC. Спроси пользователя, выполнять ли его сейчас. Если он
согласен:

```powershell
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
npm install -g pnpm@10.33.4
```

Затем в корне репозитория (`rustup` может ещё не быть в `PATH` текущей оболочки — тогда вызывай его как
`$env:USERPROFILE\.cargo\bin\rustup.exe`):

```powershell
rustup toolchain install 1.98.1 --component rustfmt --component clippy
cargo --version
pnpm --version
pnpm install --frozen-lockfile
```

Сборку Wealthfolio не запускай — это часть фазы 0 из `plus/docs/wealthfolio-plan.md`.

## Новые файлы

### `plus/.prettierrc.cjs`

```js
// Настройки Prettier из корня Wealthfolio, но без переноса строк в Markdown:
// хук Claude Code из .claude/settings.json форматирует каждый изменённый файл.
const base = require("../.prettierrc.cjs");

const isMarkdown = (override) =>
  [].concat(override.files).some((pattern) => pattern.endsWith(".md") || pattern.endsWith(".mdx"));

module.exports = {
  ...base,
  overrides: [
    ...base.overrides.filter((override) => !isMarkdown(override)),
    { files: ["**/*.md", "**/*.mdx"], options: { proseWrap: "preserve" } },
  ],
};
```

### `CLAUDE.md` (корень репозитория)

```markdown
# wealthfolio-plus

Личный форк Wealthfolio с испанским финансовым планировщиком.

Правила Wealthfolio — для всех файлов вне `plus/`:
@AGENTS.md

Наша часть — `plus/`:
@plus/CLAUDE.md
```

### `plus/CLAUDE.md`

```markdown
# plus/ — испанский планировщик поверх Wealthfolio

Личный финансовый планировщик в духе ProjectionLab с испанскими налогами. Инструмент для одного
домохозяйства, не продукт для других.

## Контекст

- Налоговое резидентство: Испания, Comunitat Valenciana (régimen común). Форальные режимы не нужны.
- Основной доход: autónomo.
- Цель: структурно правильная модель на горизонте 20–30 лет (что, где и когда облагается), а не
  точность декларации до евро.
- Язык общения и комментариев — русский; налоговые термины — по-испански; идентификаторы в коде —
  английские (кроме устоявшихся испанских терминов вроде `cuota_integra`, `base_ahorro`).

## Устройство

- Основа — форк Wealthfolio. Испанский планировщик — аддон Wealthfolio в `plus/addon/`
  (TypeScript/React). То, что аддону недоступно, — точечные правки файлов Wealthfolio в этом форке.
- `plus/python/` — Python-эталон: `planner.tax` (IRPF по двум базам и двум половинам, mínimos,
  reducciones, перенос убытков, autónomo + RETA) и правила `plus/python/rules/<год>/*.yaml`. С ним
  сверяется порт на TypeScript через golden-фикстуры. Приложение NiceGUI (`src/planner/app`) заморожено.
- `plus/docs/` — документы. План и фазы — `docs/wealthfolio-plan.md`: прочитай его перед работой над
  любой фазой. Ловушки окружения и источников — одноимённые разделы в `docs/next-steps.md`.
- В старых документах пути вида `src/planner/...`, `rules/...`, `tests/...` отсчитываются от
  `plus/python/`.

Модель и налоги:
@docs/architecture.md
@docs/spain-tax-notes.md

## Git

- Рабочая ветка — `plus`, начата от релизного тега Wealthfolio. `main` — зеркало upstream, в него
  не коммитим.
- Новый релиз Wealthfolio вливаем мержем его тега (`git merge vX.Y.Z`), не ребейзом.
- Наши правки файлов Wealthfolio видны так: `git diff <тег> plus -- . ":(exclude)plus"`.
- Сообщения коммитов — в стиле upstream (Conventional Commits): наша часть — `type(plus): ...`,
  правки файлов Wealthfolio — `type(fork/<область>): ...`.
- Репозиторий публичный: личные данные не коммитим.

## Команды Python-эталона

Из `plus/python` (`uv` не установлен):

- окружение: `python -m venv .venv`, затем
  `.venv\Scripts\python -m pip install -e . pytest pytest-asyncio ruff`;
- тесты: `.venv\Scripts\python -m pytest` (для кириллицы в консоли — `PYTHONIOENCODING=utf-8`);
- линтер: `.venv\Scripts\python -m ruff check .`

## Налоговые правила

- Каждое число в `rules/` — с комментарием-источником (BOE / AEAT / DOGV). Непроверенное помечать
  `TODO: verify`. Не выдумывать ставки и пороги: если значение неизвестно, оставить TODO и спросить.
- Каждое налоговое правило — с тестом. Эталоны: симулятор Renta Web (AEAT) и прошлая декларация.
- Деньги — float в евро, округление только на выходе. Год — всегда параметр, не хардкодить текущий.
- IRPF считается по половинам (estatal + autonómica): у них разные шкалы и mínimos.

## Договорённости с пользователем

- Планировщик не пишем с нуля: дорабатываем Wealthfolio (аддон + тонкий форк), готовые части движка
  и Monte Carlo берём из ignidash (AGPL-3.0). Стек — TypeScript.
- ProjectionLab — главный образец UX и модели данных. Ноутбуки не предлагать как интерфейс.
- Только десктоп: мобильная вёрстка не нужна.
- Личные данные (суммы, декларации, счета) пользователь вносит сам: не спрашивать их, давать шаблоны
  и формы; тесты на личных данных пропускаются, если файла нет.
```

### `plus/README.md`

```markdown
# plus/

Наша часть форка. Всё остальное в репозитории — Wealthfolio
([wealthfolio/wealthfolio](https://github.com/wealthfolio/wealthfolio)) с точечными правками.

- `python/` — Python-эталон налогового ядра (IRPF, RETA) и правила по годам;
- `addon/` — аддон Wealthfolio с испанским планировщиком (в работе);
- `docs/` — архитектура, налоговые заметки и план работ.

Инструкции для Claude Code — в `CLAUDE.md`.
```

### `plus/python/README.md` (заменяет скопированный)

````markdown
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
````

## Сообщения коммитов

Текст — точно как ниже, без добавлений.

### Сообщение 1

```
chore(plus): перенести Python-эталон в plus/python

Проект spain-planner из E:\GameDeveloping\BetterFinancePlanner без
изменений кода: planner.tax, правила rules/<год>, тесты и
замороженное приложение NiceGUI. Эталон для порта налогового ядра
на TypeScript через golden-фикстуры. README переписан под эту роль.

Проверка: в plus/python создать .venv, установить пакет вместе с
pytest и запустить pytest.
```

### Сообщение 2

```
docs(plus): перенести документы и правила для Claude

plus/docs: архитектура, налоговые заметки, план на основе
Wealthfolio, сравнение с ignidash, инструкция по переносу.
plus/CLAUDE.md: правила нашей части и договоренности с
пользователем; раньше они жили в памяти Claude для старой папки.
plus/README.md: устройство папки plus/.
plus/.prettierrc.cjs: настройки корня без переноса строк в
Markdown, потому что хук из .claude/settings.json форматирует
каждую правку.
```

### Сообщение 3

```
chore(fork/root): добавить CLAUDE.md с импортом AGENTS.md

Claude Code читает CLAUDE.md, а правила upstream лежат в AGENTS.md.
Корневой CLAUDE.md подключает AGENTS.md и plus/CLAUDE.md. В upstream
файла CLAUDE.md нет, поэтому при мерже релизов конфликт не ожидается.
```

## Если что-то пошло не так

- Рабочее дерево не чистое на шаге 1 — остановись и покажи `git status`.
- Тега `v3.8.0` нет или его хеш не совпал с upstream — остановись.
- Ветка `plus` уже есть — остановись и спроси, что с ней делать.
- robocopy вернул код 8 или больше, либо списки файлов не совпали — остановись и покажи расхождения.
- Тесты или ruff падают в копии, но проходят в источнике — остановись и покажи вывод. Код не чини.
- Хук форматирования выдаёт ошибки (например, `npx prettier` без установленных зависимостей) — задаче это
  не мешает, продолжай. Если он всё же изменил скопированные файлы, покажи `git diff` пользователю перед
  коммитом.
- Push не прошёл — остановись и покажи ошибку.

## Отчёт

В конце выдай отчёт в таком виде (значения — фактические):

```
Перенос завершён.
- Ветка plus от v3.8.0 (<хеш коммита тега>), отправлена в origin: да
- Коммиты: <хеш> chore(plus): ...; <хеш> docs(plus): ...; <хеш> chore(fork/root): ...
- Вне plus/ изменён только CLAUDE.md: да
- Скопировано: plus/python — <N> файлов, plus/docs — <M> файлов; расхождений с источником нет
- plus/python: pytest — 119 passed, 1 skipped; ruff — без замечаний
- Личные данные в коммитах: не найдены
- Шаг 8 (инструменты): выполнен / отложен по решению пользователя
- Отклонения от инструкции: нет
- Сделать вручную: GitHub -> Settings -> General -> Default branch -> plus; открыть
  E:\GameDeveloping\wealthfolio-plus в VS Code; исходную папку удалить после проверки
```

## Главное

- Исходную папку только читать.
- Ветка `plus` — от `v3.8.0`; вне `plus/` — только корневой `CLAUDE.md`.
- Личных данных в коммитах нет.
- При любом отклонении — остановиться и спросить пользователя.
