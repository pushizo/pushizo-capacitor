import { describe, expect, it, vi } from 'vitest';

import { capacitorBridge, PushizoCore } from '../src/index';
import { PushizoWeb } from '../src/web';
import type { WebSdkInstance } from '../src/web';

type Fn = (...args: never[]) => unknown;

/** `@pushizo/web` örneğinin sahte karşılığı; dinleyiciler dışarıdan tetiklenebilir. */
function fakeWebSdk() {
  const listeners: Record<string, Fn> = {};
  let permission = 'default';
  let locationShared = false;
  const sdk = {
    init: vi.fn(async () => undefined),
    setConsentGiven: vi.fn(async () => undefined),
    login: vi.fn(async () => undefined),
    updateUserJwt: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    User: {
      addTags: vi.fn(),
      removeTags: vi.fn(),
      getTags: vi.fn(() => ({ plan: 'pro' })),
      addAliases: vi.fn(),
      removeAlias: vi.fn(),
      setLanguage: vi.fn(),
      addEmail: vi.fn(),
      removeEmail: vi.fn(),
      addSms: vi.fn(),
      removeSms: vi.fn(),
      getPreferences: vi.fn(async () => ({
        preferences: [
          { category: 'promo', channel: null, optedIn: true, explicit: false, source: null, updatedAt: null },
          { category: 'promo', channel: 'email', optedIn: true, explicit: true, source: 'api', updatedAt: '2026-10-01T10:00:00.000Z' },
          { category: 'news', channel: null, optedIn: false, explicit: false, source: null, updatedAt: null },
        ],
        categories: [
          { key: 'promo', name: { tr: 'Kampanya' }, description: {}, channels: ['email', 'sms'], defaultOptedIn: true },
          { key: 'news', name: { en: 'News' }, description: {}, channels: null, defaultOptedIn: false },
        ],
      })),
      setPreferences: vi.fn(),
      id: 'usr_1',
      externalId: 'ext_1',
      pushSubscription: {
        state: { id: 'sub_1', token: 'https://push.example/ep', optedIn: true, permission: 'granted' },
        optIn: vi.fn(async () => undefined),
        optOut: vi.fn(async () => undefined),
        addObserver: vi.fn((cb: Fn) => {
          listeners.subscription = cb;
          return () => undefined;
        }),
      },
    },
    Notifications: {
      get permission() {
        return permission;
      },
      requestPermission: vi.fn(async () => {
        permission = 'granted';
        return 'granted';
      }),
      addClickListener: vi.fn((cb: Fn) => {
        listeners.click = cb;
        return () => undefined;
      }),
      addForegroundLifecycleListener: vi.fn((cb: Fn) => {
        listeners.foreground = cb;
        return () => undefined;
      }),
    },
    Session: { sendEvent: vi.fn() },
    InAppMessages: {
      addTriggers: vi.fn(),
      removeTriggers: vi.fn(),
      clearTriggers: vi.fn(),
      getTriggers: vi.fn(() => ({ level: 3, vip: true })),
      setScreen: vi.fn(),
      paused: false,
      addClickListener: vi.fn((cb: Fn) => {
        listeners.inAppClick = cb;
        return () => undefined;
      }),
      addLifecycleListener: vi.fn((l: Record<string, Fn>) => {
        listeners.didDisplay = l.didDisplay;
        return () => undefined;
      }),
    },
    Inbox: {
      list: vi.fn(async () => ({
        items: [
          {
            id: 'i1', messageId: 'm1', title: 'T', body: 'B', url: null, imageUrl: null, data: {}, read: false,
            readAt: null, archivedAt: null, expiresAt: '2026-12-01T00:00:00.000Z', createdAt: '2026-10-01T10:00:00.000Z',
          },
        ],
        unreadCount: 1,
        nextCursor: 'c2',
        hasMore: true,
      })),
      markRead: vi.fn(async () => ({
        id: 'i1', messageId: null, title: null, body: null, url: null, imageUrl: null, data: {}, read: true,
        readAt: '2026-10-02T00:00:00.000Z', archivedAt: null, expiresAt: null, createdAt: '2026-10-01T10:00:00.000Z',
      })),
      markAllRead: vi.fn(async () => ({ updated: 2, unreadCount: 0 })),
      archive: vi.fn(async () => undefined),
      unreadCount: vi.fn(async () => 4),
    },
    Debug: { setLogLevel: vi.fn() },
    Location: {
      setShared: vi.fn((shared: boolean) => {
        locationShared = shared;
      }),
      get isShared() {
        return locationShared;
      },
      requestPermission: vi.fn(async (_rationale?: string) => true),
    },
    FeatureFlags: {
      // Web SDK `refresh` sonuç döndürmez; yeni değer alındığında gözlemciler çağrılır (test: `flagsUpdated` ile).
      refresh: vi.fn(async () => {
        if (flagsUpdated) listeners.flags?.();
      }),
      isEnabled: vi.fn((key: string, defaultValue: boolean = false): boolean => (key === 'yeni_sepet' ? true : defaultValue)),
      getValue: vi.fn((key: string, defaultValue?: unknown) => (key === 'tema' ? { renk: 'mavi' } : defaultValue)),
      addObserver: vi.fn((cb: Fn) => {
        listeners.flags = cb;
        return () => {
          delete listeners.flags;
        };
      }),
    },
    Placements: {
      list: vi.fn(async (_key: string, _options?: { limit?: number }) => [serverPlacement]),
      reportImpression: vi.fn(),
      reportClick: vi.fn(),
      reportDismiss: vi.fn(),
    },
  };
  let flagsUpdated = true;
  return {
    sdk,
    listeners,
    web: new PushizoWeb(sdk as unknown as WebSdkInstance),
    setFlagsUpdated: (value: boolean) => {
      flagsUpdated = value;
    },
  };
}

