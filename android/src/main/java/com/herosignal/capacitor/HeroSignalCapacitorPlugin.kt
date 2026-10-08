package com.herosignal.capacitor

import android.Manifest
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.herosignal.sdk.HeroSignal
import com.herosignal.sdk.HsApiException
import com.herosignal.sdk.HsCallback
import com.herosignal.sdk.HsClickEvent
import com.herosignal.sdk.HsForegroundEvent
import com.herosignal.sdk.HsInAppClickEvent
import com.herosignal.sdk.HsInAppLifecycleEvent
import com.herosignal.sdk.HsInAppLifecycleListener
import com.herosignal.sdk.HsPushSubscriptionState
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Capacitor → HeroSignal Android SDK köprüsü. JS sözleşmesi `src/definitions.ts` (`HeroSignalPlugin`) ile
 * birebir aynıdır; argüman dönüşümleri [HeroSignalBridgeMapper] içindedir. In-app mesajları native SDK'nın
 * varsayılan Dialog çizimiyle gösterilir.
 */
@CapacitorPlugin(
    name = "HeroSignal",
    permissions = [Permission(alias = HeroSignalCapacitorPlugin.NOTIFICATIONS, strings = [Manifest.permission.POST_NOTIFICATIONS])],
)
class HeroSignalCapacitorPlugin : Plugin() {
    private val main = Handler(Looper.getMainLooper())
    private var listenersAttached = false

    /** JS tarafında ön plan dinleyicisi var mı (`setForegroundHandlerEnabled`). */
    @Volatile private var foregroundHandlerEnabled = false

    /** JS kararı bekleyen ön plan bildirimleri (eventId → olay). */
    private val pendingForeground = ConcurrentHashMap<String, HsForegroundEvent>()

    private val clickListener: (HsClickEvent) -> Unit = { e ->
        // Soğuk açılışta tıklama JS dinleyicisi eklenmeden gelebilir; Capacitor olayı dinleyiciye kadar saklar.
        notifyListeners("notificationClick", HeroSignalBridgeMapper.click(e), true)
    }

    private val foregroundListener: (HsForegroundEvent) -> Unit = { e ->
        if (foregroundHandlerEnabled) {
            // Gösterim JS kararına ertelenir; yanıt gelmezse zaman aşımında gösterilir.
            e.preventDefault()
            val eventId = UUID.randomUUID().toString()
            pendingForeground[eventId] = e
            main.postDelayed({ pendingForeground.remove(eventId)?.display() }, FOREGROUND_TIMEOUT_MS)
            notifyListeners(
                "notificationWillDisplay",
                JSObject().put("eventId", eventId).put("notification", HeroSignalBridgeMapper.notification(e.notification)),
            )
        }
    }

    private val subscriptionObserver: (HsPushSubscriptionState) -> Unit = { s ->
        notifyListeners("pushSubscriptionChange", JSObject().put("current", HeroSignalBridgeMapper.subscription(s)))
    }

    private val inAppClickListener: (HsInAppClickEvent) -> Unit = { e -> notifyListeners("inAppClick", HeroSignalBridgeMapper.inAppClick(e)) }

    private val inAppLifecycleListener = object : HsInAppLifecycleListener {
        private fun send(name: String, e: HsInAppLifecycleEvent) = notifyListeners(name, HeroSignalBridgeMapper.inAppMessage(e.message.id))
        override fun onWillDisplay(event: HsInAppLifecycleEvent) = send("inAppWillDisplay", event)
        override fun onDidDisplay(event: HsInAppLifecycleEvent) = send("inAppDidDisplay", event)
        override fun onWillDismiss(event: HsInAppLifecycleEvent) = send("inAppWillDismiss", event)
        override fun onDidDismiss(event: HsInAppLifecycleEvent) = send("inAppDidDismiss", event)
    }

    override fun handleOnDestroy() {
        detachListeners()
        pendingForeground.values.forEach { it.display() }
        pendingForeground.clear()
        main.removeCallbacksAndMessages(null)
    }

    private fun attachListeners() {
        if (listenersAttached) return
        listenersAttached = true
        HeroSignal.Notifications.addClickListener(clickListener)
        HeroSignal.Notifications.addForegroundLifecycleListener(foregroundListener)
        HeroSignal.User.pushSubscription.addObserver(subscriptionObserver)
        HeroSignal.InAppMessages.addClickListener(inAppClickListener)
        HeroSignal.InAppMessages.addLifecycleListener(inAppLifecycleListener)
    }

    private fun detachListeners() {
        if (!listenersAttached) return
        listenersAttached = false
        HeroSignal.Notifications.removeClickListener(clickListener)
        HeroSignal.Notifications.removeForegroundLifecycleListener(foregroundListener)
        HeroSignal.User.pushSubscription.removeObserver(subscriptionObserver)
        HeroSignal.InAppMessages.removeClickListener(inAppClickListener)
        HeroSignal.InAppMessages.removeLifecycleListener(inAppLifecycleListener)
    }

