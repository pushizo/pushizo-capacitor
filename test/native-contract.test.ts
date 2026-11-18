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

/** `PushizoPlugin` arayüzündeki metot adları (dinleyici yönetimi hariç). */
function pluginMethods(): string[] {
  const src = read('src/definitions.ts');
  const body = src.slice(src.indexOf('export interface PushizoPlugin'));
  return [...new Set([...body.matchAll(/^\s{2}([a-zA-Z]+)\(/gm)].map((m) => m[1]))].filter(
    (m) => m !== 'addListener' && m !== 'removeAllListeners',
  );
}

describe('native sözleşme', () => {
  const methods = pluginMethods();
  const adapterHandled = new Set(['requestPermission', 'requestLocationPermission', 'requestBackgroundLocationPermission']);

  it('cephenin çağırdığı her metot eklenti arayüzünde var', () => {
    const core = read('src/core.ts');
    const called = new Set([...core.matchAll(/bridge\.call(?:<[^>]*>)?\('([A-Za-z]+)'/g)].map((m) => m[1]));
    expect(methods.length).toBeGreaterThan(30);
    for (const m of called) expect(methods, m).toContain(m);
  });

  it('Android: her metot @PluginMethod ve çekirdek işleyicisine sahip', () => {
    const plugin = read('android/src/main/java/com/pushizo/capacitor/PushizoPlugin.kt');
    const annotated = new Set([...plugin.matchAll(/@PluginMethod\s+fun ([A-Za-z]+)\(/g)].map((m) => m[1]));
    const core = read('android/src/main/java/com/pushizo/capacitor/PushizoBridgeCore.kt');
    const handled = new Set([...core.matchAll(/^\s+"([A-Za-z]+)" ->/gm)].map((m) => m[1]));
    for (const m of methods) {
      expect(annotated.has(m), `@PluginMethod ${m}`).toBe(true);
      expect(handled.has(m) || adapterHandled.has(m), `çekirdek ${m}`).toBe(true);
    }
  });

  it('iOS: her metot CAPPluginMethod, @objc fonksiyon ve çekirdek işleyicisine sahip', () => {
    const plugin = read('ios/Sources/PushizoPlugin/PushizoPlugin.swift');
    const declared = new Set([...plugin.matchAll(/CAPPluginMethod\(name: "([A-Za-z]+)"/g)].map((m) => m[1]));
    const objc = new Set([...plugin.matchAll(/@objc(?:\(([A-Za-z]+):\))? func ([A-Za-z]+)\(_ call: CAPPluginCall\)/g)].map((m) => m[1] ?? m[2]));
    const core = read('ios/Sources/PushizoPlugin/PushizoBridgeCore.swift');
    const handled = new Set([...core.matchAll(/case ((?:"[A-Za-z]+"(?:, )?)+):/g)].flatMap((m) => [...m[1].matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1])));
    for (const m of methods) {
      expect(declared.has(m), `CAPPluginMethod ${m}`).toBe(true);
      expect(objc.has(m), `@objc ${m}`).toBe(true);
      expect(handled.has(m), `çekirdek ${m}`).toBe(true);
    }
    expect(plugin).toContain('public let jsName = "Pushizo"');
  });

  it('bildirim kaldırma ve e-posta/SMS listeleri gerçek native SDK çağrılarına bağlı', () => {
    expect(methods).toContain('getContacts');
    const kt = read('android/src/main/java/com/pushizo/capacitor/PushizoBridgeCore.kt');
    expect(kt).toContain('Pushizo.Notifications.removeNotification(id)');
    expect(kt).toContain('JSONArray(Pushizo.User.emails)');
    expect(kt).toContain('JSONArray(Pushizo.User.smsNumbers)');
    const swift = read('ios/Sources/PushizoPlugin/PushizoBridgeCore.swift');
    expect(swift).toContain('Pushizo.Notifications.removeNotification(identifier: identifier)');
    expect(swift).toContain('Pushizo.Notifications.removeGroupedNotifications(group)');
    expect(swift).toContain('"emails": Pushizo.User.emails, "smsNumbers": Pushizo.User.smsNumbers');
    expect(swift).not.toMatch(/case "removeNotification": ok\(\)/);
  });

  it('JWT identity verification native SDK çağrılarına iletilir', () => {
    expect(methods).toEqual(expect.arrayContaining(['login', 'updateUserJwt']));
    const kt = read('android/src/main/java/com/pushizo/capacitor/PushizoBridgeCore.kt');
    expect(kt).toContain('Pushizo.login(args.requireString("externalId"), args.optStringOrNull("identityHash"), args.optStringOrNull("jwt"))');
    expect(kt).toContain('Pushizo.updateUserJwt(args.requireString("jwt"))');
    const swift = read('ios/Sources/PushizoPlugin/PushizoBridgeCore.swift');
    expect(swift).toContain('Pushizo.login(externalId, identityHash: identityHash, jwt: jwt)');
    expect(swift).toContain('try Pushizo.updateUserJwt(jwt)');
  });

  it('Live Activities: iOS native SDK çağrılarına bağlı, Android PLATFORM_NOT_SUPPORTED ile reddeder', () => {
    expect(methods).toEqual(expect.arrayContaining(['setupDefaultLiveActivity', 'startDefaultLiveActivity']));
    const swift = read('ios/Sources/PushizoPlugin/PushizoBridgeCore.swift');
    expect(swift).toContain('try Pushizo.LiveActivities.setupDefaultLiveActivity()');
    expect(swift).toContain(
      'try Pushizo.LiveActivities.startDefaultLiveActivity(activityId: activityId, attributes: attributes, contentState: contentState)',
    );
    // SDK hata kodu (PLATFORM_NOT_SUPPORTED / NOT_READY / INVALID_ARGUMENT / LIVE_ACTIVITY_FAILED) aynen iletilir.
    expect(swift).toContain('catch let error as HSLiveActivityError');
    expect(swift).toContain('reply(.failure(code: error.code, message: error.message))');
    expect(swift).toContain('reply(.failure(code: "LIVE_ACTIVITY_FAILED", message: error.localizedDescription))');

    const kt = read('android/src/main/java/com/pushizo/capacitor/PushizoBridgeCore.kt');
    expect(kt).toContain('"setupDefaultLiveActivity" -> reply.error(PLATFORM_NOT_SUPPORTED, LIVE_ACTIVITIES_IOS_ONLY)');
    expect(kt).toContain('"startDefaultLiveActivity" -> reply.error(PLATFORM_NOT_SUPPORTED, LIVE_ACTIVITIES_IOS_ONLY)');
    expect(kt).toContain('const val PLATFORM_NOT_SUPPORTED = "PLATFORM_NOT_SUPPORTED"');
    expect(kt).toContain('const val LIVE_ACTIVITIES_IOS_ONLY = "Live Activities yalnızca iOS\'ta desteklenir"');
  });

  it('Android teslimat güçlendirme: native Pushizo.Delivery çağrılarına bağlı; iOS zararsız yanıt verir', () => {
    expect(methods).toEqual(
      expect.arrayContaining(['deliveryStatus', 'deliveryShouldShowGuidance', 'deliveryOpenSettings', 'deliveryShowGuidance']),
    );
    const kt = read('android/src/main/java/com/pushizo/capacitor/PushizoBridgeCore.kt');
    expect(kt).toContain('"deliveryStatus" -> reply.success(Pushizo.Delivery.status()?.toJson() ?: JSONObject().put("supported", false))');
    expect(kt).toContain('Pushizo.Delivery.shouldShowGuidance(args.optInt("minIntervalDays", 14))');
    expect(kt).toContain('Pushizo.Delivery.openSettings(activityProvider?.invoke() ?: context, deliverySetting(args.optStringOrNull("setting")))');
    expect(kt).toContain('Pushizo.Delivery.showGuidance(activity, deliverySetting(args.optStringOrNull("setting")), args.optStringOrNull("message")) { opened ->');
    // Activity yoksa diyalog gösterilmez; hata yerine false döner.
    expect(kt).toContain('if (activity == null) reply.success(JSONObject().put("opened", false))');
    // Köprü pil optimizasyonu iznini istemez (ADR-0092 §3).
    expect(kt).not.toContain('REQUEST_IGNORE_BATTERY_OPTIMIZATIONS');
    expect(read('android/src/main/java/com/pushizo/capacitor/PushizoPlugin.kt')).toContain('core.activityProvider = { activity }');
    // TS `DeliveryStatus` alanlarının tümü native JSON'da bulunur.
    const defs = read('src/definitions.ts');
    const fields = [...defs.slice(defs.indexOf('export interface DeliveryStatus {')).split('\n}')[0].matchAll(/^\s{2}([a-zA-Z]+): /gm)].map((m) => m[1]);
    expect(fields).toHaveLength(17);
    const json = kt.slice(kt.indexOf('fun HsDeliveryStatus.toJson()'), kt.indexOf('fun HsNotification.toJson()'));
    for (const field of fields) expect(json.includes(`.put("${field}", `), field).toBe(true);

    const swift = read('ios/Sources/PushizoPlugin/PushizoBridgeCore.swift');
    expect(swift).toContain('case "deliveryStatus": ok(["supported": false])');
    expect(swift).toContain('case "deliveryShouldShowGuidance": ok(["show": false])');
    expect(swift).toContain('case "deliveryOpenSettings", "deliveryShowGuidance": ok(["opened": false])');
  });

  it('Konum: native SDK Location çağrılarına bağlı; Android izni manifest, açıklama ve Capacitor izin API akışıyla ister', () => {
    expect(methods).toEqual(expect.arrayContaining(['setLocationShared', 'isLocationShared', 'requestLocationPermission']));
    const kt = read('android/src/main/java/com/pushizo/capacitor/PushizoBridgeCore.kt');
    expect(kt).toContain('Pushizo.Location.setShared(args.optBoolean("shared", false))');
    expect(kt).toContain('"isLocationShared" -> reply.success(JSONObject().put("shared", Pushizo.Location.isShared))');
    expect(kt).toContain('JSONObject().put("permission", Pushizo.Location.permissionGranted)');
    expect(kt).toContain('Pushizo.Location.onPermissionResult()');
    // Yalnızca uygulama manifest'inde tanımlı konum izinleri istenir.
    expect(kt).toContain('PackageManager.GET_PERMISSIONS');
    expect(kt).toContain('arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)');
    // Açıklama diyaloğu SDK string kaynaklarıyla; "Şimdi değil"/iptal false döner.
    for (const key of ['title', 'message', 'continue', 'not_now']) {
      expect(kt).toContain(`com.pushizo.sdk.R.string.hs_location_rationale_${key}`);
    }
    expect(kt).toContain('.setOnCancelListener { reply.success(locationPermissionJson()) }');
    const plugin = read('android/src/main/java/com/pushizo/capacitor/PushizoPlugin.kt');
    expect(plugin).toContain('Permission(strings = [Manifest.permission.ACCESS_COARSE_LOCATION], alias = PushizoPlugin.LOCATION_COARSE_ALIAS)');
    expect(plugin).toContain('Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION], alias = PushizoPlugin.LOCATION_FINE_ALIAS)');
    expect(plugin).toContain('core.requestLocationPermission(activity, call.data, reply(call))');
    expect(plugin).toContain('requestPermissionForAliases(aliases.toTypedArray(), call, "onLocationPermission")');
    expect(plugin).toMatch(/@PermissionCallback\s+private fun onLocationPermission\(call: PluginCall\)/);
    expect(plugin).toContain('call.resolve(JSObject.fromJSONObject(core.onLocationPermissionResult()))');
    // Eklenti konum iznini manifest'e otomatik eklemez (README "Konum").
    expect(read('android/src/main/AndroidManifest.xml')).not.toMatch(/ACCESS_(COARSE|FINE|BACKGROUND)_LOCATION/);
    const swift = read('ios/Sources/PushizoPlugin/PushizoBridgeCore.swift');
    expect(swift).toContain('Pushizo.Location.setShared(args["shared"] as? Bool ?? false)');
    expect(swift).toContain('case "isLocationShared": ok(["shared": Pushizo.Location.isShared])');
    expect(swift).toContain('Pushizo.Location.requestPermission(rationale: string("rationale")) { granted in ok(["permission": granted]) }');
  });

  it('Bölge izleme, özellik bayrakları ve yerleşimler native SDK çağrılarına bağlı', () => {
    expect(methods).toEqual(
      expect.arrayContaining([
        'setGeofencingEnabled', 'isGeofencingEnabled', 'featureFlagsRefresh', 'featureFlagsIsEnabled', 'featureFlagsGetValue',
        'placementsList', 'placementsReportImpression', 'placementsReportClick', 'placementsReportDismiss',
      ]),
    );
    const kt = read('android/src/main/java/com/pushizo/capacitor/PushizoBridgeCore.kt');
    const swift = read('ios/Sources/PushizoPlugin/PushizoBridgeCore.swift');
    expect(kt).toContain('Pushizo.Location.setGeofencingEnabled(args.optBoolean("enabled", false))');
    expect(kt).toContain('"isGeofencingEnabled" -> reply.success(JSONObject().put("enabled", Pushizo.Location.isGeofencingEnabled))');
    expect(kt).toContain('"featureFlagsRefresh" -> Pushizo.FeatureFlags.refresh { ok -> reply.success(JSONObject().put("success", ok)) }');
    expect(kt).toContain('Pushizo.FeatureFlags.isEnabled(args.requireString("key"), args.optBoolean("defaultValue", false))');
    expect(kt).toContain('Pushizo.FeatureFlags.getValue(args.requireString("key")).orNull()');
    expect(kt).toContain('"placementsList" -> Pushizo.Placements.list(args.requireString("key"), args.optInt("limit", 1))');
    expect(kt).toContain('Pushizo.Placements.reportImpression(it)');
    expect(kt).toContain('Pushizo.Placements.reportClick(it, buttonId)');
    expect(kt).toContain('Pushizo.Placements.reportDismiss(it)');
    // Rapor çağrıları son `list` yanıtlarındaki mesajla yapılır (sınırlı önbellek); bulunamazsa yalnızca debug log.
    expect(kt).toContain('private const val MAX_PLACEMENT_CACHE = 50');
    expect(kt).toContain('HsLog.d("yerleşim mesajı bulunamadı: $id")');
    expect(kt).toContain('fun HsInAppMessage.toBridgeJson(): JSONObject');
    // Köprü arka plan konum iznini manifeste eklemez (ADR-0065 §2); izin `requestBackgroundLocationPermission` ile istenir.

    expect(swift).toContain('Pushizo.Location.setGeofencingEnabled(args["enabled"] as? Bool ?? false)');
    expect(swift).toContain('case "isGeofencingEnabled": ok(["enabled": Pushizo.Location.isGeofencingEnabled])');
    expect(swift).toContain('let success = await Pushizo.FeatureFlags.refresh()');
    expect(swift).toContain('Pushizo.FeatureFlags.isEnabled(key, default: args["defaultValue"] as? Bool ?? false)');
    expect(swift).toContain('ok(["value": Self.orNull(Pushizo.FeatureFlags.value(key))])');
    expect(swift).toContain('let messages = try await Pushizo.Placements.list(key, limit: limit)');
    expect(swift).toContain('Pushizo.Placements.reportImpression(message)');
    expect(swift).toContain('Pushizo.Placements.reportClick(message, buttonId: buttonId)');
    expect(swift).toContain('Pushizo.Placements.reportDismiss(message)');
    expect(swift).toContain('private static let maxPlacementCache = 50');
    expect(swift).toContain('static func map(_ m: HSInAppMessage) -> [String: Any]');
    expect(read('android/src/main/AndroidManifest.xml')).not.toContain('ACCESS_BACKGROUND_LOCATION');
  });

  it('yerel API eşitliği: profille login, reklam rızası, reklam kimliği, rozet, ADM, konum izni ve sohbet dinleme', () => {
    expect([...methods]).toEqual(
      expect.arrayContaining([
        'isInitialized', 'setAdsPersonalizationConsent', 'getConsents', 'registerAdm', 'setAdvertisingId', 'setBadgeCount',
        'getLocationPermission', 'requestBackgroundLocationPermission', 'chatIsListening',
      ]),
    );
    const kt = read('android/src/main/java/com/pushizo/capacitor/PushizoBridgeCore.kt');
    expect(kt).toContain('"isInitialized" -> reply.success(JSONObject().put("initialized", Pushizo.isInitialized))');
    // Profil yerel `login(externalId, HsUserProfile, identityHash, jwt)` aşırı yüklemesine gider (doğrulama girişten önce).
    expect(kt).toContain('val profile = args.optJSONObject("profile")');
    expect(kt).toMatch(/Pushizo\.login\(\s+args\.requireString\("externalId"\),\s+HsUserProfile\(/);
    for (const field of ['email = profile.optStringOrNull("email")', 'sms = profile.optStringOrNull("sms")', 'tags = profile.stringMap("tags")', 'aliases = profile.stringMap("aliases")']) {
      expect(kt).toContain(field);
    }
    expect(kt).toContain('Pushizo.User.setAdsPersonalizationConsent(args.optBoolean("granted", false), callback(reply) { it.toJson() })');
    expect(kt).toContain('Pushizo.User.getConsents(callback(reply) { list -> JSONObject().put("consents", JSONArray(list.map { it.toJson() })) })');
    const consentJson = kt.slice(kt.indexOf('fun HsConsent.toJson()'), kt.indexOf('fun HsPreferencesResult.toJson()'));
    for (const field of ['purpose', 'granted', 'source', 'updatedAt']) expect(consentJson.includes(`.put("${field}", `), field).toBe(true);
    expect(kt).toContain('Pushizo.User.registerAdm(args.requireString("token"))');
    expect(kt).toContain('Pushizo.Ads.setAdvertisingId(args.optStringOrNull("id"))');
    // Rozet yerel `Notifications.setBadgeCount` çağrısına bağlıdır; sonuç (rozet gösterilebiliyor mu) JS'e döner.
    expect(kt).toContain('"setBadgeCount" -> reply.success(JSONObject().put("success", Pushizo.Notifications.setBadgeCount(args.optInt("count", 0))))');
    expect(kt).toContain('JSONObject().put("permission", Pushizo.Location.permissionGranted).put("background", Pushizo.Location.backgroundPermissionGranted)');
    expect(kt).toContain('"chatIsListening" -> reply.success(JSONObject().put("listening", Pushizo.Chat.isListening))');
    // Arka plan izni: zaten varsa true; yalnızca manifest'te tanımlıysa istenir; vazgeçilirse yanıt askıda kalmaz.
    expect(kt).toContain('fun requestBackgroundLocationPermission(activity: Activity?, args: JSONObject, reply: Reply, requestSystem: (Array<String>) -> Unit)');
    expect(kt).toContain('if (Pushizo.Location.backgroundPermissionGranted) {');
    expect(kt).toContain('declaredPermissions(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION))');
    expect(kt).toContain('val legacy = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q');
    for (const key of ['hs_geofence_rationale_title', 'hs_geofence_rationale_message']) expect(kt).toContain(`com.pushizo.sdk.R.string.${key}`);
    expect(kt).toContain('.setNegativeButton(com.pushizo.sdk.R.string.hs_location_rationale_not_now) { _, _ -> reply.success(backgroundLocationPermissionJson()) }');
    expect(kt).toContain('.setOnCancelListener { reply.success(backgroundLocationPermissionJson()) }');
    expect(kt).toContain('fun backgroundLocationPermissionJson(): JSONObject = JSONObject().put("permission", Pushizo.Location.backgroundPermissionGranted)');
    const plugin = read('android/src/main/java/com/pushizo/capacitor/PushizoPlugin.kt');
    expect(plugin).toContain('Permission(strings = [Manifest.permission.ACCESS_BACKGROUND_LOCATION], alias = PushizoPlugin.LOCATION_BACKGROUND_ALIAS)');
    expect(plugin).toContain('core.requestBackgroundLocationPermission(activity, call.data, reply(call))');
    expect(plugin).toContain('requestPermissionForAliases(aliases.toTypedArray(), call, "onBackgroundLocationPermission")');
    expect(plugin).toMatch(/@PermissionCallback\s+private fun onBackgroundLocationPermission\(call: PluginCall\)/);
    expect(plugin).toContain('call.resolve(JSObject.fromJSONObject(core.onBackgroundLocationPermissionResult()))');
    // Köprü arka plan konum iznini manifest'e eklemez; uygulama tanımlar.
    expect(read('android/src/main/AndroidManifest.xml')).not.toContain('ACCESS_BACKGROUND_LOCATION');

    const swift = read('ios/Sources/PushizoPlugin/PushizoBridgeCore.swift');
    expect(swift).toContain('case "isInitialized": ok(["initialized": Pushizo.isInitialized])');
    // Profil yerel `login(_:profile:identityHash:jwt:)` aşırı yüklemesine gider: doğrulama ve sıralama yerel SDK'dadır,
    // köprü profil alanlarını kendisi yazmaz. `HSError.invalidArgument` → INVALID_ARGUMENT, başlatılmamış SDK → NOT_READY.
    const login = swift.slice(swift.indexOf('case "login":'), swift.indexOf('case "updateUserJwt":'));
    expect(login).toContain('try Pushizo.login(externalId, profile: userProfile, identityHash: identityHash, jwt: jwt)');
    expect(login).toContain('HSUserProfile(email: Self.nonBlank(profile["email"]), sms: Self.nonBlank(profile["sms"]),');
    expect(login).toContain('tags: Self.stringMap(profile["tags"]), aliases: Self.stringMap(profile["aliases"]))');
    expect(login).toMatch(/catch HSError\.invalidArgument\(let message\) \{\s+invalid\(message\)/);
    expect(login).toContain('reply(.failure(code: "NOT_READY", message: Self.notInitialized))');
    // Kanıt denetimi profilden önce yapılır (Android köprüsüyle aynı kod).
    expect(login.indexOf('Pushizo.loginProofError(identityHash: identityHash, jwt: jwt)')).toBeLessThan(login.indexOf('try Pushizo.login('));
    for (const call of ['HSContacts.normalize', 'Pushizo.User.addEmail', 'Pushizo.User.addSms', 'Pushizo.User.addTags', 'Pushizo.User.addAliases']) {
      expect(login.includes(call), call).toBe(false);
    }
    expect(swift).toContain('Self.map(try await Pushizo.User.setAdsPersonalizationConsent(granted))');
    expect(swift).toContain('["consents": try await Pushizo.User.getConsents().map { Self.map($0) }]');
    expect(swift).toContain('static func map(_ consent: HSUserConsent) -> [String: Any]');
    expect(swift).toContain('case "registerAdm": ok()');
    expect(swift).toContain('case "setAdvertisingId": Pushizo.Ads.setAdvertisingId(string("id")); ok()');
    expect(swift).toContain('Pushizo.Notifications.setBadgeCount(count); ok(["success": true])');
    // Konum izni durumu yerel SDK'dan okunur; köprünün kendi CLLocationManager uygulaması kaldırıldı.
    expect(swift).toContain('ok(["permission": Pushizo.Location.permissionGranted, "background": Pushizo.Location.backgroundPermissionGranted])');
    expect(swift).not.toContain('CLLocationManager');
    expect(swift).not.toContain('import CoreLocation');
    expect(swift).toContain('Pushizo.Location.requestAlwaysPermission { granted in ok(["permission": granted]) }');
    expect(swift).toContain('case "chatIsListening": ok(["listening": Pushizo.Chat.isListening])');
  });

  it('köprü turu 3: kullanıcı özelliği, gözlemciler, rozet, eventId ve hazır sohbet ekranı yerel SDK çağrılarına bağlı', () => {
    expect(methods).toEqual(expect.arrayContaining(['setUserProperty', 'getBadgeCount', 'chatShow', 'chatHide', 'chatIsPresented']));
    const core = read('src/core.ts');
    for (const event of ['featureFlagsChange', 'inboxChange']) expect(core).toContain(`case '${event}':`);

    const kt = read('android/src/main/java/com/pushizo/capacitor/PushizoBridgeCore.kt');
    // Kullanıcı özelliği: JSON null → null (siler); boş anahtar yerel SDK'da IllegalArgumentException → INVALID_ARGUMENT.
    expect(kt).toContain('Pushizo.User.setProperty(args.requireString("key"), args.opt("value")?.takeUnless { it == JSONObject.NULL })');
    // Gözlemciler bir kez eklenir, `detach` ile kaldırılır.
    expect(kt).toContain('private val featureFlagObserver = HsFeatureFlagObserver { emit("featureFlagsChange", JSONObject()) }');
    expect(kt).toContain('private val inboxObserver = HsInboxObserver { event -> emit("inboxChange", JSONObject(event.toMap())) }');
    for (const call of ['Pushizo.FeatureFlags.addObserver(featureFlagObserver)', 'Pushizo.FeatureFlags.removeObserver(featureFlagObserver)', 'Pushizo.Inbox.addObserver(inboxObserver)', 'Pushizo.Inbox.removeObserver(inboxObserver)']) {
      expect(kt).toContain(call);
    }
    expect(kt).toContain('"getBadgeCount" -> reply.success(JSONObject().put("count", Pushizo.Notifications.badgeCount))');
    // eventId verilmediyse eski aşırı yükleme, verildiyse `sendEvent(name, properties, value, eventId)`.
    expect(kt).toContain('if (eventId == null) Pushizo.Session.sendEvent(name, properties, value) else Pushizo.Session.sendEvent(name, properties, value, eventId)');
    // Hazır sohbet ekranı: etkin Activity tercih edilir; başlatılmamış SDK NOT_READY.
    const show = kt.slice(kt.indexOf('"chatShow" ->'), kt.indexOf('"chatHide" ->'));
    expect(show).toContain('check(Pushizo.isInitialized) { NOT_INITIALIZED }');
    expect(show).toContain('Pushizo.Chat.show(activityProvider?.invoke() ?: context)');
    expect(kt).toContain('"chatHide" -> { Pushizo.Chat.hide(); reply.success(null) }');
    // Yerel Android SDK `isPresented` sunmaz: köprü `HsChatActivity` yaşam döngüsünü izler.
    expect(kt).toContain('"chatIsPresented" -> reply.success(JSONObject().put("presented", isChatPresented()))');
    expect(kt).toContain('if (activity is HsChatActivity) synchronized(chatScreens) { chatScreens.add(activity) }');
    expect(kt).toContain('if (activity is HsChatActivity) synchronized(chatScreens) { chatScreens.remove(activity) }');
    expect(kt).toContain('registerActivityLifecycleCallbacks(chatScreenTracker)');
    expect(kt).toContain('unregisterActivityLifecycleCallbacks(chatScreenTracker)');

    const swift = read('ios/Sources/PushizoPlugin/PushizoBridgeCore.swift');
    expect(swift).toContain('Pushizo.User.setProperty(key, args["value"]); ok()');
    expect(swift).toMatch(/Pushizo\.FeatureFlags\.addObserver \{\s+Self\.active\?\.emit\("featureFlagsChange", \[:\]\)/);
    expect(swift).toMatch(/Pushizo\.Inbox\.addObserver \{ event in\s+Self\.active\?\.emit\("inboxChange", event\.dictionary\)/);
    expect(swift).toContain('DispatchQueue.main.async { ok(["count": UIApplication.shared.applicationIconBadgeNumber]) }');
    expect(swift).toContain('value: (args["value"] as? NSNumber)?.doubleValue, eventId: string("eventId"))');
    const iosShow = swift.slice(swift.indexOf('case "chatShow":'), swift.indexOf('case "chatHide":'));
    expect(iosShow).toContain('guard Pushizo.isInitialized else { reply(.failure(code: "NOT_READY", message: Self.notInitialized)); return true }');
    expect(iosShow).toContain('Pushizo.Chat.show(); ok()');
    expect(swift).toContain('case "chatHide": Pushizo.Chat.hide(); ok()');
    expect(swift).toContain('DispatchQueue.main.async { ok(["presented": Pushizo.Chat.isPresented]) }');
    // Olaylar Capacitor dinleyicisi olarak tanımlı ve taşıma katmanında abone olunuyor.
    const defs = read('src/definitions.ts');
    const index = read('src/index.ts');
    for (const event of ['featureFlagsChange', 'inboxChange']) {
      expect(defs).toContain(`addListener(eventName: '${event}'`);
      expect(index).toContain(`'${event}',`);
    }
  });

  it('yerel SDK bağımlılıkları bayrak/yerleşim/bölge izleme sunan sürümlerde (Android 0.3.0, iOS 0.2)', () => {
    expect(read('android/build.gradle')).toContain("rootProject.ext.pushizoAndroidVersion : '0.3.0'");
    expect(read('PushizoCapacitor.podspec')).toContain("s.dependency 'Pushizo', '~> 0.3'");
    expect(read('Package.swift')).toContain('pushizo-ios.git", from: "0.3.0"');
    const pkg = JSON.parse(read('package.json')) as { version: string };
    expect(pkg.version).toBe('0.3.0');
  });

  it('package.json dosya listesi ve native paket tanımları tutarlı', () => {
    const pkg = JSON.parse(read('package.json')) as { files: string[] };
    for (const f of pkg.files.filter((x) => x !== 'dist/')) expect(existsSync(join(root, f)), f).toBe(true);
    expect(read('PushizoCapacitor.podspec')).toContain("s.source_files     = 'ios/Sources/**/*.{swift,h,m}'");
    expect(read('Package.swift')).toContain('path: "ios/Sources/PushizoPlugin"');
    expect(read('android/src/main/java/com/pushizo/capacitor/PushizoPlugin.kt')).toContain('name = "Pushizo"');
  });
});