/** Sunucunun `GET /placements/{key}` yanıtındaki in-app öğesi (Web SDK olduğu gibi verir). */
const serverPlacement = {
  id: 'iam_1',
  priority: 7,
  triggers: [{ kind: 'session_start' }],
  trigger_groups: [[{ kind: 'session_start' }], [{ kind: 'trigger', key: 'level', op: 'gt', value: 3 }, { kind: 'yeni_tur' }]],
  variant_id: 'b',
  display: {
    layout: 'banner_top',
    background_color: '#fff',
    text_color: null,
    dismissible: true,
    auto_dismiss_seconds: 0,
    blocks: [
      { type: 'image', url: 'https://cdn/x.png', alt: null },
      { type: 'title', text: 'Başlık' },
      { type: 'button', id: 'b1', text: 'Aç', action: { type: 'url', url: 'https://pushizo.com' }, background_color: '#000', text_color: '#fff' },
      { type: 'button', id: 'b2', text: 'Geçersiz', action: { type: 'url', url: 'javascript:alert(1)' } },
      { type: 'button', id: 'b3', text: 'Dönüşüm', action: { type: 'outcome', name: 'satin_alma', value: 9.5 } },
      {
        type: 'carousel',
        id: 'c1',
        cards: [
          { id: 'k1', title: 'Kart', body: null, image_url: 'https://cdn/k.png', image_alt: null, button: { id: 'kb', text: 'Git', action: { type: 'deeplink', url: 'app://x' } } },
          { id: 'k2', title: 'Kart 2', body: 'Gövde', image_url: null, image_alt: null, button: { id: 'kb2', text: 'Yok', action: { type: 'outcome' } } },
        ],
      },
      { type: 'video', url: 'https://cdn/v.mp4' },
    ],
  },
  remaining_impressions: 2,
  min_interval_seconds: 60,
  stop_after_interaction: true,
  last_impression_at: '2026-10-01T10:00:00.000Z',
  end_at: null,
};

/** WebPlugin'i doğrudan cepheye bağlar (Capacitor proxy'si olmadan). */
function coreFor(web: PushizoWeb) {
  return new PushizoCore(capacitorBridge(web));
}

