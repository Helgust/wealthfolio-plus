# ProjectionLab против Planificador ES: разрывы и пересечения с Wealthfolio

Дата: 2026-09-27. Аддон — ветка `plus` @ `7a8263f` (Wealthfolio 3.9.0). ProjectionLab — справка
[projectionlab.com/help](https://projectionlab.com/help) на сентябрь 2026. Upstream Wealthfolio — `main` @ `e2d4f8db`
(2026-09-26) и открытые PR на ту же дату.

Вопросы документа:

1. Чего в аддоне нет относительно ProjectionLab — до уровня полей форм.
2. Что в аддоне или форке дублирует Wealthfolio (сам продукт, SDK, открытые PR) и что с этим делать.
3. Кредиты: что даст открытый PR #1687 и что остаётся аддону.

Сверено с кодом 27.09.2026: утверждения о коде аддона, форка и SDK подтверждены; статусы PR #1687, #1261,
#1797 и формат `loan_projection` — по GitHub API; справка ProjectionLab — выборочно (доходы, flex spending).
Поправки после сверки внесены в текст: `spending.getReport` нет в SDK 3.8.0 из npm (§2.3), источник формата
#1687 (§3), срок кредита обещан фазой 3 (§1.8), загрузка файлов в песочнице (§1.11). План — фаза 5
в [wealthfolio-plan.md](wealthfolio-plan.md).

## Коротко

- **Каркас PL повторён**: несколько планов, milestones, timing «год / возраст / milestone», flows, порядок
  изъятий, spending rules, Sankey года, «евро сегодня», панель года, Compare, Monte Carlo. Налоговое ядро
  глубже, чем у PL.
- **Главные разрывы с PL** — ввод сумм (частота, разовые, change over time, actual / today's), типы доходов,
  milestones с несколькими условиями, flexible spending, аналитика Monte Carlo (бэктест, просмотр прогона,
  своё определение успеха), Progress, оплата налога в следующем году.
- **Прямых дублей с Wealthfolio три**, все — в открытых PR upstream: условия кредита (#1687 против
  `properties.v1.loans.monthlyPayment`), доля владения (#1261 против `owner` в `properties.v1`),
  `portfolio.getNetWorth` (#1797 против правки форка). Ни один не смержен.
- **Встроенный планировщик Wealthfolio** (Goals → Retirement) — параллельная реализация по замыслу. Из него
  стоит взять: суммы в месяц, свою инфляцию у траты, комиссию фондов, stress tests / SORR / sensitivity.
- **Wealthfolio уже знает то, что аддон просит ввести руками или не берёт**: фактические траты (Spending),
  взносы в планы пенсий за текущий год, классы активов позиций (для `equityShare`), историю баланса кредита
  (`quotes.getHistory`).

## 1. Разрывы с ProjectionLab

Ссылки на код — от `plus/addon/src/`.

### 1.1 Ввод сумм — общее для всех событий

| | ProjectionLab | Аддон |
|---|---|---|
| Частота | Yearly, once per year, quarterly, monthly и др. | Только € в год (`components/plan-editor.tsx`: «Amounts are per year»). Помесячно — только платёж кредита |
| Валюта суммы | Actual или Today's у каждого поля | Всё в евро первого года, всё индексируется |
| Change over time | Match inflation, ±%, inflation ±%, нелинейный график (Advanced editor, таблица по годам) | Autónomo — одна номинальная ставка; траты и пенсия SS — строго инфляция |
| Разовые суммы | Frequency = Once + дата (наследство, продажа) | Нет. Обход: трата с концом через год |
| Повторение | Repeat: каждые N лет, масштаб на повтор, до milestone или даты | Нет |
| Гранулярность дат | Месяц и год, симуляция по годам | Год |

Предложение: частота хранится в модели, а не только пересчитывается в форме — иначе при повторном открытии
пользователь видит годовую сумму вместо введённой месячной.

```ts
const Amount = z.object({
  value: money,
  per: z.enum(['year', 'quarter', 'month']).default('year'),
});
// upgradeLegacy: 40000 → { value: 40000, per: 'year' }
// движок: value × { year: 1, quarter: 4, month: 12 }[per]
```

Разовые суммы — отдельный вид события с одной датой, а не частота. Множитель «14 pagas» для дохода по найму
не нужен: в испанском контракте указан salario bruto anual, его и вводить. Встроенный планировщик Wealthfolio
уже хранит траты и доходы в месяц (`monthlyAmount`, §2.2): пользователю Wealthfolio месячный ввод привычен.

### 1.2 Доходы

| | ProjectionLab | Аддон (`model/plan.ts`) |
|---|---|---|
| Виды | Salary, Side Hustle, Inheritance, Social Security, pension, Custom и др. | `autonomo` и `pension` (SS) на человека |
| Налоговый тип | Auto, Wage, Self-Employment, Ordinary, Dividend, Capital Gains; Tax-Exempt по юрисдикции | Жёстко: actividad и trabajo |
| Удержание | Withholding: Auto, Fixed Rate, None | Нет (см. §1.9) |
| Part-time | Период со своим % от полного дохода | Нет |
| Куда идут деньги | Send To: общий поток или конкретный счёт | Только общий поток |

Ещё у аддона:

- нет аренды: у `rented` в `model/properties.ts` доход прямо не моделируется;
- нет дохода по найму, разовых (herencia, donación), «прочего»;
- gastos autónomo растут той же ставкой, что выручка (`AutonomoIncome.growth`);
- одна деятельность на человека: смену activity не выразить;
- пенсия SS всегда индексируется по IPC, без выбора.

Испанская версия налогового типа: rendimientos del trabajo, actividad, capital inmobiliario (alquiler),
capital mobiliario, ganancia patrimonial, exento.

### 1.3 Расходы

| | ProjectionLab | Аддон |
|---|---|---|
| Типы | 15 типов (Housing, Living Expenses, Custom…) | Имя + сумма |
| Категория | Essential, Discretionary, Hybrid, Not Spending | Essential, Discretionary |
| Оплата | Automatic или Specific Account | Только общий поток |
| Владелец | Я / партнёр / совместно | Нет |
| Жильё | Ипотека, налог, содержание — на самом активе, не в тратах | IBI на объекте; содержание, seguro, comunidad — только как общая трата |

Ещё у аддона:

- нельзя сделать номинально фиксированную трату (аренда по контракту, подписка);
- нельзя привязать трату к возрасту ребёнка: `components/timing-input.tsx` знает людей плана и milestones,
  а дети — только годы рождения для mínimos;
- нет своей инфляции у траты (во встроенном планировщике Wealthfolio она есть — `inflation_rate` у
  `ExpenseBucket`).

### 1.4 Milestones

| | ProjectionLab | Аддон (`engine/timing.ts`) |
|---|---|---|
| Условия | Сколько угодно, AND / OR | Одно |
| Метрики | Net worth, баланс счёта, долг (всего или по виду), savings rate, passive income, кратное тратам или долгу | Год, возраст, net worth ≥ X |
| Операторы | =, >, <, ≥, ≤ | Только ≥ |
| Шаблоны | Retirement (60), Life Expectancy (85), FI = 25× трат, Debt Free, Move | Retirement (65) в шаблоне плана |
| Управление | Activate / Deactivate без удаления | Только удаление; удаление блокируется, если milestone используется |

### 1.5 Flows (cash-flow priorities)

Совпадает: `max` (в аддоне для PPI/PPES — с вычитаемым лимитом, у PL такого нет), `fixed`, `percent` от
остатка, `untilBalance`.

Нет в аддоне:

- частоты у фиксированной суммы (в PL — Monthly, Quarterly, Annually);
- выбора «остаток сохранить / потратить» (Save / Spend anything left over). В аддоне остаток всегда уходит
  в cash, кроме режима spending rule;
- переводов между счетами: частота, откуда, куда, сумма, дата, налоговая обработка. Traspaso между фондами
  в `engine/portfolio.ts` есть, в модель плана не выведен;
- срока действия у flow (например, «докидывать в brokerage до 2030»);
- досрочного погашения кредита как flow (см. §3).

### 1.6 Изъятия и траты

Есть: порядок изъятий с gross-up налога (секущая), доступ к планам пенсий с `pensionAccessAge`, правила
`percent` и `guytonKlinger` с essential как полом.

Отличие в пользу аддона: Withdrawal Strategy mode в PL с выбранного года переопределяет большую часть событий
плана — траты, покупки активов. В аддоне правило заменяет только discretionary.

Нет в аддоне:

- стратегий Ratcheting SWR, VPW и других из Withdrawal Strategy mode;
- Flexible Spending: правила «портфель ниже максимума (ATH) на X% → discretionary −Y%», несколько правил,
  Step или Linear, свой период, охват All / Discretionary, сравнение flex против no-flex по шести категориям
  исходов;
- двух частей Guyton–Klinger (записаны как упрощения в `docs/wealthfolio-plan.md`, фаза 3, срез 4).

### 1.7 Счета и доходность

| | ProjectionLab | Аддон |
|---|---|---|
| Уровень доходности | План или свой у каждого счёта | Тип счёта (`Returns`) |
| Вид доходности | Фиксированная, историческая последовательность, своя последовательность | Фиксированная |
| Облигации | Доля облигаций на уровне портфеля, меняется во времени | `equityShare` по типу счёта, постоянная, только в MC |
| Комиссии | Не проверено | Нет. Во встроенном планировщике Wealthfolio — `annual_investment_fee_rate` |

Комиссию фонда (TER, custodia) стоит завести явно или записать, что доходности — за вычетом комиссий.

### 1.8 Недвижимость и долги

Что есть только у аддона: imputación de rentas, exención por reinversión и после 65, ITP / IVA + AJD, IBI.

Нет в аддоне относительно PL:

- расходов на объекте: maintenance, improvement, insurance (% или сумма), HOA в месяц — у нас comunidad,
  seguro hogar, derrama;
- налога на объект как % от оценки с правилами переоценки (у нас — рост valor catastral, тоже не моделируется);
- дохода от аренды;
- роста стоимости у каждого объекта (одна `propertyGrowth`);
- активов кроме жилья: машина, земля, коммерческая недвижимость;
- выручки от продажи на конкретный счёт;
- у кредита: простые или сложные проценты, срок до погашения, пересчёт платежа при смене срока (см. §3).
  Срок обещан и нашим планом (фаза 3, срез 5: «ежемесячный платёж или срок»), но в `LoanSettingSchema` —
  только `monthlyPayment`.

### 1.9 Налоги

Аддон сильнее: две базы, две половины, шкала Валенсии, mínimos, перенос убытков, reducciones PPI / PPES
с incremento autónomo, RETA по реальному доходу, сравнение individual / conjunta, `frozen | indexed`.

Нет в аддоне:

- **Сдвиг оплаты.** Движок PL платит в году налоги за прошлый год. Аддон платит IRPF в том же году
  (упрощение из `docs/architecture.md` §3). Испанский аналог withholding — pagos fraccionados (modelo 130)
  или retenciones, плюс доплата или возврат в renta следующего года.
- **Предельная и эффективная ставка в UI.** `es-tax/scale.ts` уже экспортирует `marginalRate`, нигде не
  используется.
- **Optimize.** В PL — Roth conversions, gain harvesting, withdrawal shielding, income-aware splitting для
  пар; цели — ступени шкалы и пороги; перебор стратегий с тепловой картой и применением в один клик.
  Испанские аналоги записаны в `docs/architecture.md` §1 (harvesting в пределах ступени 19 %, растягивание
  rescate плана пенсий), не сделаны. Аналог splitting для пар — выбор, со счетов какого супруга продавать.
- **Patrimonio.** Упомянут в `docs/architecture.md` как компонент ledger, в коде нет.

### 1.10 Monte Carlo

Есть (`lib/monte-carlo.ts`, `engine/stochastic-market.ts`): параметрическая модель (порт ignidash,
4 фактора), seed, p10–p90 номинально и в евро сегодня, успех = ни одного года с `shortfall`.

Нет в аддоне:

- исторического бэктеста (фаза 4, срез 2);
- своих распределений;
- просмотра отдельного прогона с последовательностью доходностей;
- своего определения успеха и категорий исходов;
- калибровки: волатильности и корреляции — американские (NYU Stern), в долларах.

### 1.11 Интерфейс и прочее

- Progress, план против факта — фаза 4, срез 3.
- What-If mode — в аддоне только Duplicate.
- CSV-экспорт таблицы обещан в `docs/wealthfolio-plan.md`, в `components/ledger-table.tsx` его нет. Хост
  создаёт iframe аддона с `sandbox="allow-scripts"` без `allow-downloads`
  (`apps/frontend/src/addons/iframe/addon-iframe-manager.ts`), в SDK нет API для файлов: скачивание из
  аддона, скорее всего, заблокировано. Сначала learning test; если так — API хоста в форке.
- Продолжительность жизни: план идёт, пока старший не достигнет `endAge`, оба живы до конца. В PL есть
  Life Expectancy на человека и сценарий смерти супруга. Для пары от этого зависят conjunta / individual
  и pensión de viudedad.
- Estate / net legacy — вне скоупа (Sucesiones).

### 1.12 Где аддон сильнее PL

- Испанский IRPF целиком, RETA, недвижимость по испанским правилам.
- `max` для планов пенсий с вычитаемым лимитом и incremento autónomo.
- Spending rule не отключает essential и покупки.
- Автоматическое сравнение individual / conjunta.
- Лоты FIFO из реальных позиций Wealthfolio, а не одна средняя цена.
- Воспроизводимый Monte Carlo (seed).

## 2. Пересечения с Wealthfolio

### 2.1 Дубли, которые нужно свести

| Что | У нас | В Wealthfolio | Статус upstream | Решение |
|---|---|---|---|---|
| Условия кредита | `properties.v1.loans[id].monthlyPayment` (`model/properties.ts`) | PR #1687: `loan_projection` и `loan_events` в metadata пассива | Открыт, мерж `main` 2026-09-25 | Когда PR попадёт в релиз — читать его формат, `properties.v1` — запасной вариант. Подробно — §3 |
| Доля владения | `owner: 0 \| 1 \| 'joint'` в `properties.v1` | PR #1261: `ownership_pct` (0–100) в metadata; net worth считает долю | Открыт, 2026-09-04 | Разные вещи: у нас — кто из пары, у них — доля домохозяйства. Совместить, см. ниже |
| Net worth для аддонов | Правка форка: `portfolio.getNetWorth(date?)` → `NetWorth` | PR #1797: тот же метод, `NetWorthResponse` с `breakdown` и `staleAssets` | Открыт, 2026-09-23 | После мержа удалить правку форка; наш тип — подмножество, код аддона не меняется |

**Доля владения.** Если PR #1261 смержат и пользователь поставит 50 % на квартиру, net worth Wealthfolio
посчитает половину, а аддон смоделирует объект целиком. Стартовый net worth сойдётся — разницу поглотит
`otherAssets` в `engine/run-plan.ts`, — но рост стоимости, платежи по кредиту и imputación будут вдвое больше.
При мерже: умножать стоимость, баланс кредита, прирост при продаже и imputación на `ownership_pct`; `owner`
оставить для разделения между людьми плана. Проверить, что отдаёт `alternativeAssets.getAll()` — полную
стоимость или долю.

**`getNetWorth`.** PR #1797 трогает те же файлы, что правка форка (`addons-runtime-context.ts`,
`addon-iframe-manager.ts`, `type-bridge.ts`, `addon-function-names.ts`, `data-types.ts`, `host-api.ts`,
`permissions.ts`): при мерже релиза будет конфликт, решать в пользу upstream. `staleAssets` из ответа
пригодится для предупреждения «оценка старше 90 дней» на странице плана.

### 2.2 Параллельные реализации по замыслу

**Встроенный планировщик выхода на пенсию** (`crates/core/src/planning/retirement/`,
`crates/core/src/portfolio/fire/`, `apps/frontend/src/features/goals/retirement-planner/`):

- траты в месяц, у каждой своя инфляция, начало и конец по возрасту, флаг essential;
- доходы: DB и DC, индексация, связанный счёт, выплата аннуитетом или drawdown;
- доходность до и после выхода, комиссия фондов, волатильность, glide path;
- Monte Carlo, scenario analysis, stress tests, sequence of returns risk, sensitivity, decision matrix;
- Lean / Fat FIRE от трат;
- налоги — плоские ставки по трём корзинам (taxable, tax-deferred, tax-free).

Заменить им аддон нельзя: налоги в нём плоские, а испанские типы счетов и недвижимость не моделируются.
Upstream его развивает (например, открытый #1811 про налог только на нереализованную прибыль). Форк
перенаправляет на аддон только создание новой retirement-цели (`goal-new-page.tsx`); созданная раньше
встроенная цель открывается по-старому.

Что взять оттуда: месячные суммы (§1.1), свою инфляцию у траты (§1.3), комиссию фондов (§1.7), stress tests,
SORR и sensitivity для фазы 4, FI-цель от трат для milestones (§1.4).

**Save-up цели.** Цель с суммой, датой и привязанными счетами пересекается с milestone «net worth ≥ X»
и flow `untilBalance`. Правка форка `feat(fork/goals)` добавляет им `startingAmount`. Конфликта нет.
Вариант для фазы 4, срез 4: вместо слота на дашборде в форке аддон может создавать или обновлять
цель через `goals.create` / `goals.update` / `goals.saveFunding` — прогресс покажет сам Wealthfolio.
Проверить, хватит ли этого вместо виджета.

### 2.3 Данные Wealthfolio, которые аддон не берёт

| Данные | API | Зачем аддону |
|---|---|---|
| Фактические траты по категориям | `spending.getReport`, `spending.getCategories` | Черновик списка трат за 12 месяцев; essential / discretionary по категориям. Для Испании в Spending есть пресет правил категоризации (`crates/spending/seeds/presets/es.json`, #1252). `getReport` есть только в SDK 3.9 форка, в npm-пакете 3.8.0 его нет: вызов через `lib/fork-api.ts`, как `alternativeAssets.getAll` |
| Взносы в PPI / PPES за текущий год | `getHistoricalValuations(accountId)` — прирост net contribution счёта с 1 января; или `contributionLimits.getAll`, `calculateDeposits` | Остаток вычитаемого лимита в первом году плана. Сейчас первый год считает полный лимит (`PensionRoom` в `engine/run-plan.ts`). Первый путь не требует новых прав и настройки лимита в Wealthfolio — проверить learning test'ом |
| Классы активов позиций | `holding.instrument.classifications.assetClasses` | Фактическая доля акций по типу счёта вместо шаблона `equityShare` (fondos 100 %, brokerage 100 %, планы 50 %) |
| История баланса пассива | `quotes.getHistory(assetId)` | Последний подтверждённый баланс кредита, как в модели PR #1687 |
| Дивиденды и проценты | `activities` (DIVIDEND, INTEREST) | Проверка `brokerageYield` и `cashInterest` по факту |

Права в `manifest.json` сейчас — `accounts`, `portfolio`, `alternative-assets`. Классы активов приходят
с позициями (право `portfolio` уже есть); Spending, котировкам, операциям и contribution limits нужны новые
права.

### 2.4 Не пересекается

- Лоты: аддон берёт лоты Wealthfolio (`getHolding` по позиции, `lib/starting-point.ts`), своего восстановления
  FIFO по операциям нет — так и надо.
- PR #1406 (Sankey состава net worth) — про состав на дату, а не про денежный поток года плана.
- Allocation targets и rebalancing (#1612) — про факт, не про проекцию.

## 3. Кредиты и PR #1687

**PR #1687** `feat(liabilities): add full loan lifecycle management` (DamienKCorp): открыт, 45 файлов,
+5169 / −216, последний мерж `main` — 2026-09-25. Замена закрытого #1233 того же автора. Пересекается
с открытым #1392 (дата окончания и полная стоимость кредита): дату окончания #1687 считает сам
(`calculateLoanEndDate`), полной стоимости кредита у него нет.

Что даёт (описание — `docs/features/liabilities/loan-calculation-model.md`, типы —
`apps/frontend/src/pages/asset/alternative-assets/lib/loan-events.ts` в PR):

- условия в metadata пассива, ключ `loan_projection` — JSON-строка, `LoanProjectionMetadata`: `version: 1`,
  `annualRate` (в процентах: 5.5 — это 5,5 %), `paymentAmount`, `frequency` (`monthly`, `biweekly`,
  `accelerated_biweekly`), `firstPaymentDate`, `paymentCount?`, `termEndDate?`;
- датированные события, ключ `loan_events`: `balance_correction`, `extra_repayment`, `rate_change`,
  `payment_change`, `payment_frequency_change`, `renewal`; у каждого — `effectiveDate`;
- ручной режим без условий — только балансы;
- график строится на лету во фронтенде (`apps/frontend/src/pages/asset/alternative-assets/lib/loan-*.ts`),
  будущие платежи не сохраняются как котировки и в SDK не выставлены.

Что это значит для аддона:

- Всё, что сейчас лежит в `properties.v1.loans`, будет доступно через `alternativeAssets.getAll()` → `metadata`.
  Читатель условий: `loan_projection` → платёж в месяц (biweekly × 26 / 12), ставка, срок; будущие события
  из `loan_events` — в год, когда вступают в силу; если `loan_projection` нет — `properties.v1.loans`;
  ручной режим — как сейчас (кредит стоит на месте).
- Калькулятор PR живёт во фронтенде хоста — аддон его не импортирует. Своя годовая амортизация
  (`engine/real-estate.ts`, помесячно внутри года) остаётся; сверка с формулами PR — на фикстуре, как golden
  с Python.
- PR в форк не тянуть: форк вливает только релизные теги. Читатель писать, когда PR попадёт в релиз: PR
  открыт, до мержа формат может измениться, и код под него сейчас — спекулятивный. `version` в формате
  защищает от будущих изменений, но не от правок до мержа.
- Раздел ответственности. Wealthfolio — факты договора: текущие условия, записанные досрочные погашения,
  известные изменения (конец фиксированного периода в hipoteca mixta). Аддон — сценарий: путь Euríbor,
  плановое досрочное погашение из профицита, subrogación.

Чего в PR нет для Испании (кандидаты в комментарии к PR или в аддон):

- переменной ставки как Euríbor + diferencial с периодом revisión — только конкретные `rate_change`;
- выбора при досрочном погашении: `extra_repayment` сохраняет платёж, то есть сокращает plazo; reducir cuota —
  только отдельным `payment_change`;
- комиссии за досрочное погашение и subrogación (потолки — Ley 5/2019, TODO: verify);
- `biweekly`, `accelerated_biweekly`, `renewal` — канадская практика, для Испании не нужны, но не мешают.

Что делать в аддоне:

1. Переменная ставка у кредитов плана и у покупок (`PropertyPurchase.mortgage`): фиксированная, variable,
   mixta; допущение Euríbor в плане. В Monte Carlo Euríbor можно привязать к фактору cash (векселя) —
   он уже есть в `engine/stochastic-market.ts`.
2. Досрочное погашение как flow: сумма или % остатка, reducir cuota или plazo, период действия, комиссия.
3. Срок кредита как альтернатива платежу (обещан фазой 3, срез 5).
4. Когда #1687 попадёт в релиз — читатель его формата с запасным вариантом `properties.v1` и тестами
   на фикстурах metadata.
5. Расходы на объекте (seguro de vida и hogar vinculados, comunidad) — вместе с §1.8.

## 4. План

Срезы — фаза 5 в [wealthfolio-plan.md](wealthfolio-plan.md); что в неё не вошло — там же, «Вне фазы».
Шаги при мерже релизов upstream (#1797, #1261, #1687) — там же, «Сквозные вопросы».

## Источники

ProjectionLab, справка: add-income-to-your-plan, adding-expenses-to-your-plan, cash-flow-priorities,
manage-milestones, withdrawal-strategy-mode, flex-spending, simulation-engine, model-investment-growth,
model-bond-allocation, add-real-assets, year-by-year; страницы monte-carlo, optimize; блог fine-tune-your-plans.

Wealthfolio: `crates/core/src/planning/retirement/model.rs`, `crates/core/src/portfolio/fire/calculator.rs`,
`packages/addon-sdk/src/host-api.ts`; PR #1687, #1392, #1261, #1797, #1811, #1406, #1612, #1252 — ветки
получены через `git fetch pull/<n>/head`, статусы — поиск GitHub на 2026-09-26/27.
