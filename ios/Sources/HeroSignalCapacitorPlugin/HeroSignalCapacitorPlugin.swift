import Capacitor
import Foundation
import HeroSignal
// SPM: ayrı modül; CocoaPods alt spec'leri tek "HeroSignal" modülünde derlenir.
#if canImport(HeroSignalCore)
import HeroSignalCore
#endif
import UIKit
import UserNotifications

/**
 Capacitor → HeroSignal iOS SDK köprüsü. JS sözleşmesi `src/definitions.ts` (`HeroSignalPlugin`) ile birebir
 aynıdır. APNs token'ı Capacitor'ın `capacitorDidRegisterForRemoteNotifications` bildiriminden alınır
 (AppDelegate'te iletilmesi gerekir, bkz. docs/sdk/capacitor.md). In-app mesajları native SDK çizer.
 */
@objc(HeroSignalCapacitorPlugin)
public class HeroSignalCapacitorPlugin: CAPPlugin, CAPBridgedPlugin, HSInAppLifecycleListener {
    public let identifier = "HeroSignalCapacitorPlugin"
    public let jsName = "HeroSignal"
    public let pluginMethods: [CAPPluginMethod] = [
        "initialize", "setConsentGiven", "login", "logout",
        "addTags", "removeTags", "getTags", "addAliases", "removeAlias", "setLanguage",
        "addEmail", "removeEmail", "addSms", "removeSms", "getUser",
        "getPushSubscription", "optIn", "optOut",
        "getPermission", "requestPermission", "setForegroundHandlerEnabled", "completeForegroundDisplay",
        "clearAll", "removeNotification", "removeGroupedNotifications",
        "sendEvent",
        "addTriggers", "removeTriggers", "clearTriggers", "getTriggers", "setScreen", "setInAppPaused", "getInAppPaused",
        "inboxList", "inboxMarkRead", "inboxMarkAllRead", "inboxDelete", "inboxUnreadCount",
        "setLogLevel",
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }

    private var listenersAttached = false
    /// JS tarafında ön plan dinleyicisi var mı (`setForegroundHandlerEnabled`).
    private var foregroundHandlerEnabled = false
    /// JS kararı bekleyen ön plan bildirimleri (SDK 25 sn sonra kendisi kapatır).
    private var pendingForeground: [String: HSForegroundEvent] = [:]
    private let lock = NSLock()

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(didRegisterForRemoteNotifications(_:)), name: .capacitorDidRegisterForRemoteNotifications, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(didFailToRegisterForRemoteNotifications(_:)), name: .capacitorDidFailToRegisterForRemoteNotifications, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func didRegisterForRemoteNotifications(_ notification: Notification) {
        guard let token = notification.object as? Data else { return }
        HeroSignal.setDeviceToken(token)
    }

    @objc private func didFailToRegisterForRemoteNotifications(_ notification: Notification) {
        guard let error = notification.object as? Error else { return }
        HeroSignal.setDeviceTokenError(error)
    }

    private func attachListeners() {
        // SDK'da dinleyici kaldırma yok; bir kez eklenir (initialize tekrar çağrılsa da olaylar çoğalmaz).
        guard !listenersAttached else { return }
        listenersAttached = true
        HeroSignal.Notifications.addClickListener { [weak self] e in
            // Soğuk açılışta tıklama JS dinleyicisi eklenmeden gelebilir; Capacitor olayı dinleyiciye kadar saklar.
            self?.notifyListeners("notificationClick", data: [
                "notification": HeroSignalBridgeMapper.notification(e.notification),
                "result": ["actionId": e.actionId ?? NSNull(), "url": e.url ?? NSNull()],
            ], retainUntilConsumed: true)
        }
        HeroSignal.Notifications.addForegroundLifecycleListener { [weak self] e in
            guard let self, self.foregroundHandlerEnabled else { return }
            e.preventDefault()
            let eventId = UUID().uuidString
            self.lock.lock()
            self.pendingForeground[eventId] = e
            self.lock.unlock()
            self.notifyListeners("notificationWillDisplay", data: ["eventId": eventId, "notification": HeroSignalBridgeMapper.notification(e.notification)])
        }
        HeroSignal.User.pushSubscription.addObserver { [weak self] s in
            self?.notifyListeners("pushSubscriptionChange", data: ["current": HeroSignalBridgeMapper.subscription(s)])
        }
        HeroSignal.InAppMessages.addClickListener { [weak self] e in
            self?.notifyListeners("inAppClick", data: ["message": ["id": e.messageId], "result": ["actionId": e.actionId, "url": e.url ?? NSNull()]])
        }
        HeroSignal.InAppMessages.addLifecycleListener(self)
    }

