/*
 * Web platformu: `@herosignal/web` SDK'sına devreder (Web Push + service worker). Native'e özgü
 * işlemler (Android tepsi kimliği ile kaldırma, engellenmiş bildirimi sonradan gösterme) web'de
 * `unavailable` hatası verir.
 */
import { WebPlugin } from '@capacitor/core';
import WebSdk from '@herosignal/web';
import type {
  ForegroundLifecycleEvent as WebForegroundEvent,
  InboxItem as WebInboxItem,
  InboxPage as WebInboxPage,
  LogLevel as WebLogLevel,
  NotificationClickEvent as WebClickEvent,
  PushSubscriptionState as WebPushSubscriptionState,
} from '@herosignal/web';

import type {
  HeroSignalNotification,
  HeroSignalPlugin,
  InboxItem,
  InboxListOptions,
  InboxPage,
  InitializeOptions,
  LogLevel,
  PushSubscriptionState,
  RawForegroundEvent,
} from './definitions.js';

/** Web SDK örneğinin bu eklentinin kullandığı yüzeyi (testlerde sahte örnek verilebilir). */
export type WebSdkInstance = typeof WebSdk;

function webLogLevel(level: LogLevel | undefined): WebLogLevel | undefined {
  if (level === undefined) return undefined;
  return level === 'none' ? 'silent' : level;
}

