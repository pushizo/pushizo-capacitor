import type { PluginListenerHandle } from '@capacitor/core';

/** SDK günlük seviyesi (native `HsLog.Level` / `HSLog.Level`). */
export type LogLevel = 'none' | 'error' | 'warn' | 'info' | 'debug';

/** `Pushizo.initialize` seçenekleri. */
export interface InitializeOptions {
  /** Dashboard'daki uygulama kimliği (`app_…`). */
  appId: string;
  /** API kökü; varsayılan `https://api.pushizo.com`. */
  apiUrl?: string;
  /** KVKK/GDPR: `setConsentGiven(true)` çağrılana kadar hiçbir ağ çağrısı yapılmaz. */
  requiresPrivacyConsent?: boolean;
  /** Varsayılan `warn`. */
  logLevel?: LogLevel;
  /** Yalnızca web platformu (`@pushizo/web`) için service worker ayarları. */
  web?: {
    serviceWorkerPath?: string;
    serviceWorkerScope?: string;
    allowLocalhostAsSecureOrigin?: boolean;
  };
}

/**
 * `Pushizo.login` kimlik kanıtı (ADR-0023 §9). App'in `identity_verification_mode` ayarına göre HMAC
 * `identityHash` ve/veya sunucunuzda imzalanmış ES256 `jwt` (`sub` = externalId, `aud` = appId) verilir.
 */
export interface LoginOptions {
  identityHash?: string;
  /** SDK isteklerinde `Authorization: Bearer` başlığıyla gider; süresi dolunca `updateUserJwt` ile yenilenir. */
  jwt?: string;
}

/** Bildirim içeriği (native `HsNotification` / `HSNotification`). */
export interface PushizoNotification {
  title: string | null;
  body: string | null;
  url: string | null;
  imageUrl: string | null;
  deliveryId: string | null;
  messageId: string | null;
  data: Record<string, string>;
  /** Yalnızca Android: tepsi kimliği (`Notifications.removeNotification` için); iOS/web'de null. */
  androidNotificationId: number | null;
}

/** Bildirim tıklaması: `result.actionId` düğme kimliği (gövde tıklamasında null). */
export interface NotificationClickEvent {
  notification: PushizoNotification;
  result: { actionId: string | null; url: string | null };
}

/** Uygulama ön plandayken gelen bildirim; dinleyici gösterimi engelleyebilir veya erteleyebilir. */
export interface ForegroundWillDisplayEvent {
  notification: PushizoNotification;
  /** Bildirimin şimdi gösterilmesini engeller; daha sonra `display()` ile gösterilebilir. */
  preventDefault(): void;
  /** Engellenmiş bildirimi gösterir (iOS'ta olaydan sonra en fazla 25 sn içinde). */
  display(): Promise<void>;
  readonly prevented: boolean;
}

/** Push aboneliği durumu. */
export interface PushSubscriptionState {
  id: string | null;
  token: string | null;
  optedIn: boolean;
  permission: boolean;
}

export interface PermissionChangeEvent {
  permission: boolean;
}

export interface InAppClickEvent {
  message: { id: string };
  result: { actionId: string; url: string | null };
}

export type InAppLifecycleEventName = 'willDisplay' | 'didDisplay' | 'willDismiss' | 'didDismiss';

export interface InAppLifecycleEvent {
  event: InAppLifecycleEventName;
  message: { id: string };
}

/** In-app yaşam döngüsü dinleyicisi; yalnızca ilgilenilen alanlar verilir. */
export interface InAppLifecycleListener {
  willDisplay?: (event: InAppLifecycleEvent) => void;
  didDisplay?: (event: InAppLifecycleEvent) => void;
  willDismiss?: (event: InAppLifecycleEvent) => void;
  didDismiss?: (event: InAppLifecycleEvent) => void;
}

/** Bildirim kutusu öğesi; zamanlar epoch milisaniyedir. */
export interface InboxItem {
  id: string;
  messageId: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  imageUrl: string | null;
  data: Record<string, string>;
  read: boolean;
  readAt: number | null;
  archivedAt: number | null;
  expiresAt: number | null;
  createdAt: number | null;
}