    public func onWillDisplay(_ message: HSInAppMessage) { notifyListeners("inAppWillDisplay", data: ["message": ["id": message.id]]) }
    public func onDidDisplay(_ message: HSInAppMessage) { notifyListeners("inAppDidDisplay", data: ["message": ["id": message.id]]) }
    public func onWillDismiss(_ message: HSInAppMessage) { notifyListeners("inAppWillDismiss", data: ["message": ["id": message.id]]) }
    public func onDidDismiss(_ message: HSInAppMessage) { notifyListeners("inAppDidDismiss", data: ["message": ["id": message.id]]) }

    private func takePending(_ eventId: String) -> HSForegroundEvent? {
        lock.lock()
        defer { lock.unlock() }
        return pendingForeground.removeValue(forKey: eventId)
    }

    private func required(_ call: CAPPluginCall, _ key: String) -> String? {
        guard let value = call.getString(key), !value.trimmingCharacters(in: .whitespaces).isEmpty else {
            call.reject("\(key) gerekli.", "INVALID_ARGUMENT")
            return nil
        }
        return value
    }

    // MARK: Yaşam döngüsü

    @objc func initialize(_ call: CAPPluginCall) {
        guard let appId = required(call, "appId") else { return }
        DispatchQueue.main.async {
            HeroSignal.initialize(appId) { options in
                if let apiUrl = call.getString("apiUrl") { options.apiUrl = apiUrl }
                options.requiresPrivacyConsent = call.getBool("requiresPrivacyConsent") ?? false
                options.logLevel = HeroSignalBridgeMapper.logLevel(call.getString("logLevel"))
            }
            self.attachListeners()
            call.resolve()
        }
    }

    @objc func setConsentGiven(_ call: CAPPluginCall) { HeroSignal.setConsentGiven(call.getBool("given") ?? false); call.resolve() }

    @objc func login(_ call: CAPPluginCall) {
        guard let externalId = required(call, "externalId") else { return }
        HeroSignal.login(externalId, identityHash: call.getString("identityHash"))
        call.resolve()
    }

    @objc func logout(_ call: CAPPluginCall) { HeroSignal.logout(); call.resolve() }

    // MARK: User

    @objc func addTags(_ call: CAPPluginCall) { HeroSignal.User.addTags(HeroSignalBridgeMapper.stringMap(call.options["tags"])); call.resolve() }
    @objc func removeTags(_ call: CAPPluginCall) { HeroSignal.User.removeTags(HeroSignalBridgeMapper.stringList(call.options["keys"])); call.resolve() }
    @objc func getTags(_ call: CAPPluginCall) { call.resolve(["tags": HeroSignal.User.getTags()]) }
    @objc func addAliases(_ call: CAPPluginCall) { HeroSignal.User.addAliases(HeroSignalBridgeMapper.stringMap(call.options["aliases"])); call.resolve() }

    @objc func removeAlias(_ call: CAPPluginCall) {
        guard let label = required(call, "label") else { return }
        HeroSignal.User.removeAlias(label)
        call.resolve()
    }

    @objc func setLanguage(_ call: CAPPluginCall) {
        guard let code = required(call, "code") else { return }
        HeroSignal.User.setLanguage(code)
        call.resolve()
    }

    @objc func addEmail(_ call: CAPPluginCall) { contact(call, key: "email", add: true) }
    @objc func removeEmail(_ call: CAPPluginCall) { contact(call, key: "email", add: false) }
    @objc func addSms(_ call: CAPPluginCall) { contact(call, key: "phoneNumber", add: true) }
    @objc func removeSms(_ call: CAPPluginCall) { contact(call, key: "phoneNumber", add: false) }

    /// E-posta/SMS: geçersiz adres JS'e `INVALID_ARGUMENT` olarak döner (SDK geçersiz adresi sessizce atlar).
    private func contact(_ call: CAPPluginCall, key: String, add: Bool) {
        let value = call.getString(key) ?? ""
        if key == "email" {
            guard HSContacts.normalizeEmail(value) != nil else { call.reject("Geçersiz e-posta adresi.", "INVALID_ARGUMENT"); return }
            if add { HeroSignal.User.addEmail(value) } else { HeroSignal.User.removeEmail(value) }
        } else {
            guard HSContacts.normalizePhone(value) != nil else { call.reject("Geçersiz telefon numarası (E.164 bekleniyor).", "INVALID_ARGUMENT"); return }
            if add { HeroSignal.User.addSms(value) } else { HeroSignal.User.removeSms(value) }
        }
        call.resolve()
    }

