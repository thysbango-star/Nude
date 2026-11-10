package os.rovian.defender.core

import android.content.Context
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import os.rovian.core.SecureFile
import java.util.UUID

/**
 * Rovian Defender's security history, encrypted on the phone with a Keystore key. Nothing here leaves the phone.
 * Events with the same key (the same app, the same setting) update in place instead of repeating.
 */
class EventStore(ctx: Context) {
    private val file = SecureFile(ctx, "rovian-defender-events", "defender.events")
    val events = mutableStateListOf<SecurityEvent>()
    var lastScan by mutableLongStateOf(0L); private set
    var lastScanApps by mutableLongStateOf(0L); private set

    init {
        try {
            file.read()?.let { text ->
                val j = JSONObject(text)
                val a = j.optJSONArray("events") ?: JSONArray()
                for (i in 0 until a.length()) events += SecurityEvent.fromJson(a.getJSONObject(i))
                lastScan = j.optLong("lastScan")
                lastScanApps = j.optLong("lastScanApps")
            }
        } catch (e: Exception) {
            file.delete()
        }
    }

    @Synchronized
    private fun save() {
        val a = JSONArray()
        events.take(MAX).forEach { a.put(it.toJson()) }
        file.write(JSONObject().put("events", a).put("lastScan", lastScan).put("lastScanApps", lastScanApps).toString())
    }

    /** Adds an event, or refreshes the open one with the same key. Returns true if it's new. */
    fun record(category: Category, severity: Severity, subject: String, title: String, explanation: String, action: String, key: String? = null): Boolean {
        val k = key ?: UUID.randomUUID().toString()
        val i = events.indexOfFirst { it.key == k && !it.resolved }
        val e = SecurityEvent(if (i >= 0) events[i].id else UUID.randomUUID().toString(), System.currentTimeMillis(), category, severity,
            subject.take(160), title.take(160), explanation.take(600), action.take(400), false, k)
        if (i >= 0) { events.removeAt(i); events.add(0, e) } else events.add(0, e)
        while (events.size > MAX) events.removeAt(events.lastIndex)
        save()
        return i < 0
    }

    /** After a scan: issues it no longer finds are marked resolved (the app was removed, the setting changed). */
    fun resolveMissing(prefix: String, stillPresent: Set<String>) {
        var changed = false
        for (i in events.indices) {
            val e = events[i]
            if (!e.resolved && e.key.startsWith(prefix) && e.key !in stillPresent) { events[i] = e.copy(resolved = true); changed = true }
        }
        if (changed) save()
    }

    fun setResolved(id: String, resolved: Boolean) {
        val i = events.indexOfFirst { it.id == id }
        if (i >= 0) { events[i] = events[i].copy(resolved = resolved); save() }
    }

    fun markScanned(apps: Boolean) { lastScan = System.currentTimeMillis(); if (apps) lastScanApps = lastScan; save() }

    fun clear() { events.clear(); save() }

    companion object { const val MAX = 300 }
}
