import type { PluginListenerHandle } from '@capacitor/core';

import type {
  ForegroundWillDisplayEvent,
  HeroSignalEventMap,
  HeroSignalEventName,
  HeroSignalPlugin,
  InAppClickEvent,
  InAppLifecycleListener,
  InboxItem,
  InboxListOptions,
  InboxPage,
  InitializeOptions,
  LogLevel,
  NativeForegroundEvent,
  NotificationClickEvent,
  PermissionStatus,
  PushSubscriptionChangeEvent,
} from './definitions.js';

// --- Argüman dönüşümleri (köprü sözleşmesi: native taraf yalnızca dizge sözlükleri kabul eder) ---

/** Tag/trigger değeri olarak kabul edilen JS türleri; köprüye dizge olarak geçer. */
export type ScalarValue = string | number | boolean;

const LOG_LEVELS: readonly LogLevel[] = ['none', 'error', 'warn', 'info', 'debug'];

/** Tag/trigger sözlüğünü native köprünün beklediği `Record<string, string>` biçimine çevirir. */
export function toStringRecord(
  record: Record<string, ScalarValue>,
  what: string,
): Record<string, string> {
  if (record === null || typeof record !== 'object' || Array.isArray(record))
    throw new TypeError(`${what} bir nesne olmalı.`);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!key) throw new TypeError(`${what} anahtarı boş olamaz.`);
    if (typeof value === 'string') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = String(value);
    else if (typeof value === 'boolean') out[key] = value ? 'true' : 'false';
    else throw new TypeError(`${what} "${key}" değeri dizge, sayı veya boolean olmalı.`);
  }
  return out;
}

/** Anahtar listesini doğrular (boş dizgeler köprüye gönderilmez). */
export function toKeyList(keys: readonly string[], what: string): string[] {
  if (!Array.isArray(keys)) throw new TypeError(`${what} bir dizi olmalı.`);
  return keys.map((k) => {
    if (typeof k !== 'string' || !k) throw new TypeError(`${what} boş olmayan dizgeler içermeli.`);
    return k;
  });
}

