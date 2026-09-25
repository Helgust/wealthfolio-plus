// Monte Carlo run of the page's plan: started by the user, it runs in slices outside React. The
// run lives in a store owned by the page, so it goes on while other tabs are open, and its progress
// re-renders only the component that shows it. A run belongs to the plan and starting point it was
// started for: when they change, it is stopped and its result is no longer shown.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { StartingPoint } from '../engine/run-plan';
import { runMonteCarlo, type MonteCarloResult } from '../lib/monte-carlo';
import type { Plan } from '../model/plan';

export interface MonteCarloRun {
  plan: Plan;
  start: StartingPoint;
  /** Trials done */
  done: number;
  result: MonteCarloResult | null;
  /** How long the run took, ms */
  ms: number | null;
  error: string | null;
}

export interface MonteCarloStore {
  subscribe: (listener: () => void) => () => void;
  get: () => MonteCarloRun | null;
  run: (plan: Plan, start: StartingPoint) => void;
  stop: () => void;
}

function createMonteCarloStore(): MonteCarloStore {
  let current: MonteCarloRun | null = null;
  let controller: AbortController | null = null;
  const listeners = new Set<() => void>();
  const set = (next: MonteCarloRun | null) => {
    current = next;
    listeners.forEach((l) => l());
  };
  const stop = () => controller?.abort();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => current,
    stop,
    run: (plan, start) => {
      stop();
      const ac = new AbortController();
      controller = ac;
      const update = (patch: Partial<MonteCarloRun>) => {
        if (!ac.signal.aborted && current) set({ ...current, ...patch });
      };
      set({ plan, start, done: 0, result: null, ms: null, error: null });
      const began = performance.now();
      runMonteCarlo(plan, start, { signal: ac.signal, onProgress: (done) => update({ done }) }).then(
        (result) => update({ result, ms: performance.now() - began }),
        (e: unknown) => update({ error: String(e) }),
      );
    },
  };
}

/** The page's store; its run stops when the plan or the starting point changes or the page closes. */
export function useMonteCarloStore(plan: Plan | undefined, start: StartingPoint | null): MonteCarloStore {
  const [store] = useState(createMonteCarloStore);
  useEffect(() => store.stop, [store, plan, start]);
  return store;
}

/** The store's run if it was started for this plan and starting point. */
export function useMonteCarloRun(store: MonteCarloStore, plan: Plan, start: StartingPoint): MonteCarloRun | null {
  const run = useSyncExternalStore(store.subscribe, store.get);
  return run && run.plan === plan && run.start === start ? run : null;
}
