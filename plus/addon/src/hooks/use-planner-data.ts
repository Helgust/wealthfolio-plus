// Data shared by the planner pages: Wealthfolio portfolio, account and real estate settings, and
// the stored plans.
// The query cache is the host's, so a change made on one page is seen by the other.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddonContext } from '@wealthfolio/addon-sdk';
import { useMemo } from 'react';
import { buildStart, loadPortfolio } from '../lib/starting-point';
import { loadAccountSettings } from '../model/accounts';
import { loadRealEstateSettings } from '../model/properties';
import { loadPlanBook, type PlanBook } from '../model/plan-storage';

export const PORTFOLIO_KEY = ['planificador-es', 'portfolio'];
export const SETTINGS_KEY = ['planificador-es', 'account-settings'];
export const PLANS_KEY = ['planificador-es', 'plans'];
export const REAL_ESTATE_KEY = ['planificador-es', 'real-estate'];

export function usePlannerData(ctx: AddonContext) {
  const queryClient = useQueryClient();
  const portfolio = useQuery({ queryKey: PORTFOLIO_KEY, queryFn: () => loadPortfolio(ctx) });
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => loadAccountSettings(ctx) });
  const realEstate = useQuery({ queryKey: REAL_ESTATE_KEY, queryFn: () => loadRealEstateSettings(ctx) });
  const book = useQuery({
    queryKey: PLANS_KEY,
    queryFn: () => loadPlanBook(ctx.api.storage, new Date().getFullYear()),
  });
  const start = useMemo(
    () =>
      portfolio.data && settings.data && realEstate.data
        ? buildStart(portfolio.data, settings.data, realEstate.data)
        : null,
    [portfolio.data, settings.data, realEstate.data],
  );

  /** Applies a storage operation to the plans and puts the result in the cache. */
  async function changePlans(op: (book: PlanBook) => Promise<PlanBook>): Promise<void> {
    queryClient.setQueryData<PlanBook>(PLANS_KEY, await op(book.data!));
  }

  return {
    portfolio: portfolio.data,
    settings: settings.data,
    realEstate: realEstate.data,
    book: book.data,
    start,
    error: portfolio.error ?? settings.error ?? realEstate.error ?? book.error,
    changePlans,
  };
}
