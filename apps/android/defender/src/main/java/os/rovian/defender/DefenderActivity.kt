@file:OptIn(ExperimentalMaterial3Api::class)

package os.rovian.defender

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import os.rovian.core.MatteCard
import os.rovian.core.Rise
import os.rovian.core.RovianColors
import os.rovian.core.RovianTheme
import os.rovian.core.Security
import java.text.DateFormat

private enum class Page { HOME, CHECK, FILE, APPS, SETTINGS }

/** What was shared into the app, if anything. */
private data class Incoming(val text: String?, val file: Uri?)

class DefenderActivity : ComponentActivity() {
    private val incoming = mutableStateOf<Incoming?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        incoming.value = read(intent)
        val store = DefenderStore(this)
        setContent { RovianTheme { DefenderApp(store, incoming) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        incoming.value = read(intent)
    }

    private fun read(i: Intent?): Incoming? {
        if (i?.action != Intent.ACTION_SEND) return null
        val file = if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else @Suppress("DEPRECATION") i.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        return Incoming(i.getStringExtra(Intent.EXTRA_TEXT), file)
    }
}

@Composable
private fun DefenderApp(store: DefenderStore, incoming: MutableState<Incoming?>) {
    var page by remember { mutableStateOf(Page.HOME) }
    var draft by remember { mutableStateOf("") }
    var fileUri by remember { mutableStateOf<Uri?>(null) }
    LaunchedEffect(incoming.value) {
        incoming.value?.let { inc ->
            if (inc.file != null) { fileUri = inc.file; page = Page.FILE } else if (!inc.text.isNullOrBlank()) { draft = inc.text; page = Page.CHECK }
            incoming.value = null
        }
    }
    BackHandler(page != Page.HOME) { page = Page.HOME }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) { fileUri = uri; page = Page.FILE } }

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        AnimatedContent(page, transitionSpec = {
            val forward = targetState != Page.HOME
            (slideInHorizontally(spring(dampingRatio = 0.9f, stiffness = Spring.StiffnessMediumLow)) { if (forward) it / 3 else -it / 3 } + fadeIn(tween(220))) togetherWith
                (slideOutHorizontally(tween(220)) { if (forward) -it / 5 else it / 5 } + fadeOut(tween(160)))
        }, label = "page") { p ->
            when (p) {
                Page.HOME -> Home(store, onCheck = { draft = ""; page = Page.CHECK }, onFile = { pick.launch(arrayOf("*/*")) }, onApps = { page = Page.APPS }, onSettings = { page = Page.SETTINGS })
                Page.CHECK -> CheckPage(store, draft) { page = Page.HOME }
                Page.FILE -> FilePage(store, fileUri) { page = Page.HOME }
                Page.APPS -> AppsPage(store) { page = Page.HOME }
                Page.SETTINGS -> SettingsPage(store) { page = Page.HOME }
            }
        }
    }
}

