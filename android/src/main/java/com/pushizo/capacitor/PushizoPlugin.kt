package com.pushizo.capacitor

import android.Manifest
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject

/**
 * Capacitor → Pushizo Android SDK köprüsü. Metotlar [PushizoBridgeCore] üzerinden SDK'ya iletilir;
 * SDK olayları `notifyListeners` ile JS'e gönderilir. Bildirim tıklaması JS dinleyicisi bağlanana kadar
 * saklanır (`retainUntilConsumed`), böylece soğuk başlatma tıklaması kaybolmaz.
 */
@CapacitorPlugin(
    name = "Pushizo",
    permissions = [
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = PushizoPlugin.PERMISSION_ALIAS),
        // Konum izinleri ayrı takma adlarla tanımlanır; yalnızca uygulama manifest'inde bulunanlar istenir.
        Permission(strings = [Manifest.permission.ACCESS_COARSE_LOCATION], alias = PushizoPlugin.LOCATION_COARSE_ALIAS),
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION], alias = PushizoPlugin.LOCATION_FINE_ALIAS),
    ],
)
class PushizoPlugin : Plugin() {
    private lateinit var core: PushizoBridgeCore

    override fun load() {
        core = PushizoBridgeCore(context.applicationContext) { type, payload ->
            notifyListeners(type, JSObject.fromJSONObject(payload), type == "click" || type == "chatOpen")
        }
        core.attachIfInitialized()
    }

    override fun handleOnDestroy() {
        core.detach()
        super.handleOnDestroy()
    }

    private fun reply(call: PluginCall) = object : PushizoBridgeCore.Reply {
        override fun success(data: JSONObject?) {
            if (data == null) call.resolve() else call.resolve(JSObject.fromJSONObject(data))
        }

        override fun error(code: String, message: String?) {
            call.reject(message ?: code, code)
        }
    }

    private fun dispatch(call: PluginCall) {
        val handled = core.handle(call.methodName, call.data, reply(call))
        if (!handled) call.unimplemented("Pushizo: ${call.methodName} desteklenmiyor")
    }