    /** Senkron çağrıları ortak hata eşlemesiyle çalıştırır (geçersiz argüman → `INVALID_ARGUMENT`). */
    private inline fun run(call: PluginCall, block: () -> JSObject?) {
        try {
            val result = block()
            if (result == null) call.resolve() else call.resolve(result)
        } catch (e: Exception) {
            call.reject(e.message ?: e.javaClass.simpleName, HeroSignalBridgeMapper.errorCode(e), e)
        }
    }

    /** SDK'nın arka plan geri çağrısını Capacitor sonucuna çevirir. */
    private fun <T> reply(call: PluginCall, map: (T) -> JSObject?) = HsCallback<T> { r ->
        r.fold(
            onSuccess = { value -> map(value)?.let(call::resolve) ?: call.resolve() },
            onFailure = { e ->
                val code = if (e is HsApiException) e.code else HeroSignalBridgeMapper.errorCode(e)
                call.reject(e.message ?: code, code, e as? Exception)
            },
        )
    }

    private fun PluginCall.requireString(name: String): String =
        getString(name)?.takeIf { it.isNotBlank() } ?: throw IllegalArgumentException("$name gerekli.")

    // --- Yaşam döngüsü ---

    @PluginMethod
    fun initialize(call: PluginCall) = run(call) {
        HeroSignal.initialize(
            context.applicationContext,
            call.requireString("appId"),
            HeroSignal.Options(
                apiUrl = call.getString("apiUrl") ?: HeroSignal.Options().apiUrl,
                requiresPrivacyConsent = call.getBoolean("requiresPrivacyConsent", false) ?: false,
                logLevel = HeroSignalBridgeMapper.logLevel(call.getString("logLevel")),
            ),
        )
        attachListeners()
        null
    }

    @PluginMethod
    fun setConsentGiven(call: PluginCall) = run(call) { HeroSignal.setConsentGiven(call.getBoolean("given", false) ?: false); null }

    @PluginMethod
    fun login(call: PluginCall) = run(call) { HeroSignal.login(call.requireString("externalId"), call.getString("identityHash")); null }

    @PluginMethod
    fun logout(call: PluginCall) = run(call) { HeroSignal.logout(); null }

    // --- User ---

    @PluginMethod
    fun addTags(call: PluginCall) = run(call) { HeroSignal.User.addTags(HeroSignalBridgeMapper.stringMap(call.getObject("tags"))); null }

    @PluginMethod
    fun removeTags(call: PluginCall) = run(call) { HeroSignal.User.removeTags(HeroSignalBridgeMapper.stringList(call.getArray("keys"))); null }

    @PluginMethod
    fun getTags(call: PluginCall) = run(call) { JSObject().put("tags", HeroSignalBridgeMapper.toJs(HeroSignal.User.getTags())) }

    @PluginMethod
    fun addAliases(call: PluginCall) = run(call) { HeroSignal.User.addAliases(HeroSignalBridgeMapper.stringMap(call.getObject("aliases"))); null }

    @PluginMethod
    fun removeAlias(call: PluginCall) = run(call) { HeroSignal.User.removeAlias(call.requireString("label")); null }

    @PluginMethod
    fun setLanguage(call: PluginCall) = run(call) { HeroSignal.User.setLanguage(call.requireString("code")); null }

    @PluginMethod
    fun addEmail(call: PluginCall) = run(call) { HeroSignal.User.addEmail(call.getString("email") ?: ""); null }

    @PluginMethod
    fun removeEmail(call: PluginCall) = run(call) { HeroSignal.User.removeEmail(call.getString("email") ?: ""); null }

    @PluginMethod
    fun addSms(call: PluginCall) = run(call) { HeroSignal.User.addSms(call.getString("phoneNumber") ?: ""); null }

    @PluginMethod
    fun removeSms(call: PluginCall) = run(call) { HeroSignal.User.removeSms(call.getString("phoneNumber") ?: ""); null }

    @PluginMethod
    fun getUser(call: PluginCall) = run(call) {
        JSObject().putNullable("id", HeroSignal.User.id).putNullable("externalId", HeroSignal.User.externalId)
    }

    @PluginMethod
    fun getPushSubscription(call: PluginCall) = run(call) { HeroSignalBridgeMapper.subscription(HeroSignal.User.pushSubscription.state) }

    @PluginMethod
    fun optIn(call: PluginCall) = run(call) { HeroSignal.User.pushSubscription.optIn(); null }

    @PluginMethod
    fun optOut(call: PluginCall) = run(call) { HeroSignal.User.pushSubscription.optOut(); null }

    // --- Notifications ---

    private fun permissionResult(): JSObject {
        val granted = HeroSignal.Notifications.permission
        val status = when {
            granted -> "granted"
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ->
                if (getPermissionState(NOTIFICATIONS) == PermissionState.DENIED) "denied" else "default"
            // Android 12 ve öncesi: çalışma zamanı izni yok; bildirimler sistem ayarından kapatılmış.
            else -> "denied"
        }
        return JSObject().put("granted", granted).put("status", status)
    }

