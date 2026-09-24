# Архитектура: ProjectionLab как образец, Испания как налоговое ядро

ProjectionLab (PL) — эталон по UX и модели данных. Мы берём его концепции почти один в один,
но налоговое ядро, типы счетов и порядок движения денег — испанские.
Ниже: что есть в PL, чем это становится у нас и в каком шаге дорожной карты появится.

## 1. Карта концепций PL → spain-planner

| ProjectionLab | Что это | У нас | Шаг |
|---|---|---|---|
| **Current Finances** | «Где я сейчас»: счета, активы, долги, отдельно от планов | `Snapshot` — балансы на дату; позже импорт из Wealthfolio | 5, 7 |
| **Plans** (много, сравнение бок о бок) | Независимые сценарии поверх одного Current Finances | `Scenario` в `scenarios/*.yaml`, наследование `extends: base.yaml` + переопределения | 5 |
| **Accounts**: savings, taxable, 401k/IRA, Roth, HSA, 529, crypto | Типы счетов с разной налоговой логикой | `CashAccount`, `FundAccount` (fondos, traspaso без налога), `BrokerageAccount` (ETF/акции, FIFO), `PensionPlan` (PPI / PPES для autónomo) | 5 |
| **Real assets** (+ привязанный loan) | Дом, машина; ипотека как часть актива | `RealEstate` (vivienda habitual / иная) + `Loan`; ITP, IBI, imputación de rentas | 5 |
| **Debts** | Кредиты с графиком | `Loan` (аннуитет, досрочное погашение как flow) | 5 |
| **Income** (salary, side hustle, pension, SS) | Потоки со start/end, рост | `AutonomoIncome` (facturación − gastos → rendimiento neto, RETA), `PublicPension` (вход из отчёта SS), `RentalIncome`, `OtherIncome` | 3, 5 |
| **Expenses**: essential / discretionary | Разделение нужно для гибких трат | `Expense(kind=essential\|discretionary)`, start/end — год, возраст или milestone | 5 |
| **Milestones** (по году, возрасту, условию «net worth ≥ X», FI) | Точки, к которым привязываются события | `Milestone(trigger=Year\|Age\|Condition)`; события ссылаются на milestone, а не на год | 5 |
| **Cash-flow priorities (Flows)** | Порядок распределения профицита: max / % остатка / фикс. сумма, target balance | `Flow`-список: подушка → план пенсий до лимита → фонды → ETF; режимы `max`, `percent_remaining`, `fixed`, `until_balance` | 5 |
| **Withdrawal strategy** | Порядок счетов при дефиците + стратегия: fixed / % портфеля / guardrails | `WithdrawalOrder` + `SpendingRule` (fixed real, % портфеля, Guyton-Klinger); налог при продаже досчитывается итерациями (gross-up) | 5 |
| **Tax analytics** (эффективная и предельная ставка, по видам налога) | Графики налогов по годам | Ledger хранит налоги по компонентам: IRPF estatal / autonómica, база сбережений, RETA, IBI, Patrimonio | 4, 5 |
| **Roth conversions / bracket targeting** | Налоговые оптимизации | Испанские аналоги: tax-gain harvesting в пределах ступени 19 %, распределение выкупа plan de pensiones по годам, выбор fondos vs ETF | после 6 |
| **Monte Carlo** (свои распределения, success rate, drill-down в trial) | Вероятностный прогноз | `montecarlo.py`: параметрический (lognormal + корреляции) и bootstrap; метрики — success rate, перцентили, выбор отдельного trial | 6 |
| **Historical backtesting** | Прогон по реальным последовательностям | Скользящие окна исторических доходностей (акции / облигации / инфляция в EUR) | 6 |
| **Chance of success** + свои категории исходов | Одна метрика для сравнения планов | Определение «успеха» — параметр (не обнулились; ≥ legacy-цели; без сокращения трат) | 6 |
| **Cash-flow Sankey** | Куда ушли деньги в году X | Строится из ledger: доходы → налоги / RETA / траты / взносы / инвестиции | 8 |
| **Today's dollars** toggle | Реальные vs номинальные суммы | Ledger номинальный + колонка дефлятора; перевод в «евро сегодня» только в отображении | 5 |
| **Progress tab** | Фактические снимки net worth во времени | Импорт истории из Wealthfolio, план-факт | 7 |
| **Estate** | Наследство, налог на наследство | Sucesiones — вне скоупа; точка расширения | — |