    @objc func getUser(_ call: CAPPluginCall) {
        call.resolve(["id": HeroSignal.User.id ?? NSNull(), "externalId": HeroSignal.User.externalId ?? NSNull()])
    }

    @objc func getPushSubscription(_ call: CAPPluginCall) {
        Task {
            let state = await HeroSignal.User.pushSubscription.state()
            call.resolve(HeroSignalBridgeMapper.subscription(state))
        }
    }

    @objc func optIn(_ call: CAPPluginCall) { HeroSignal.User.pushSubscription.optIn(); call.resolve() }
    @objc func optOut(_ call: CAPPluginCall) { HeroSignal.User.pushSubscription.optOut(); call.resolve() }

    // MARK: Notifications

    @objc func getPermission(_ call: CAPPluginCall) {
        Task { call.resolve(HeroSignalBridgeMapper.permission(await HeroSignal.Notifications.permission())) }
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        HeroSignal.Notifications.requestPermission { _ in
            Task { call.resolve(HeroSignalBridgeMapper.permission(await HeroSignal.Notifications.permission())) }
        }
    }

    @objc func setForegroundHandlerEnabled(_ call: CAPPluginCall) {
        foregroundHandlerEnabled = call.getBool("enabled") ?? false
        if !foregroundHandlerEnabled {
            // Bekleyen kararlar varsayılan davranışa (göster) döner.
            lock.lock()
            let pending = Array(pendingForeground.values)
            pendingForeground.removeAll()
            lock.unlock()
            pending.forEach { $0.display() }
        }
        call.resolve()
    }

    @objc func completeForegroundDisplay(_ call: CAPPluginCall) {
        guard let eventId = required(call, "eventId") else { return }
        // Gösterilmeyecekse olay bırakılır; SDK `displayTimeout` sonunda bildirimi göstermeden kapatır.
        if let event = takePending(eventId), call.getBool("display") ?? true { event.display() }
        call.resolve()
    }

    @objc func clearAll(_ call: CAPPluginCall) { HeroSignal.Notifications.clearAll(); call.resolve() }

    @objc func removeNotification(_ call: CAPPluginCall) {
        guard let id = required(call, "id") else { return }
        HeroSignal.Notifications.removeNotification(id: id)
        call.resolve()
    }

    @objc func removeGroupedNotifications(_ call: CAPPluginCall) {
        guard let group = required(call, "group") else { return }
        HeroSignal.Notifications.removeGroupedNotifications(group: group)
        call.resolve()
    }

    // MARK: Session

    @objc func sendEvent(_ call: CAPPluginCall) {
        guard let name = required(call, "name") else { return }
        HeroSignal.Session.sendEvent(name, properties: call.options["properties"] as? [String: Any] ?? [:], value: (call.options["value"] as? NSNumber)?.doubleValue)
        call.resolve()
    }

    // MARK: In-app

    @objc func addTriggers(_ call: CAPPluginCall) { HeroSignal.InAppMessages.addTriggers(HeroSignalBridgeMapper.stringMap(call.options["triggers"])); call.resolve() }
    @objc func removeTriggers(_ call: CAPPluginCall) { HeroSignal.InAppMessages.removeTriggers(HeroSignalBridgeMapper.stringList(call.options["keys"])); call.resolve() }
    @objc func clearTriggers(_ call: CAPPluginCall) { HeroSignal.InAppMessages.clearTriggers(); call.resolve() }
    @objc func getTriggers(_ call: CAPPluginCall) { call.resolve(["triggers": HeroSignal.InAppMessages.getTriggers()]) }
    @objc func setScreen(_ call: CAPPluginCall) { HeroSignal.InAppMessages.setScreen(call.getString("name")); call.resolve() }
    @objc func setInAppPaused(_ call: CAPPluginCall) { HeroSignal.InAppMessages.paused = call.getBool("paused") ?? false; call.resolve() }
    @objc func getInAppPaused(_ call: CAPPluginCall) { call.resolve(["paused": HeroSignal.InAppMessages.paused]) }

    // MARK: Inbox

    /// Bildirim kutusu çağrısı: hata kodu `HSApiError.code`, geçersiz argüman `INVALID_ARGUMENT`, diğerleri `NOT_READY`.
    private func inbox(_ call: CAPPluginCall, _ body: @escaping () async throws -> [String: Any]) {
        Task {
            do {
                call.resolve(try await body())
            } catch let error as HSApiError {
                call.reject(error.message, error.code, error)
            } catch HSError.invalidArgument(let message) {
                call.reject(message, "INVALID_ARGUMENT")
            } catch {
                call.reject("\(error)", "NOT_READY", error)
            }
        }
    }

