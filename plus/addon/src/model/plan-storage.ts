// Plans in ctx.api.storage: the index plans.v1 (plan ids and the active one) and each plan under
// plan.v1:<id> as a JSON string (value limit — 250,000 characters). The single plan of phases 1–2
// (key plan.v1) becomes the first plan on first load; its key is left in place.
import type { AddonContext } from '@wealthfolio/addon-sdk';
import { z } from 'zod';
import { defaultPlan, PlanSchema, type Plan } from './plan';

type Storage = AddonContext['api']['storage'];

const LEGACY_KEY = 'plan.v1';
const INDEX_KEY = 'plans.v1';
const planKey = (id: string) => `plan.v1:${id}`;
export const MAX_PLANS = 20;

const IndexSchema = z.object({
  ids: z
    .array(z.string().regex(/^[A-Za-z0-9_-]{1,40}$/))
    .min(1)
    .max(MAX_PLANS),
  activeId: z.string(),
});

export interface LoadedPlan {
  plan: Plan;
  /** Plan not found or failed validation — a template is shown */
  isDefault: boolean;
  error?: string;
}

export interface PlanEntry extends LoadedPlan {
  id: string;
}

export interface PlanBook {
  entries: PlanEntry[];
  activeId: string;
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

function parseIndex(json: string | null): z.infer<typeof IndexSchema> | null {
  if (json === null) return null;
  try {
    const parsed = IndexSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Short random id; crypto.randomUUID needs a secure context, which the sandbox may not be. */
const newPlanId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const activeEntry = (book: PlanBook): PlanEntry =>
  book.entries.find((e) => e.id === book.activeId) ?? book.entries[0];

export async function loadPlanBook(storage: Storage, startYear: number): Promise<PlanBook> {
  const index = parseIndex(await storage.get(INDEX_KEY));
  if (index) {
    const entries = await Promise.all(
      index.ids.map(async (id) => ({ id, ...parsePlan(await storage.get(planKey(id)), startYear) })),
    );
    const activeId = index.ids.includes(index.activeId) ? index.activeId : index.ids[0];
    return { entries, activeId };
  }
  const legacy = await storage.get(LEGACY_KEY);
  const first: PlanEntry = { id: newPlanId(), ...parsePlan(legacy, startYear) };
  const book = { entries: [first], activeId: first.id };
  // A readable phases 1–2 plan moves to the new layout; a template is stored on its first save.
  if (!first.isDefault) {
    await storage.set(planKey(first.id), JSON.stringify(first.plan));
    await writeIndex(storage, book);
  }
  return book;
}

async function writeIndex(storage: Storage, book: PlanBook): Promise<void> {
  await storage.set(INDEX_KEY, JSON.stringify({ ids: book.entries.map((e) => e.id), activeId: book.activeId }));
}

// Writes go plan first, then index: the index never names a plan that was not written.

export async function savePlan(storage: Storage, book: PlanBook, id: string, plan: Plan): Promise<PlanBook> {
  const parsed = PlanSchema.parse(plan);
  await storage.set(planKey(id), JSON.stringify(parsed));
  const next = {
    ...book,
    entries: book.entries.map((e) => (e.id === id ? { id, plan: parsed, isDefault: false } : e)),
  };
  await writeIndex(storage, next);
  return next;
}

/** Stores plan as a new plan and makes it active. */
export async function addPlan(storage: Storage, book: PlanBook, plan: Plan): Promise<PlanBook> {
  if (book.entries.length >= MAX_PLANS) throw new Error(`At most ${MAX_PLANS} plans`);
  const parsed = PlanSchema.parse(plan);
  const id = newPlanId();
  await storage.set(planKey(id), JSON.stringify(parsed));
  const next = { entries: [...book.entries, { id, plan: parsed, isDefault: false }], activeId: id };
  await writeIndex(storage, next);
  return next;
}

export async function deletePlan(storage: Storage, book: PlanBook, id: string): Promise<PlanBook> {
  if (book.entries.length <= 1) throw new Error('The only plan cannot be deleted');
  const entries = book.entries.filter((e) => e.id !== id);
  const next = { entries, activeId: book.activeId === id ? entries[0].id : book.activeId };
  await writeIndex(storage, next);
  await storage.delete(planKey(id));
  return next;
}

export async function selectPlan(storage: Storage, book: PlanBook, id: string): Promise<PlanBook> {
  const next = { ...book, activeId: id };
  await writeIndex(storage, next);
  return next;
}
