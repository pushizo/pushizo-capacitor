/*
 * Web platformu: `@herosignal/web` SDK'sına devreder (Web Push + service worker, konum). Native'e özgü
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
  UserPreferences as WebUserPreferences,
} from '@herosignal/web';

import type {
  HeroSignalNotification,
  HeroSignalPlugin,
  InboxItem,
  InboxListOptions,
  InboxPage,
  InitializeOptions,
  LiveActivityValue,
  LogLevel,
  PreferenceInput,
  PushSubscriptionState,
  RawForegroundEvent,
  UserPreference,
  UserPreferences,
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

function mapPreferences(result: WebUserPreferences): UserPreferences {
  return {
    preferences: result.preferences.map((p) => ({
      category: p.category,
      channel: p.channel ?? null,
      optedIn: p.optedIn,
      explicit: p.explicit,
      source: p.source ?? null,
      updatedAt: millis(p.updatedAt),
    })),
    categories: result.categories.map((c) => ({
      key: c.key,
      name: c.name ?? {},
      description: c.description ?? {},
      channels: c.channels ?? null,
      defaultOptedIn: c.defaultOptedIn,
    })),
  };
}

/** Native köprünün sunucu hata kodlarıyla aynı `code` alanını taşıyan hata. */
function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Android köprüsüyle aynı ret mesajı (`PLATFORM_NOT_SUPPORTED`). */
const LIVE_ACTIVITIES_IOS_ONLY = "Live Activities yalnızca iOS'ta desteklenir";

/**
 * Kuyruğa alınan yazma sunucuya ulaştığında `PUT /preferences` yanıtının içereceği listeyi üretir (sunucuyla aynı kural):
 * aynı kategori × kanal kaydı açık değerle değiştirilir, yoksa kategorinin son kaydından sonra eklenir.
 */
function applyPreferenceInputs(current: UserPreferences, inputs: PreferenceInput[], now: number): UserPreferences {
  const preferences = [...current.preferences];
  for (const input of inputs) {
    const channel = input.channel ?? null;
    const next: UserPreference = { category: input.category, channel, optedIn: input.optedIn, explicit: true, source: 'sdk', updatedAt: now };
    const index = preferences.findIndex((p) => p.category === input.category && p.channel === channel);
    if (index >= 0) {
      preferences[index] = next;
      continue;
    }
    let last = -1;
    preferences.forEach((p, i) => {
      if (p.category === input.category) last = i;
    });
    preferences.splice(last >= 0 ? last + 1 : preferences.length, 0, next);
  }
  return { preferences, categories: current.categories };
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

  async login(options: { externalId: string; identityHash?: string; jwt?: string }): Promise<void> {
    await this.sdk.login(options.externalId, { identityHash: options.identityHash, jwt: options.jwt });
  }

  async updateUserJwt(options: { jwt: string }): Promise<void> {
    await this.sdk.updateUserJwt(options.jwt);
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

  /** Web SDK yerel e-posta/SMS listesini dışa açmadığından desteklenmez. */
  async getContacts(): Promise<{ emails: string[]; smsNumbers: string[] }> {
    throw this.unavailable('getEmails/getSmsNumbers yalnızca Android ve iOS\'ta kullanılabilir.');
  }

  async getPreferences(): Promise<UserPreferences> {
    return mapPreferences(await this.sdk.User.getPreferences());
  }

  /**
   * Web SDK tercih yazmasını çevrimdışı kuyruğa alır ve sonuç döndürmez. Native ile aynı sözleşme için önce güncel
   * liste okunur (abonelik ve sahiplik kanıtı gerekir), kategori/kanal sunucu kurallarıyla denetlenir, yazma kuyruğa
   * verilir ve sunucunun yazma sonrası döndüreceği liste üretilir.
   */
  async setPreferences(options: { preferences: PreferenceInput[] }): Promise<UserPreferences> {
    const inputs = options.preferences ?? [];
    const current = mapPreferences(await this.sdk.User.getPreferences());
    for (const p of inputs) {
      const category = current.categories.find((c) => c.key === p.category);
      if (!category) throw codedError('HS_NOT_FOUND', `Kategori bulunamadı: ${p.category}`);
      if (p.channel && category.channels && !category.channels.includes(p.channel)) {
        throw codedError('HS_VALIDATION_ERROR', `'${p.category}' kategorisi ${p.channel} kanalını kapsamıyor.`);
      }
    }
    this.sdk.User.setPreferences(inputs.map((p) => ({ category: p.category, optedIn: p.optedIn, channel: p.channel ?? null })));
    return applyPreferenceInputs(current, inputs, Date.now());
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

  async removeNotification(_options: { id?: number; identifier?: string }): Promise<void> {
    throw this.unavailable('removeNotification yalnızca Android ve iOS\'ta kullanılabilir.');
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

  /** Konum paylaşımı Web SDK'ya iletilir (`init` öncesinde Web SDK hata fırlatır). */
  async setLocationShared(options: { shared: boolean }): Promise<void> {
    this.sdk.Location.setShared(options.shared === true);
  }

  async isLocationShared(): Promise<{ shared: boolean }> {
    return { shared: this.sdk.Location.isShared };
  }

  /** Tarayıcı Geolocation izni; Web SDK önce açıklama kutusunu gösterir, vazgeçilirse tarayıcı istemi açılmaz. */
  async requestLocationPermission(options: { rationale?: string }): Promise<{ permission: boolean }> {
    return { permission: await this.sdk.Location.requestPermission(options.rationale) };
  }

  /** Live Activities bir iOS (ActivityKit) özelliğidir; web'de sessizce yok sayılmaz, açık hatayla reddedilir. */
  async setupDefaultLiveActivity(): Promise<void> {
    throw codedError('PLATFORM_NOT_SUPPORTED', LIVE_ACTIVITIES_IOS_ONLY);
  }

  async startDefaultLiveActivity(_options: {
    activityId: string;
    attributes: Record<string, LiveActivityValue>;
    contentState: Record<string, LiveActivityValue>;
  }): Promise<void> {
    throw codedError('PLATFORM_NOT_SUPPORTED', LIVE_ACTIVITIES_IOS_ONLY);
  }
}
