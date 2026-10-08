import { WebPlugin } from '@capacitor/core';
import { HeroSignal as defaultSdk, type HeroSignalSdk } from '@herosignal/web';
import type {
  ForegroundLifecycleEvent as WebForegroundEvent,
  InboxItem as WebInboxItem,
  NotificationClickEvent as WebClickEvent,
  PushSubscriptionState as WebSubscriptionState,
} from '@herosignal/web';

import type {
  HeroSignalNotification,
  HeroSignalPlugin,
  InboxItem,
  InboxPage,
  InitializeOptions,
  LogLevel,
  PermissionResult,
  PermissionStatus,
  PushSubscriptionState,
} from './definitions.js';

/** Web SDK'nın tepsi temizleme API'si (eski `@herosignal/web` sürümlerinde yoksa service worker ile yapılır). */
interface TrayApi {
  clearAll?: () => unknown;
  removeNotification?: (id: string) => unknown;
  removeGroupedNotifications?: (group: string) => unknown;
}

/** Service worker'ın gösterdiği bildirimin `data` alanı (`sdk/web/src/sw/payload.ts`). */
interface ShownNotificationData {
  hs?: { dlv?: unknown; delivery_id?: unknown };
}

const toWebLogLevel = (level: LogLevel) => (level === 'none' ? 'silent' : level);

