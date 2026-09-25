// Модель плана: домохозяйство, доход autónomo, расходы; с фазы 2 — доходности счетов, flows
// профицита и порядок изъятий. Схема Zod проверяет план, прочитанный из storage: старый или
// испорченный JSON не должен молча давать нули. Поля фазы 2 — с default, поэтому план фазы 1
// читается без миграции.
import { z } from 'zod';

const money = z.number().finite().min(0);
const rate = z.number().finite().min(-0.5).max(0.5);
const year = z.number().int().min(1900).max(2200);

export const AutonomoIncomeSchema = z.object({
  /** Facturación за первый год плана, € в год */
  revenue: money,
  /** Вычитаемые расходы деятельности без cuota RETA, € в год */
  expenses: money,
  /** Номинальный рост выручки и расходов в год */
  growth: rate,
  /** Возраст, с которого дохода нет (год, когда исполнилось, — уже без дохода) */
  untilAge: z.number().int().min(0).max(120),
});

export const PersonSchema = z.object({
  name: z.string().min(1).max(60),
  birthYear: year,
  disability: z.enum(['ninguna', 'grado_33', 'grado_65']),
  autonomo: AutonomoIncomeSchema.nullable(),
});

export const ChildSchema = z.object({
  birthYear: year,
});

export const ExpenseSchema = z.object({
  name: z.string().min(1).max(60),
  /** € в год в ценах первого года плана; растёт с инфляцией */
  amount: money,
  kind: z.enum(['essential', 'discretionary']),
  startYear: year.nullable(),
  endYear: year.nullable(),
});

/** Номинальные ожидаемые доходности по испанским типам счетов, доля в год. */
export const ReturnsSchema = z.object({
  /** Проценты по CASH-счетам — rendimientos del capital mobiliario */
  cashInterest: rate,
  /** Рост fondos de inversión (накопительные: выплат нет) */
  fundGrowth: rate,
  /** Рост цены ETF и акций */
  brokerageGrowth: rate,
  /** Дивиденды брокерского счёта от стоимости на начало года */
  brokerageYield: rate,
  /** Рост planes de pensiones */
  pensionGrowth: rate,
});

/**
 * Куда идёт профицит года, по порядку. max — до вычитаемого лимита для плана пенсий, иначе весь
 * остаток; fixed — сумма в год; percent — доля остатка (amount 0…1); untilBalance — пополнить до
 * баланса. Суммы fixed и untilBalance — в ценах первого года плана. Остаток после flows — на
 * первый CASH-счёт.
 */
export const FlowSchema = z.object({
  accountId: z.string().min(1),
  mode: z.enum(['max', 'fixed', 'percent', 'untilBalance']),
  amount: money,
});

export const DEFAULT_RETURNS: Returns = {
  cashInterest: 0.015,
  fundGrowth: 0.06,
  brokerageGrowth: 0.045,
  brokerageYield: 0.015,
  pensionGrowth: 0.05,
};

export const PlanSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1).max(80),
    startYear: year,
    /** План идёт, пока старшему не исполнится endAge */
    endAge: z.number().int().min(1).max(120),
    inflation: rate,
    /** Tributación individual или conjunta; conjunta — только для пары */
    filing: z.enum(['individual', 'joint']),
    people: z.array(PersonSchema).min(1).max(2),
    children: z.array(ChildSchema).max(10),
    expenses: z.array(ExpenseSchema).max(50),
    returns: ReturnsSchema.default(DEFAULT_RETURNS),
    flows: z.array(FlowSchema).max(30).default([]),
    /** id счетов Wealthfolio; пусто — cash → fondos → брокерский → планы пенсий */
    withdrawalOrder: z.array(z.string().min(1)).max(50).default([]),
    /** С этого возраста владельца план пенсий доступен для изъятий */
    pensionAccessAge: z.number().int().min(50).max(80).default(65),
  })
  .refine((p) => p.filing === 'individual' || p.people.length === 2, {
    message: 'Joint filing needs two people',
    path: ['filing'],
  });

export type AutonomoIncome = z.infer<typeof AutonomoIncomeSchema>;
export type Person = z.infer<typeof PersonSchema>;
export type Child = z.infer<typeof ChildSchema>;
export type Expense = z.infer<typeof ExpenseSchema>;
export type Returns = z.infer<typeof ReturnsSchema>;
export type Flow = z.infer<typeof FlowSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Filing = Plan['filing'];

/** Шаблон нового плана: суммы — заглушки, пользователь вводит свои. */
export function defaultPlan(startYear: number): Plan {
  return {
    version: 1,
    name: 'My plan',
    startYear,
    endAge: 90,
    inflation: 0.02,
    filing: 'individual',
    people: [
      {
        name: 'Me',
        birthYear: startYear - 40,
        disability: 'ninguna',
        autonomo: { revenue: 40_000, expenses: 5_000, growth: 0.02, untilAge: 65 },
      },
    ],
    children: [],
    expenses: [
      {
        name: 'Living',
        amount: 20_000,
        kind: 'essential',
        startYear: null,
        endYear: null,
      },
    ],
    returns: DEFAULT_RETURNS,
    flows: [],
    withdrawalOrder: [],
    pensionAccessAge: 65,
  };
}
