import type { PluginListenerHandle } from '@capacitor/core';

/** SDK günlük seviyesi (native SDK'larda `none` = sessiz). */
export type LogLevel = 'none' | 'error' | 'warn' | 'info' | 'debug';

/**
 * Bildirim izni durumu. `provisional` yalnızca iOS (sessiz deneme izni), `unsupported` yalnızca web
 * (tarayıcı push desteklemiyor) içindir.
 */
export type PermissionStatus = 'granted' | 'denied' | 'default' | 'provisional' | 'unsupported';

export interface InitializeOptions {
  /** Dashboard → App ayarlarındaki App ID (`app_…`). */
  appId: string;
  /** API kökü; varsayılan `https://api.herosignal.dev`. */
  apiUrl?: string;
  /** KVKK/GDPR: `setConsentGiven(true)` çağrılana kadar ağ çağrısı yapılmaz. */
  requiresPrivacyConsent?: boolean;
  logLevel?: LogLevel;
  /** Yalnızca web: service worker yolu (varsayılan `/HeroSignalSDKWorker.js`). */
  serviceWorkerPath?: string;
  /** Yalnızca web: HTTP localhost üzerinde çalışmaya izin verir (geliştirme). */
  allowLocalhostAsSecureOrigin?: boolean;
}

/** Bildirim aksiyon düğmesi. */
export interface NotificationAction {
  id: string;
  title: string;
  url: string | null;
}

/** Platformlar arası bildirim modeli. */
export interface HeroSignalNotification {
  /**
   * Tepsiden kaldırma kimliği (`Notifications.removeNotification`): Android'de sistem bildirim kimliği,
   * iOS'ta teslimat kimliği (`hs.dlv`), web'de bildirim etiketi. Bilinmiyorsa null.
   */
  notificationId: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  imageUrl: string | null;
  deliveryId: string | null;
  messageId: string | null;
  /** Android `hs_group` / iOS `thread-id` grup anahtarı. */
  groupKey: string | null;
  actions: NotificationAction[];
  /** Müşteri verisi (payload'daki `hs` dışı alanlar). */
  data: Record<string, string>;
}

/** Bildirim tıklaması (§6.1): `{ notification, result: { actionId, url } }`. */
export interface NotificationClickEvent {
  notification: HeroSignalNotification;
  result: { actionId: string | null; url: string | null };
}

/** Native katmandan gelen ham ön plan olayı; karar `completeForegroundDisplay` ile döner. */
export interface NativeForegroundEvent {
  eventId: string;
  notification: HeroSignalNotification;
}

/** Uygulama ön plandayken gelen bildirim; `preventDefault()` gösterimi engeller. */
export interface ForegroundWillDisplayEvent {
  notification: HeroSignalNotification;
  preventDefault(): void;
}

export interface PushSubscriptionState {
  id: string | null;
  token: string | null;
  optedIn: boolean;
}

export interface PushSubscriptionChangeEvent {
  current: PushSubscriptionState;
}

export interface PermissionResult {
  granted: boolean;
  status: PermissionStatus;
}

export interface InAppMessageRef {
  id: string;
}

export interface InAppClickEvent {
  message: InAppMessageRef;
  result: { actionId: string; url: string | null };
}

export interface InAppLifecycleEvent {
  message: InAppMessageRef;
}

/** In-app yaşam döngüsü dinleyicisi; yalnızca ilgilenilen alanlar verilir. */
export interface InAppLifecycleListener {
  willDisplay?: (event: InAppLifecycleEvent) => void;
  didDisplay?: (event: InAppLifecycleEvent) => void;
  willDismiss?: (event: InAppLifecycleEvent) => void;
  didDismiss?: (event: InAppLifecycleEvent) => void;
}

/** Bildirim kutusu öğesi; zamanlar ISO-8601 dizgesidir. */
export interface InboxItem {
  id: string;
  messageId: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  imageUrl: string | null;
  data: Record<string, string>;
  read: boolean;
  readAt: string | null;
  archivedAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
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

/** Native olay adları ve yükleri. */
export interface HeroSignalEventMap {
  notificationClick: NotificationClickEvent;
  notificationWillDisplay: NativeForegroundEvent;
  pushSubscriptionChange: PushSubscriptionChangeEvent;
  inAppClick: InAppClickEvent;
  inAppWillDisplay: InAppLifecycleEvent;
  inAppDidDisplay: InAppLifecycleEvent;
  inAppWillDismiss: InAppLifecycleEvent;
  inAppDidDismiss: InAppLifecycleEvent;
}

export type HeroSignalEventName = keyof HeroSignalEventMap;

/**
 * Native köprü sözleşmesi (Android `HeroSignalCapacitorPlugin`, iOS `HeroSignalCapacitorPlugin`, web
 * `HeroSignalWeb`). Uygulama kodu doğrudan değil, `HeroSignal` ad alanları üzerinden kullanır.
 */
export interface HeroSignalPlugin {
  initialize(options: InitializeOptions): Promise<void>;
  setConsentGiven(options: { given: boolean }): Promise<void>;
  login(options: { externalId: string; identityHash?: string }): Promise<void>;
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

  getPushSubscription(): Promise<PushSubscriptionState>;
  optIn(): Promise<void>;
  optOut(): Promise<void>;

  getPermission(): Promise<PermissionResult>;
  requestPermission(): Promise<PermissionResult>;
  setForegroundHandlerEnabled(options: { enabled: boolean }): Promise<void>;
  completeForegroundDisplay(options: { eventId: string; display: boolean }): Promise<void>;
  clearAll(): Promise<void>;
  removeNotification(options: { id: string }): Promise<void>;
  removeGroupedNotifications(options: { group: string }): Promise<void>;

  sendEvent(options: {
    name: string;
    properties?: Record<string, unknown>;
    value?: number;
  }): Promise<void>;

  addTriggers(options: { triggers: Record<string, string> }): Promise<void>;
  removeTriggers(options: { keys: string[] }): Promise<void>;
  clearTriggers(): Promise<void>;
  getTriggers(): Promise<{ triggers: Record<string, string> }>;
  setScreen(options: { name: string | null }): Promise<void>;
  setInAppPaused(options: { paused: boolean }): Promise<void>;
  getInAppPaused(): Promise<{ paused: boolean }>;

  inboxList(options: { limit: number; cursor?: string }): Promise<InboxPage>;
  inboxMarkRead(options: { id: string }): Promise<{ item: InboxItem }>;
  inboxMarkAllRead(): Promise<{ unreadCount: number }>;
  inboxDelete(options: { id: string }): Promise<void>;
  inboxUnreadCount(): Promise<{ unreadCount: number }>;

  setLogLevel(options: { level: LogLevel }): Promise<void>;

  addListener<E extends HeroSignalEventName>(
    eventName: E,
    listener: (event: HeroSignalEventMap[E]) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
