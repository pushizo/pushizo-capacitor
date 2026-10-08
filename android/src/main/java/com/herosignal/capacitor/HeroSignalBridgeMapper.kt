package com.herosignal.capacitor

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.herosignal.sdk.HsApiException
import com.herosignal.sdk.HsClickEvent
import com.herosignal.sdk.HsInAppClickEvent
import com.herosignal.sdk.HsInboxItem
import com.herosignal.sdk.HsInboxPage
import com.herosignal.sdk.HsLog
import com.herosignal.sdk.HsNotification
import com.herosignal.sdk.HsPushSubscriptionState
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** `null` değeri JSON `null` olarak yazar (JSONObject.put(null) anahtarı siler). */
internal fun JSObject.putNullable(key: String, value: Any?): JSObject = put(key, value ?: JSONObject.NULL)

/** JS ↔ SDK model ve argüman dönüşümleri (`src/definitions.ts` ile aynı alan adları). */
internal object HeroSignalBridgeMapper {
    fun logLevel(name: String?): HsLog.Level = when (name) {
        "none" -> HsLog.Level.NONE
        "error" -> HsLog.Level.ERROR
        "info" -> HsLog.Level.INFO
        "debug" -> HsLog.Level.DEBUG
        else -> HsLog.Level.WARN
    }

    fun errorCode(e: Throwable): String = when (e) {
        is HsApiException -> e.code
        is IllegalArgumentException -> "INVALID_ARGUMENT"
        is IllegalStateException -> "NOT_READY"
        else -> "HS_ERROR"
    }

    /** JS dizge kimliğini Android sistem bildirim kimliğine (Int) çevirir. */
    fun androidNotificationId(raw: String?): Int =
        raw?.trim()?.toIntOrNull() ?: throw IllegalArgumentException("Android bildirim kimliği tam sayı olmalı.")

    fun stringMap(obj: JSONObject?): Map<String, String> {
        if (obj == null) return emptyMap()
        val out = LinkedHashMap<String, String>()
        for (key in obj.keys()) {
            val value = obj.opt(key)
            if (value == null || value == JSONObject.NULL) continue
            out[key] = value.toString()
        }
        return out
    }

    fun stringList(arr: JSONArray?): List<String> {
        if (arr == null) return emptyList()
        return (0 until arr.length()).mapNotNull { i -> arr.opt(i)?.takeIf { it != JSONObject.NULL }?.toString() }
    }

    /** Olay özellikleri: iç içe nesneler/diziler korunur, JSON null → null. */
    fun anyMap(obj: JSONObject?): Map<String, Any?> {
        if (obj == null) return emptyMap()
        val out = LinkedHashMap<String, Any?>()
        for (key in obj.keys()) out[key] = obj.opt(key).takeIf { it != JSONObject.NULL }
        return out
    }

    fun toJs(map: Map<String, String>): JSObject = JSObject().apply { map.forEach { (k, v) -> put(k, v) } }

    fun notification(n: HsNotification): JSObject {
        val actions = JSArray()
        n.actions.forEach { a -> actions.put(JSObject().put("id", a.id).put("title", a.title).putNullable("url", a.url)) }
        return JSObject()
            .putNullable("notificationId", n.androidNotificationId?.toString())
            .putNullable("title", n.title)
            .putNullable("body", n.body)
            .putNullable("url", n.url)
            .putNullable("imageUrl", n.imageUrl)
            .putNullable("deliveryId", n.deliveryId)
            .putNullable("messageId", n.messageId)
            .putNullable("groupKey", n.groupKey)
            .put("actions", actions)
            .put("data", toJs(n.data))
    }

    fun click(e: HsClickEvent): JSObject = JSObject()
        .put("notification", notification(e.notification))
        .put("result", JSObject().putNullable("actionId", e.actionId).putNullable("url", e.url))

    fun subscription(s: HsPushSubscriptionState): JSObject =
        JSObject().putNullable("id", s.id).putNullable("token", s.token).put("optedIn", s.optedIn)

    fun inAppMessage(id: String): JSObject = JSObject().put("message", JSObject().put("id", id))

    fun inAppClick(e: HsInAppClickEvent): JSObject = inAppMessage(e.messageId)
        .put("result", JSObject().put("actionId", e.actionId).putNullable("url", e.url))

    /** Epoch milisaniye → ISO-8601 UTC (web SDK ile aynı biçim). */
    fun isoTime(ms: Long?): String? {
        if (ms == null) return null
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        format.timeZone = TimeZone.getTimeZone("UTC")
        return format.format(Date(ms))
    }

    fun inboxItem(item: HsInboxItem): JSObject = JSObject()
        .put("id", item.id)
        .putNullable("messageId", item.messageId)
        .putNullable("title", item.title)
        .putNullable("body", item.body)
        .putNullable("url", item.url)
        .putNullable("imageUrl", item.imageUrl)
        .put("data", toJs(item.data))
        .put("read", item.read)
        .putNullable("readAt", isoTime(item.readAt))
        .putNullable("archivedAt", isoTime(item.archivedAt))
        .putNullable("expiresAt", isoTime(item.expiresAt))
        .putNullable("createdAt", isoTime(item.createdAt))

    fun inboxPage(page: HsInboxPage): JSObject {
        val items = JSArray()
        page.items.forEach { items.put(inboxItem(it)) }
        return JSObject()
            .put("items", items)
            .put("unreadCount", page.unreadCount)
            .putNullable("nextCursor", page.nextCursor)
            .put("hasMore", page.hasMore)
    }
}
