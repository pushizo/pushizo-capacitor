import { describe, expect, it, vi } from 'vitest';

import {
  createHeroSignal,
  toEventPayload,
  toInboxListOptions,
  toNotificationId,
  toStringRecord,
} from '../src/bridge.js';
import type {
  HeroSignalEventMap,
  HeroSignalEventName,
  HeroSignalPlugin,
  NativeForegroundEvent,
} from '../src/definitions.js';

type Call = { method: string; args: unknown };

/** Native köprüyü taklit eder: çağrıları kaydeder, olayları elle yayınlamaya izin verir. */
function fakePlugin(responses: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const handler: ProxyHandler<object> = {
    get(_target, prop: string) {
      if (prop === 'addListener')
        return async (event: string, cb: (e: unknown) => void) => {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(cb);
          calls.push({ method: 'addListener', args: event });
          return { remove: async () => void listeners.get(event)!.delete(cb) };
        };
      if (prop === 'then') return undefined;
      return async (args?: unknown) => {
        calls.push({ method: prop, args });
        return responses[prop];
      };
    },
  };
  const plugin = new Proxy({}, handler) as HeroSignalPlugin;
  const emit = <E extends HeroSignalEventName>(event: E, payload: HeroSignalEventMap[E]) => {
    for (const cb of listeners.get(event) ?? []) cb(payload);
  };
  const count = (event: string) => listeners.get(event)?.size ?? 0;
  const last = (method: string) => [...calls].reverse().find((c) => c.method === method)?.args;
  return { plugin, calls, emit, count, last };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const notification = {
  notificationId: '42',
  title: 'Merhaba',
  body: 'Gövde',
  url: null,
  imageUrl: null,
  deliveryId: 'dlv_1',
  messageId: 'msg_1',
  groupKey: null,
  actions: [],
  data: {},
};

describe('argüman dönüşümleri', () => {
  it('tag/trigger değerlerini dizgeye çevirir', () => {
    expect(toStringRecord({ a: 'x', b: 3, c: true, d: false, e: 1.5 }, 'Tag')).toEqual({
      a: 'x',
      b: '3',
      c: 'true',
      d: 'false',
      e: '1.5',
    });
  });

  it('geçersiz tag değerlerini reddeder', () => {
    expect(() => toStringRecord({ a: null as unknown as string }, 'Tag')).toThrow(TypeError);
    expect(() => toStringRecord({ a: Number.NaN }, 'Tag')).toThrow(TypeError);
    expect(() => toStringRecord({ a: { x: 1 } as unknown as string }, 'Tag')).toThrow(TypeError);
    expect(() => toStringRecord([] as unknown as Record<string, string>, 'Tag')).toThrow(TypeError);
  });

  it('bildirim kimliğini dizgeye çevirir (Android tam sayı, iOS dizge)', () => {
    expect(toNotificationId(1234)).toBe('1234');
    expect(toNotificationId(-5)).toBe('-5');
    expect(toNotificationId('dlv_abc')).toBe('dlv_abc');
    expect(() => toNotificationId(1.5)).toThrow(TypeError);
    expect(() => toNotificationId('')).toThrow(TypeError);
  });

  it('olay yükünden undefined alanları atar ve değeri doğrular', () => {
    expect(toEventPayload('purchase')).toEqual({ name: 'purchase' });
    expect(toEventPayload('purchase', { sku: 'A', note: undefined, n: 2 }, 9.9)).toEqual({
      name: 'purchase',
      properties: { sku: 'A', n: 2 },
      value: 9.9,
    });
    expect(() => toEventPayload('')).toThrow(TypeError);
    expect(() => toEventPayload('x', undefined, Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it('inbox limitini doğrular', () => {
    expect(toInboxListOptions()).toEqual({ limit: 50 });
    expect(toInboxListOptions({ limit: 10, cursor: 'c1' })).toEqual({ limit: 10, cursor: 'c1' });
    expect(() => toInboxListOptions({ limit: 0 })).toThrow(RangeError);
    expect(() => toInboxListOptions({ limit: 201 })).toThrow(RangeError);
  });
});

describe('ad alanlı API → native köprü', () => {
  it('initialize seçeneklerini sadeleştirir', async () => {
    const f = fakePlugin();
    const hs = createHeroSignal(f.plugin);
    await hs.initialize('app_1', { apiUrl: 'https://api.example.com/', logLevel: 'debug' });
    expect(f.last('initialize')).toEqual({ appId: 'app_1', apiUrl: 'https://api.example.com', logLevel: 'debug' });
    expect(() => hs.initialize('')).toThrow(TypeError);
    expect(() => hs.initialize('app_1', { logLevel: 'verbose' as never })).toThrow(RangeError);
  });

  it('login identityHash yoksa alanı göndermez', async () => {
    const f = fakePlugin();
    const hs = createHeroSignal(f.plugin);
    await hs.login('user_1');
    expect(f.last('login')).toEqual({ externalId: 'user_1' });
    await hs.login('user_1', 'hash');
    expect(f.last('login')).toEqual({ externalId: 'user_1', identityHash: 'hash' });
  });

  it('User çağrılarını doğru argümanlarla iletir', async () => {
    const f = fakePlugin({ getTags: { tags: { plan: 'pro' } }, getUser: { id: 'u1', externalId: 'e1' } });
    const hs = createHeroSignal(f.plugin);
    await hs.User.addTag('level', 5);
    expect(f.last('addTags')).toEqual({ tags: { level: '5' } });
    await hs.User.removeTag('level');
    expect(f.last('removeTags')).toEqual({ keys: ['level'] });
    await hs.User.addAlias('crm_id', '42');
    expect(f.last('addAliases')).toEqual({ aliases: { crm_id: '42' } });
    await hs.User.addSms('+905551112233');
    expect(f.last('addSms')).toEqual({ phoneNumber: '+905551112233' });
    expect(await hs.User.getTags()).toEqual({ plan: 'pro' });
    expect(await hs.User.getExternalId()).toBe('e1');
    expect(await hs.User.getId()).toBe('u1');
    expect(() => hs.User.addEmail(' ')).toThrow(TypeError);
  });

  it('bildirim tepsisi metotlarını iletir', async () => {
    const f = fakePlugin();
    const hs = createHeroSignal(f.plugin);
    await hs.Notifications.clearAll();
    await hs.Notifications.removeNotification(77);
    expect(f.last('removeNotification')).toEqual({ id: '77' });
    await hs.Notifications.removeGroupedNotifications('orders');
    expect(f.last('removeGroupedNotifications')).toEqual({ group: 'orders' });
    expect(f.calls.some((c) => c.method === 'clearAll')).toBe(true);
  });

  it('izin sonucunu boolean ve ayrıntılı durum olarak verir', async () => {
    const f = fakePlugin({
      getPermission: { granted: false, status: 'denied' },
      requestPermission: { granted: true, status: 'provisional' },
    });
    const hs = createHeroSignal(f.plugin);
    expect(await hs.Notifications.getPermission()).toBe(false);
    expect(await hs.Notifications.getPermissionStatus()).toBe('denied');
    expect(await hs.Notifications.requestPermission()).toBe(true);
  });

  it('ön plan dinleyicisi preventDefault kararını native tarafa döndürür', async () => {
    const f = fakePlugin();
    const hs = createHeroSignal(f.plugin);
    const first = vi.fn((e: { preventDefault(): void; notification: { data: Record<string, string> } }) => {
      if (e.notification.data.silent === '1') e.preventDefault();
    });
    const broken = vi.fn(() => {
      throw new Error('dinleyici hatası');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    hs.Notifications.addForegroundLifecycleListener(first);
    hs.Notifications.addForegroundLifecycleListener(broken);
    await flush();
    expect(f.last('setForegroundHandlerEnabled')).toEqual({ enabled: true });
    expect(f.count('notificationWillDisplay')).toBe(1);

    const event: NativeForegroundEvent = { eventId: 'e1', notification: { ...notification, data: { silent: '1' } } };
    f.emit('notificationWillDisplay', event);
    expect(f.last('completeForegroundDisplay')).toEqual({ eventId: 'e1', display: false });

    f.emit('notificationWillDisplay', { eventId: 'e2', notification });
    expect(f.last('completeForegroundDisplay')).toEqual({ eventId: 'e2', display: true });
    expect(broken).toHaveBeenCalledTimes(2);

    await hs.Notifications.removeForegroundLifecycleListener(first);
    expect(f.count('notificationWillDisplay')).toBe(1);
    await hs.Notifications.removeForegroundLifecycleListener(broken);
    expect(f.last('setForegroundHandlerEnabled')).toEqual({ enabled: false });
    expect(f.count('notificationWillDisplay')).toBe(0);
    consoleError.mockRestore();
  });

  it('tıklama dinleyicisini bir kez ekler ve kaldırır', async () => {
    const f = fakePlugin();
    const hs = createHeroSignal(f.plugin);
    const cb = vi.fn();
    hs.Notifications.addClickListener(cb);
    hs.Notifications.addClickListener(cb);
    await flush();
    expect(f.count('notificationClick')).toBe(1);
    f.emit('notificationClick', { notification, result: { actionId: 'btn', url: 'https://x.test' } });
    expect(cb).toHaveBeenCalledWith({ notification, result: { actionId: 'btn', url: 'https://x.test' } });
    await hs.Notifications.removeClickListener(cb);
    expect(f.count('notificationClick')).toBe(0);
  });

  it('in-app yaşam döngüsü dinleyicisi yalnızca verilen alanları bağlar', async () => {
    const f = fakePlugin();
    const hs = createHeroSignal(f.plugin);
    const listener = { didDisplay: vi.fn(), didDismiss: vi.fn() };
    hs.InAppMessages.addLifecycleListener(listener);
    await flush();
    expect(f.count('inAppDidDisplay')).toBe(1);
    expect(f.count('inAppWillDisplay')).toBe(0);
    f.emit('inAppDidDisplay', { message: { id: 'iam_1' } });
    expect(listener.didDisplay).toHaveBeenCalledWith({ message: { id: 'iam_1' } });
    await hs.InAppMessages.removeLifecycleListener(listener);
    expect(f.count('inAppDidDisplay')).toBe(0);
    expect(f.count('inAppDidDismiss')).toBe(0);
  });

  it('in-app tetik ve ekran argümanlarını dönüştürür', async () => {
    const f = fakePlugin({ getInAppPaused: { paused: true }, getTriggers: { triggers: { level: '3' } } });
    const hs = createHeroSignal(f.plugin);
    await hs.InAppMessages.addTrigger('level', 3);
    expect(f.last('addTriggers')).toEqual({ triggers: { level: '3' } });
    await hs.InAppMessages.setScreen('  ');
    expect(f.last('setScreen')).toEqual({ name: null });
    await hs.InAppMessages.setScreen('checkout');
    expect(f.last('setScreen')).toEqual({ name: 'checkout' });
    await hs.InAppMessages.setPaused(true);
    expect(f.last('setInAppPaused')).toEqual({ paused: true });
    expect(await hs.InAppMessages.getPaused()).toBe(true);
    expect(await hs.InAppMessages.getTriggers()).toEqual({ level: '3' });
  });

  it('inbox sonuçlarını açar', async () => {
    const item = {
      id: 'i1',
      messageId: null,
      title: 't',
      body: null,
      url: null,
      imageUrl: null,
      data: {},
      read: true,
      readAt: '2026-10-08T10:00:00.000Z',
      archivedAt: null,
      expiresAt: null,
      createdAt: '2026-10-08T09:00:00.000Z',
    };
    const f = fakePlugin({
      inboxList: { items: [item], unreadCount: 0, nextCursor: null, hasMore: false },
      inboxMarkRead: { item },
      inboxMarkAllRead: { unreadCount: 0 },
      inboxUnreadCount: { unreadCount: 4 },
    });
    const hs = createHeroSignal(f.plugin);
    expect((await hs.Inbox.list({ limit: 20 })).items).toHaveLength(1);
    expect(f.last('inboxList')).toEqual({ limit: 20 });
    expect(await hs.Inbox.markRead('i1')).toEqual(item);
    expect(await hs.Inbox.markAllRead()).toBe(0);
    expect(await hs.Inbox.unreadCount()).toBe(4);
    await hs.Inbox.delete('i1');
    expect(f.last('inboxDelete')).toEqual({ id: 'i1' });
  });

  it('olay ve log seviyesi çağrılarını iletir', async () => {
    const f = fakePlugin();
    const hs = createHeroSignal(f.plugin);
    await hs.Session.sendEvent('purchase', { sku: 'A' }, 10);
    expect(f.last('sendEvent')).toEqual({ name: 'purchase', properties: { sku: 'A' }, value: 10 });
    await hs.Debug.setLogLevel('none');
    expect(f.last('setLogLevel')).toEqual({ level: 'none' });
  });
});
