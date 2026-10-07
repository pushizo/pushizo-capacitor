import { describe, expect, it, vi } from 'vitest';

import { capacitorBridge, HeroSignalCore } from '../src/index';
import { HeroSignalWeb } from '../src/web';
import type { WebSdkInstance } from '../src/web';

type Fn = (...args: never[]) => unknown;

/** `@herosignal/web` örneğinin sahte karşılığı; dinleyiciler dışarıdan tetiklenebilir. */
function fakeWebSdk() {
  const listeners: Record<string, Fn> = {};
  let permission = 'default';
  const sdk = {
    init: vi.fn(async () => undefined),
    setConsentGiven: vi.fn(async () => undefined),
    login: vi.fn(async () => undefined),
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
  };
  return { sdk, listeners, web: new HeroSignalWeb(sdk as unknown as WebSdkInstance) };
}

/** WebPlugin'i doğrudan cepheye bağlar (Capacitor proxy'si olmadan). */
function coreFor(web: HeroSignalWeb) {
  return new HeroSignalCore(capacitorBridge(web));
}

describe('HeroSignalWeb', () => {
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
    await hs.User.addEmail('ali@example.com');
    await hs.InAppMessages.addTrigger('level', 3);
    await hs.InAppMessages.setScreen(null);
    await hs.InAppMessages.setPaused(true);
    await hs.Session.sendEvent('purchase', { sku: 'A' }, 10);
    expect(sdk.login).toHaveBeenCalledWith('ext_1', 'hash');
    expect(sdk.User.addTags).toHaveBeenCalledWith({ plan: 'pro' });
    expect(sdk.User.addEmail).toHaveBeenCalledWith('ali@example.com');
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

  it('yalnızca Android olan removeNotification web\'de unavailable döner', async () => {
    const { web } = fakeWebSdk();
    await expect(coreFor(web).Notifications.removeNotification(3)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
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
