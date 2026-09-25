// Модель плана (фаза 1): домохозяйство, доход autónomo, расходы. Схема Zod проверяет план,
// прочитанный из storage: старый или испорченный JSON не должен молча давать нули.
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
  })
  .refine((p) => p.filing === 'individual' || p.people.length === 2, {
    message: 'Joint filing needs two people',
    path: ['filing'],
  });

export type AutonomoIncome = z.infer<typeof AutonomoIncomeSchema>;
export type Person = z.infer<typeof PersonSchema>;
export type Child = z.infer<typeof ChildSchema>;
export type Expense = z.infer<typeof ExpenseSchema>;
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
  };
}
