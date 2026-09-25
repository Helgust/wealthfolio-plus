import type { AddonContext } from '@wealthfolio/addon-sdk';
import { describe, expect, it } from 'vitest';
import { defaultPlan } from './plan';
import { activeEntry, addPlan, deletePlan, loadPlanBook, savePlan, selectPlan } from './plan-storage';

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

const named = (name: string) => ({ ...defaultPlan(2026), name });

describe('plan storage', () => {
  it('starts with an unsaved template and stores it on the first save', async () => {
    const { data, storage } = memoryStorage();
    const book = await loadPlanBook(storage, 2026);
    expect(book.entries).toHaveLength(1);
    expect(activeEntry(book).isDefault).toBe(true);
    expect(data.size).toBe(0);

    await savePlan(storage, book, book.activeId, named('Base'));
    const again = await loadPlanBook(storage, 2026);
    expect(again.activeId).toBe(book.activeId);
    expect(activeEntry(again)).toMatchObject({ isDefault: false, plan: { name: 'Base' } });
  });

  it('moves the phases 1–2 plan to the new layout once and keeps its key', async () => {
    const legacy = JSON.stringify(named('Old'));
    const { data, storage } = memoryStorage({ 'plan.v1': legacy });
    const book = await loadPlanBook(storage, 2026);
    expect(activeEntry(book)).toMatchObject({ isDefault: false, plan: { name: 'Old' } });
    expect(data.get(`plan.v1:${book.activeId}`)).toBe(legacy);
    expect(data.get('plan.v1')).toBe(legacy);

    const again = await loadPlanBook(storage, 2026);
    expect(again.entries.map((e) => e.id)).toEqual([book.activeId]);
  });

  it('adds, selects and deletes plans across reloads', async () => {
    const { data, storage } = memoryStorage({ 'plan.v1': JSON.stringify(named('A')) });
    let book = await loadPlanBook(storage, 2026);
    const a = book.activeId;
    book = await addPlan(storage, book, named('B'));
    const b = book.activeId;
    expect(b).not.toBe(a);

    book = await selectPlan(storage, book, a);
    let loaded = await loadPlanBook(storage, 2026);
    expect(loaded.entries.map((e) => e.plan.name)).toEqual(['A', 'B']);
    expect(loaded.activeId).toBe(a);

    book = await deletePlan(storage, book, a);
    expect(book.activeId).toBe(b);
    expect(data.has(`plan.v1:${a}`)).toBe(false);
    loaded = await loadPlanBook(storage, 2026);
    expect(loaded.entries.map((e) => e.plan.name)).toEqual(['B']);
    await expect(deletePlan(storage, book, b)).rejects.toThrow(/only plan/);
  });

  it('shows a template for an unreadable plan without touching the others', async () => {
    const { storage } = memoryStorage({
      'plans.v1': JSON.stringify({ ids: ['x', 'y'], activeId: 'gone' }),
      'plan.v1:x': '{broken',
      'plan.v1:y': JSON.stringify(named('Y')),
    });
    const book = await loadPlanBook(storage, 2026);
    expect(book.activeId).toBe('x');
    expect(book.entries[0].isDefault).toBe(true);
    expect(book.entries[0].error).toMatch(/Invalid JSON/);
    expect(book.entries[1].plan.name).toBe('Y');
  });
});
