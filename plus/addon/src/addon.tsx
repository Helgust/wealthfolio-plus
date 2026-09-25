import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AddonContext, AddonEnableFunction } from '@wealthfolio/addon-sdk';
import { registerTranslations } from '@wealthfolio/addon-sdk';
import { Phase0Page } from './pages/phase0-page';

// Хост сам монтирует `component` маршрута без ctx, поэтому ctx запоминаем при enable.
// createRoot самим не вызывать — корнем React владеет хост.
let addonCtx: AddonContext | undefined;

const AddonRoute = () => (
  <QueryClientProvider client={addonCtx!.api.query.getClient() as QueryClient}>
    <Phase0Page ctx={addonCtx!} />
  </QueryClientProvider>
);

const enable: AddonEnableFunction = (ctx) => {
  addonCtx = ctx;

  registerTranslations({
    en: { 'phase0.greeting': 'Hello from the addon' },
    es: { 'phase0.greeting': 'Hola desde el complemento' },
    ru: { 'phase0.greeting': 'Привет из аддона' },
  });

  // `id` обязан совпадать с `contributes.routes[].id` в manifest.json.
  ctx.router.add({
    id: 'planificador-es',
    path: '/addons/planificador-es',
    component: AddonRoute,
  });

  ctx.onDisable(() => {
    addonCtx = undefined;
  });
};

export default enable;
