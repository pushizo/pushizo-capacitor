import Capacitor
import Foundation
import HeroSignal
#if canImport(HeroSignalCore)
import HeroSignalCore
#endif
import UIKit

/**
 Capacitor → HeroSignal iOS SDK köprüsü. Metotlar `HeroSignalBridgeCore` üzerinden SDK'ya iletilir, SDK olayları
 `notifyListeners` ile JS'e gönderilir. APNs token'ı uygulamanın AppDelegate'inin Capacitor'a ilettiği
 `capacitorDidRegisterForRemoteNotifications` bildiriminden alınır (README: iOS kurulumu).
 */
@objc(HeroSignalPlugin)
public class HeroSignalPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HeroSignalPlugin"
    public let jsName = "HeroSignal"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setConsentGiven", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "login", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateUserJwt", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addTags", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeTags", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTags", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addAliases", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeAlias", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLanguage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addEmail", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeEmail", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addSms", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeSms", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getUser", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getContacts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPreferences", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPreferences", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPushSubscription", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "optIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "optOut", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeNotification", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeGroupedNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setForegroundHandlerEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "displayNotification", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLogLevel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addTriggers", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeTriggers", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearTriggers", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTriggers", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setScreen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setInAppPaused", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getInAppPaused", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "inboxList", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "inboxMarkRead", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "inboxMarkAllRead", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "inboxArchive", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "inboxUnreadCount", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setupDefaultLiveActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startDefaultLiveActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLocationShared", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isLocationShared", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestLocationPermission", returnType: CAPPluginReturnPromise),
    ]

    private var core: HeroSignalBridgeCore!
    private var observers: [NSObjectProtocol] = []

    override public func load() {
        core = HeroSignalBridgeCore { [weak self] type, payload in
            // Tıklama JS dinleyicisi bağlanana kadar saklanır (soğuk başlatma).
            self?.notifyListeners(type, data: payload, retainUntilConsumed: type == "click")
        }
        // Daha önce JS ile başlatıldıysa SDK hemen kayıtlı ayarlarla başlatılır; bildirimden açılış tıklaması kaybolmaz.
        if !HeroSignal.isInitialized, let config = HeroSignalBridgeConfig.load() {
            config.initializeSdk()
        }
        core.attachIfInitialized()

        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: .capacitorDidRegisterForRemoteNotifications, object: nil, queue: .main) { notification in
            if let token = notification.object as? Data { HeroSignal.setDeviceToken(token) }
        })
        observers.append(center.addObserver(forName: .capacitorDidFailToRegisterForRemoteNotifications, object: nil, queue: .main) { notification in
            if let error = notification.object as? Error { HeroSignal.setDeviceTokenError(error) }
        })
    }

    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
    }

    private func dispatch(_ call: CAPPluginCall) {
        var args: [String: Any] = [:]
        for (key, value) in call.options ?? [:] {
            if let key = key as? String { args[key] = value }
        }
        let handled = core.handle(call.methodName, args) { result in
            switch result {
            case .success(let data):
                if let data { call.resolve(data) } else { call.resolve() }
            case .failure(let code, let message):
                call.reject(message, code)
            }
        }
        if !handled { call.unimplemented("HeroSignal: \(call.methodName) desteklenmiyor") }
    }

    @objc(initialize:) func initializeSdk(_ call: CAPPluginCall) { dispatch(call) }
    @objc func setConsentGiven(_ call: CAPPluginCall) { dispatch(call) }
    @objc func login(_ call: CAPPluginCall) { dispatch(call) }
    @objc func updateUserJwt(_ call: CAPPluginCall) { dispatch(call) }
    @objc func logout(_ call: CAPPluginCall) { dispatch(call) }
    @objc func addTags(_ call: CAPPluginCall) { dispatch(call) }
    @objc func removeTags(_ call: CAPPluginCall) { dispatch(call) }
    @objc func getTags(_ call: CAPPluginCall) { dispatch(call) }
    @objc func addAliases(_ call: CAPPluginCall) { dispatch(call) }
    @objc func removeAlias(_ call: CAPPluginCall) { dispatch(call) }
    @objc func setLanguage(_ call: CAPPluginCall) { dispatch(call) }
    @objc func addEmail(_ call: CAPPluginCall) { dispatch(call) }
    @objc func removeEmail(_ call: CAPPluginCall) { dispatch(call) }
    @objc func addSms(_ call: CAPPluginCall) { dispatch(call) }
    @objc func removeSms(_ call: CAPPluginCall) { dispatch(call) }
    @objc func getUser(_ call: CAPPluginCall) { dispatch(call) }
    @objc func getContacts(_ call: CAPPluginCall) { dispatch(call) }
    @objc func getPreferences(_ call: CAPPluginCall) { dispatch(call) }
    @objc func setPreferences(_ call: CAPPluginCall) { dispatch(call) }
    @objc func getPushSubscription(_ call: CAPPluginCall) { dispatch(call) }
    @objc func optIn(_ call: CAPPluginCall) { dispatch(call) }
    @objc func optOut(_ call: CAPPluginCall) { dispatch(call) }
    @objc func getPermission(_ call: CAPPluginCall) { dispatch(call) }
    @objc func requestPermission(_ call: CAPPluginCall) { dispatch(call) }
    @objc func clearAll(_ call: CAPPluginCall) { dispatch(call) }
    @objc func removeNotification(_ call: CAPPluginCall) { dispatch(call) }
    @objc func removeGroupedNotifications(_ call: CAPPluginCall) { dispatch(call) }
    @objc func setForegroundHandlerEnabled(_ call: CAPPluginCall) { dispatch(call) }
    @objc func displayNotification(_ call: CAPPluginCall) { dispatch(call) }
    @objc func sendEvent(_ call: CAPPluginCall) { dispatch(call) }
    @objc func setLogLevel(_ call: CAPPluginCall) { dispatch(call) }
    @objc func addTriggers(_ call: CAPPluginCall) { dispatch(call) }
    @objc func removeTriggers(_ call: CAPPluginCall) { dispatch(call) }
    @objc func clearTriggers(_ call: CAPPluginCall) { dispatch(call) }
    @objc func getTriggers(_ call: CAPPluginCall) { dispatch(call) }
    @objc func setScreen(_ call: CAPPluginCall) { dispatch(call) }
    @objc func setInAppPaused(_ call: CAPPluginCall) { dispatch(call) }
    @objc func getInAppPaused(_ call: CAPPluginCall) { dispatch(call) }
    @objc func inboxList(_ call: CAPPluginCall) { dispatch(call) }
    @objc func inboxMarkRead(_ call: CAPPluginCall) { dispatch(call) }
    @objc func inboxMarkAllRead(_ call: CAPPluginCall) { dispatch(call) }
    @objc func inboxArchive(_ call: CAPPluginCall) { dispatch(call) }
    @objc func inboxUnreadCount(_ call: CAPPluginCall) { dispatch(call) }
    @objc func setupDefaultLiveActivity(_ call: CAPPluginCall) { dispatch(call) }
    @objc func startDefaultLiveActivity(_ call: CAPPluginCall) { dispatch(call) }
    @objc func setLocationShared(_ call: CAPPluginCall) { dispatch(call) }
    @objc func isLocationShared(_ call: CAPPluginCall) { dispatch(call) }
    @objc func requestLocationPermission(_ call: CAPPluginCall) { dispatch(call) }
}
