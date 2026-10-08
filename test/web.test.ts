import type { HeroSignalSdk } from '@herosignal/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHeroSignal } from '../src/bridge.js';
import { HeroSignalWeb } from '../src/web.js';

type Fn = (...args: never[]) => unknown;

/** `@herosignal/web` örneğinin köprünün kullandığı yüzeyini taklit eder. */
function fakeSdk(extraNotifications: Record<string, Fn> = {}) {
  const click = new Set<(e: unknown) => void>();
  const foreground = new Set<(e: unknown) => void>();
  const observers = new Set<(e: unknown) => void>();
  const inAppClick = new Set<(e: unknown) => void>();
  const lifecycle = new Set<Record<string, (e: unknown) => void>>();
  let paused = false;
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
      id: 'user_1',
      externalId: 'ext_1',
      pushSubscription: {
        state: { id: 'sub_1', token: 'https://push.example/abc', optedIn: true, permission: 'granted' },
        optIn: vi.fn(async () => undefined),
        optOut: vi.fn(async () => undefined),
        addObserver: (cb: (e: unknown) => void) => {
          observers.add(cb);
          return () => observers.delete(cb);
        },
      },
    },
    Notifications: {
      permission: 'default',
      requestPermission: vi.fn(async () => 'granted'),
      addClickListener: (cb: (e: unknown) => void) => {
        click.add(cb);
        return () => click.delete(cb);
      },
      addForegroundLifecycleListener: (cb: (e: unknown) => void) => {
        foreground.add(cb);
        return () => foreground.delete(cb);
      },
      ...extraNotifications,
    },
    Session: { sendEvent: vi.fn() },
    InAppMessages: {
      addTriggers: vi.fn(),
      removeTriggers: vi.fn(),
      clearTriggers: vi.fn(),
      getTriggers: vi.fn(() => ({ level: 3, vip: true })),
      setScreen: vi.fn(),
      addClickListener: (cb: (e: unknown) => void) => {
        inAppClick.add(cb);
        return () => inAppClick.delete(cb);
      },
      addLifecycleListener: (l: Record<string, (e: unknown) => void>) => {
        lifecycle.add(l);
        return () => lifecycle.delete(l);
      },
      get paused() {
        return paused;
      },
      set paused(v: boolean) {
        paused = v;
      },
    },
    Inbox: {
      list: vi.fn(async () => ({
        items: [
          {
            id: 'i1',
            messageId: 'm1',
            title: 'Başlık',
            body: null,
            url: null,
            imageUrl: null,
            data: { k: 'v' },
            read: false,
            readAt: null,
            archivedAt: null,
            expiresAt: null,
            createdAt: '2026-10-08T09:00:00.000Z',
          },
        ],
        unreadCount: 1,
        nextCursor: null,
        hasMore: false,
      })),
      markRead: vi.fn(),
      markAllRead: vi.fn(async () => ({ updated: 3, unreadCount: 0 })),
      archive: vi.fn(async () => undefined),
      unreadCount: vi.fn(async () => 2),
    },
    Debug: { setLogLevel: vi.fn() },
  };
  const emitForeground = (data: Record<string, unknown>) => {
    let prevented = false;
    const event = {
      notification: { title: 'T', body: 'B', deliveryId: 'dlv_9', messageId: 'msg_9', data },
      preventDefault: () => {
        prevented = true;
      },
    };
    for (const cb of foreground) cb(event);
    return prevented;
  };
  return {
    sdk,
    asSdk: sdk as unknown as HeroSignalSdk,
    emitClick: (e: unknown) => click.forEach((cb) => cb(e)),
    emitForeground,
    emitObserver: (e: unknown) => observers.forEach((cb) => cb(e)),
    emitInAppClick: (e: unknown) => inAppClick.forEach((cb) => cb(e)),
    emitLifecycle: (name: string, e: unknown) => lifecycle.forEach((l) => l[name]?.(e)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HeroSignalWeb (@herosignal/web köprüsü)', () => {
  it('initialize seçeneklerini web SDK biçimine çevirir ve dinleyicileri bir kez bağlar', async () => {
    const f = fakeSdk();
    const web = new HeroSignalWeb(f.asSdk);
    const hs = createHeroSignal(web);
    await hs.initialize('app_1', { apiUrl: 'https://api.example.com', logLevel: 'none', requiresPrivacyConsent: true });
    await hs.initialize('app_1');
    expect(f.sdk.init).toHaveBeenCalledWith({
      appId: 'app_1',
      apiUrl: 'https://api.example.com',
      requiresPrivacyConsent: true,
      logLevel: 'silent',
    });
    const cb = vi.fn();
    hs.Notifications.addClickListener(cb);
    await Promise.resolve();
    f.emitClick({
      notification: { title: 'Merhaba', body: '', url: 'https://x.test', deliveryId: 'dlv_1', data: { a: 1 } },
      result: { actionId: 'btn' },
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({
      notification: {
        notificationId: 'dlv_1',
        title: 'Merhaba',
        body: null,
        url: 'https://x.test',
        imageUrl: null,
        deliveryId: 'dlv_1',
        messageId: null,
        groupKey: null,
        actions: [],
        data: { a: '1' },
      },
      result: { actionId: 'btn', url: null },
    });
  });

  it('ön plan kararını web SDK olayına senkron uygular', async () => {
    const f = fakeSdk();
    const hs = createHeroSignal(new HeroSignalWeb(f.asSdk));
    await hs.initialize('app_1');
    // Dinleyici yokken web SDK varsayılanı (göster) korunur.
    expect(f.emitForeground({ silent: '1' })).toBe(false);
    hs.Notifications.addForegroundLifecycleListener((e) => {
      if (e.notification.data.silent === '1') e.preventDefault();
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(f.emitForeground({ silent: '1' })).toBe(true);
    expect(f.emitForeground({ silent: '0' })).toBe(false);
  });

  it('kullanıcı, abonelik ve izin çağrılarını eşler', async () => {
    const f = fakeSdk();
    const hs = createHeroSignal(new HeroSignalWeb(f.asSdk));
    await hs.initialize('app_1');
    await hs.User.addTags({ plan: 'pro', score: 10 });
    expect(f.sdk.User.addTags).toHaveBeenCalledWith({ plan: 'pro', score: '10' });
    await hs.User.addEmail('ali@example.com');
    expect(f.sdk.User.addEmail).toHaveBeenCalledWith('ali@example.com');
    expect(await hs.User.getId()).toBe('user_1');
    expect(await hs.User.pushSubscription.getState()).toEqual({
      id: 'sub_1',
      token: 'https://push.example/abc',
      optedIn: true,
    });
    expect(await hs.Notifications.getPermissionStatus()).toBe('default');
    expect(await hs.Notifications.requestPermission()).toBe(true);

    const observer = vi.fn();
    hs.User.pushSubscription.addObserver(observer);
    await Promise.resolve();
    f.emitObserver({ id: 'sub_2', token: 't', optedIn: false, permission: 'denied' });
    expect(observer).toHaveBeenCalledWith({ current: { id: 'sub_2', token: 't', optedIn: false } });
  });

  it('in-app olaylarını ve tetikleri eşler', async () => {
    const f = fakeSdk();
    const hs = createHeroSignal(new HeroSignalWeb(f.asSdk));
    await hs.initialize('app_1');
    const click = vi.fn();
    const didDisplay = vi.fn();
    hs.InAppMessages.addClickListener(click);
    hs.InAppMessages.addLifecycleListener({ didDisplay });
    await Promise.resolve();
    f.emitInAppClick({ message: { id: 'iam_1' }, result: { actionId: 'ok' } });
    f.emitLifecycle('didDisplay', { message: { id: 'iam_1' } });
    expect(click).toHaveBeenCalledWith({ message: { id: 'iam_1' }, result: { actionId: 'ok', url: null } });
    expect(didDisplay).toHaveBeenCalledWith({ message: { id: 'iam_1' } });

    await hs.InAppMessages.setScreen(null);
    expect(f.sdk.InAppMessages.setScreen).toHaveBeenCalledWith('');
    await hs.InAppMessages.setPaused(true);
    expect(await hs.InAppMessages.getPaused()).toBe(true);
    expect(await hs.InAppMessages.getTriggers()).toEqual({ level: '3', vip: 'true' });
  });

  it('inbox çağrılarını eşler (delete → archive)', async () => {
    const f = fakeSdk();
    const hs = createHeroSignal(new HeroSignalWeb(f.asSdk));
    await hs.initialize('app_1');
    const page = await hs.Inbox.list({ limit: 5 });
    expect(f.sdk.Inbox.list).toHaveBeenCalledWith({ limit: 5 });
    expect(page.items[0]?.title).toBe('Başlık');
    expect(await hs.Inbox.markAllRead()).toBe(0);
    await hs.Inbox.delete('i1');
    expect(f.sdk.Inbox.archive).toHaveBeenCalledWith('i1');
    expect(await hs.Inbox.unreadCount()).toBe(2);
  });

  it('tepsi temizlemeyi web SDK destekliyorsa ona devreder', async () => {
    const clearAll = vi.fn();
    const removeNotification = vi.fn();
    const removeGroupedNotifications = vi.fn();
    const f = fakeSdk({ clearAll, removeNotification, removeGroupedNotifications });
    const hs = createHeroSignal(new HeroSignalWeb(f.asSdk));
    await hs.Notifications.clearAll();
    await hs.Notifications.removeNotification('dlv_1');
    await hs.Notifications.removeGroupedNotifications('orders');
    expect(clearAll).toHaveBeenCalled();
    expect(removeNotification).toHaveBeenCalledWith('dlv_1');
    expect(removeGroupedNotifications).toHaveBeenCalledWith('orders');
  });

  it('tepsi temizlemeyi service worker bildirimleriyle yapar (yalnızca HeroSignal bildirimleri)', async () => {
    const make = (tag: string, data: unknown) => ({ tag, data, close: vi.fn() });
    const a = make('orders', { hs: { dlv: 'dlv_1' } });
    const b = make('orders', { hs: { dlv: 'dlv_2' } });
    const other = make('orders', { app: true });
    const getNotifications = vi.fn(async () => [a, b, other]);
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistration: async () => ({ getNotifications }) },
    });
    const f = fakeSdk();
    const hs = createHeroSignal(new HeroSignalWeb(f.asSdk));

    await hs.Notifications.removeNotification('dlv_2');
    expect(b.close).toHaveBeenCalledTimes(1);
    expect(a.close).not.toHaveBeenCalled();

    await hs.Notifications.removeGroupedNotifications('orders');
    expect(a.close).toHaveBeenCalledTimes(1);
    expect(other.close).not.toHaveBeenCalled();

    await hs.Notifications.clearAll();
    expect(a.close).toHaveBeenCalledTimes(2);
    expect(other.close).not.toHaveBeenCalled();
  });

  it('log seviyesini ve olayları iletir', async () => {
    const f = fakeSdk();
    const hs = createHeroSignal(new HeroSignalWeb(f.asSdk));
    await hs.Debug.setLogLevel('debug');
    expect(f.sdk.Debug.setLogLevel).toHaveBeenCalledWith('debug');
    await hs.Session.sendEvent('purchase', { sku: 'A' }, 5);
    expect(f.sdk.Session.sendEvent).toHaveBeenCalledWith('purchase', { sku: 'A' }, 5);
  });
});