export interface InboxPage {
  items: InboxItem[];
  unreadCount: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface InboxListOptions {
  /** 1-200 (varsayılan 50). */
  limit?: number;
  cursor?: string;
}

/** Tercih kanalı (ADR-0019 §4); tercihlerde `null` tüm kanallar demektir. */
export type PreferenceChannel = 'ios_push' | 'android_push' | 'web_push' | 'email' | 'sms';

/**
 * Kullanıcı tercihi: kategori × kanal → opt-in. `explicit` false ise değer kategori varsayılanından
 * türetilmiştir; `source` kaydı yazan taraftır (sdk, api, preference_center…).
 */
export interface UserPreference {
  category: string;
  /** null = tüm kanallar. */
  channel: PreferenceChannel | null;
  optedIn: boolean;
  explicit: boolean;
  source: string | null;
  /** Epoch milisaniye; türetilmiş değerde null. */
  updatedAt: number | null;
}

/** Mesaj kategorisi: çok dilli ad/açıklama (`dil kodu → metin`), kanal kısıtı (null = tümü) ve varsayılan opt-in. */
export interface PreferenceCategory {
  key: string;
  name: Record<string, string>;
  description: Record<string, string>;
  channels: string[] | null;
  defaultOptedIn: boolean;
}

/** `User.getPreferences` / `User.setPreferences` sonucu: kullanıcının tercihleri ve app'in kategorileri. */
export interface UserPreferences {
  preferences: UserPreference[];
  categories: PreferenceCategory[];
}

/** `User.setPreferences` girdisi; `channel` verilmezse veya null ise tüm kanallar. */
export interface PreferenceInput {
  category: string;
  optedIn: boolean;
  channel?: PreferenceChannel | null;
}

export type InAppTriggerValue = string | number | boolean;

/**
 * iOS Live Activity alan değeri (`PushizoDefaultLiveActivityAttributes.data` / `ContentState.data`): metin, sonlu
 * sayı veya mantıksal değer.
 */
export type LiveActivityValue = string | number | boolean;

/** Native katmanın gönderdiği ham ön plan olayı. */
export interface RawForegroundEvent {
  /** Erteleme kimliği; `displayNotification` ile kullanılır. */
  notificationId: string;
  /** true ise native gösterimi bekletiyor; JS karar vermeli (göster/engelle). */
  pending: boolean;
  notification: PushizoNotification;
}

export interface RawInAppLifecycleEvent {
  event: InAppLifecycleEventName;
  message: { id: string };
}

/**
 * Ham Capacitor eklenti yüzeyi (native köprü). Uygulamalar doğrudan `Pushizo` cephesini
 * (`index.ts`) kullanır; bu arayüz cephe ve testler içindir.
 */
export interface PushizoPlugin {
  initialize(options: InitializeOptions): Promise<void>;
  setConsentGiven(options: { given: boolean }): Promise<void>;
  login(options: { externalId: string; identityHash?: string; jwt?: string }): Promise<void>;
  updateUserJwt(options: { jwt: string }): Promise<void>;
  logout(): Promise<void>;

  addTags(options: { tags: Record<string, string> }): Promise<void>;
  removeTags(options: { keys: string[] }): Promise<void>;
  getTags(): Promise<{ tags: Record<string, string> }>;
  addAliases(options: { aliases: Record<string, string> }): Promise<void>;
  removeAlias(options: { label: string }): Promise<void>;
  setLanguage(options: { code: string }): Promise<void>;
  addEmail(options: { email: string }): Promise<void>;
  removeEmail(options: { email: string }): Promise<void>;
  addSms(options: { phoneNumber: string }): Promise<void>;
  removeSms(options: { phoneNumber: string }): Promise<void>;
  getUser(): Promise<{ id: string | null; externalId: string | null }>;
  getContacts(): Promise<{ emails: string[]; smsNumbers: string[] }>;
  getPreferences(): Promise<UserPreferences>;
  setPreferences(options: { preferences: PreferenceInput[] }): Promise<UserPreferences>;

  getPushSubscription(): Promise<PushSubscriptionState>;
  optIn(): Promise<void>;
  optOut(): Promise<void>;

  getPermission(): Promise<{ permission: boolean }>;
  requestPermission(): Promise<{ permission: boolean }>;
  clearAll(): Promise<void>;
  /** `id`: Android tepsi kimliği; `identifier`: iOS `UNNotificationRequest.identifier`. */
  removeNotification(options: { id?: number; identifier?: string }): Promise<void>;
  removeGroupedNotifications(options: { group: string }): Promise<void>;
  setForegroundHandlerEnabled(options: { enabled: boolean }): Promise<void>;
  displayNotification(options: { notificationId: string }): Promise<void>;

  sendEvent(options: { name: string; properties?: Record<string, unknown>; value?: number }): Promise<void>;
  setLogLevel(options: { level: LogLevel }): Promise<void>;

  addTriggers(options: { triggers: Record<string, string> }): Promise<void>;
  removeTriggers(options: { keys: string[] }): Promise<void>;
  clearTriggers(): Promise<void>;
  getTriggers(): Promise<{ triggers: Record<string, string> }>;
  setScreen(options: { name: string | null }): Promise<void>;
  setInAppPaused(options: { paused: boolean }): Promise<void>;
  getInAppPaused(): Promise<{ paused: boolean }>;

  inboxList(options: InboxListOptions): Promise<InboxPage>;
  inboxMarkRead(options: { id: string }): Promise<InboxItem>;
  inboxMarkAllRead(): Promise<{ unreadCount: number }>;
  inboxArchive(options: { id: string }): Promise<void>;
  inboxUnreadCount(): Promise<{ unreadCount: number }>;

  /** Konum paylaşımı (v2 Faz 17b); web'de `@pushizo/web` `Location` yüzeyine iletilir. */
  setLocationShared(options: { shared: boolean }): Promise<void>;
  isLocationShared(): Promise<{ shared: boolean }>;
  requestLocationPermission(options: { rationale?: string }): Promise<{ permission: boolean }>;

  /** Yalnızca iOS 16.1+; Android ve web `PLATFORM_NOT_SUPPORTED` ile reddeder. */
  setupDefaultLiveActivity(): Promise<void>;
  startDefaultLiveActivity(options: {
    activityId: string;
    attributes: Record<string, LiveActivityValue>;
    contentState: Record<string, LiveActivityValue>;
  }): Promise<void>;

  addListener(eventName: 'click', listener: (event: NotificationClickEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'foregroundWillDisplay', listener: (event: RawForegroundEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'pushSubscriptionChange', listener: (event: PushSubscriptionState) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'permissionChange', listener: (event: PermissionChangeEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'inAppClick', listener: (event: InAppClickEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'inAppLifecycle', listener: (event: RawInAppLifecycleEvent) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
