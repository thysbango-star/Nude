package os.rovian.defender

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import os.rovian.core.LinkCode
import os.rovian.core.LinkError
import os.rovian.core.LinkedPc
import os.rovian.core.PhoneLinkClient
import os.rovian.core.SecureFile
import os.rovian.core.phoneName

/** Counts from Rovian Defender on the PC. Real numbers only; nothing here is estimated. */
data class Stats(val blockedSites: Int, val warnedSites: Int, val blockedTrackers: Int, val blockedDownloads: Int, val flaggedDownloads: Int)

/** One thing Rovian Defender did on the PC. */
data class DEvent(val t: Long, val type: String, val host: String?, val category: String?, val detail: String)

data class Report(
    val pcName: String, val platform: String, val nudeVersion: String,
    val firstName: String?, val initials: String?, val color: String?,
    val level: String, val levelName: String, val levelSummary: String,
    val stats: Stats, val lastScan: Long, val listsUpdated: Long, val knownThreats: Int, val threatService: Boolean,
    val httpsOnly: Boolean, val trustedSites: Int, val events: List<DEvent>, val time: Long,
)

fun parseReport(j: JSONObject): Report {
    val pc = j.optJSONObject("pc") ?: JSONObject()
    val user = j.optJSONObject("user")
    val s = j.optJSONObject("stats") ?: JSONObject()
    val ev = j.optJSONArray("events")
    val events = (0 until (ev?.length() ?: 0)).mapNotNull { i ->
        ev!!.optJSONObject(i)?.let { e ->
            DEvent(e.optLong("t"), e.optString("type"), e.optString("host").takeIf { it.isNotBlank() && it != "null" },
                e.optString("category").takeIf { it.isNotBlank() && it != "null" }, e.optString("detail").take(300))
        }
    }
    val level = j.optString("level", "standard")
    return Report(
        pc.optString("name", "Your PC"), pc.optString("platform"), pc.optString("nude"),
        user?.optString("firstName")?.takeIf { it.isNotBlank() }, user?.optString("initials"), user?.optString("color"),
        level, j.optString("levelName", level.replaceFirstChar { it.uppercase() } + " Protection"), j.optString("levelSummary"),
        Stats(s.optInt("blockedSites"), s.optInt("warnedSites"), s.optInt("blockedTrackers"), s.optInt("blockedDownloads"), s.optInt("flaggedDownloads")),
        j.optLong("lastScan"), j.optLong("listsUpdated"), j.optInt("knownThreats"), j.optBoolean("threatService"),
        j.optBoolean("httpsOnly"), j.optInt("trustedSites"), events, j.optLong("time"),
    )
}

/** The link to the PC and its latest report, kept encrypted on the phone. */
class DefenderModel(ctx: Context) {
    private val file = SecureFile(ctx, "rovian-defender-link", "defender.link")
    private val client = PhoneLinkClient()
    private var raw: JSONObject? = null

    var pc by mutableStateOf<LinkedPc?>(null); private set
    var report by mutableStateOf<Report?>(null); private set
    var reportAt by mutableLongStateOf(0L); private set
    var error by mutableStateOf<String?>(null)
    var busy by mutableStateOf(false); private set
    /** True when the PC said this phone isn't linked any more. */
    var unlinked by mutableStateOf(false); private set

    init {
        try {
            file.read()?.let { text ->
                val j = JSONObject(text)
                pc = j.optJSONObject("pc")?.let(LinkedPc::fromJson)
                raw = j.optJSONObject("report")
                report = raw?.let(::parseReport)
                reportAt = j.optLong("reportAt")
            }
        } catch (e: Exception) {
            file.delete()
            error = "Rovian Defender couldn't open its saved link on this phone, so you'll need to scan your PC's code again."
        }
    }

    private fun save() {
        val p = pc
        if (p == null) { file.delete(); return }
        file.write(JSONObject().put("pc", p.toJson()).put("report", raw).put("reportAt", reportAt).toString())
    }

    /** Links to the PC from a scanned code. Returns an error message, or null. */
    suspend fun link(text: String): String? {
        val code = LinkCode.parse(text) ?: return "That isn't a code from Nude. On your PC, open Nude's menu and choose Connect your phone."
        if (code.app != "defender") return "That code is for PassGate. On your PC, choose Rovian Defender and scan again."
        busy = true
        return try {
            val p = withContext(Dispatchers.IO) { client.pair(code, phoneName()) }
            pc = p; raw = null; report = null; reportAt = 0; unlinked = false; error = null
            save()
            refresh()
            null
        } catch (e: LinkError) { e.userMessage } catch (e: Exception) { "Linking didn't work. Please try again." } finally { busy = false }
    }

    suspend fun refresh() {
        val p = pc ?: return
        if (busy && reportAt != 0L) return
        busy = true
        try {
            val (j, updated) = withContext(Dispatchers.IO) { client.fetch(p, "report") }
            raw = j; report = parseReport(j); reportAt = System.currentTimeMillis(); pc = updated; error = null; unlinked = false
            save()
        } catch (e: LinkError) {
            error = e.userMessage
            if (e.code == "unlinked") unlinked = true
        } catch (e: Exception) {
            error = "Rovian Defender couldn't read the report from your PC. Try again in a moment."
        } finally { busy = false }
    }

    suspend fun unlink() {
        pc?.let { p -> withContext(Dispatchers.IO) { client.unlink(p) } }
        pc = null; raw = null; report = null; reportAt = 0; unlinked = false; error = null
        file.delete()
    }
}