    @PluginMethod
    fun getPermission(call: PluginCall) = run(call) { permissionResult() }

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        if (HeroSignal.Notifications.permission || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            HeroSignal.Notifications.onPermissionResult()
            call.resolve(permissionResult())
            return
        }
        requestPermissionForAlias(NOTIFICATIONS, call, "notificationPermissionCallback")
    }

    @PermissionCallback
    private fun notificationPermissionCallback(call: PluginCall) {
        HeroSignal.Notifications.onPermissionResult()
        call.resolve(permissionResult())
    }

    @PluginMethod
    fun setForegroundHandlerEnabled(call: PluginCall) = run(call) {
        foregroundHandlerEnabled = call.getBoolean("enabled", false) ?: false
        if (!foregroundHandlerEnabled) {
            // Bekleyen kararlar varsayılan davranışa (göster) döner.
            pendingForeground.keys.toList().forEach { id -> pendingForeground.remove(id)?.display() }
        }
        null
    }

    @PluginMethod
    fun completeForegroundDisplay(call: PluginCall) = run(call) {
        val event = pendingForeground.remove(call.requireString("eventId"))
        if (event != null && call.getBoolean("display", true) == true) event.display()
        null
    }

    @PluginMethod
    fun clearAll(call: PluginCall) = run(call) { HeroSignal.Notifications.clearAll(); null }

    @PluginMethod
    fun removeNotification(call: PluginCall) = run(call) {
        HeroSignal.Notifications.removeNotification(HeroSignalBridgeMapper.androidNotificationId(call.getString("id")))
        null
    }

    @PluginMethod
    fun removeGroupedNotifications(call: PluginCall) = run(call) {
        HeroSignal.Notifications.removeGroupedNotifications(call.requireString("group"))
        null
    }

    // --- Session ---

    @PluginMethod
    fun sendEvent(call: PluginCall) = run(call) {
        HeroSignal.Session.sendEvent(
            call.requireString("name"),
            HeroSignalBridgeMapper.anyMap(call.getObject("properties")),
            (call.data.opt("value") as? Number)?.toDouble(),
        )
        null
    }

    // --- In-app ---

    @PluginMethod
    fun addTriggers(call: PluginCall) = run(call) { HeroSignal.InAppMessages.addTriggers(HeroSignalBridgeMapper.stringMap(call.getObject("triggers"))); null }

    @PluginMethod
    fun removeTriggers(call: PluginCall) = run(call) { HeroSignal.InAppMessages.removeTriggers(HeroSignalBridgeMapper.stringList(call.getArray("keys"))); null }

    @PluginMethod
    fun clearTriggers(call: PluginCall) = run(call) { HeroSignal.InAppMessages.clearTriggers(); null }

    @PluginMethod
    fun getTriggers(call: PluginCall) = run(call) { JSObject().put("triggers", HeroSignalBridgeMapper.toJs(HeroSignal.InAppMessages.getTriggers())) }

    @PluginMethod
    fun setScreen(call: PluginCall) = run(call) { HeroSignal.InAppMessages.setScreen(call.getString("name")); null }

    @PluginMethod
    fun setInAppPaused(call: PluginCall) = run(call) { HeroSignal.InAppMessages.paused = call.getBoolean("paused", false) ?: false; null }

    @PluginMethod
    fun getInAppPaused(call: PluginCall) = run(call) { JSObject().put("paused", HeroSignal.InAppMessages.paused) }

    // --- Inbox (sonuç SDK'nın arka plan iş parçacığından döner) ---

    /** Asenkron SDK çağrısını başlatır; yalnızca başlatma sırasındaki (argüman) hataları burada reddedilir. */
    private inline fun launch(call: PluginCall, block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            call.reject(e.message ?: e.javaClass.simpleName, HeroSignalBridgeMapper.errorCode(e), e)
        }
    }

    @PluginMethod
    fun inboxList(call: PluginCall) = launch(call) {
        HeroSignal.Inbox.list(call.getInt("limit", 50) ?: 50, call.getString("cursor"), reply(call) { HeroSignalBridgeMapper.inboxPage(it) })
    }

    @PluginMethod
    fun inboxMarkRead(call: PluginCall) = launch(call) {
        HeroSignal.Inbox.markRead(call.requireString("id"), reply(call) { JSObject().put("item", HeroSignalBridgeMapper.inboxItem(it)) })
    }

    @PluginMethod
    fun inboxMarkAllRead(call: PluginCall) = launch(call) {
        HeroSignal.Inbox.markAllRead(reply(call) { JSObject().put("unreadCount", it) })
    }

    @PluginMethod
    fun inboxDelete(call: PluginCall) = launch(call) {
        HeroSignal.Inbox.archive(call.requireString("id"), reply<Unit>(call) { null })
    }

    @PluginMethod
    fun inboxUnreadCount(call: PluginCall) = launch(call) {
        HeroSignal.Inbox.unreadCount(reply(call) { JSObject().put("unreadCount", it) })
    }

    // --- Debug ---

    @PluginMethod
    fun setLogLevel(call: PluginCall) = run(call) { HeroSignal.Debug.setLogLevel(HeroSignalBridgeMapper.logLevel(call.getString("level"))); null }

    companion object {
        const val NOTIFICATIONS = "notifications"
        private const val FOREGROUND_TIMEOUT_MS = 25_000L
    }
}
