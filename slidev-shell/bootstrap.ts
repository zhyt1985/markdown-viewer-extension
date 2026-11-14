/**
 * Slidev Shell bootstrap
 *
 * Separated from main.ts so that all @slidev/client imports
 * (and the shims that read window.__SLIDEV__) are deferred
 * until after data is injected via postMessage.
 */

/// <reference types="@slidev/types/client" />

import { createApp } from 'vue'
import App from '@slidev/client/App.vue'
import setupMain from '@slidev/client/setup/main'
import { useNav, type SlidevContextNavFull } from '@slidev/client/composables/useNav'

import 'uno.css'

export async function bootstrap(onReady?: (nav: SlidevContextNavFull) => Promise<void>) {
  const app = createApp(App)
  await setupMain(app)
  app.mount('#app')
  if (onReady) await app.runWithContext(async () => {
    const nav = useNav()
    await nav.router.isReady()
    await onReady(nav)
  })
}
