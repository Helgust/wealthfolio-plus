// План в ctx.api.storage: одна строка JSON под одним ключом (лимит значения — 250 000 символов).
import type { AddonContext } from '@wealthfolio/addon-sdk';
import { defaultPlan, PlanSchema, type Plan } from './plan';

const PLAN_KEY = 'plan.v1';

export interface LoadedPlan {
  plan: Plan;
  /** План не найден или не прошёл проверку — показан шаблон */
  isDefault: boolean;
  error?: string;
}

export function parsePlan(json: string | null, startYear: number): LoadedPlan {
  if (json === null) return { plan: defaultPlan(startYear), isDefault: true };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { plan: defaultPlan(startYear), isDefault: true, error: `Invalid JSON: ${String(e)}` };
  }
  const parsed = PlanSchema.safeParse(raw);
  if (!parsed.success) {
    return { plan: defaultPlan(startYear), isDefault: true, error: parsed.error.message };
  }
  return { plan: parsed.data, isDefault: false };
}

export async function loadPlan(ctx: AddonContext, startYear: number): Promise<LoadedPlan> {
  return parsePlan(await ctx.api.storage.get(PLAN_KEY), startYear);
}

export async function savePlan(ctx: AddonContext, plan: Plan): Promise<void> {
  await ctx.api.storage.set(PLAN_KEY, JSON.stringify(PlanSchema.parse(plan)));
}
