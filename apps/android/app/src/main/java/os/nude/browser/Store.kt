package os.nude.browser

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class Bookmark(val url: String, val title: String, val created: Long)
data class HistoryEntry(val url: String, val title: String, val lastVisit: Long, val visits: Int)
data class SecurityEvent(val time: Long, val type: String, val detail: String, val url: String?)

/** Small persistent store (SharedPreferences + JSON). Private tabs never write here. */
class Store(context: Context) {
    private val prefs = context.getSharedPreferences("nude", Context.MODE_PRIVATE)

    var engine: Omnibox.Engine
        get() = runCatching { Omnibox.Engine.valueOf(prefs.getString("engine", "DUCKDUCKGO")!!) }.getOrDefault(Omnibox.Engine.DUCKDUCKGO)
        set(v) = prefs.edit().putString("engine", v.name).apply()
    var level: Security.Level
        get() = runCatching { Security.Level.valueOf(prefs.getString("level", "STANDARD")!!) }.getOrDefault(Security.Level.STANDARD)
        set(v) = prefs.edit().putString("level", v.name).apply()
    var theme: String
        get() = prefs.getString("theme", "system")!!
        set(v) = prefs.edit().putString("theme", v).apply()
    var aiGateway: String
        get() = prefs.getString("aiGateway", "")!!
        set(v) = prefs.edit().putString("aiGateway", v.trim()).apply()
    var searchServer: String
        get() = prefs.getString("searchServer", "")!!
        set(v) = prefs.edit().putString("searchServer", v.trim()).apply()
    var serviceToken: String
        get() = prefs.getString("serviceToken", "")!!
        set(v) = prefs.edit().putString("serviceToken", v.trim()).apply()
    var desktopMode: Boolean
        get() = prefs.getBoolean("desktopMode", false)
        set(v) = prefs.edit().putBoolean("desktopMode", v).apply()
    var blockedTrackers: Long
        get() = prefs.getLong("blockedTrackers", 0)
        set(v) = prefs.edit().putLong("blockedTrackers", v).apply()
    var blockedSites: Long
        get() = prefs.getLong("blockedSites", 0)
        set(v) = prefs.edit().putLong("blockedSites", v).apply()
    var blockedDownloads: Long
        get() = prefs.getLong("blockedDownloads", 0)
        set(v) = prefs.edit().putLong("blockedDownloads", v).apply()

    fun bookmarks(): List<Bookmark> = readArray("bookmarks").map { Bookmark(it.getString("url"), it.optString("title"), it.optLong("created")) }
    fun isBookmarked(url: String) = bookmarks().any { it.url == url }
    fun toggleBookmark(url: String, title: String): Boolean {
        val list = bookmarks().toMutableList()
        val existing = list.indexOfFirst { it.url == url }
        if (existing >= 0) list.removeAt(existing) else list.add(Bookmark(url, title.ifBlank { url }, System.currentTimeMillis()))
        writeArray("bookmarks", list.map { JSONObject().put("url", it.url).put("title", it.title).put("created", it.created) })
        return existing < 0
    }
    fun removeBookmark(url: String) = writeArray("bookmarks", bookmarks().filter { it.url != url }.map { JSONObject().put("url", it.url).put("title", it.title).put("created", it.created) })

    fun history(): List<HistoryEntry> = readArray("history").map { HistoryEntry(it.getString("url"), it.optString("title"), it.optLong("t"), it.optInt("v", 1)) }
        .sortedByDescending { it.lastVisit }
    fun recordVisit(url: String, title: String) {
        if (!url.startsWith("http")) return
        val list = history().toMutableList()
        val prev = list.firstOrNull { it.url == url }
        list.removeAll { it.url == url }
        list.add(0, HistoryEntry(url, title.ifBlank { prev?.title ?: url }, System.currentTimeMillis(), (prev?.visits ?: 0) + 1))
        writeArray("history", list.take(3000).map { JSONObject().put("url", it.url).put("title", it.title).put("t", it.lastVisit).put("v", it.visits) })
    }
    fun updateTitle(url: String, title: String) {
        val list = history()
        if (list.none { it.url == url && it.title != title }) return
        writeArray("history", list.map { JSONObject().put("url", it.url).put("title", if (it.url == url) title else it.title).put("t", it.lastVisit).put("v", it.visits) })
    }
    fun removeHistory(url: String) = writeArray("history", history().filter { it.url != url }.map { JSONObject().put("url", it.url).put("title", it.title).put("t", it.lastVisit).put("v", it.visits) })
    fun clearHistory() = prefs.edit().remove("history").apply()

    fun events(): List<SecurityEvent> = readArray("events").map { SecurityEvent(it.optLong("t"), it.optString("type"), it.optString("detail"), it.optString("url").ifBlank { null }) }
    fun logEvent(type: String, detail: String, url: String?) {
        val list = listOf(JSONObject().put("t", System.currentTimeMillis()).put("type", type).put("detail", detail).put("url", url ?: "")) + readArray("events").take(199)
        writeArray("events", list)
    }

    fun trusted(): Set<String> = prefs.getStringSet("trusted", emptySet())!!.toSet()
    fun setTrusted(s: Set<String>) = prefs.edit().putStringSet("trusted", s).apply()

    fun savedTabs(): List<String> = readArray("tabs").map { it.getString("url") }
    fun saveTabs(urls: List<String>) = writeArray("tabs", urls.map { JSONObject().put("url", it) })

    fun suggestions(q: String, limit: Int = 6): List<Pair<String, String>> {
        val s = q.lowercase().trim()
        if (s.isEmpty()) return emptyList()
        val fromBookmarks = bookmarks().filter { it.url.lowercase().contains(s) || it.title.lowercase().contains(s) }.map { it.title to it.url }
        val fromHistory = history().filter { it.url.lowercase().removePrefix("https://").removePrefix("www.").startsWith(s) || it.title.lowercase().contains(s) }
            .sortedByDescending { it.visits }.map { it.title to it.url }
        return (fromBookmarks + fromHistory).distinctBy { it.second }.take(limit)
    }

    private fun readArray(key: String): List<JSONObject> = runCatching {
        val a = JSONArray(prefs.getString(key, "[]"))
        (0 until a.length()).map { a.getJSONObject(it) }
    }.getOrDefault(emptyList())

    private fun writeArray(key: String, items: List<JSONObject>) {
        val a = JSONArray()
        items.forEach { a.put(it) }
        prefs.edit().putString(key, a.toString()).apply()
    }
}
