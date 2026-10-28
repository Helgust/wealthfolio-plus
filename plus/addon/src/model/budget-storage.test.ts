import type { AddonContext } from '@wealthfolio/addon-sdk';
import { describe, expect, it } from 'vitest';
import { newBudget } from './budget';
import { activeBudget, addBudget, deleteBudget, loadBudgets, saveBudgets, setBudget } from './budget-storage';

type Storage = AddonContext['api']['storage'];

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: Storage = {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
  return { data, storage };
}

const named = (name: string) => ({ ...newBudget(new Date(2026, 10, 1)), name });

describe('budget storage', () => {
  it('starts with an unsaved empty budget and round-trips a save', async () => {
    const { data, storage } = memoryStorage();
    const { book, error } = await loadBudgets(storage);
    expect(error).toBeUndefined();
    expect(activeBudget(book).budget.start).toMatch(/^\d{4}-\d{2}$/);
    expect(data.size).toBe(0);

    await saveBudgets(storage, setBudget(book, book.activeId, named('Base')));
    const again = await loadBudgets(storage);
    expect(activeBudget(again.book).budget.name).toBe('Base');
  });

  it('adds, switches and deletes budgets; the last one stays', async () => {
    const { storage } = memoryStorage();
    const { book } = await loadBudgets(storage);
    const two = addBudget(book, named('Second'));
    expect(activeBudget(two).budget.name).toBe('Second');
    const one = deleteBudget(two, two.activeId);
    expect(one.activeId).toBe(book.activeId);
    expect(() => deleteBudget(one, one.activeId)).toThrow();
  });

  it('keeps an unreadable record before anything is written over it', async () => {
    const bad = JSON.stringify({ activeId: 'a', entries: [{ id: 'a', budget: { name: 'x' } }] });
    const { data, storage } = memoryStorage({ 'budgets.v1': bad });
    const { book, error } = await loadBudgets(storage);
    expect(error).toContain('entries.0.budget');
    expect(data.get('budgets.v1.unreadable')).toBe(bad);
    await saveBudgets(storage, book);
    expect(data.get('budgets.v1.unreadable')).toBe(bad);
  });

  it('refuses to save a budget that fails the schema', async () => {
    const { data, storage } = memoryStorage();
    const { book } = await loadBudgets(storage);
    await expect(
      saveBudgets(storage, setBudget(book, book.activeId, { ...named('Bad'), months: 0 })),
    ).rejects.toThrow();
    expect(data.size).toBe(0);
  });
});
