import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AddonContext, AddonEnableFunction } from '@wealthfolio/addon-sdk';
import { registerTranslations } from '@wealthfolio/addon-sdk';
import type { ReactNode } from 'react';
import { Phase0Page } from './pages/phase0-page';
import { CHECKS_ROUTE, PlanPage } from './pages/plan-page';

// Хост сам монтирует `component` маршрута без ctx, поэтому ctx запоминаем при enable.
// createRoot самим не вызывать — корнем React владеет хост.
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

  // Только для страницы проверок фазы 0; интерфейс планировщика — на английском без i18n.
  registerTranslations({
    en: { 'phase0.greeting': 'Hello from the addon' },
    es: { 'phase0.greeting': 'Hola desde el complemento' },
    ru: { 'phase0.greeting': 'Привет из аддона' },
  });

  // `id` обязан совпадать с `contributes.routes[].id` в manifest.json.
  ctx.router.add({ id: 'planificador-es', path: '/addons/planificador-es', component: PlanRoute });
  ctx.router.add({ id: 'planificador-es-checks', path: CHECKS_ROUTE, component: ChecksRoute });

  ctx.onDisable(() => {
    addonCtx = undefined;
  });
};

export default enable;