function toStringMap(data: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

/** Web SDK bildirim modelini köprü modeline çevirir (web'de kaldırma kimliği teslimat kimliğidir). */
export function mapWebNotification(n: WebClickEvent['notification'] | WebForegroundEvent['notification']): HeroSignalNotification {
  return {
    notificationId: n.deliveryId ?? null,
    title: n.title || null,
    body: n.body || null,
    url: ('url' in n ? n.url : undefined) ?? null,
    imageUrl: null,
    deliveryId: n.deliveryId ?? null,
    messageId: n.messageId ?? null,
    groupKey: null,
    actions: [],
    data: toStringMap(n.data),
  };
}

export function mapWebInboxItem(item: WebInboxItem): InboxItem {
  return { ...item, data: { ...item.data } };
}

function mapSubscription(state: WebSubscriptionState): PushSubscriptionState {
  return { id: state.id, token: state.token, optedIn: state.optedIn };
}

function permissionResult(status: PermissionStatus): PermissionResult {
  return { granted: status === 'granted', status };
}

/**
 * Tarayıcı (PWA / `ionic serve`) uygulaması: `@herosignal/web` üzerine kurulur. Web SDK'nın service
 * worker dosyası (`HeroSignalSDKWorker.js`) sitenin kökünde yayınlanmalıdır.
 */
export class HeroSignalWeb extends WebPlugin implements HeroSignalPlugin {
  private listenersAttached = false;
  private foregroundEnabled = false;
  private foregroundSeq = 0;
  /** Senkron ön plan kararı: olay yayınlanırken `completeForegroundDisplay` buraya yazar. */
  private readonly pendingForeground = new Map<string, WebForegroundEvent>();

  constructor(private readonly sdk: HeroSignalSdk = defaultSdk) {
    super();
  }

  async initialize(options: InitializeOptions): Promise<void> {
    await this.sdk.init({
      appId: options.appId,
      ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
      ...(options.requiresPrivacyConsent !== undefined ? { requiresPrivacyConsent: options.requiresPrivacyConsent } : {}),
      ...(options.logLevel ? { logLevel: toWebLogLevel(options.logLevel) } : {}),
      ...(options.serviceWorkerPath ? { serviceWorkerPath: options.serviceWorkerPath } : {}),
      ...(options.allowLocalhostAsSecureOrigin !== undefined
        ? { allowLocalhostAsSecureOrigin: options.allowLocalhostAsSecureOrigin }
        : {}),
    });
    this.attachListeners();
  }

  /** SDK olaylarını Capacitor olaylarına bir kez bağlar (initialize tekrar çağrılsa da çoğalmaz). */
  private attachListeners(): void {
    if (this.listenersAttached) return;
    this.listenersAttached = true;
    this.sdk.Notifications.addClickListener((e) =>
      this.notifyListeners(
        'notificationClick',
        { notification: mapWebNotification(e.notification), result: { actionId: e.result.actionId ?? null, url: e.result.url ?? null } },
        true,
      ),
    );
    this.sdk.Notifications.addForegroundLifecycleListener((e) => this.onForeground(e));
    this.sdk.User.pushSubscription.addObserver((s) =>
      this.notifyListeners('pushSubscriptionChange', { current: mapSubscription(s) }),
    );
    this.sdk.InAppMessages.addClickListener((e) =>
      this.notifyListeners('inAppClick', { message: { id: e.message.id }, result: { actionId: e.result.actionId, url: e.result.url ?? null } }),
    );
    const lifecycle = (name: string) => (e: { message: { id: string } }) =>
      this.notifyListeners(name, { message: { id: e.message.id } });
    this.sdk.InAppMessages.addLifecycleListener({
      willDisplay: lifecycle('inAppWillDisplay'),
      didDisplay: lifecycle('inAppDidDisplay'),
      willDismiss: lifecycle('inAppWillDismiss'),
      didDismiss: lifecycle('inAppDidDismiss'),
    });
  }

  /** Web SDK kararı senkron ister: dinleyiciler `completeForegroundDisplay`'i olay içinde çağırır. */
  private onForeground(e: WebForegroundEvent): void {
    if (!this.foregroundEnabled) return;
    const eventId = `web-${++this.foregroundSeq}`;
    this.pendingForeground.set(eventId, e);
    try {
      this.notifyListeners('notificationWillDisplay', { eventId, notification: mapWebNotification(e.notification) });
    } finally {
      this.pendingForeground.delete(eventId);
    }
  }

  async setForegroundHandlerEnabled(options: { enabled: boolean }): Promise<void> {
    this.foregroundEnabled = options.enabled;
  }

  async completeForegroundDisplay(options: { eventId: string; display: boolean }): Promise<void> {
    const event = this.pendingForeground.get(options.eventId);
    if (!event) return;
    this.pendingForeground.delete(options.eventId);
    if (!options.display) event.preventDefault();
  }

  async setConsentGiven(options: { given: boolean }): Promise<void> {
    await this.sdk.setConsentGiven(options.given);
  }

  async login(options: { externalId: string; identityHash?: string }): Promise<void> {
    await this.sdk.login(options.externalId, options.identityHash);
  }

  async logout(): Promise<void> {
    await this.sdk.logout();
  }

  async addTags(options: { tags: Record<string, string> }): Promise<void> {
    this.sdk.User.addTags(options.tags);
  }

  async removeTags(options: { keys: string[] }): Promise<void> {
    this.sdk.User.removeTags(options.keys);
  }

  async getTags(): Promise<{ tags: Record<string, string> }> {
    return { tags: this.sdk.User.getTags() };
  }

  async addAliases(options: { aliases: Record<string, string> }): Promise<void> {
    this.sdk.User.addAliases(options.aliases);
  }

  async removeAlias(options: { label: string }): Promise<void> {
    this.sdk.User.removeAlias(options.label);
  }

  async setLanguage(options: { code: string }): Promise<void> {
    this.sdk.User.setLanguage(options.code);
  }

  async addEmail(options: { email: string }): Promise<void> {
    this.sdk.User.addEmail(options.email);
  }

  async removeEmail(options: { email: string }): Promise<void> {
    this.sdk.User.removeEmail(options.email);
  }

  async addSms(options: { phoneNumber: string }): Promise<void> {
    this.sdk.User.addSms(options.phoneNumber);
  }

  async removeSms(options: { phoneNumber: string }): Promise<void> {
    this.sdk.User.removeSms(options.phoneNumber);
  }

  async getUser(): Promise<{ id: string | null; externalId: string | null }> {
    return { id: this.sdk.User.id, externalId: this.sdk.User.externalId };
  }

  async getPushSubscription(): Promise<PushSubscriptionState> {
    return mapSubscription(this.sdk.User.pushSubscription.state);
  }

  async optIn(): Promise<void> {
    await this.sdk.User.pushSubscription.optIn();
  }

  async optOut(): Promise<void> {
    await this.sdk.User.pushSubscription.optOut();
  }

  async getPermission(): Promise<PermissionResult> {
    return permissionResult(this.sdk.Notifications.permission);
  }

  async requestPermission(): Promise<PermissionResult> {
    return permissionResult(await this.sdk.Notifications.requestPermission());
  }

  async clearAll(): Promise<void> {
    const tray = this.sdk.Notifications as TrayApi;
    if (typeof tray.clearAll === 'function') {
      await tray.clearAll();
      return;
    }
    await this.closeShown(() => true);
  }

  async removeNotification(options: { id: string }): Promise<void> {
    const tray = this.sdk.Notifications as TrayApi;
    if (typeof tray.removeNotification === 'function') {
      await tray.removeNotification(options.id);
      return;
    }
    await this.closeShown((n, data) => {
      const dlv = data.hs?.dlv ?? data.hs?.delivery_id;
      return dlv === options.id || n.tag === options.id;
    });
  }

  async removeGroupedNotifications(options: { group: string }): Promise<void> {
    const tray = this.sdk.Notifications as TrayApi;
    if (typeof tray.removeGroupedNotifications === 'function') {
      await tray.removeGroupedNotifications(options.group);
      return;
    }
    await this.closeShown((n) => n.tag === options.group);
  }

  /** Service worker'ın gösterdiği HeroSignal bildirimlerinden eşleşenleri kapatır (uygulamanın diğer bildirimleri hariç). */
  private async closeShown(match: (n: Notification, data: ShownNotificationData) => boolean): Promise<void> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return;
    const shown = await registration.getNotifications();
    for (const n of shown) {
      const data = (n.data ?? {}) as ShownNotificationData;
      if (data.hs && match(n, data)) n.close();
    }
  }

  async sendEvent(options: { name: string; properties?: Record<string, unknown>; value?: number }): Promise<void> {
    this.sdk.Session.sendEvent(options.name, options.properties, options.value);
  }

  async addTriggers(options: { triggers: Record<string, string> }): Promise<void> {
    this.sdk.InAppMessages.addTriggers(options.triggers);
  }

  async removeTriggers(options: { keys: string[] }): Promise<void> {
    this.sdk.InAppMessages.removeTriggers(options.keys);
  }

  async clearTriggers(): Promise<void> {
    this.sdk.InAppMessages.clearTriggers();
  }

  async getTriggers(): Promise<{ triggers: Record<string, string> }> {
    return { triggers: toStringMap(this.sdk.InAppMessages.getTriggers()) };
  }

  async setScreen(options: { name: string | null }): Promise<void> {
    this.sdk.InAppMessages.setScreen(options.name ?? '');
  }

  async setInAppPaused(options: { paused: boolean }): Promise<void> {
    this.sdk.InAppMessages.paused = options.paused;
  }

  async getInAppPaused(): Promise<{ paused: boolean }> {
    return { paused: this.sdk.InAppMessages.paused };
  }

  async inboxList(options: { limit: number; cursor?: string }): Promise<InboxPage> {
    const page = await this.sdk.Inbox.list(options);
    return { ...page, items: page.items.map(mapWebInboxItem) };
  }

  async inboxMarkRead(options: { id: string }): Promise<{ item: InboxItem }> {
    return { item: mapWebInboxItem(await this.sdk.Inbox.markRead(options.id)) };
  }

  async inboxMarkAllRead(): Promise<{ unreadCount: number }> {
    const result = await this.sdk.Inbox.markAllRead();
    return { unreadCount: result.unreadCount };
  }

  async inboxDelete(options: { id: string }): Promise<void> {
    await this.sdk.Inbox.archive(options.id);
  }

  async inboxUnreadCount(): Promise<{ unreadCount: number }> {
    return { unreadCount: await this.sdk.Inbox.unreadCount() };
  }

  async setLogLevel(options: { level: LogLevel }): Promise<void> {
    this.sdk.Debug.setLogLevel(toWebLogLevel(options.level));
  }
}