    @objc func inboxList(_ call: CAPPluginCall) {
        let limit = call.getInt("limit") ?? 50
        let cursor = call.getString("cursor")
        inbox(call) { HeroSignalBridgeMapper.inboxPage(try await HeroSignal.Inbox.list(limit: limit, cursor: cursor)) }
    }

    @objc func inboxMarkRead(_ call: CAPPluginCall) {
        guard let id = required(call, "id") else { return }
        inbox(call) { ["item": HeroSignalBridgeMapper.inboxItem(try await HeroSignal.Inbox.markRead(id))] }
    }

    @objc func inboxMarkAllRead(_ call: CAPPluginCall) {
        inbox(call) { ["unreadCount": try await HeroSignal.Inbox.markAllRead()] }
    }

    @objc func inboxDelete(_ call: CAPPluginCall) {
        guard let id = required(call, "id") else { return }
        inbox(call) {
            try await HeroSignal.Inbox.archive(id)
            return [:]
        }
    }

    @objc func inboxUnreadCount(_ call: CAPPluginCall) {
        inbox(call) { ["unreadCount": try await HeroSignal.Inbox.unreadCount()] }
    }

    // MARK: Debug

    @objc func setLogLevel(_ call: CAPPluginCall) { HeroSignal.Debug.setLogLevel(HeroSignalBridgeMapper.logLevel(call.getString("level"))); call.resolve() }
}

/// JS ↔ SDK model ve argüman dönüşümleri (`src/definitions.ts` ile aynı alan adları).
enum HeroSignalBridgeMapper {
    static func logLevel(_ name: String?) -> HSLog.Level {
        switch name {
        case "none": return HSLog.Level.none
        case "error": return .error
        case "info": return .info
        case "debug": return .debug
        default: return .warn
        }
    }

    static func stringMap(_ raw: Any?) -> [String: String] {
        guard let dict = raw as? [String: Any] else { return [:] }
        var out: [String: String] = [:]
        for (key, value) in dict {
            switch value {
            case let s as String: out[key] = s
            case is NSNull: continue
            default: out[key] = "\(value)"
            }
        }
        return out
    }

    static func stringList(_ raw: Any?) -> [String] {
        (raw as? [Any] ?? []).compactMap { $0 as? String }
    }

    static func permission(_ status: UNAuthorizationStatus) -> [String: Any] {
        let name: String
        switch status {
        case .authorized, .ephemeral: name = "granted"
        case .provisional: name = "provisional"
        case .denied: name = "denied"
        case .notDetermined: name = "default"
        @unknown default: name = "default"
        }
        return ["granted": name == "granted" || name == "provisional", "status": name]
    }

    /// iOS'ta kaldırma kimliği teslimat kimliğidir (`removeNotification(id:)` `hs.dlv` ile de eşleşir).
    static func notification(_ n: HSNotification) -> [String: Any] {
        [
            "notificationId": n.deliveryId ?? NSNull(),
            "title": n.title ?? NSNull(),
            "body": n.body ?? NSNull(),
            "url": n.url ?? NSNull(),
            "imageUrl": n.imageUrl ?? NSNull(),
            "deliveryId": n.deliveryId ?? NSNull(),
            "messageId": n.messageId ?? NSNull(),
            "groupKey": NSNull(),
            "actions": n.actions.map { ["id": $0.id, "title": $0.title, "url": $0.url ?? NSNull()] as [String: Any] },
            "data": n.data,
        ]
    }

    static func subscription(_ s: HSPushSubscriptionState) -> [String: Any] {
        ["id": s.id ?? NSNull(), "token": s.token ?? NSNull(), "optedIn": s.optedIn]
    }

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static func iso(_ date: Date?) -> Any { date.map { isoFormatter.string(from: $0) } ?? NSNull() }

    static func inboxItem(_ item: HSInboxItem) -> [String: Any] {
        [
            "id": item.id, "messageId": item.messageId ?? NSNull(), "title": item.title ?? NSNull(), "body": item.body ?? NSNull(),
            "url": item.url ?? NSNull(), "imageUrl": item.imageUrl ?? NSNull(), "data": item.data, "read": item.read,
            "readAt": iso(item.readAt), "archivedAt": iso(item.archivedAt), "expiresAt": iso(item.expiresAt), "createdAt": iso(item.createdAt),
        ]
    }

    static func inboxPage(_ page: HSInboxPage) -> [String: Any] {
        ["items": page.items.map { inboxItem($0) }, "unreadCount": page.unreadCount, "nextCursor": page.nextCursor ?? NSNull(), "hasMore": page.hasMore]
    }
}
