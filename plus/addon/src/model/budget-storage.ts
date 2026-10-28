// Budgets in ctx.api.storage: one key budgets.v1 with every budget and the active one (a budget is
// a few kilobytes; the value limit is 250,000 characters). One key keeps the MCP server's read
// simple. A record that fails validation is copied to budgets.v1.unreadable before anything is
// written over it, so a bad write (by hand or by an older addon) loses nothing.
import type { AddonContext } from '@wealthfolio/addon-sdk';
import { z } from 'zod';
import { BudgetSchema, newBudget, type Budget } from './budget';

type Storage = AddonContext['api']['storage'];

export const BUDGETS_KEY = 'budgets.v1';
const UNREADABLE_KEY = 'budgets.v1.unreadable';
export const MAX_BUDGETS = 10;

const BookSchema = z
  .object({
    activeId: z.string(),
    entries: z
      .array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), budget: BudgetSchema }))
      .min(1)
      .max(MAX_BUDGETS),
  })
  .refine((b) => b.entries.some((e) => e.id === b.activeId), {
    message: 'activeId is not a budget',
  });

export type BudgetBook = z.infer<typeof BookSchema>;

export interface LoadedBudgets {
  book: BudgetBook;
  /** The stored record could not be read; it was kept under budgets.v1.unreadable */
  error?: string;
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const freshBook = (): BudgetBook => {
  const id = newId();
  return { activeId: id, entries: [{ id, budget: newBudget(new Date()) }] };
};

export const activeBudget = (book: BudgetBook) => book.entries.find((e) => e.id === book.activeId)!;

export async function loadBudgets(storage: Storage): Promise<LoadedBudgets> {
  const json = await storage.get(BUDGETS_KEY);
  if (json === null) return { book: freshBook() };
  let error: string;
  try {
    const parsed = BookSchema.safeParse(JSON.parse(json));
    if (parsed.success) return { book: parsed.data };
    error = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  } catch (e) {
    error = `Invalid JSON: ${String(e)}`;
  }
  await storage.set(UNREADABLE_KEY, json);
  return { book: freshBook(), error };
}

export async function saveBudgets(storage: Storage, book: BudgetBook): Promise<BudgetBook> {
  const parsed = BookSchema.parse(book);
  await storage.set(BUDGETS_KEY, JSON.stringify(parsed));
  return parsed;
}

export const setBudget = (book: BudgetBook, id: string, budget: Budget): BudgetBook => ({
  ...book,
  entries: book.entries.map((e) => (e.id === id ? { id, budget } : e)),
});

/** Adds the budget and makes it active. */
export function addBudget(book: BudgetBook, budget: Budget): BudgetBook {
  if (book.entries.length >= MAX_BUDGETS) throw new Error(`At most ${MAX_BUDGETS} budgets`);
  const id = newId();
  return { activeId: id, entries: [...book.entries, { id, budget }] };
}

export function deleteBudget(book: BudgetBook, id: string): BudgetBook {
  if (book.entries.length <= 1) throw new Error('The only budget cannot be deleted');
  const entries = book.entries.filter((e) => e.id !== id);
  return { entries, activeId: book.activeId === id ? entries[0].id : book.activeId };
}
