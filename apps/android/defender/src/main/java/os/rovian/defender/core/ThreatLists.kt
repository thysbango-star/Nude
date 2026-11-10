package os.rovian.defender.core

import android.content.Context
import org.json.JSONObject
import os.rovian.core.Security
import os.rovian.defender.apps.AppAnalyzer
import os.rovian.defender.files.FileScanner
import java.net.HttpURLConnection
import java.net.URL

/**
 * Rovian threat intelligence on the phone: lists downloaded from a Rovian threat-intel server (services/threat-intel,
 * GET /v1/lists). Domains feed the link scanner; "packages", "certs" and "hashes" (when the server provides them)
 * feed app and file checks. Nothing is uploaded.
 */
class ThreatLists(ctx: Context) {
    private val prefs = ctx.getSharedPreferences("rovian-defender-lists", Context.MODE_PRIVATE)
    var url: String = prefs.getString("url", "") ?: ""; private set
    var updated: Long = prefs.getLong("updated", 0L); private set
    var domains = 0; private set

    init { runCatching { apply(JSONObject(prefs.getString("lists", "{}")!!)) } }

    fun setUrl(u: String) { url = u.trim(); prefs.edit().putString("url", url).apply() }

    private fun apply(j: JSONObject) {
        j.optJSONObject("domains")?.let { d ->
            Security.knownBad.clear()
            for (k in d.keys()) Security.knownBad[k.lowercase()] = when (val v = d.opt(k)) { is JSONObject -> v.optString("category", "malware"); is String -> v; else -> "malware" }
        }
        j.optJSONObject("packages")?.let { p -> AppAnalyzer.knownBadPackages.clear(); for (k in p.keys()) AppAnalyzer.knownBadPackages[k] = p.optString(k, "malware") }
        j.optJSONObject("certs")?.let { p -> AppAnalyzer.knownBadCerts.clear(); for (k in p.keys()) AppAnalyzer.knownBadCerts[k.lowercase()] = p.optString(k, "malware") }
        j.optJSONObject("hashes")?.let { p -> FileScanner.knownBadHashes.clear(); for (k in p.keys()) FileScanner.knownBadHashes[k.lowercase()] = p.optString(k, "malware") }
        domains = Security.knownBad.size
    }

    /** Downloads the lists. Blocking. Returns an error message or null. */
    fun update(): String? {
        val base = url.trimEnd('/')
        if (!base.startsWith("https://") && !base.startsWith("http://")) return "Add your Rovian threat-intel server address first."
        return try {
            val c = URL("$base/v1/lists").openConnection() as HttpURLConnection
            c.connectTimeout = 10_000; c.readTimeout = 30_000
            if (c.responseCode != 200) return "The server answered ${c.responseCode}."
            val text = c.inputStream.bufferedReader().use { it.readText() }
            if (text.length > 30_000_000) return "The list was too large."
            apply(JSONObject(text))
            updated = System.currentTimeMillis()
            prefs.edit().putString("lists", text).putLong("updated", updated).apply()
            null
        } catch (e: Exception) { "Couldn't reach the server (${e.javaClass.simpleName})." }
    }
}
