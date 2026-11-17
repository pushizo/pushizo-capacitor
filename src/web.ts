/*
 * Web platformu: `@pushizo/web` SDK'sına devreder (Web Push + service worker, konum, özellik bayrakları, gömülü
 * yerleşimler). Native'e özgü işlemler (Android tepsi kimliği ile kaldırma, engellenmiş bildirimi sonradan gösterme)
 * web'de `unavailable` hatası verir; arka plan bölge izleme web'de yoktur.
 */
import { WebPlugin } from '@capacitor/core';
import WebSdk from '@pushizo/web';
import type {
  ForegroundLifecycleEvent as WebForegroundEvent,
  InAppMessage as WebInAppMessage,
  ContentCard as WebContentCard,
  InboxItem as WebInboxItem,
  InboxPage as WebInboxPage,
  LogLevel as WebLogLevel,
  NotificationClickEvent as WebClickEvent,
  PushSubscriptionState as WebPushSubscriptionState,
  UserPreferences as WebUserPreferences,
} from '@pushizo/web';

import type {
  ChatConfig,
  ChatConversationState,
  ChatIdentifyResult,
  ChatMessage,
  ChatMessagePage,
  FeatureFlagValue,
  PushizoNotification,
  PushizoPlugin,
  InAppAction,
  InAppBlock,
  InAppButton,
  InAppCarouselCard,
  InAppLayout,
  InAppMessage,
  InAppTrigger,
  ContentCard,
  ContentCardEvent,
  ContentCardFeed,
  DeliverySetting,
  DeliveryStatus,
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

function mapNotification(n: WebClickEvent['notification'] | WebForegroundEvent['notification']): PushizoNotification {
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

function mapContentCard(card: WebContentCard): ContentCard {
  return {
    id: card.id,
    messageId: card.messageId,
    type: card.type,
    title: card.title,
    body: card.body,
    url: card.url,
    imageUrl: card.imageUrl,
    buttonText: card.buttonText,
    data: card.data ?? {},
    pinned: card.pinned,
    priority: card.priority,
    viewed: card.viewed,
    clicked: card.clicked,
    expiresAt: millis(card.expiresAt),
    createdAt: millis(card.createdAt),
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

/** Web'de canlı sohbet `@pushizo/web` sohbet widget'ıyla sunulur; `Pushizo.Chat` yalnızca Android ve iOS'tadır. */
const CHAT_NATIVE_ONLY = "Capacitor web'de canlı sohbet Web SDK widget'ıyla sunulur; Pushizo.Chat yalnızca Android ve iOS'ta kullanılabilir";

function chatUnsupported(): Error {
  return codedError('PLATFORM_NOT_SUPPORTED', CHAT_NATIVE_ONLY);
}

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

// --- Gömülü yerleşimler: Web SDK sunucu JSON'unu olduğu gibi verir; native ayrıştırıcılarla (HsInAppParser /
// HSInAppParser) aynı kurallarla köprü modeline çevrilir, geçersiz blok/düğme atlanır, içeriksiz HTML mesajı düşer.

type JsonObject = Record<string, unknown>;
const IN_APP_LAYOUTS: readonly InAppLayout[] = ['modal', 'banner_top', 'banner_bottom', 'fullscreen'];
/** Rapor çağrıları için saklanan son `list` mesajları (kimliğe göre, en çok bu kadar). */
const MAX_PLACEMENT_CACHE = 50;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Pozitif tam sayı; aksi halde null (`auto_dismiss_seconds`, `html_height`). */
function positiveInt(value: unknown): number | null {
  const n = finite(value);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
}

function mapInAppTrigger(raw: JsonObject): InAppTrigger {
  const kind = typeof raw.kind === 'string' ? raw.kind : '';
  const unsupported: InAppTrigger = { kind: 'unsupported', name: kind };
  switch (kind) {
    case 'session_start':
      return { kind };
    case 'session_duration': {
      const seconds = finite(raw.seconds);
      return seconds === null ? unsupported : { kind, seconds };
    }
    case 'event':
    case 'screen':
      return typeof raw.name === 'string' ? { kind, name: raw.name } : unsupported;
    case 'trigger': {
      if (typeof raw.key !== 'string' || typeof raw.op !== 'string') return unsupported;
      const value = typeof raw.value === 'string' ? raw.value : finite(raw.value);
      return { kind, key: raw.key, op: raw.op, value };
    }
    default:
      return unsupported;
  }
}

/** Aksiyon yoksa `dismiss`; adressiz url/deeplink ve adsız outcome geçersizdir (düğme atlanır). */
function mapInAppAction(raw: unknown): InAppAction | null {
  if (!isObject(raw)) return { type: 'dismiss' };
  switch (raw.type) {
    case 'url': {
      const url = nonEmpty(raw.url);
      return url !== null && /^https?:\/\//.test(url) ? { type: 'url', url } : null;
    }
    case 'deeplink': {
      const url = nonEmpty(raw.url);
      return url === null ? null : { type: 'deeplink', url };
    }
    case 'tags': {
      const tags: Record<string, string> = {};
      if (isObject(raw.tags)) for (const [k, v] of Object.entries(raw.tags)) if (typeof v === 'string') tags[k] = v;
      return { type: 'tags', tags };
    }
    case 'push_prompt':
      return { type: 'push_prompt' };
    case 'outcome': {
      const name = nonEmpty(raw.name);
      return name === null ? null : { type: 'outcome', name, value: finite(raw.value) };
    }
    default:
      return { type: 'dismiss' };
  }
}

/** Kart düğmelerinde renk alanı yoktur (`withColors` false). */
function mapInAppButton(raw: JsonObject, withColors: boolean): InAppButton | null {
  const id = nonEmpty(raw.id);
  const action = mapInAppAction(raw.action);
  if (id === null || action === null) return null;
  return {
    id,
    text: typeof raw.text === 'string' ? raw.text : '',
    action,
    backgroundColor: withColors ? nonEmpty(raw.background_color) : null,
    textColor: withColors ? nonEmpty(raw.text_color) : null,
  };
}

function mapInAppBlock(raw: JsonObject): InAppBlock | null {
  switch (raw.type) {
    case 'image': {
      const url = nonEmpty(raw.url);
      return url === null ? null : { type: 'image', url, alt: nonEmpty(raw.alt) };
    }
    case 'title':
    case 'body':
      return { type: raw.type, text: typeof raw.text === 'string' ? raw.text : '' };
    case 'button': {
      const button = mapInAppButton(raw, true);
      return button === null ? null : { type: 'button', ...button };
    }
    case 'carousel': {
      const id = nonEmpty(raw.id);
      if (id === null || !Array.isArray(raw.cards)) return null;
      const cards: InAppCarouselCard[] = [];
      for (const card of raw.cards) {
        if (!isObject(card)) continue;
        const cardId = nonEmpty(card.id);
        if (cardId === null) continue;
        cards.push({
          id: cardId,
          title: typeof card.title === 'string' ? card.title : '',
          body: nonEmpty(card.body),
          imageUrl: nonEmpty(card.image_url),
          imageAlt: nonEmpty(card.image_alt),
          button: isObject(card.button) ? mapInAppButton(card.button, false) : null,
        });
      }
      return cards.length === 0 ? null : { type: 'carousel', id, cards };
    }
    default:
      // Tanınmayan blok türü atlanır (ileri uyumluluk).
      return null;
  }
}

function mapInAppTriggers(raw: unknown): InAppTrigger[] {
  return Array.isArray(raw) ? raw.filter(isObject).map(mapInAppTrigger) : [];
}

/** Sunucu in-app öğesi → köprü modeli; kimliksiz, görünümsüz veya içeriksiz HTML mesajı null (atlanır). */
function mapInAppMessage(raw: WebInAppMessage): InAppMessage | null {
  const item = raw as unknown as JsonObject;
  const id = nonEmpty(item.id);
  const display = item.display;
  if (id === null || !isObject(display)) return null;
  const contentType = display.content_type === 'html' ? 'html' : 'blocks';
  const html = nonEmpty(display.html);
  if (contentType === 'html' && (html === null || html.trim() === '')) return null;
  const groups = Array.isArray(item.trigger_groups) ? item.trigger_groups.filter(Array.isArray).map(mapInAppTriggers) : [];
  const triggerGroups = groups.length > 0 ? groups : [mapInAppTriggers(item.triggers)];
  const layout = IN_APP_LAYOUTS.find((l) => l === display.layout) ?? 'modal';
  return {
    id,
    priority: finite(item.priority) ?? 0,
    triggers: triggerGroups[0],
    triggerGroups,
    variantId: nonEmpty(item.variant_id),
    display: {
      layout,
      backgroundColor: nonEmpty(display.background_color),
      textColor: nonEmpty(display.text_color),
      dismissible: display.dismissible !== false,
      autoDismissSeconds: positiveInt(display.auto_dismiss_seconds),
      contentType,
      blocks:
        contentType === 'html' || !Array.isArray(display.blocks)
          ? []
          : display.blocks.filter(isObject).map(mapInAppBlock).filter((b): b is InAppBlock => b !== null),
      html: contentType === 'html' ? html : null,
      htmlHeight: contentType === 'html' ? positiveInt(display.html_height) : null,
    },
    remainingImpressions: finite(item.remaining_impressions) ?? 1,
    minIntervalSeconds: finite(item.min_interval_seconds) ?? 0,
    stopAfterInteraction: item.stop_after_interaction === true,
    lastImpressionAt: millis(nonEmpty(item.last_impression_at)),
    endAt: millis(nonEmpty(item.end_at)),
    language: null,
  };
}

function mapState(s: WebPushSubscriptionState): PushSubscriptionState {
  return { id: s.id, token: s.token, optedIn: s.optedIn, permission: s.permission === 'granted' };
}

export class PushizoWeb extends WebPlugin implements PushizoPlugin {
  private listenersAttached = false;
  private lastPermission: boolean | null = null;
  private foregroundSeq = 0;
  /** Engellenen ön plan bildirimleri (web'de sonradan gösterilemez). */
  private readonly preventedIds = new Set<string>();
  private serviceWorkerScope: string | undefined;
  /** Son `placementsList` yanıtlarındaki Web SDK mesajları; raporlar bu nesnelerle yapılır. */
  private readonly placementMessages = new Map<string, WebInAppMessage>();

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

  async contentCardsList(options: { limit: number }): Promise<ContentCardFeed> {
    const feed = await this.sdk.ContentCards.list(options.limit);
    return { cards: feed.cards.map(mapContentCard), unviewedCount: feed.unviewedCount };
  }

  async contentCardEvent(options: { id: string; event: ContentCardEvent }): Promise<ContentCard> {
    const cards = this.sdk.ContentCards;
    if (options.event === 'impression') return mapContentCard(await cards.logImpression(options.id));
    if (options.event === 'click') return mapContentCard(await cards.logClick(options.id));
    if (options.event === 'dismiss') return mapContentCard(await cards.dismiss(options.id));
    throw codedError('INVALID_ARGUMENT', 'Kart olayı impression, click veya dismiss olmalı.');
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

  /** Web'de arka plan bölge izleme yoktur (ADR-0065): ayar etkisizdir, durum her zaman false. */
  async setGeofencingEnabled(_options: { enabled: boolean }): Promise<void> {
    return;
  }

  async isGeofencingEnabled(): Promise<{ enabled: boolean }> {
    return { enabled: false };
  }

  /** Android teslimat güçlendirme (ADR-0092) web'de yoktur: durum "desteklenmiyor", diğerleri etkisiz false. */
  async deliveryStatus(): Promise<Partial<DeliveryStatus>> {
    return { supported: false };
  }

  async deliveryShouldShowGuidance(_options: { minIntervalDays: number }): Promise<{ show: boolean }> {
    return { show: false };
  }

  async deliveryOpenSettings(_options: { setting: DeliverySetting }): Promise<{ opened: boolean }> {
    return { opened: false };
  }

  async deliveryShowGuidance(_options: { setting: DeliverySetting; message?: string }): Promise<{ opened: boolean }> {
    return { opened: false };
  }

  /** Web SDK `refresh` başarı bilgisi döndürmez; yeni değerler yazıldığında bayrak gözlemcisi çağrılır. */
  async featureFlagsRefresh(): Promise<{ success: boolean }> {
    let success = false;
    const remove = this.sdk.FeatureFlags.addObserver(() => {
      success = true;
    });
    try {
      await this.sdk.FeatureFlags.refresh();
    } finally {
      remove();
    }
    return { success };
  }

  async featureFlagsIsEnabled(options: { key: string; defaultValue: boolean }): Promise<{ enabled: boolean }> {
    return { enabled: this.sdk.FeatureFlags.isEnabled(options.key, options.defaultValue === true) };
  }

  async featureFlagsGetValue(options: { key: string }): Promise<{ value: FeatureFlagValue }> {
    return { value: this.sdk.FeatureFlags.getValue<FeatureFlagValue>(options.key) ?? null };
  }

  /** Anahtar ve hazırlık denetimi Web SDK'dadır; dönen mesajlar rapor çağrıları için saklanır. */
  async placementsList(options: { key: string; limit: number }): Promise<{ messages: InAppMessage[] }> {
    const messages: InAppMessage[] = [];
    for (const raw of await this.sdk.Placements.list(options.key, { limit: options.limit })) {
      const message = mapInAppMessage(raw);
      if (message === null) continue;
      this.placementMessages.delete(raw.id);
      this.placementMessages.set(raw.id, raw);
      messages.push(message);
    }
    for (const id of this.placementMessages.keys()) {
      if (this.placementMessages.size <= MAX_PLACEMENT_CACHE) break;
      this.placementMessages.delete(id);
    }
    return { messages };
  }

  // Raporlar yalnızca `placementsList` ile alınmış mesajlar için; tanınmayan kimlik sessizce yok sayılır.
  async placementsReportImpression(options: { id: string }): Promise<void> {
    const message = this.placementMessages.get(options.id);
    if (message) this.sdk.Placements.reportImpression(message);
  }

  async placementsReportClick(options: { id: string; buttonId: string }): Promise<void> {
    const message = this.placementMessages.get(options.id);
    if (message) this.sdk.Placements.reportClick(message, options.buttonId);
  }

  async placementsReportDismiss(options: { id: string }): Promise<void> {
    const message = this.placementMessages.get(options.id);
    if (message) this.sdk.Placements.reportDismiss(message);
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

  // Canlı sohbet: web'de açık hatayla reddedilir (sessizce yok sayılmaz).
  async chatStart(): Promise<ChatIdentifyResult> {
    throw chatUnsupported();
  }

  async chatGetConfig(): Promise<ChatConfig> {
    throw chatUnsupported();
  }

  async chatGetConversation(): Promise<ChatConversationState> {
    throw chatUnsupported();
  }

  async chatGetMessages(): Promise<ChatMessagePage> {
    throw chatUnsupported();
  }

  async chatSendMessage(): Promise<ChatMessage> {
    throw chatUnsupported();
  }

  async chatSendAttachment(): Promise<ChatMessage> {
    throw chatUnsupported();
  }

  async chatMarkRead(): Promise<{ unreadCount: number }> {
    throw chatUnsupported();
  }

  async chatRefreshUnreadCount(): Promise<{ unreadCount: number }> {
    throw chatUnsupported();
  }

  async chatGetUnreadCount(): Promise<{ unreadCount: number }> {
    throw chatUnsupported();
  }

  async chatLeaveOfflineMessage(): Promise<ChatMessage> {
    throw chatUnsupported();
  }

  async chatSetTyping(): Promise<void> {
    throw chatUnsupported();
  }

  async chatStartListening(): Promise<void> {
    throw chatUnsupported();
  }

  async chatStopListening(): Promise<void> {
    throw chatUnsupported();
  }

  async chatAttachmentUrl(): Promise<{ url: string }> {
    throw chatUnsupported();
  }

  async chatGetVisitorId(): Promise<{ visitorId: string | null }> {
    throw chatUnsupported();
  }
}