    @PluginMethod fun initialize(call: PluginCall) = dispatch(call)
    @PluginMethod fun setConsentGiven(call: PluginCall) = dispatch(call)
    @PluginMethod fun login(call: PluginCall) = dispatch(call)
    @PluginMethod fun updateUserJwt(call: PluginCall) = dispatch(call)
    @PluginMethod fun logout(call: PluginCall) = dispatch(call)
    @PluginMethod fun addTags(call: PluginCall) = dispatch(call)
    @PluginMethod fun removeTags(call: PluginCall) = dispatch(call)
    @PluginMethod fun getTags(call: PluginCall) = dispatch(call)
    @PluginMethod fun addAliases(call: PluginCall) = dispatch(call)
    @PluginMethod fun removeAlias(call: PluginCall) = dispatch(call)
    @PluginMethod fun setLanguage(call: PluginCall) = dispatch(call)
    @PluginMethod fun addEmail(call: PluginCall) = dispatch(call)
    @PluginMethod fun removeEmail(call: PluginCall) = dispatch(call)
    @PluginMethod fun addSms(call: PluginCall) = dispatch(call)
    @PluginMethod fun removeSms(call: PluginCall) = dispatch(call)
    @PluginMethod fun getUser(call: PluginCall) = dispatch(call)
    @PluginMethod fun getContacts(call: PluginCall) = dispatch(call)
    @PluginMethod fun getPreferences(call: PluginCall) = dispatch(call)
    @PluginMethod fun setPreferences(call: PluginCall) = dispatch(call)
    @PluginMethod fun getPushSubscription(call: PluginCall) = dispatch(call)
    @PluginMethod fun optIn(call: PluginCall) = dispatch(call)
    @PluginMethod fun optOut(call: PluginCall) = dispatch(call)
    @PluginMethod fun getPermission(call: PluginCall) = dispatch(call)
    @PluginMethod fun clearAll(call: PluginCall) = dispatch(call)
    @PluginMethod fun removeNotification(call: PluginCall) = dispatch(call)
    @PluginMethod fun removeGroupedNotifications(call: PluginCall) = dispatch(call)
    @PluginMethod fun setForegroundHandlerEnabled(call: PluginCall) = dispatch(call)
    @PluginMethod fun displayNotification(call: PluginCall) = dispatch(call)
    @PluginMethod fun sendEvent(call: PluginCall) = dispatch(call)
    @PluginMethod fun setLogLevel(call: PluginCall) = dispatch(call)
    @PluginMethod fun addTriggers(call: PluginCall) = dispatch(call)
    @PluginMethod fun removeTriggers(call: PluginCall) = dispatch(call)
    @PluginMethod fun clearTriggers(call: PluginCall) = dispatch(call)
    @PluginMethod fun getTriggers(call: PluginCall) = dispatch(call)
    @PluginMethod fun setScreen(call: PluginCall) = dispatch(call)
    @PluginMethod fun setInAppPaused(call: PluginCall) = dispatch(call)
    @PluginMethod fun getInAppPaused(call: PluginCall) = dispatch(call)
    @PluginMethod fun inboxList(call: PluginCall) = dispatch(call)
    @PluginMethod fun inboxMarkRead(call: PluginCall) = dispatch(call)
    @PluginMethod fun inboxMarkAllRead(call: PluginCall) = dispatch(call)
    @PluginMethod fun inboxArchive(call: PluginCall) = dispatch(call)
    @PluginMethod fun inboxUnreadCount(call: PluginCall) = dispatch(call)
    @PluginMethod fun setupDefaultLiveActivity(call: PluginCall) = dispatch(call)
    @PluginMethod fun startDefaultLiveActivity(call: PluginCall) = dispatch(call)
    @PluginMethod fun setLocationShared(call: PluginCall) = dispatch(call)
    @PluginMethod fun isLocationShared(call: PluginCall) = dispatch(call)
    @PluginMethod fun chatStart(call: PluginCall) = dispatch(call)
    @PluginMethod fun chatGetConfig(call: PluginCall) = dispatch(call)
    @PluginMethod fun chatGetConversation(call: PluginCall) = dispatch(call)
    @PluginMethod fun chatGetMessages(call: PluginCall) = dispatch(call)
    @PluginMethod fun chatSendMessage(call: PluginCall) = dispatch(call)
    @PluginMethod fun chatSendAttachment(call: PluginCall) = dispatch(call)
    @PluginMethod fun chatMarkRead(call: PluginCall) = dispatch(call)
    @PluginMethod fun chatRefreshUnreadCount(call: PluginCall) = dispatch(call)
    @PluginMethod fun chatGetUnreadCount(call: PluginCall) = dispatch(call)
    @PluginMethod fun chatLeaveOfflineMessage(call: PluginCall) = dispatch(call)
    @PluginMethod fun chatSetTyping(call: PluginCall) = dispatch(call)
    @PluginMethod fun chatStartListening(call: PluginCall) = dispatch(call)
    @PluginMethod fun chatStopListening(call: PluginCall) = dispatch(call)
    @PluginMethod fun chatAttachmentUrl(call: PluginCall) = dispatch(call)
    @PluginMethod fun chatGetVisitorId(call: PluginCall) = dispatch(call)

    /** Android 13+ POST_NOTIFICATIONS istemi; önceki sürümlerde çalışma zamanı izni yoktur, mevcut durum döner. */
    @PluginMethod
    fun requestPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState(PERMISSION_ALIAS) == PermissionState.GRANTED) {
            core.onPermissionResult()
            call.resolve(JSObject.fromJSONObject(core.permissionJson()))
            return
        }
        requestPermissionForAlias(PERMISSION_ALIAS, call, "onNotificationPermission")
    }

    @PermissionCallback
    private fun onNotificationPermission(call: PluginCall) {
        core.onPermissionResult()
        call.resolve(JSObject.fromJSONObject(core.permissionJson()))
    }

    /**
     * Konum izni (v2 Faz 17b): açıklama diyaloğu ve manifest denetimi [PushizoBridgeCore] içindedir; sistem izni
     * Capacitor izin API'siyle (istek kodu yerine `@PermissionCallback`) istenir.
     */
    @PluginMethod
    fun requestLocationPermission(call: PluginCall) {
        core.requestLocationPermission(activity, call.data, reply(call)) { permissions ->
            val aliases = permissions.map { if (it == Manifest.permission.ACCESS_FINE_LOCATION) LOCATION_FINE_ALIAS else LOCATION_COARSE_ALIAS }
            requestPermissionForAliases(aliases.toTypedArray(), call, "onLocationPermission")
        }
    }

    @PermissionCallback
    private fun onLocationPermission(call: PluginCall) {
        call.resolve(JSObject.fromJSONObject(core.onLocationPermissionResult()))
    }

    companion object {
        const val PERMISSION_ALIAS = "notifications"
        const val LOCATION_COARSE_ALIAS = "locationCoarse"
        const val LOCATION_FINE_ALIAS = "locationFine"
    }
}