/** The shield, breathing slowly; it pulses brighter while a check runs. */
@Composable
private fun Shield(size: Int, active: Boolean = false) {
    val t = rememberInfiniteTransition(label = "shield")
    val glow by t.animateFloat(0.35f, if (active) 0.95f else 0.6f, infiniteRepeatable(tween(if (active) 700 else 2600, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "glow")
    Box(contentAlignment = Alignment.Center, modifier = Modifier.size((size * 1.5f).dp).drawBehind {
        drawCircle(Brush.radialGradient(listOf(RovianColors.Sky.copy(alpha = glow * 0.55f), Color.Transparent), center = center, radius = this.size.minDimension / 2), radius = this.size.minDimension / 2)
    }) {
        Image(painterResource(os.rovian.core.R.drawable.ic_rovian_mark), "Rovian Defender", Modifier.size(size.dp, (size * 1.15f).dp))
    }
}

@Composable
private fun Wordmark() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("Rovian", fontWeight = FontWeight.Bold, fontSize = 22.sp)
        Text("Defender", fontWeight = FontWeight.SemiBold, fontSize = 22.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Home(store: DefenderStore, onCheck: () -> Unit, onFile: () -> Unit, onApps: () -> Unit, onSettings: () -> Unit) {
    val levelName = mapOf(Security.Level.STANDARD to "Standard", Security.Level.ENHANCED to "Enhanced", Security.Level.MAXIMUM to "Maximum").getValue(store.level)
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().navigationBarsPadding().padding(horizontal = 18.dp)) {
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Wordmark()
            Spacer(Modifier.weight(1f))
            IconButton(onSettings) { Icon(Icons.Default.Settings, "Settings") }
        }
        Rise(0, Modifier.fillMaxWidth()) {
            Column(Modifier.fillMaxWidth().padding(vertical = 18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Shield(120)
                Text("Ready to check", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(top = 4.dp))
                Text("Links, messages, files and apps are checked here on your phone. $levelName protection.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp, start = 12.dp, end = 12.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                Text(if (store.listCount > 0) "${store.listCount} known threats on your phone · updated ${ago(store.listsUpdated)}" else "Using built-in checks. Add threat lists in Settings.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
            }
        }
        val actions = listOf(
            Triple(Icons.Default.Search, "Check a link or message", "Paste it, or share it to Rovian Defender from any app") to onCheck,
            Triple(Icons.Default.Info, "Check a file", "See what a file really is before you open it") to onFile,
            Triple(Icons.Default.Lock, "Check my apps", "Find apps that can read codes or control your phone") to onApps,
        )
        actions.forEachIndexed { i, (a, go) ->
            Rise(80 + i * 60, Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
                MatteCard(Modifier.fillMaxWidth(), onClick = go) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(RovianColors.ShieldBrush), contentAlignment = Alignment.Center) { Icon(a.first, null, tint = Color.White) }
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f)) { Text(a.second, fontWeight = FontWeight.SemiBold, fontSize = 16.sp); Text(a.third, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        if (store.history.isNotEmpty()) {
            Text("Recent checks", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 14.dp, bottom = 8.dp))
            store.history.take(8).forEachIndexed { i, r ->
                Rise(260 + i * 40, Modifier.fillMaxWidth()) {
                    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Dot(r.level)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(r.subject, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 14.sp)
                            Text("${r.outcome} · ${ago(r.time)}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
        Text("Rovian Defender helps you spot danger. It can't promise that a link, file or app is safe.", fontSize = 11.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 20.dp))
    }
}

@Composable
private fun Dot(level: Int) {
    val c = when (level) { 2 -> RovianColors.Red; 1 -> RovianColors.Amber; else -> RovianColors.Green }
    Box(Modifier.size(10.dp).clip(CircleShape).background(c))
}

@Composable
private fun PageScaffold(title: String, onBack: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text(title, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp), content = content)
    }
}

/** Unified result: verdict colour, a headline, what was found and what to do. */
private data class Outcome(val level: Int, val headline: String, val detail: String, val points: List<String>, val advice: String?)

@Composable
private fun OutcomeCard(o: Outcome) {
    val color = when (o.level) { 2 -> RovianColors.Red; 1 -> RovianColors.Amber; else -> RovianColors.Green }
    Rise(0, Modifier.fillMaxWidth()) {
        MatteCard(Modifier.fillMaxWidth().padding(top = 14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(40.dp).clip(CircleShape).background(color.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
                    Icon(when (o.level) { 2 -> Icons.Default.Warning; 1 -> Icons.Default.Info; else -> Icons.Default.CheckCircle }, null, tint = color)
                }
                Spacer(Modifier.width(12.dp))
                Column { Text(o.headline, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = color); Text(o.detail, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            if (o.points.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                o.points.forEachIndexed { i, s ->
                    Rise(i * 60) { Text("• $s", fontSize = 14.sp, modifier = Modifier.padding(vertical = 3.dp)) }
                }
            }
            o.advice?.let { Text(it, fontSize = 14.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 10.dp)) }
        }
    }
}

@Composable
private fun CheckPage(store: DefenderStore, initial: String, onBack: () -> Unit) {
    var text by remember { mutableStateOf(initial) }
    var outcome by remember { mutableStateOf<Outcome?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val clip = LocalClipboardManager.current
    fun doCheck() {
        val t = text.trim()
        if (t.isEmpty()) return
        busy = true
        scope.launch {
            kotlinx.coroutines.delay(350) // long enough to see the shield work, short enough not to wait
            outcome = check(t, store.level)
            outcome?.let { store.record(if (isSingleUrl(t)) "link" else "message", t.lines().first(), it.headline, it.level) }
            busy = false
        }
    }
    LaunchedEffect(Unit) { if (initial.isNotBlank()) doCheck() }
    PageScaffold("Check a link or message", onBack) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { Shield(64, active = busy) }
        OutlinedTextField(text, { text = it; outcome = null }, Modifier.fillMaxWidth().heightIn(min = 120.dp), label = { Text("Paste a link or a message") },
            shape = RoundedCornerShape(18.dp), maxLines = 10)
        Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedButton({ clip.getText()?.text?.let { text = it; outcome = null } }, Modifier.weight(1f).height(50.dp), shape = RoundedCornerShape(14.dp)) { Text("Paste") }
            Button({ doCheck() }, Modifier.weight(1f).height(50.dp), enabled = text.isNotBlank() && !busy, shape = RoundedCornerShape(14.dp)) { Text(if (busy) "Checking…" else "Check") }
        }
        outcome?.let { OutcomeCard(it) }
        Text("Tip: in WhatsApp, Messages or your browser, tap Share → Rovian Defender to check something without copying it.", fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 18.dp))
    }
}

private fun isSingleUrl(t: String) = Regex("^(https?://)?[\\w.-]+\\.[a-z]{2,}(/\\S*)?$", RegexOption.IGNORE_CASE).matches(t.trim())

private fun check(t: String, level: Security.Level): Outcome {
    if (isSingleUrl(t)) {
        val url = if (t.startsWith("http")) t else "https://$t"
        val v = Security.analyze(url, level)
        val info = v.category?.let { Security.categoryInfo[it] }
        return when (v.action) {
            Security.Action.BLOCK -> Outcome(2, info?.first ?: "Dangerous link", "${v.host} · ${if (v.confirmed) "on a known-threat list" else "warning signs, not confirmed"}",
                v.signals.map { it.message }, info?.third ?: "Don't open it.")
            Security.Action.WARN -> Outcome(1, "Be careful", v.host, v.signals.map { it.message }, "Only open it if you trust where it came from.")
            Security.Action.ALLOW -> Outcome(0, "No warning signs found", v.host, v.signals.map { it.message },
                "That doesn't prove it's safe. Check the address before you sign in or pay.")
        }
    }
    val m = Security.analyzeMessage(t)
    val level2 = when (m.assessment) { "Likely a scam" -> 2; "Suspicious" -> 1; else -> 0 }
    return Outcome(level2, m.assessment, "Message check", m.indicators, m.summary)
}

@Composable
private fun FilePage(store: DefenderStore, uri: Uri?, onBack: () -> Unit) {
    val ctx = LocalContext.current
    var report by remember(uri) { mutableStateOf<FileReport?>(null) }
    var error by remember(uri) { mutableStateOf<String?>(null) }
    LaunchedEffect(uri) {
        if (uri == null) return@LaunchedEffect
        kotlinx.coroutines.delay(300)
        try {
            val r = withContext(Dispatchers.IO) { FileCheck.inspect(ctx, uri, store.level) }
            report = r
            store.record("file", r.name, r.verdict.risk.replaceFirstChar { it.uppercase() } + " risk", when (r.verdict.action) { Security.Action.BLOCK -> 2; Security.Action.WARN -> 1; else -> 0 })
        } catch (e: Exception) { error = "Couldn't read that file." }
    }
    PageScaffold("Check a file", onBack) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { Shield(64, active = report == null && error == null) }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        report?.let { r ->
            Text(r.name, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, modifier = Modifier.fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            Text(listOfNotNull(r.realType, r.size?.let { size(it) }).joinToString(" · "), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            val o = when (r.verdict.action) {
                Security.Action.BLOCK -> Outcome(2, "Don't open this file", "${r.verdict.risk.replaceFirstChar { it.uppercase() }} risk", r.notes, "Delete it unless you're certain where it came from.")
                Security.Action.WARN -> Outcome(1, "Open with care", "${r.verdict.risk.replaceFirstChar { it.uppercase() }} risk", r.notes, "Only open it if you trust the sender.")
                else -> Outcome(0, "No warning signs found", "Low risk", r.notes, "Rovian Defender can't guarantee a file is safe. It checked the name, type and contents' signature.")
            }
            OutcomeCard(o)
        }
    }
}

@Composable
private fun AppsPage(store: DefenderStore, onBack: () -> Unit) {
    val ctx = LocalContext.current
    var findings by remember { mutableStateOf<List<AppFinding>?>(null) }
    LaunchedEffect(Unit) {
        val f = withContext(Dispatchers.IO) { AppAudit.scan(ctx) }
        kotlinx.coroutines.delay(400)
        findings = f
        store.record("apps", "App check", if (f.isEmpty()) "Nothing to review" else "${f.size} app${if (f.size == 1) "" else "s"} to review", if (f.any { it.severity >= 60 }) 2 else if (f.isNotEmpty()) 1 else 0)
    }
    PageScaffold("Check my apps", onBack) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { Shield(64, active = findings == null) }
        val list = findings
        if (list == null) Text("Looking at your apps…", modifier = Modifier.fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        else if (list.isEmpty()) OutcomeCard(Outcome(0, "Nothing to review", "Your apps",
            emptyList(), "No app from outside an app store holds permissions that could read codes or control your phone."))
        else {
            Text("These apps can do things scammers rely on. If you don't recognise one, remove it.", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            list.forEachIndexed { i, f ->
                Rise(i * 60, Modifier.fillMaxWidth().padding(top = 10.dp)) {
                    MatteCard(Modifier.fillMaxWidth(), onClick = {
                        ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${f.packageName}")))
                    }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Dot(if (f.severity >= 60) 2 else 1)
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) { Text(f.label, fontWeight = FontWeight.SemiBold); Text(f.source, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            Text("Review", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                        }
                        f.reasons.forEach { Text("• $it", fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp)) }
                    }
                }
            }
        }
        Text("Rovian Defender looks at where apps came from and what they're allowed to do. It doesn't scan app code, so it can't say an app is malware.",
            fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 18.dp))
    }
}

@Composable
private fun SettingsPage(store: DefenderStore, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var url by remember { mutableStateOf(store.listsUrl) }
    var status by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    PageScaffold("Settings", onBack) {
        Text("Protection level", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 8.dp))
        listOf(
            Triple(Security.Level.STANDARD, "Standard", "Blocks known threats, warns about suspicious links."),
            Triple(Security.Level.ENHANCED, "Enhanced", "Stricter: more links get a warning."),
            Triple(Security.Level.MAXIMUM, "Maximum", "Strictest: blocks anything suspicious."),
        ).forEach { (l, name, desc) ->
            val on = store.level == l
            MatteCard(Modifier.fillMaxWidth().padding(bottom = 8.dp), onClick = { store.chooseLevel(l) }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(on, { store.chooseLevel(l) })
                    Column { Text(name, fontWeight = FontWeight.SemiBold); Text(desc, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
        Text("Threat lists", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 14.dp, bottom = 4.dp))
        Text("Download known phishing and malware sites from your Rovian threat-intel server, so checks work offline.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(url, { url = it }, Modifier.fillMaxWidth().padding(top = 8.dp), label = { Text("Server address") }, singleLine = true, shape = RoundedCornerShape(14.dp))
        Button({
            store.chooseListsUrl(url); busy = true
            scope.launch { val e = withContext(Dispatchers.IO) { store.updateLists() }; status = e ?: "Updated: ${store.listCount} known threats."; busy = false }
        }, Modifier.padding(top = 8.dp), enabled = !busy, shape = RoundedCornerShape(14.dp)) { Text(if (busy) "Updating…" else "Update now") }
        status?.let { Text(it, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp)) }
        Text("History", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 18.dp, bottom = 4.dp))
        OutlinedButton({ store.clearHistory(); status = "History cleared." }, shape = RoundedCornerShape(14.dp)) { Text("Clear recent checks") }
        Text("Everything you check stays on this phone.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 18.dp))
    }
}

private fun ago(t: Long): String {
    if (t <= 0) return "never"
    val s = (System.currentTimeMillis() - t) / 1000
    return when { s < 60 -> "just now"; s < 3600 -> "${s / 60} min ago"; s < 86_400 -> "${s / 3600} h ago"; else -> DateFormat.getDateInstance(DateFormat.SHORT).format(t) }
}

private fun size(b: Long): String = when { b < 1024 -> "$b B"; b < 1_048_576 -> "${b / 1024} KB"; else -> "%.1f MB".format(b / 1_048_576.0) }