describe('PushizoWeb', () => {
  it('initialize web SDK seçeneklerini eşler (none → silent)', async () => {
    const { sdk, web } = fakeWebSdk();
    await coreFor(web).initialize('app_1', {
      apiUrl: 'https://api.test',
      logLevel: 'none',
      requiresPrivacyConsent: true,
      web: { serviceWorkerPath: '/sw.js', allowLocalhostAsSecureOrigin: true },
    });
    expect(sdk.init).toHaveBeenCalledWith({
      appId: 'app_1',
      apiUrl: 'https://api.test',
      requiresPrivacyConsent: true,
      logLevel: 'silent',
      serviceWorkerPath: '/sw.js',
      serviceWorkerScope: undefined,
      allowLocalhostAsSecureOrigin: true,
    });
  });

  it('kullanıcı, izin ve in-app çağrıları web SDK yüzeyine iletilir', async () => {
    const { sdk, web } = fakeWebSdk();
    const hs = coreFor(web);
    await hs.initialize('app_1');
    await hs.login('ext_1', 'hash');
    await hs.User.addTags({ plan: 'pro' });
    await hs.User.addEmail('ali@pushizo.com');
    await hs.InAppMessages.addTrigger('level', 3);
    await hs.InAppMessages.setScreen(null);
    await hs.InAppMessages.setPaused(true);
    await hs.Session.sendEvent('purchase', { sku: 'A' }, 10);
    expect(sdk.login).toHaveBeenCalledWith('ext_1', { identityHash: 'hash', jwt: undefined });
    expect(sdk.User.addTags).toHaveBeenCalledWith({ plan: 'pro' });
    expect(sdk.User.addEmail).toHaveBeenCalledWith('ali@pushizo.com');
    expect(sdk.InAppMessages.addTriggers).toHaveBeenCalledWith({ level: '3' });
    expect(sdk.InAppMessages.setScreen).toHaveBeenCalledWith('');
    expect(sdk.InAppMessages.paused).toBe(true);
    expect(sdk.Session.sendEvent).toHaveBeenCalledWith('purchase', { sku: 'A' }, 10);
    expect(await hs.InAppMessages.getTriggers()).toEqual({ level: '3', vip: 'true' });
    expect(await hs.User.getId()).toBe('usr_1');
    expect(await hs.User.pushSubscription.getState()).toEqual({
      id: 'sub_1', token: 'https://push.example/ep', optedIn: true, permission: true,
    });
    expect(await hs.Notifications.getPermission()).toBe(false);
  });

  it('JWT identity verification web SDK login seçeneklerine ve updateUserJwt çağrısına iletilir', async () => {
    const { sdk, web } = fakeWebSdk();
    const hs = coreFor(web);
    await hs.initialize('app_1');
    await hs.login('ext_1', { jwt: 'a.b.c' });
    await hs.updateUserJwt('d.e.f');
    expect(sdk.login).toHaveBeenCalledWith('ext_1', { identityHash: undefined, jwt: 'a.b.c' });
    expect(sdk.updateUserJwt).toHaveBeenCalledWith('d.e.f');
  });

  it('Live Activities web\'de PLATFORM_NOT_SUPPORTED ile reddedilir', async () => {
    const { web } = fakeWebSdk();
    const hs = coreFor(web);
    await hs.initialize('app_1');
    const expected = { code: 'PLATFORM_NOT_SUPPORTED', message: "Live Activities yalnızca iOS'ta desteklenir" };
    await expect(hs.LiveActivities.setupDefaultLiveActivity()).rejects.toMatchObject(expected);
    await expect(hs.LiveActivities.startDefaultLiveActivity('order_42', { title: 'Sipariş #42' }, { status: 'Yolda' })).rejects.toMatchObject(
      expected,
    );
  });

  it('Location: paylaşım, okuma ve izin isteği Web SDK Location yüzeyine iletilir', async () => {
    const { sdk, web } = fakeWebSdk();
    const hs = coreFor(web);
    await hs.initialize('app_1');
    expect(await hs.Location.isShared()).toBe(false);
    await hs.Location.setShared(true);
    expect(sdk.Location.setShared).toHaveBeenLastCalledWith(true);
    expect(await hs.Location.isShared()).toBe(true);
    await hs.Location.setShared(false);
    expect(sdk.Location.setShared).toHaveBeenLastCalledWith(false);
    expect(await hs.Location.requestPermission('Yakındaki mağazalar için')).toBe(true);
    expect(sdk.Location.requestPermission).toHaveBeenLastCalledWith('Yakındaki mağazalar için');
    sdk.Location.requestPermission.mockResolvedValueOnce(false);
    expect(await hs.Location.requestPermission()).toBe(false);
    expect(sdk.Location.requestPermission).toHaveBeenLastCalledWith(undefined);
  });

  it('Location: Web SDK hatası (init öncesi) cepheye ret olarak ulaşır', async () => {
    const { sdk, web } = fakeWebSdk();
    sdk.Location.setShared.mockImplementationOnce(() => {
      throw new Error('Pushizo.init önce çağrılmalı.');
    });
    sdk.Location.requestPermission.mockRejectedValueOnce(new Error('Pushizo.init önce çağrılmalı.'));
    const hs = coreFor(web);
    await expect(hs.Location.setShared(true)).rejects.toThrow(/init önce/);
    await expect(hs.Location.requestPermission()).rejects.toThrow(/init önce/);
  });

  it('Location: web\'de bölge izleme yoktur; ayar etkisiz, durum false', async () => {
    const { web } = fakeWebSdk();
    const hs = coreFor(web);
    await hs.Location.setGeofencingEnabled(true);
    expect(await hs.Location.isGeofencingEnabled()).toBe(false);
  });

  it('özellik bayrakları Web SDK FeatureFlags yüzeyine iletilir; yenileme başarısı gözlemciden anlaşılır', async () => {
    const { sdk, web, setFlagsUpdated } = fakeWebSdk();
    const hs = coreFor(web);
    expect(await hs.FeatureFlags.refresh()).toBe(true);
    expect(sdk.FeatureFlags.refresh).toHaveBeenCalledTimes(1);
    // Gözlemci yenileme sonrası kaldırılır; başarısız yenilemede false.
    expect(sdk.FeatureFlags.addObserver).toHaveBeenCalledTimes(1);
    setFlagsUpdated(false);
    expect(await hs.FeatureFlags.refresh()).toBe(false);
    expect(await hs.FeatureFlags.isEnabled('yeni_sepet')).toBe(true);
    expect(await hs.FeatureFlags.isEnabled('yok', true)).toBe(true);
    expect(sdk.FeatureFlags.isEnabled).toHaveBeenLastCalledWith('yok', true);
    expect(await hs.FeatureFlags.getValue('tema')).toEqual({ renk: 'mavi' });
    expect(await hs.FeatureFlags.getValue('sepet_limiti', 10)).toBe(10);
    expect(sdk.FeatureFlags.getValue).toHaveBeenLastCalledWith('sepet_limiti');
  });

  it('yerleşimler: sunucu öğesi köprü modeline çevrilir (geçersiz düğme ve bilinmeyen blok atlanır)', async () => {
    const { sdk, web } = fakeWebSdk();
    const hs = coreFor(web);
    const [message] = await hs.Placements.list('home_banner', { limit: 3 });
    expect(sdk.Placements.list).toHaveBeenCalledWith('home_banner', { limit: 3 });
    expect(message).toEqual({
      id: 'iam_1',
      priority: 7,
      triggers: [{ kind: 'session_start' }],
      triggerGroups: [
        [{ kind: 'session_start' }],
        [{ kind: 'trigger', key: 'level', op: 'gt', value: 3 }, { kind: 'unsupported', name: 'yeni_tur' }],
      ],
      variantId: 'b',
      display: {
        layout: 'banner_top',
        backgroundColor: '#fff',
        textColor: null,
        dismissible: true,
        autoDismissSeconds: null,
        contentType: 'blocks',
        blocks: [
          { type: 'image', url: 'https://cdn/x.png', alt: null },
          { type: 'title', text: 'Başlık' },
          { type: 'button', id: 'b1', text: 'Aç', action: { type: 'url', url: 'https://pushizo.com' }, backgroundColor: '#000', textColor: '#fff' },
          { type: 'button', id: 'b3', text: 'Dönüşüm', action: { type: 'outcome', name: 'satin_alma', value: 9.5 }, backgroundColor: null, textColor: null },
          {
            type: 'carousel',
            id: 'c1',
            cards: [
              {
                id: 'k1', title: 'Kart', body: null, imageUrl: 'https://cdn/k.png', imageAlt: null,
                button: { id: 'kb', text: 'Git', action: { type: 'deeplink', url: 'app://x' }, backgroundColor: null, textColor: null },
              },
              { id: 'k2', title: 'Kart 2', body: 'Gövde', imageUrl: null, imageAlt: null, button: null },
            ],
          },
        ],
        html: null,
        htmlHeight: null,
      },
      remainingImpressions: 2,
      minIntervalSeconds: 60,
      stopAfterInteraction: true,
      lastImpressionAt: Date.parse('2026-10-01T10:00:00.000Z'),
      endAt: null,
      language: null,
    });

    // HTML içerik: bloklar boş, html ve yükseklik taşınır; içeriksiz HTML mesajı atlanır.
    sdk.Placements.list.mockResolvedValueOnce([
      { ...serverPlacement, id: 'html_1', display: { layout: 'modal', content_type: 'html', html: '<p>Merhaba</p>', html_height: 120, blocks: [] } },
      { ...serverPlacement, id: 'html_2', display: { layout: 'modal', content_type: 'html', html: '  ', blocks: [] } },
    ] as never);
    const html = await hs.Placements.list('home_banner');
    expect(html.map((m) => m.id)).toEqual(['html_1']);
    expect(html[0].display).toMatchObject({ contentType: 'html', html: '<p>Merhaba</p>', htmlHeight: 120, blocks: [], layout: 'modal' });
  });

  it('yerleşim raporları son listedeki Web SDK mesajıyla yapılır; tanınmayan kimlik yok sayılır', async () => {
    const { sdk, web } = fakeWebSdk();
    const hs = coreFor(web);
    await hs.Placements.reportImpression({ id: 'iam_1' });
    expect(sdk.Placements.reportImpression).not.toHaveBeenCalled();
    const [message] = await hs.Placements.list('home_banner');
    await hs.Placements.reportImpression(message);
    await hs.Placements.reportClick(message, 'b1');
    await hs.Placements.reportDismiss(message);
    expect(sdk.Placements.reportImpression).toHaveBeenCalledWith(serverPlacement);
    expect(sdk.Placements.reportClick).toHaveBeenCalledWith(serverPlacement, 'b1');
    expect(sdk.Placements.reportDismiss).toHaveBeenCalledWith(serverPlacement);

    // Önbellek en çok 50 mesaj tutar; en eskiler düşer, yeniden listelenen güncel kalır.
    sdk.Placements.list.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ ...serverPlacement, id: `m${i}` })));
    await hs.Placements.list('home_banner');
    await hs.Placements.reportDismiss({ id: 'iam_1' });
    await hs.Placements.reportDismiss({ id: 'm0' });
    expect(sdk.Placements.reportDismiss).toHaveBeenCalledTimes(2);
    expect(sdk.Placements.reportDismiss).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'm0' }));
  });

  it('izin isteği sonucu izin gözlemcisine bir kez bildirilir', async () => {
    const { web } = fakeWebSdk();
    const hs = coreFor(web);
    await hs.initialize('app_1');
    const perm = vi.fn();
    hs.Notifications.addPermissionObserver(perm);
    expect(await hs.Notifications.requestPermission()).toBe(true);
    expect(await hs.Notifications.requestPermission()).toBe(true);
    expect(perm).toHaveBeenCalledTimes(1);
    expect(perm).toHaveBeenCalledWith({ permission: true });
  });

  it('tıklama ve ön plan olayları cepheye ulaşır; preventDefault tarayıcıya senkron iletilir', async () => {
    const { listeners, web } = fakeWebSdk();
    const hs = coreFor(web);
    await hs.initialize('app_1');
    const clicks = vi.fn();
    hs.Notifications.addClickListener(clicks);
    hs.Notifications.addForegroundLifecycleListener((e) => e.preventDefault());
    (listeners.click as (e: unknown) => void)({
      notification: { title: 'T', body: 'B', url: 'https://x', deliveryId: 'd1', data: { a: 1 } },
      result: { actionId: 'b1' },
    });
    expect(clicks).toHaveBeenCalledWith({
      notification: {
        title: 'T', body: 'B', url: 'https://x', imageUrl: null, deliveryId: 'd1', messageId: null, data: { a: '1' }, androidNotificationId: null,
      },
      result: { actionId: 'b1', url: null },
    });
    const browserPrevent = vi.fn();
    (listeners.foreground as (e: unknown) => void)({ notification: { title: 'T', body: 'B', data: {} }, preventDefault: browserPrevent });
    expect(browserPrevent).toHaveBeenCalledTimes(1);
    await expect(web.displayNotification({ notificationId: 'web-1' })).rejects.toThrow(/sonradan/);
  });

  it('in-app olayları ve abonelik gözlemcisi eşlenir', async () => {
    const { listeners, web } = fakeWebSdk();
    const hs = coreFor(web);
    await hs.initialize('app_1');
    const click = vi.fn();
    const didDisplay = vi.fn();
    const sub = vi.fn();
    hs.InAppMessages.addClickListener(click);
    hs.InAppMessages.addLifecycleListener({ didDisplay });
    hs.User.pushSubscription.addObserver(sub);
    (listeners.inAppClick as (e: unknown) => void)({ message: { id: 'iam' }, result: { actionId: 'b', url: 'https://y' } });
    (listeners.didDisplay as (e: unknown) => void)({ message: { id: 'iam' } });
    (listeners.subscription as (e: unknown) => void)({ id: 's', token: null, optedIn: false, permission: 'denied' });
    expect(click).toHaveBeenCalledWith({ message: { id: 'iam' }, result: { actionId: 'b', url: 'https://y' } });
    expect(didDisplay).toHaveBeenCalledWith({ event: 'didDisplay', message: { id: 'iam' } });
    expect(sub).toHaveBeenCalledWith({ id: 's', token: null, optedIn: false, permission: false });
  });

  it('bildirim kutusu ISO zamanlarını epoch milisaniyeye çevirir', async () => {
    const { sdk, web } = fakeWebSdk();
    const hs = coreFor(web);
    const page = await hs.Inbox.list({ limit: 10 });
    expect(sdk.Inbox.list).toHaveBeenCalledWith({ limit: 10, cursor: undefined });
    expect(page.items[0].createdAt).toBe(Date.parse('2026-10-01T10:00:00.000Z'));
    expect(page.items[0].readAt).toBeNull();
    expect(page.nextCursor).toBe('c2');
    expect((await hs.Inbox.markRead('i1')).readAt).toBe(Date.parse('2026-10-02T00:00:00.000Z'));
    expect(await hs.Inbox.markAllRead()).toBe(0);
    expect(await hs.Inbox.unreadCount()).toBe(4);
  });

  it('tercihler: ISO zamanı epoch milisaniyeye çevrilir; yazma kuyruğa verilir ve sonuç listesi döner', async () => {
    const { sdk, web } = fakeWebSdk();
    const hs = coreFor(web);
    const prefs = await hs.User.getPreferences();
    expect(prefs.preferences[1].updatedAt).toBe(Date.parse('2026-10-01T10:00:00.000Z'));
    expect(prefs.categories[0]).toEqual({ key: 'promo', name: { tr: 'Kampanya' }, description: {}, channels: ['email', 'sms'], defaultOptedIn: true });

    const result = await hs.User.setPreferences([
      { category: 'promo', channel: 'sms', optedIn: false },
      { category: 'promo', optedIn: false },
      { category: 'news', optedIn: true },
    ]);
    expect(sdk.User.setPreferences).toHaveBeenCalledWith([
      { category: 'promo', optedIn: false, channel: 'sms' },
      { category: 'promo', optedIn: false, channel: null },
      { category: 'news', optedIn: true, channel: null },
    ]);
    expect(result.preferences.map((p) => [p.category, p.channel, p.optedIn, p.explicit, p.source])).toEqual([
      ['promo', null, false, true, 'sdk'],
      ['promo', 'email', true, true, 'api'],
      ['promo', 'sms', false, true, 'sdk'],
      ['news', null, true, true, 'sdk'],
    ]);
    expect(typeof result.preferences[0].updatedAt).toBe('number');
  });

  it('tercihler: bilinmeyen kategori ve kapsam dışı kanal sunucu koduyla reddedilir, kuyruğa yazılmaz', async () => {
    const { sdk, web } = fakeWebSdk();
    const hs = coreFor(web);
    await expect(hs.User.setPreferences([{ category: 'missing', optedIn: true }])).rejects.toMatchObject({ code: 'HS_NOT_FOUND' });
    await expect(hs.User.setPreferences([{ category: 'promo', channel: 'web_push', optedIn: true }])).rejects.toMatchObject({
      code: 'HS_VALIDATION_ERROR',
    });
    expect(sdk.User.setPreferences).not.toHaveBeenCalled();
  });

  it('yalnızca native olan removeNotification ve e-posta/SMS listeleri web\'de unavailable döner', async () => {
    const { web } = fakeWebSdk();
    await expect(coreFor(web).Notifications.removeNotification(3)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(coreFor(web).Notifications.removeNotification('req-1')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(coreFor(web).User.getEmails()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(coreFor(web).User.getSmsNumbers()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('clearAll service worker bildirimlerini kapatır', async () => {
    const { web } = fakeWebSdk();
    const close = vi.fn();
    const getNotifications = vi.fn(async () => [{ close }, { close }]);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: vi.fn(async () => ({ getNotifications })) },
    });
    await coreFor(web).Notifications.clearAll();
    await coreFor(web).Notifications.removeGroupedNotifications('orders');
    expect(close).toHaveBeenCalledTimes(4);
    expect(getNotifications).toHaveBeenLastCalledWith({ tag: 'orders' });
  });
});
