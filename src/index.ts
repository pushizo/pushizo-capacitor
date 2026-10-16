import { registerPlugin } from '@capacitor/core';

import { PushizoCore } from './core.js';
import type { Bridge, BridgeEventType } from './core.js';
import type { PushizoPlugin } from './definitions.js';

/** Ham native eklenti (Android `PushizoPlugin.kt`, iOS `PushizoPlugin.swift`, web `PushizoWeb`). */
export const PushizoNative = registerPlugin<PushizoPlugin>('Pushizo', {
  web: () => import('./web.js').then((m) => new m.PushizoWeb()),
});

const EVENT_TYPES: readonly BridgeEventType[] = [
  'click',
  'foregroundWillDisplay',
  'pushSubscriptionChange',
  'permissionChange',
  'inAppClick',
  'inAppLifecycle',
];

/** Capacitor eklentisini cephenin taşıma arayüzüne uyarlar. */
export function capacitorBridge(plugin: PushizoPlugin): Bridge {
  return {
    call<T>(method: string, args?: Record<string, unknown>): Promise<T> {
      const fn = (plugin as unknown as Record<string, ((a?: unknown) => Promise<T>) | undefined>)[method];
      if (typeof fn !== 'function') return Promise.reject(new Error(`Pushizo: bilinmeyen metot ${method}`));
      return fn.call(plugin, args ?? {});
    },
    async subscribe(handler) {
      await Promise.all(
        EVENT_TYPES.map((type) =>
          (plugin.addListener as (e: string, l: (p: unknown) => void) => Promise<unknown>)(type, (payload) =>
            handler(type, payload),
          ),
        ),
      );
    },
  };
}

/**
 * Pushizo Capacitor SDK (eski sağlayıcı v5 yüzeyiyle uyumlu).
 *
 * ```ts
 * import { Pushizo } from '@pushizo/capacitor';
 * await Pushizo.initialize('app_…', { apiUrl: 'https://api.example.com' });
 * await Pushizo.Notifications.requestPermission();
 * await Pushizo.login('user_42');
 * await Pushizo.User.addTag('plan', 'pro');
 * Pushizo.Notifications.addClickListener((e) => console.log(e.result.url));
 * ```
 */
export const Pushizo = new PushizoCore(capacitorBridge(PushizoNative));
export default Pushizo;

export { PushizoCore, normalizeNotification } from './core.js';
export type { Bridge, BridgeEventType } from './core.js';
export * from './definitions.js';