function millis(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function toStringRecord(data: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

function mapNotification(n: WebClickEvent['notification'] | WebForegroundEvent['notification']): HeroSignalNotification {
  return {
    title: n.title || null,
    body: n.body || null,
    url: ('url' in n ? n.url : undefined) ?? null,
    imageUrl: null,
    deliveryId: n.deliveryId ?? null,
    messageId: n.messageId ?? null,
    data: toStringRecord(n.data),
    androidNotificationId: null,
  };
}

function mapInboxItem(item: WebInboxItem): InboxItem {
  return {
    id: item.id,
    messageId: item.messageId,
    title: item.title,
    body: item.body,
    url: item.url,
    imageUrl: item.imageUrl,
    data: item.data ?? {},
    read: item.read,
    readAt: millis(item.readAt),
    archivedAt: millis(item.archivedAt),
    expiresAt: millis(item.expiresAt),
    createdAt: millis(item.createdAt),
  };
}

function mapInboxPage(page: WebInboxPage): InboxPage {
  return {
    items: page.items.map(mapInboxItem),
    unreadCount: page.unreadCount,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

function mapState(s: WebPushSubscriptionState): PushSubscriptionState {
  return { id: s.id, token: s.token, optedIn: s.optedIn, permission: s.permission === 'granted' };
}

export class HeroSignalWeb extends WebPlugin implements HeroSignalPlugin {
  private listenersAttached = false;
  private lastPermission: boolean | null = null;
  private foregroundSeq = 0;
  /** Engellenen ön plan bildirimleri (web'de sonradan gösterilemez). */
  private readonly preventedIds = new Set<string>();
  private serviceWorkerScope: string | undefined;

  constructor(private readonly sdk: WebSdkInstance = WebSdk) {
    super();
  }

  async initialize(options: InitializeOptions): Promise<void> {
    this.serviceWorkerScope = options.web?.serviceWorkerScope;
    await this.sdk.init({
      appId: options.appId,
      apiUrl: options.apiUrl,
      requiresPrivacyConsent: options.requiresPrivacyConsent,
      logLevel: webLogLevel(options.logLevel),
      serviceWorkerPath: options.web?.serviceWorkerPath,
      serviceWorkerScope: options.web?.serviceWorkerScope,
      allowLocalhostAsSecureOrigin: options.web?.allowLocalhostAsSecureOrigin,
    });
    this.attachListeners();
  }

  private attachListeners(): void {
    if (this.listenersAttached) return;
    this.listenersAttached = true;
    const sdk = this.sdk;
    this.lastPermission = sdk.Notifications.permission === 'granted';
    sdk.Notifications.addClickListener((e) => {
      this.notifyListeners(
        'click',
        { notification: mapNotification(e.notification), result: { actionId: e.result.actionId ?? null, url: e.result.url ?? null } },
        true,
      );
    });
    sdk.Notifications.addForegroundLifecycleListener((e) => {
      const notificationId = `web-${++this.foregroundSeq}`;
      const raw: RawForegroundEvent = { notificationId, pending: false, notification: mapNotification(e.notification) };
      // Tarayıcıda karar senkron verilir: cephe `preventDefault()` çağrısını doğrudan SDK'ya iletir.
      Object.defineProperty(raw, 'preventDefault', {
        enumerable: false,
        value: () => {
          this.preventedIds.add(notificationId);
          e.preventDefault();
        },
      });
      this.notifyListeners('foregroundWillDisplay', raw);
    });
    sdk.User.pushSubscription.addObserver((s) => {
      const state = mapState(s);
      this.notifyListeners('pushSubscriptionChange', state);
      this.emitPermission(state.permission);
    });
    sdk.InAppMessages.addClickListener((e) => {
      this.notifyListeners('inAppClick', { message: { id: e.message.id }, result: { actionId: e.result.actionId, url: e.result.url ?? null } });
    });
    const lifecycle = (event: 'willDisplay' | 'didDisplay' | 'willDismiss' | 'didDismiss') => (e: { message: { id: string } }) =>
      this.notifyListeners('inAppLifecycle', { event, message: { id: e.message.id } });
    sdk.InAppMessages.addLifecycleListener({
      willDisplay: lifecycle('willDisplay'),
      didDisplay: lifecycle('didDisplay'),
      willDismiss: lifecycle('willDismiss'),
      didDismiss: lifecycle('didDismiss'),
    });
  }

  private emitPermission(permission: boolean): void {
    if (this.lastPermission === permission) return;
    this.lastPermission = permission;
    this.notifyListeners('permissionChange', { permission });
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
    return mapState(this.sdk.User.pushSubscription.state);
  }

  async optIn(): Promise<void> {
    await this.sdk.User.pushSubscription.optIn();
  }

  async optOut(): Promise<void> {
    await this.sdk.User.pushSubscription.optOut();
  }

  async getPermission(): Promise<{ permission: boolean }> {
    return { permission: this.sdk.Notifications.permission === 'granted' };
  }

  async requestPermission(): Promise<{ permission: boolean }> {
    const permission = (await this.sdk.Notifications.requestPermission()) === 'granted';
    this.emitPermission(permission);
    return { permission };
  }

  /** Bu origin'in service worker'ının gösterdiği bildirimleri kapatır. */
  async clearAll(): Promise<void> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration(this.serviceWorkerScope);
    if (!registration) return;
    const notifications = await registration.getNotifications();
    notifications.forEach((n) => n.close());
  }

  async removeNotification(_options: { id: number }): Promise<void> {
    throw this.unavailable('removeNotification yalnızca Android\'de kullanılabilir.');
  }

  /** Web'de grup karşılığı bildirim `tag` alanıdır. */
  async removeGroupedNotifications(options: { group: string }): Promise<void> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration(this.serviceWorkerScope);
    if (!registration) return;
    const notifications = await registration.getNotifications({ tag: options.group });
    notifications.forEach((n) => n.close());
  }

  /** Web'de ön plan kararı senkron verildiğinden ayrı bir bayrak gerekmez. */
  async setForegroundHandlerEnabled(_options: { enabled: boolean }): Promise<void> {
    return;
  }

  async displayNotification(options: { notificationId: string }): Promise<void> {
    if (this.preventedIds.has(options.notificationId)) {
      this.preventedIds.delete(options.notificationId);
      throw this.unavailable('Web\'de engellenen bildirim sonradan gösterilemez.');
    }
    // Engellenmemiş bildirim service worker tarafından zaten gösterildi.
  }

  async sendEvent(options: { name: string; properties?: Record<string, unknown>; value?: number }): Promise<void> {
    this.sdk.Session.sendEvent(options.name, options.properties, options.value);
  }

  async setLogLevel(options: { level: LogLevel }): Promise<void> {
    this.sdk.Debug.setLogLevel(webLogLevel(options.level) ?? 'warn');
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
    return { triggers: toStringRecord(this.sdk.InAppMessages.getTriggers()) };
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

  async inboxList(options: InboxListOptions): Promise<InboxPage> {
    return mapInboxPage(await this.sdk.Inbox.list({ limit: options.limit, cursor: options.cursor }));
  }

  async inboxMarkRead(options: { id: string }): Promise<InboxItem> {
    return mapInboxItem(await this.sdk.Inbox.markRead(options.id));
  }

  async inboxMarkAllRead(): Promise<{ unreadCount: number }> {
    const result = await this.sdk.Inbox.markAllRead();
    return { unreadCount: result.unreadCount };
  }

  async inboxArchive(options: { id: string }): Promise<void> {
    await this.sdk.Inbox.archive(options.id);
  }

  async inboxUnreadCount(): Promise<{ unreadCount: number }> {
    return { unreadCount: await this.sdk.Inbox.unreadCount() };
  }
}
