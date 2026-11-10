package os.rovian.defender.ui

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import os.rovian.core.Security
import os.rovian.defender.core.Assessment
import os.rovian.defender.core.Category
import os.rovian.defender.core.DefenderCore
import os.rovian.defender.core.EventStore
import os.rovian.defender.core.ScanResult
import os.rovian.defender.core.ThreatLists
import os.rovian.defender.files.FileReport
import os.rovian.defender.files.FileScanner
import os.rovian.defender.notify.Notifier
import os.rovian.defender.pc.PcLink
import os.rovian.defender.web.LinkReport
import os.rovian.defender.web.LinkScanner

/** Everything the screens show. Work runs on background threads; results land here on the main thread. */
class DefenderState(private val ctx: Context) {
    val events = EventStore(ctx)
    val lists = ThreatLists(ctx)
    val pc = PcLink(ctx)
    private val prefs = ctx.getSharedPreferences("rovian-defender-ui", Context.MODE_PRIVATE)

    var scan by mutableStateOf<ScanResult?>(null); private set
    var scanning by mutableStateOf(false); private set
    var scanStep by mutableStateOf(""); private set
    var scanProgress by mutableFloatStateOf(0f); private set

    var link by mutableStateOf<LinkReport?>(null); private set
    var message by mutableStateOf<Security.MessageVerdict?>(null); private set
    var linkBusy by mutableStateOf(false); private set
    var linkError by mutableStateOf<String?>(null)

    var file by mutableStateOf<FileReport?>(null)
    var fileBusy by mutableStateOf(false); private set

    var theme by mutableStateOf(prefs.getString("theme", "system") ?: "system"); private set
    var listsBusy by mutableStateOf(false); private set
    var listsMessage by mutableStateOf<String?>(null)

    fun chooseTheme(t: String) { theme = t; prefs.edit().putString("theme", t).apply() }

    /** A full scan of settings and apps. `quiet` = on open, without the scanning animation. */
    suspend fun scan(quiet: Boolean = false) {
        if (scanning) return
        scanning = !quiet
        scanProgress = 0f
        try {
            val r = withContext(Dispatchers.IO) {
                DefenderCore.scan(ctx) { step, p -> if (!quiet) { scanStep = step; scanProgress = p } }
            }
            scan = r
            val fresh = DefenderCore.record(events, r)
            if (!quiet) Notifier.alert(ctx, fresh)
        } finally { scanning = false; scanStep = "" }
    }

    suspend fun checkLink(text: String, followRedirects: Boolean) {
        linkError = null
        val url = LinkScanner.extract(text)
        message = if (text.trim().length > (url?.length ?: 0) + 12) Security.analyzeMessage(text) else null
        if (url == null) {
            link = null
            if (message == null) linkError = "There's no link in that text."
            return
        }
        linkBusy = true
        try {
            val redirects = if (followRedirects) withContext(Dispatchers.IO) { runCatching { LinkScanner.followRedirects(url) }.getOrDefault(emptyList()) } else emptyList()
            val r = LinkScanner.scan(text, Security.Level.ENHANCED, redirects, followRedirects)
            link = r
            if (r != null && (r.assessment == Assessment.DANGEROUS || r.assessment == Assessment.SUSPICIOUS)) {
                events.record(Category.WEB, r.assessment.severity, r.host, "${r.headline}: ${r.host}", r.indicators.filter { it.bad }.joinToString(" ") { it.text }, r.advice, "web:${r.host}")
            }
        } finally { linkBusy = false }
    }

    suspend fun scanFile(uri: Uri) {
        fileBusy = true
        try {
            val r = withContext(Dispatchers.IO) { runCatching { FileScanner.scan(ctx, uri) }.getOrNull() }
            file = r
            if (r != null) {
                events.record(Category.FILE, r.assessment.severity, r.name, "File scan: ${r.assessment.label}", r.findings.joinToString(" "), r.advice,
                    r.sha256?.let { "file:$it" })
            }
        } finally { fileBusy = false }
    }

    suspend fun updateLists() {
        listsBusy = true
        listsMessage = withContext(Dispatchers.IO) { lists.update() } ?: "Updated: ${lists.domains} known dangerous sites."
        listsBusy = false
    }
}