export function requireNonEmpty(value: string, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${what} gerekli.`);
  return value;
}

export function toLogLevel(level: LogLevel): LogLevel {
  if (!LOG_LEVELS.includes(level))
    throw new RangeError(`Geçersiz log seviyesi: ${String(level)} (${LOG_LEVELS.join(', ')}).`);
  return level;
}

/**
 * `removeNotification` kimliği: Android sistem bildirim kimliği (tam sayı), iOS/web dizge kimlik.
 * Köprüye her zaman dizge olarak geçer; Android tarafı tam sayıya çevirir.
 */
export function toNotificationId(id: number | string): string {
  if (typeof id === 'number') {
    if (!Number.isInteger(id)) throw new TypeError('Bildirim kimliği tam sayı olmalı.');
    return String(id);
  }
  return requireNonEmpty(id, 'Bildirim kimliği');
}

/** Olay özelliklerini JSON'a uygun hale getirir (`undefined` alanlar atılır). */
export function toEventPayload(
  name: string,
  properties?: Record<string, unknown>,
  value?: number,
): { name: string; properties?: Record<string, unknown>; value?: number } {
  const payload: { name: string; properties?: Record<string, unknown>; value?: number } = {
    name: requireNonEmpty(name, 'Olay adı'),
  };
  if (properties !== undefined) {
    if (properties === null || typeof properties !== 'object' || Array.isArray(properties))
      throw new TypeError('Olay özellikleri bir nesne olmalı.');
    payload.properties = JSON.parse(JSON.stringify(properties)) as Record<string, unknown>;
  }
  if (value !== undefined) {
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new TypeError('Olay değeri sonlu bir sayı olmalı.');
    payload.value = value;
  }
  return payload;
}

export function toInboxListOptions(options?: InboxListOptions): { limit: number; cursor?: string } {
  const limit = options?.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new RangeError('limit 1-200 arasında bir tam sayı olmalı.');
  return options?.cursor ? { limit, cursor: options.cursor } : { limit };
}

export function toInitializeOptions(appId: string, options?: Omit<InitializeOptions, 'appId'>): InitializeOptions {
  const out: InitializeOptions = { appId: requireNonEmpty(appId, 'appId') };
  if (options?.apiUrl) out.apiUrl = options.apiUrl.replace(/\/+$/, '');
  if (options?.requiresPrivacyConsent !== undefined)
    out.requiresPrivacyConsent = options.requiresPrivacyConsent;
  if (options?.logLevel !== undefined) out.logLevel = toLogLevel(options.logLevel);
  if (options?.serviceWorkerPath) out.serviceWorkerPath = options.serviceWorkerPath;
  if (options?.allowLocalhostAsSecureOrigin !== undefined)
    out.allowLocalhostAsSecureOrigin = options.allowLocalhostAsSecureOrigin;
  return out;
}

export function isGranted(status: PermissionStatus): boolean {
  return status === 'granted' || status === 'provisional';
}

// --- Dinleyici yönetimi ---

type Callback<T> = (event: T) => void;

/** Kullanıcı geri çağrısı ↔ native dinleyici tutamacı eşlemesi (aynı geri çağrı iki kez eklenmez). */
class ListenerRegistry {
  private readonly handles = new Map<string, Map<unknown, Promise<PluginListenerHandle>>>();

  constructor(private readonly plugin: HeroSignalPlugin) {}

  add<E extends HeroSignalEventName>(event: E, key: unknown, cb: Callback<HeroSignalEventMap[E]>): void {
    let byKey = this.handles.get(event);
    if (!byKey) {
      byKey = new Map();
      this.handles.set(event, byKey);
    }
    if (byKey.has(key)) return;
    byKey.set(key, this.plugin.addListener(event, cb));
  }

  async remove(event: HeroSignalEventName, key: unknown): Promise<void> {
    const byKey = this.handles.get(event);
    const handle = byKey?.get(key);
    if (!handle) return;
    byKey!.delete(key);
    await (await handle).remove();
  }
}

/**
 * eski sağlayıcı v5 benzeri ad alanlı API'yi (plan 06 §6.1) native köprü üzerine kurar. Native çağrılar
 * asenkron olduğundan özellik okuyucuları (`permission`, `pushSubscription.id`…) `get…()` metotlarıdır.
 */
export function createHeroSignal(plugin: HeroSignalPlugin) {
  const listeners = new ListenerRegistry(plugin);
  const foregroundListeners = new Set<Callback<ForegroundWillDisplayEvent>>();
  let foregroundHandle: Promise<PluginListenerHandle> | null = null;

  /** Native olay: dinleyiciler senkron çalışır, karar native tarafa geri bildirilir. */
  const onNativeForeground = (event: NativeForegroundEvent): void => {
    let prevented = false;
    const wrapped: ForegroundWillDisplayEvent = {
      notification: event.notification,
      preventDefault: () => {
        prevented = true;
      },
    };
    for (const cb of [...foregroundListeners]) {
      try {
        cb(wrapped);
      } catch (err) {
        // Dinleyici hatası gösterimi engellemez; diğer dinleyiciler çalışmaya devam eder.
        console.error('[HeroSignal] ön plan dinleyicisi hata verdi', err);
      }
    }
    void plugin.completeForegroundDisplay({ eventId: event.eventId, display: !prevented });
  };

  const lifecycleEvents = {
    willDisplay: 'inAppWillDisplay',
    didDisplay: 'inAppDidDisplay',
    willDismiss: 'inAppWillDismiss',
    didDismiss: 'inAppDidDismiss',
  } as const;

  return {
    /** Uygulama başlangıcında bir kez çağrılır. */
    initialize: (appId: string, options?: Omit<InitializeOptions, 'appId'>): Promise<void> =>
      plugin.initialize(toInitializeOptions(appId, options)),

    /** KVKK/GDPR onayı (`requiresPrivacyConsent` açıkken). */
    setConsentGiven: (given: boolean): Promise<void> => plugin.setConsentGiven({ given: !!given }),

    /** Anonim cihazı `externalId` kullanıcısına bağlar; identity verification açıksa `identityHash` zorunludur. */
    login: (externalId: string, identityHash?: string): Promise<void> =>
      plugin.login(
        identityHash
          ? { externalId: requireNonEmpty(externalId, 'externalId'), identityHash }
          : { externalId: requireNonEmpty(externalId, 'externalId') },
      ),

    logout: (): Promise<void> => plugin.logout(),

    User: {
      addTag: (key: string, value: ScalarValue): Promise<void> =>
        plugin.addTags({ tags: toStringRecord({ [requireNonEmpty(key, 'Tag anahtarı')]: value }, 'Tag') }),
      addTags: (tags: Record<string, ScalarValue>): Promise<void> =>
        plugin.addTags({ tags: toStringRecord(tags, 'Tag') }),
      removeTag: (key: string): Promise<void> =>
        plugin.removeTags({ keys: toKeyList([key], 'Tag anahtarları') }),
      removeTags: (keys: string[]): Promise<void> =>
        plugin.removeTags({ keys: toKeyList(keys, 'Tag anahtarları') }),
      getTags: async (): Promise<Record<string, string>> => (await plugin.getTags()).tags,
      addAlias: (label: string, id: string): Promise<void> =>
        plugin.addAliases({ aliases: toStringRecord({ [requireNonEmpty(label, 'Alias etiketi')]: id }, 'Alias') }),
      addAliases: (aliases: Record<string, string>): Promise<void> =>
        plugin.addAliases({ aliases: toStringRecord(aliases, 'Alias') }),
      removeAlias: (label: string): Promise<void> =>
        plugin.removeAlias({ label: requireNonEmpty(label, 'Alias etiketi') }),
      setLanguage: (code: string): Promise<void> =>
        plugin.setLanguage({ code: requireNonEmpty(code, 'Dil kodu') }),
      /** Geçersiz adres native tarafta `INVALID_ARGUMENT` hatasıyla reddedilir. */
      addEmail: (email: string): Promise<void> => plugin.addEmail({ email: requireNonEmpty(email, 'E-posta') }),
      removeEmail: (email: string): Promise<void> =>
        plugin.removeEmail({ email: requireNonEmpty(email, 'E-posta') }),
      /** E.164 numara (`+905551112233`); boşluk/tire native tarafta temizlenir. */
      addSms: (phoneNumber: string): Promise<void> =>
        plugin.addSms({ phoneNumber: requireNonEmpty(phoneNumber, 'Telefon numarası') }),
      removeSms: (phoneNumber: string): Promise<void> =>
        plugin.removeSms({ phoneNumber: requireNonEmpty(phoneNumber, 'Telefon numarası') }),
      getExternalId: async (): Promise<string | null> => (await plugin.getUser()).externalId,
      /** HeroSignal kullanıcı kimliği (`user_id`). */
      getId: async (): Promise<string | null> => (await plugin.getUser()).id,

      pushSubscription: {
        getId: async (): Promise<string | null> => (await plugin.getPushSubscription()).id,
        getToken: async (): Promise<string | null> => (await plugin.getPushSubscription()).token,
        getOptedIn: async (): Promise<boolean> => (await plugin.getPushSubscription()).optedIn,
        getState: () => plugin.getPushSubscription(),
        optIn: (): Promise<void> => plugin.optIn(),
        optOut: (): Promise<void> => plugin.optOut(),
        addObserver: (cb: Callback<PushSubscriptionChangeEvent>): void =>
          listeners.add('pushSubscriptionChange', cb, cb),
        removeObserver: (cb: Callback<PushSubscriptionChangeEvent>): Promise<void> =>
          listeners.remove('pushSubscriptionChange', cb),
      },
    },

    Notifications: {
      /** İzin verildi mi (iOS provisional dahil). */
      getPermission: async (): Promise<boolean> => (await plugin.getPermission()).granted,
      /** Ayrıntılı izin durumu: granted/denied/default (+ iOS provisional, web unsupported). */
      getPermissionStatus: async (): Promise<PermissionStatus> => (await plugin.getPermission()).status,
      /** Sistem izin istemini gösterir; sonuç izin verildi mi. */
      requestPermission: async (): Promise<boolean> => isGranted((await plugin.requestPermission()).status),
      addClickListener: (cb: Callback<NotificationClickEvent>): void =>
        listeners.add('notificationClick', cb, cb),
      removeClickListener: (cb: Callback<NotificationClickEvent>): Promise<void> =>
        listeners.remove('notificationClick', cb),
      /**
       * Ön planda gelen bildirim; dinleyici `event.preventDefault()` çağırırsa gösterilmez. Dinleyiciler
       * senkron karar vermelidir (yanıt gelmezse native SDK 25 sn sonra bildirimi gösterir).
       */
      addForegroundLifecycleListener: (cb: Callback<ForegroundWillDisplayEvent>): void => {
        foregroundListeners.add(cb);
        if (foregroundHandle) return;
        foregroundHandle = plugin.addListener('notificationWillDisplay', onNativeForeground);
        void plugin.setForegroundHandlerEnabled({ enabled: true });
      },
      removeForegroundLifecycleListener: async (cb: Callback<ForegroundWillDisplayEvent>): Promise<void> => {
        foregroundListeners.delete(cb);
        if (foregroundListeners.size > 0 || !foregroundHandle) return;
        const handle = foregroundHandle;
        foregroundHandle = null;
        await plugin.setForegroundHandlerEnabled({ enabled: false });
        await (await handle).remove();
      },
      /** SDK'nın gösterdiği tüm bildirimleri tepsiden kaldırır. */
      clearAll: (): Promise<void> => plugin.clearAll(),
      /** `notification.notificationId` ile tek bildirimi kaldırır (Android: tam sayı, iOS/web: dizge). */
      removeNotification: (id: number | string): Promise<void> =>
        plugin.removeNotification({ id: toNotificationId(id) }),
      /** Grup anahtarı (`hs_group` / iOS `thread-id`) eşleşen bildirimleri kaldırır. */
      removeGroupedNotifications: (group: string): Promise<void> =>
        plugin.removeGroupedNotifications({ group: requireNonEmpty(group, 'Grup anahtarı') }),
    },

    Session: {
      /** Özel olay / outcome; in-app `event` tetiklerini de değerlendirir. */
      sendEvent: (name: string, properties?: Record<string, unknown>, value?: number): Promise<void> =>
        plugin.sendEvent(toEventPayload(name, properties, value)),
    },

    InAppMessages: {
      addTrigger: (key: string, value: ScalarValue): Promise<void> =>
        plugin.addTriggers({ triggers: toStringRecord({ [requireNonEmpty(key, 'Trigger anahtarı')]: value }, 'Trigger') }),
      addTriggers: (triggers: Record<string, ScalarValue>): Promise<void> =>
        plugin.addTriggers({ triggers: toStringRecord(triggers, 'Trigger') }),
      removeTrigger: (key: string): Promise<void> =>
        plugin.removeTriggers({ keys: toKeyList([key], 'Trigger anahtarları') }),
      removeTriggers: (keys: string[]): Promise<void> =>
        plugin.removeTriggers({ keys: toKeyList(keys, 'Trigger anahtarları') }),
      clearTriggers: (): Promise<void> => plugin.clearTriggers(),
      getTriggers: async (): Promise<Record<string, string>> => (await plugin.getTriggers()).triggers,
      /** Geçerli ekran adı (`screen` tetikleri); ekrandan çıkarken `null`. */
      setScreen: (name: string | null): Promise<void> =>
        plugin.setScreen({ name: name && name.trim() ? name : null }),
      /** true iken yeni mesaj gösterilmez (tetikler kaydedilmeye devam eder). */
      setPaused: (paused: boolean): Promise<void> => plugin.setInAppPaused({ paused: !!paused }),
      getPaused: async (): Promise<boolean> => (await plugin.getInAppPaused()).paused,
      addClickListener: (cb: Callback<InAppClickEvent>): void => listeners.add('inAppClick', cb, cb),
      removeClickListener: (cb: Callback<InAppClickEvent>): Promise<void> => listeners.remove('inAppClick', cb),
      addLifecycleListener: (listener: InAppLifecycleListener): void => {
        for (const [field, event] of Object.entries(lifecycleEvents) as [keyof InAppLifecycleListener, (typeof lifecycleEvents)[keyof typeof lifecycleEvents]][]) {
          const cb = listener[field];
          if (cb) listeners.add(event, listener, cb);
        }
      },
      removeLifecycleListener: async (listener: InAppLifecycleListener): Promise<void> => {
        await Promise.all(Object.values(lifecycleEvents).map((event) => listeners.remove(event, listener)));
      },
    },

    Inbox: {
      /** Öğeler (yeniden eskiye), okunmamış sayısı ve sonraki sayfa imleci. */
      list: (options?: InboxListOptions): Promise<InboxPage> => plugin.inboxList(toInboxListOptions(options)),
      markRead: async (id: string): Promise<InboxItem> =>
        (await plugin.inboxMarkRead({ id: requireNonEmpty(id, 'Öğe kimliği') })).item,
      /** Tümünü okundu işaretler; kalan okunmamış sayısını döndürür. */
      markAllRead: async (): Promise<number> => (await plugin.inboxMarkAllRead()).unreadCount,
      /** Öğeyi kutudan kaldırır (sunucuda arşivlenir). */
      delete: (id: string): Promise<void> => plugin.inboxDelete({ id: requireNonEmpty(id, 'Öğe kimliği') }),
      unreadCount: async (): Promise<number> => (await plugin.inboxUnreadCount()).unreadCount,
    },

    Debug: {
      setLogLevel: (level: LogLevel): Promise<void> => plugin.setLogLevel({ level: toLogLevel(level) }),
    },
  };
}

export type HeroSignalApi = ReturnType<typeof createHeroSignal>;
