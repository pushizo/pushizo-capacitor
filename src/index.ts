import { registerPlugin } from '@capacitor/core';

import { HeroSignalCore } from './core.js';
import type { Bridge, BridgeEventType } from './core.js';
import type { HeroSignalPlugin } from './definitions.js';

/** Ham native eklenti (Android `HeroSignalPlugin.kt`, iOS `HeroSignalPlugin.swift`, web `HeroSignalWeb`). */
export const HeroSignalNative = registerPlugin<HeroSignalPlugin>('HeroSignal', {
  web: () => import('./web.js').then((m) => new m.HeroSignalWeb()),
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
export function capacitorBridge(plugin: HeroSignalPlugin): Bridge {
  return {
    call<T>(method: string, args?: Record<string, unknown>): Promise<T> {
      const fn = (plugin as unknown as Record<string, ((a?: unknown) => Promise<T>) | undefined>)[method];
      if (typeof fn !== 'function') return Promise.reject(new Error(`HeroSignal: bilinmeyen metot ${method}`));
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
 * HeroSignal Capacitor SDK (eski sağlayıcı v5 yüzeyiyle uyumlu).
 *
 * ```ts
 * import { HeroSignal } from '@herosignal/capacitor';
 * await HeroSignal.initialize('app_…', { apiUrl: 'https://api.example.com' });
 * await HeroSignal.Notifications.requestPermission();
 * await HeroSignal.login('user_42');
 * await HeroSignal.User.addTag('plan', 'pro');
 * HeroSignal.Notifications.addClickListener((e) => console.log(e.result.url));
 * ```
 */
export const HeroSignal = new HeroSignalCore(capacitorBridge(HeroSignalNative));
export default HeroSignal;

export { HeroSignalCore, normalizeNotification } from './core.js';
export type { Bridge, BridgeEventType } from './core.js';
export * from './definitions.js';
