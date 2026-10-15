/*
 * Native köprü sözleşmesi: TS eklenti arayüzündeki her metodun Android (@PluginMethod) ve iOS
 * (CAPPluginMethod + @objc) karşılığı ve çekirdek işleyicisi olmalı. Native kod bu ortamda derlenemediğinden
 * kaynak metni üzerinden doğrulanır.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** `HeroSignalPlugin` arayüzündeki metot adları (dinleyici yönetimi hariç). */
function pluginMethods(): string[] {
  const src = read('src/definitions.ts');
  const body = src.slice(src.indexOf('export interface HeroSignalPlugin'));
  return [...new Set([...body.matchAll(/^\s{2}([a-zA-Z]+)\(/gm)].map((m) => m[1]))].filter(
    (m) => m !== 'addListener' && m !== 'removeAllListeners',
  );
}

describe('native sözleşme', () => {
  const methods = pluginMethods();
  const adapterHandled = new Set(['requestPermission', 'requestLocationPermission']);

  it('cephenin çağırdığı her metot eklenti arayüzünde var', () => {
    const core = read('src/core.ts');
    const called = new Set([...core.matchAll(/bridge\.call(?:<[^>]*>)?\('([A-Za-z]+)'/g)].map((m) => m[1]));
    expect(methods.length).toBeGreaterThan(30);
    for (const m of called) expect(methods, m).toContain(m);
  });

  it('Android: her metot @PluginMethod ve çekirdek işleyicisine sahip', () => {
    const plugin = read('android/src/main/java/com/herosignal/capacitor/HeroSignalPlugin.kt');
    const annotated = new Set([...plugin.matchAll(/@PluginMethod\s+fun ([A-Za-z]+)\(/g)].map((m) => m[1]));
    const core = read('android/src/main/java/com/herosignal/capacitor/HeroSignalBridgeCore.kt');
    const handled = new Set([...core.matchAll(/^\s+"([A-Za-z]+)" ->/gm)].map((m) => m[1]));
    for (const m of methods) {
      expect(annotated.has(m), `@PluginMethod ${m}`).toBe(true);
      expect(handled.has(m) || adapterHandled.has(m), `çekirdek ${m}`).toBe(true);
    }
  });

  it('iOS: her metot CAPPluginMethod, @objc fonksiyon ve çekirdek işleyicisine sahip', () => {
    const plugin = read('ios/Sources/HeroSignalPlugin/HeroSignalPlugin.swift');
    const declared = new Set([...plugin.matchAll(/CAPPluginMethod\(name: "([A-Za-z]+)"/g)].map((m) => m[1]));
    const objc = new Set([...plugin.matchAll(/@objc(?:\(([A-Za-z]+):\))? func ([A-Za-z]+)\(_ call: CAPPluginCall\)/g)].map((m) => m[1] ?? m[2]));
    const core = read('ios/Sources/HeroSignalPlugin/HeroSignalBridgeCore.swift');
    const handled = new Set([...core.matchAll(/case ((?:"[A-Za-z]+"(?:, )?)+):/g)].flatMap((m) => [...m[1].matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1])));
    for (const m of methods) {
      expect(declared.has(m), `CAPPluginMethod ${m}`).toBe(true);
      expect(objc.has(m), `@objc ${m}`).toBe(true);
      expect(handled.has(m), `çekirdek ${m}`).toBe(true);
    }
    expect(plugin).toContain('public let jsName = "HeroSignal"');
  });

  it('bildirim kaldırma ve e-posta/SMS listeleri gerçek native SDK çağrılarına bağlı', () => {
    expect(methods).toContain('getContacts');
    const kt = read('android/src/main/java/com/herosignal/capacitor/HeroSignalBridgeCore.kt');
    expect(kt).toContain('HeroSignal.Notifications.removeNotification(id)');
    expect(kt).toContain('JSONArray(HeroSignal.User.emails)');
    expect(kt).toContain('JSONArray(HeroSignal.User.smsNumbers)');
    const swift = read('ios/Sources/HeroSignalPlugin/HeroSignalBridgeCore.swift');
    expect(swift).toContain('HeroSignal.Notifications.removeNotification(identifier: identifier)');
    expect(swift).toContain('HeroSignal.Notifications.removeGroupedNotifications(group)');
    expect(swift).toContain('"emails": HeroSignal.User.emails, "smsNumbers": HeroSignal.User.smsNumbers');
    expect(swift).not.toMatch(/case "removeNotification": ok\(\)/);
  });

  it('JWT identity verification native SDK çağrılarına iletilir', () => {
    expect(methods).toEqual(expect.arrayContaining(['login', 'updateUserJwt']));
    const kt = read('android/src/main/java/com/herosignal/capacitor/HeroSignalBridgeCore.kt');
    expect(kt).toContain('HeroSignal.login(args.requireString("externalId"), args.optStringOrNull("identityHash"), args.optStringOrNull("jwt"))');
    expect(kt).toContain('HeroSignal.updateUserJwt(args.requireString("jwt"))');
    const swift = read('ios/Sources/HeroSignalPlugin/HeroSignalBridgeCore.swift');
    expect(swift).toContain('HeroSignal.login(externalId, identityHash: identityHash, jwt: jwt)');
    expect(swift).toContain('try HeroSignal.updateUserJwt(jwt)');
  });

  it('Live Activities: iOS native SDK çağrılarına bağlı, Android PLATFORM_NOT_SUPPORTED ile reddeder', () => {
    expect(methods).toEqual(expect.arrayContaining(['setupDefaultLiveActivity', 'startDefaultLiveActivity']));
    const swift = read('ios/Sources/HeroSignalPlugin/HeroSignalBridgeCore.swift');
    expect(swift).toContain('try HeroSignal.LiveActivities.setupDefaultLiveActivity()');
    expect(swift).toContain(
      'try HeroSignal.LiveActivities.startDefaultLiveActivity(activityId: activityId, attributes: attributes, contentState: contentState)',
    );
    // SDK hata kodu (PLATFORM_NOT_SUPPORTED / NOT_READY / INVALID_ARGUMENT / LIVE_ACTIVITY_FAILED) aynen iletilir.
    expect(swift).toContain('catch let error as HSLiveActivityError');
    expect(swift).toContain('reply(.failure(code: error.code, message: error.message))');
    expect(swift).toContain('reply(.failure(code: "LIVE_ACTIVITY_FAILED", message: error.localizedDescription))');

    const kt = read('android/src/main/java/com/herosignal/capacitor/HeroSignalBridgeCore.kt');
    expect(kt).toContain('"setupDefaultLiveActivity" -> reply.error(PLATFORM_NOT_SUPPORTED, LIVE_ACTIVITIES_IOS_ONLY)');
    expect(kt).toContain('"startDefaultLiveActivity" -> reply.error(PLATFORM_NOT_SUPPORTED, LIVE_ACTIVITIES_IOS_ONLY)');
    expect(kt).toContain('const val PLATFORM_NOT_SUPPORTED = "PLATFORM_NOT_SUPPORTED"');
    expect(kt).toContain('const val LIVE_ACTIVITIES_IOS_ONLY = "Live Activities yalnızca iOS\'ta desteklenir"');
  });

  it('Konum: native SDK Location çağrılarına bağlı; Android izni manifest, açıklama ve Capacitor izin API akışıyla ister', () => {
    expect(methods).toEqual(expect.arrayContaining(['setLocationShared', 'isLocationShared', 'requestLocationPermission']));
    const kt = read('android/src/main/java/com/herosignal/capacitor/HeroSignalBridgeCore.kt');
    expect(kt).toContain('HeroSignal.Location.setShared(args.optBoolean("shared", false))');
    expect(kt).toContain('"isLocationShared" -> reply.success(JSONObject().put("shared", HeroSignal.Location.isShared))');
    expect(kt).toContain('JSONObject().put("permission", HeroSignal.Location.permissionGranted)');
    expect(kt).toContain('HeroSignal.Location.onPermissionResult()');
    // Yalnızca uygulama manifest'inde tanımlı konum izinleri istenir; arka plan konumu yok.
    expect(kt).toContain('PackageManager.GET_PERMISSIONS');
    expect(kt).toContain('arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)');
    expect(kt).not.toContain('ACCESS_BACKGROUND_LOCATION');
    // Açıklama diyaloğu SDK string kaynaklarıyla; "Şimdi değil"/iptal false döner.
    for (const key of ['title', 'message', 'continue', 'not_now']) {
      expect(kt).toContain(`com.herosignal.sdk.R.string.hs_location_rationale_${key}`);
    }
    expect(kt).toContain('.setOnCancelListener { reply.success(locationPermissionJson()) }');
    const plugin = read('android/src/main/java/com/herosignal/capacitor/HeroSignalPlugin.kt');
    expect(plugin).toContain('Permission(strings = [Manifest.permission.ACCESS_COARSE_LOCATION], alias = HeroSignalPlugin.LOCATION_COARSE_ALIAS)');
    expect(plugin).toContain('Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION], alias = HeroSignalPlugin.LOCATION_FINE_ALIAS)');
    expect(plugin).toContain('core.requestLocationPermission(activity, call.data, reply(call))');
    expect(plugin).toContain('requestPermissionForAliases(aliases.toTypedArray(), call, "onLocationPermission")');
    expect(plugin).toMatch(/@PermissionCallback\s+private fun onLocationPermission\(call: PluginCall\)/);
    expect(plugin).toContain('call.resolve(JSObject.fromJSONObject(core.onLocationPermissionResult()))');
    // Eklenti konum iznini manifest'e otomatik eklemez (README "Konum").
    expect(read('android/src/main/AndroidManifest.xml')).not.toMatch(/ACCESS_(COARSE|FINE|BACKGROUND)_LOCATION/);
    const swift = read('ios/Sources/HeroSignalPlugin/HeroSignalBridgeCore.swift');
    expect(swift).toContain('HeroSignal.Location.setShared(args["shared"] as? Bool ?? false)');
    expect(swift).toContain('case "isLocationShared": ok(["shared": HeroSignal.Location.isShared])');
    expect(swift).toContain('HeroSignal.Location.requestPermission(rationale: string("rationale")) { granted in ok(["permission": granted]) }');
  });

  it('package.json dosya listesi ve native paket tanımları tutarlı', () => {
    const pkg = JSON.parse(read('package.json')) as { files: string[] };
    for (const f of pkg.files.filter((x) => x !== 'dist/')) expect(existsSync(join(root, f)), f).toBe(true);
    expect(read('HerosignalCapacitor.podspec')).toContain("s.source_files     = 'ios/Sources/**/*.{swift,h,m}'");
    expect(read('Package.swift')).toContain('path: "ios/Sources/HeroSignalPlugin"');
    expect(read('android/src/main/java/com/herosignal/capacitor/HeroSignalPlugin.kt')).toContain('name = "HeroSignal"');
  });
});
