package os.rovian.defender

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import os.rovian.core.Security
import java.net.HttpURLConnection
import java.net.URL

/** One check the user ran. Kept on the phone only. */
data class CheckRecord(val time: Long, val kind: String, val subject: String, val outcome: String, val level: Int)

class DefenderStore(ctx: Context) {
    private val prefs = ctx.getSharedPreferences("rovian-defender", Context.MODE_PRIVATE)

    var level by mutableStateOf(runCatching { Security.Level.valueOf(prefs.getString("level", "STANDARD")!!) }.getOrDefault(Security.Level.STANDARD))
        private set
    var listsUrl by mutableStateOf(prefs.getString("listsUrl", "") ?: "")
        private set
    var listsUpdated by mutableStateOf(prefs.getLong("listsUpdated", 0L))
        private set
    var listCount by mutableStateOf(0)
        private set
    val history = mutableStateListOf<CheckRecord>()

    init {
        runCatching {
            val a = JSONArray(prefs.getString("history", "[]"))
            for (i in 0 until a.length()) a.getJSONObject(i).let { history += CheckRecord(it.getLong("t"), it.getString("k"), it.getString("s"), it.getString("o"), it.getInt("l")) }
        }
        // Downloaded threat lists from last time.
        runCatching { loadLists(JSONObject(prefs.getString("lists", "{}")!!)) }
    }

    fun chooseLevel(l: Security.Level) { level = l; prefs.edit().putString("level", l.name).apply() }
    fun chooseListsUrl(u: String) { listsUrl = u.trim(); prefs.edit().putString("listsUrl", listsUrl).apply() }

    fun record(kind: String, subject: String, outcome: String, level: Int) {
        history.add(0, CheckRecord(System.currentTimeMillis(), kind, subject.take(160), outcome, level))
        while (history.size > 50) history.removeAt(history.lastIndex)
        val a = JSONArray()
        history.forEach { a.put(JSONObject().put("t", it.time).put("k", it.kind).put("s", it.subject).put("o", it.outcome).put("l", it.level)) }
        prefs.edit().putString("history", a.toString()).apply()
    }

    fun clearHistory() { history.clear(); prefs.edit().remove("history").apply() }

    private fun loadLists(j: JSONObject) {
        val domains = j.optJSONObject("domains") ?: return
        Security.knownBad.clear()
        for (k in domains.keys()) {
            val v = domains.opt(k)
            Security.knownBad[k.lowercase()] = when (v) { is JSONObject -> v.optString("category", "malware"); is String -> v; else -> "malware" }
        }
        listCount = Security.knownBad.size
    }

    /** Downloads threat lists from the Rovian threat-intel server. Runs on a background thread. Returns an error or null. */
    fun updateLists(): String? {
        val base = listsUrl.trimEnd('/')
        if (!base.startsWith("https://") && !base.startsWith("http://")) return "Add your threat-intel server address first."
        return try {
            val c = URL("$base/v1/lists").openConnection() as HttpURLConnection
            c.connectTimeout = 10_000; c.readTimeout = 30_000
            if (c.responseCode != 200) return "The server said ${c.responseCode}."
            val text = c.inputStream.bufferedReader().use { it.readText() }
            if (text.length > 20_000_000) return "The list was too large."
            val j = JSONObject(text)
            loadLists(j)
            listsUpdated = System.currentTimeMillis()
            prefs.edit().putString("lists", text).putLong("listsUpdated", listsUpdated).apply()
            null
        } catch (e: Exception) { "Couldn't reach the server (${e.javaClass.simpleName})." }
    }
}
