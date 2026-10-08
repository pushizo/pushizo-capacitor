import { registerPlugin } from '@capacitor/core';

import { createHeroSignal } from './bridge.js';
import type { HeroSignalPlugin } from './definitions.js';

/**
 * Ham Capacitor köprüsü (native: Android/iOS eklentisi, web: `@herosignal/web`). Uygulama kodunda
 * ad alanlı `HeroSignal` API'si tercih edilir.
 */
export const HeroSignalNative = registerPlugin<HeroSignalPlugin>('HeroSignal', {
  web: () => import('./web.js').then((m) => new m.HeroSignalWeb()),
});

/**
 * HeroSignal Capacitor API'si (plan 06 §6.1, eski sağlayıcı v5 ile uyumlu ad alanları).
 *
 * ```ts
 * import { HeroSignal } from '@herosignal/capacitor';
 * await HeroSignal.initialize('app_…', { apiUrl: 'https://api.example.com' });
 * await HeroSignal.Notifications.requestPermission();
 * await HeroSignal.login('user_42');
 * await HeroSignal.User.addTags({ plan: 'pro' });
 * HeroSignal.Notifications.addClickListener((e) => console.log(e.result.url));
 * ```
 */
export const HeroSignal = createHeroSignal(HeroSignalNative);
export default HeroSignal;

export * from './definitions.js';
export {
  createHeroSignal,
  toEventPayload,
  toInboxListOptions,
  toNotificationId,
  toStringRecord,
  type HeroSignalApi,
  type ScalarValue,
} from './bridge.js';