### Чего в PL нет, а нам нужно
- **Две базы IRPF и две половины** (estatal / autonómica) — ядро уже есть в `planner.tax`.
- **Traspaso между фондами**: ребалансировка без налога внутри `FundAccount`, но не между ETF.
- **FIFO по лотам** для однородных бумаг: лот = (дата, количество, цена покупки).
- **Зачёт убытков** в базе сбережений: лимит 25 % на перекрёстный зачёт, перенос на 4 года — состояние, которое движок носит между годами.
- **RETA** как отдельный обязательный расход автономо, зависящий от rendimiento neto.
- **Проекция налоговых правил**: шкалы не индексируются сами — политика `frozen | indexed` в сценарии (механизм `IrpfRules.indexed(factor)` уже есть).

## 2. Слои и направления зависимостей

```
rules/<год>/*.yaml        данные: ставки и пороги с источниками
      │
planner.tax               чистые функции: шкалы, mínimos, IRPF, RETA  (numpy-совместимые)
      │
planner.model             pydantic-схема сценария: Household, Account, Income, Expense, Milestone, Flow
      │
planner.engine            годовой цикл → Ledger (pandas DataFrame, одна строка на год × траекторию)
      │
planner.montecarlo        генераторы траекторий доходностей и инфляции → engine → метрики
      │
planner.reports           данные для экранов: таблицы, кривые, KPI
      │
planner.app (NiceGUI)     только отображение, без логики; разделы как в ProjectionLab
```

Правило: нижний слой ничего не знает о верхнем. `tax` не знает про счета, `engine` не читает YAML с правилами напрямую — только через `planner.tax.rules_for_year`.

## 3. Ключевые решения

1. **Входы — pydantic v2, frozen, `extra="forbid"`.** Опечатка в YAML сценария должна падать при загрузке, а не молча давать 0.
2. **Движок векторизован по траекториям.** Состояние — numpy-массивы формы `(n_trials,)` (лоты — `(n_trials, n_lots)`). Детерминированный прогон — это `n_trials = 1`, отдельной реализации нет. Поэтому все налоговые функции уже принимают массивы.
3. **Ledger — единственный выход движка.** Широкая таблица: доходы, налоги по компонентам, траты, взносы, балансы по счетам, net worth, дефлятор. Графики, Sankey, success rate — производные от ledger.
4. **Порядок шагов внутри года** (фиксирован, тестируется):
   1. milestones и события года;
   2. доходы (rendimiento neto autónomo, пенсии, аренда) и обязательные расходы (RETA, траты, долги);
   3. рост счетов: цена и выплаты раздельно (дивиденды ETF облагаются ежегодно, накопительные фонды — нет);
   4. профицит → flows по приоритету; дефицит → изъятия по порядку с gross-up на налог от продажи;
   5. IRPF за год (общая база, база сбережений, mínimos, перенос убытков) → налог платится в этом же году
      (упрощение: реальный платёж по декларации — в апреле–июне следующего; параметр на будущее);
   6. запись строки ledger.
5. **Суммы номинальные.** Инфляция — траектория (детерминированная или стохастическая); «евро сегодня» — только в отображении.
6. **Сценарии как данные.** `scenarios/base.yaml` + `scenarios/retire-50.yaml` с `extends: base.yaml`: сравнение планов = diff двух ledger.

## 4. Дорожная карта (уточнённая)

1. [x] Шкалы, государственная шкала, база сбережений, механика mínimo.
2. [x] Шкала Валенсии (2025, 2026), полные mínimos обеих половин, правила по годам + индексация.
3. [x] Rendimiento neto autónomo (gastos deducibles, gastos de difícil justificación 5 % / 2 000 €) + `reta.yaml`; экран в «Налогах».
4. [x] Полный IRPF за год: reducciones (art. 32, planes de pensiones), перенос убытков (ahorro, base general), cuota líquida; deducciones — суммой по половинам. Эталонный тест — шаблон `tests/data/declaracion.example.yaml`, данные вводит пользователь.
5. [ ] `model.py` + `engine.py`: Current Finances, счета, доходы/расходы, milestones, flows, withdrawal strategy, ledger. Сначала детерминированно.
6. [ ] Monte Carlo + historical backtesting, success rate.
7. [ ] Импорт из Wealthfolio (Current Finances + Progress).
8. [ ] UI (NiceGUI) растёт вместе с ядром: каждый шаг добавляет свой экран. Готово: каркас и раздел «Налоги» (autónomo + IRPF). Дальше: план, сравнение планов, Sankey, tax analytics, Monte Carlo.
