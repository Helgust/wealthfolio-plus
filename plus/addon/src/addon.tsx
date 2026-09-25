import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AddonContext, AddonEnableFunction } from '@wealthfolio/addon-sdk';
import { registerTranslations } from '@wealthfolio/addon-sdk';
import type { ReactNode } from 'react';
import { Phase0Page } from './pages/phase0-page';
import { CHECKS_ROUTE, PlanPage } from './pages/plan-page';

// The host mounts the route `component` itself without ctx, so ctx is kept at enable.
// Never call createRoot here — the host owns the React root.
let addonCtx: AddonContext | undefined;

const WithQuery = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={addonCtx!.api.query.getClient() as QueryClient}>
    {children}
  </QueryClientProvider>
);

const PlanRoute = () => (
  <WithQuery>
    <PlanPage ctx={addonCtx!} />
  </WithQuery>
);

const ChecksRoute = () => (
  <WithQuery>
    <Phase0Page ctx={addonCtx!} />
  </WithQuery>
);

const enable: AddonEnableFunction = (ctx) => {
  addonCtx = ctx;

  // Only for the phase 0 checks page; the planner UI is English without i18n.
  // The ru string below is Russian test data for the phase 0 localization check.
  registerTranslations({
    en: { 'phase0.greeting': 'Hello from the addon' },
    es: { 'phase0.greeting': 'Hola desde el complemento' },
    ru: { 'phase0.greeting': 'Привет из аддона' },
  });

  // `id` must match `contributes.routes[].id` in manifest.json.
  ctx.router.add({ id: 'planificador-es', path: '/addons/planificador-es', component: PlanRoute });
  ctx.router.add({ id: 'planificador-es-checks', path: CHECKS_ROUTE, component: ChecksRoute });

  ctx.onDisable(() => {
    addonCtx = undefined;
  });
};

export default enable;
