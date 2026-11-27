import { Capacitor } from '@capacitor/core';

import { environment } from '../environments/environment';

export const SERVICE_WORKER_URL = 'service-worker.js';

/**
 * Registers the service worker that lets the browser install SAYC and open it offline.
 * Only in production builds: during `ng serve` it would keep serving old copies of the code.
 * Not in the Android app either, which already carries its files on the device.
 */
export function registerServiceWorker(
  production = environment.production,
  native = Capacitor.isNativePlatform(),
  nav: Navigator = navigator,
): Promise<ServiceWorkerRegistration | null> {
  if (!production || native || !('serviceWorker' in nav)) return Promise.resolve(null);
  return nav.serviceWorker.register(SERVICE_WORKER_URL, { scope: './' }).catch((err) => {
    // The app works the same without it; it just can't be installed or opened offline.
    console.error('Service worker registration failed', err);
    return null;
  });
}
