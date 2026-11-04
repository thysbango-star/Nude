@file:OptIn(ExperimentalMaterial3Api::class)

package os.rovian.defender

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import os.rovian.core.Poppins
import os.rovian.core.Rise
import os.rovian.core.poppinsTypography
import java.text.DateFormat

/** Rovian Defender's palette: deep night blue with electric Rovian blue. */
private object D {
    val Ink = Color(0xFF05060F)
    val Card = Color(0xFF14162A)
    val CardEdge = Color(0x14FFFFFF)
    val Text = Color(0xFFF3F4FF)
    val Muted = Color(0xFFA3A9CC)
    val Faint = Color(0xFF6E7499)
    val Electric = Color(0xFF3346FF)
    val Lime = Color(0xFFB5E86F)
    val Cyan = Color(0xFF5ED6E6)
    val Orange = Color(0xFFF3A85E)
    val Pink = Color(0xFFF07193)
    val Violet = Color(0xFFA48BFF)
    val Hero = Brush.linearGradient(listOf(Color(0xFF6C82FF), Color(0xFF3B52F2), Color(0xFF8EA3FF)), start = Offset(0f, 0f), end = Offset(900f, 700f))
}

private enum class Tab { HOME, REPORT }

class DefenderActivity : ComponentActivity() {
    private lateinit var model: DefenderModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        model = DefenderModel(applicationContext)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = D.Electric, background = D.Ink, surface = D.Card, onSurface = D.Text), typography = poppinsTypography()) {
                App(model, refresh = { lifecycleScope.launch { model.refresh() } })
            }
        }
        // While Rovian Defender is open, keep the report fresh.
        lifecycleScope.launch {
            while (true) {
                if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) && model.pc != null) model.refresh()
                delay(30_000)
            }
        }
    }
}

@Composable
private fun App(model: DefenderModel, refresh: () -> Unit) {
    val scope = rememberCoroutineScope()
    var tab by remember { mutableStateOf(Tab.HOME) }
    var linkError by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf(false) }
    var detail by remember { mutableStateOf<DEvent?>(null) }
    val scan = rememberLauncherForActivityResult(ScanContract()) { r ->
        val text = r.contents ?: return@rememberLauncherForActivityResult
        scope.launch { linkError = model.link(text) }
    }
    val startScan = {
        linkError = null
        scan.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE).setPrompt("Scan the Rovian Defender code on your PC").setBeepEnabled(false).setOrientationLocked(false))
    }
    BackHandler(tab != Tab.HOME) { tab = Tab.HOME }

    Box(Modifier.fillMaxSize().background(D.Ink).drawBehind {
        drawRect(Brush.verticalGradient(listOf(Color(0xFF0C1647), Color(0xFF080C2A), D.Ink), endY = size.height * 0.75f))
        drawCircle(Brush.radialGradient(listOf(Color(0x552B45FF), Color.Transparent), center = Offset(size.width * 0.5f, -size.width * 0.1f), radius = size.width), radius = size.width, center = Offset(size.width * 0.5f, -size.width * 0.1f))
    }) {
        val pc = model.pc
        val report = model.report
        AnimatedContent(Triple(pc != null, tab, report != null), transitionSpec = {
            (fadeIn(tween(280)) + slideInVertically(tween(380, easing = FastOutSlowInEasing)) { it / 14 }) togetherWith fadeOut(tween(160))
        }, label = "screen") { (linked, t, _) ->
            when {
                !linked -> Onboarding(model.busy, linkError ?: model.error, startScan)
                t == Tab.REPORT && report != null -> ReportScreen(model, report, onMenu = { menu = true })
                else -> Home(model, onMenu = { menu = true }, onRefresh = refresh, onEvent = { detail = it }, onReport = { tab = Tab.REPORT }, onScan = startScan)
            }
        }
        if (pc != null) {
            BottomNav(Modifier.align(Alignment.BottomCenter), tab, busy = model.busy,
                onHome = { tab = Tab.HOME }, onCenter = refresh, onReport = { if (model.report != null) tab = Tab.REPORT })
        }
    }

    if (menu) {
        ModalBottomSheet(onDismissRequest = { menu = false }, containerColor = Color(0xFF101226), contentColor = D.Text) {
            MenuSheet(model, onScan = { menu = false; startScan() }, onUnlink = { scope.launch { model.unlink(); menu = false; tab = Tab.HOME } })
        }
    }
    detail?.let { ev ->
        ModalBottomSheet(onDismissRequest = { detail = null }, containerColor = Color(0xFF101226), contentColor = D.Text) { EventSheet(ev) }
    }
}

// ------------------------------------------------------------------ onboarding

@Composable
private fun Onboarding(busy: Boolean, error: String?, onScan: () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().navigationBarsPadding().padding(horizontal = 22.dp)) {
        Spacer(Modifier.height(18.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Image(painterResource(os.rovian.core.R.drawable.ic_rovian_mark), null, Modifier.size(30.dp, 34.dp))
            Spacer(Modifier.width(10.dp))
            Text("Rovian Defender", color = D.Text, fontWeight = FontWeight.Medium, fontSize = 16.sp)
        }
        Spacer(Modifier.height(26.dp))
        Text("Hi there!", color = D.Muted, fontSize = 16.sp, fontWeight = FontWeight.Light)
        Text("See how your PC\nis protected.", color = D.Text, fontSize = 30.sp, lineHeight = 38.sp)
        Spacer(Modifier.height(22.dp))
        Rise(80) {
            HeroCard(title = "Link your PC", body = "In Nude on your PC, open the menu and choose Connect your phone, then Rovian Defender.", button = if (busy) "Linking…" else "Scan code", onButton = onScan)
        }
        AnimatedVisibility(error != null) {
            Text(error ?: "", color = D.Pink, fontSize = 13.sp, modifier = Modifier.padding(top = 14.dp))
        }
        Spacer(Modifier.height(26.dp))
        Text("What you'll see", color = D.Text, fontSize = 17.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(12.dp))
        listOf(
            Triple(Icons.Default.Lock, D.Lime, "Dangerous sites and downloads Rovian Defender stopped"),
            Triple(Icons.Default.Search, D.Cyan, "How many trackers were blocked"),
            Triple(Icons.Default.Warning, D.Orange, "Warnings and every security event, as they happen"),
        ).forEachIndexed { i, (ic, c, t) -> Rise(160 + i * 70) { Row1(ic, c, t, null, null) }; Spacer(Modifier.height(10.dp)) }
        Spacer(Modifier.height(10.dp))
        Text("Rovian Defender reads an encrypted report from Nude over your own Wi-Fi. It never sees your browsing history.",
            color = D.Faint, fontSize = 12.sp, lineHeight = 17.sp)
        Spacer(Modifier.height(40.dp))
    }
}

// ------------------------------------------------------------------ home

@Composable
private fun Home(model: DefenderModel, onMenu: () -> Unit, onRefresh: () -> Unit, onEvent: (DEvent) -> Unit, onReport: () -> Unit, onScan: () -> Unit) {
    val r = model.report
    var filter by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(horizontal = 20.dp)) {
        Spacer(Modifier.height(14.dp))
        TopBar(r, onMenu)
        Spacer(Modifier.height(22.dp))
        Text("Hi..! ${r?.firstName ?: "there"}", color = D.Muted, fontSize = 16.sp, fontWeight = FontWeight.Light)
        Text(headline(model), color = D.Text, fontSize = 29.sp, lineHeight = 37.sp)
        Spacer(Modifier.height(20.dp))
        if (r == null) {
            Rise { HeroCard("Waiting for your PC", model.error ?: "Getting the first report from ${model.pc?.pcName ?: "your PC"}…", if (model.busy) "Checking…" else "Try again", onRefresh) }
            if (model.unlinked) { Spacer(Modifier.height(12.dp)); PillButton("Scan a new code", onScan) }
            return@Column
        }
        Rise {
            HeroCard(r.levelName, r.levelSummary.ifBlank { "Rovian Defender is checking sites and downloads on ${r.pcName}." },
                if (model.busy) "Updating…" else "Refresh report", onRefresh, footer = "Updated ${ago(model.reportAt)} from ${r.pcName}")
        }
        model.error?.let { Text(it, color = D.Orange, fontSize = 12.5.sp, modifier = Modifier.padding(top = 10.dp)) }
        if (model.unlinked) { Spacer(Modifier.height(10.dp)); PillButton("Scan a new code", onScan) }
        Spacer(Modifier.height(18.dp))
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Chip("Sites", r.stats.blockedSites + r.stats.warnedSites, Icons.Default.Lock, D.Lime, filter == "sites") { filter = if (filter == "sites") null else "sites" }
            Chip("Trackers", r.stats.blockedTrackers, Icons.Default.Search, D.Cyan, filter == "trackers") { filter = if (filter == "trackers") null else "trackers" }
            Chip("Downloads", r.stats.blockedDownloads + r.stats.flaggedDownloads, Icons.Default.Warning, D.Orange, filter == "downloads") { filter = if (filter == "downloads") null else "downloads" }
            Chip("Updates", r.events.count { it.type == "lists-updated" || it.type == "scan" }, Icons.Default.Refresh, D.Violet, filter == "updates") { filter = if (filter == "updates") null else "updates" }
        }
        Spacer(Modifier.height(22.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Recent activity", color = D.Text, fontSize = 17.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
            Text("See all", color = D.Text, fontSize = 13.sp, modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onReport).padding(6.dp))
        }
        Spacer(Modifier.height(10.dp))
        val list = r.events.filter { matches(it, filter) }.take(20)
        if (list.isEmpty()) Text(if (filter == null) "Nothing yet. Rovian Defender will list what it blocks on ${r.pcName} here." else "Nothing in this group yet.", color = D.Faint, fontSize = 13.sp)
        list.forEachIndexed { i, e ->
            key(e.t, e.type, i) {
                Rise(i.coerceAtMost(8) * 45) { val (ic, c) = iconFor(e.type); Row1(ic, c, e.detail, listOfNotNull(e.host, ago(e.t)).joinToString(" · "), onClick = { onEvent(e) }) }
            }
            Spacer(Modifier.height(10.dp))
        }
        Spacer(Modifier.height(120.dp))
    }
}

private fun headline(m: DefenderModel): String {
    val r = m.report ?: return if (m.busy) "Connecting to your PC…" else "Let's reach your PC."
    val stale = System.currentTimeMillis() - m.reportAt > 10 * 60_000
    return when {
        stale && m.error != null -> "This is the last report\nfrom ${r.pcName}."
        r.level == "maximum" -> "Your PC has maximum\nprotection on."
        else -> "Rovian Defender is\nprotecting ${r.pcName}."
    }
}

private fun matches(e: DEvent, f: String?) = when (f) {
    null -> true
    "sites" -> e.type.startsWith("site-") || e.type == "bypass"
    "trackers" -> e.type == "tracker-summary"
    "downloads" -> e.type.startsWith("download-")
    "updates" -> e.type == "lists-updated" || e.type == "scan"
    else -> true
}

private fun iconFor(type: String): Pair<ImageVector, Color> = when {
    type == "site-blocked" -> Icons.Default.Close to D.Pink
    type == "site-warned" -> Icons.Default.Warning to D.Orange
    type.startsWith("download-") -> Icons.Default.Delete to D.Orange
    type == "bypass" -> Icons.Default.Info to D.Muted
    type == "tracker-summary" -> Icons.Default.Search to D.Cyan
    type == "lists-updated" -> Icons.Default.Refresh to D.Violet
    else -> Icons.Default.Done to D.Lime
}

private fun title(type: String) = when (type) {
    "site-blocked" -> "Site blocked"; "site-warned" -> "Site warning"; "download-blocked" -> "Download blocked"
    "download-warned", "download-flagged" -> "Download warning"; "bypass" -> "You chose to continue"; "tracker-summary" -> "Trackers blocked"
    "lists-updated" -> "Threat lists updated"; "scan" -> "Check"; else -> "Security event"
}

// ------------------------------------------------------------------ report

@Composable
private fun ReportScreen(model: DefenderModel, r: Report, onMenu: () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(horizontal = 20.dp)) {
        Spacer(Modifier.height(14.dp))
        TopBar(r, onMenu)
        Spacer(Modifier.height(22.dp))
        Text("Report for ${r.pcName}", color = D.Muted, fontSize = 16.sp, fontWeight = FontWeight.Light)
        Text("Everything Rovian\nDefender has done.", color = D.Text, fontSize = 29.sp, lineHeight = 37.sp)
        Spacer(Modifier.height(20.dp))
        val tiles = listOf(
            Triple("Sites blocked", r.stats.blockedSites, D.Pink), Triple("Site warnings", r.stats.warnedSites, D.Orange),
            Triple("Trackers blocked", r.stats.blockedTrackers, D.Cyan), Triple("Downloads blocked", r.stats.blockedDownloads, D.Lime),
            Triple("Download warnings", r.stats.flaggedDownloads, D.Violet), Triple("Trusted sites", r.trustedSites, D.Muted),
        )
        tiles.chunked(2).forEachIndexed { row, pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                pair.forEachIndexed { i, (label, n, c) -> Rise((row * 2 + i) * 50, Modifier.weight(1f)) { StatTile(label, n, c) } }
            }
            Spacer(Modifier.height(10.dp))
        }
        Spacer(Modifier.height(8.dp))
        Card {
            Fact("Protection level", r.levelName)
            Fact("HTTPS only", if (r.httpsOnly) "On" else "Off")
            Fact("Threat lists", if (r.listsUpdated > 0) "Updated ${ago(r.listsUpdated)} · ${"%,d".format(r.knownThreats)} known threats" else if (r.threatService) "Not downloaded yet" else "Built-in checks only (no threat service set up)")
            Fact("Last check", if (r.lastScan > 0) ago(r.lastScan) else "Not yet")
            Fact("PC", "${r.pcName} · ${platformName(r.platform)} · Nude ${r.nudeVersion}", last = true)
        }
        Spacer(Modifier.height(20.dp))
        Text("All activity", color = D.Text, fontSize = 17.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(10.dp))
        if (r.events.isEmpty()) Text("Nothing yet.", color = D.Faint, fontSize = 13.sp)
        r.events.forEach { e ->
            val (ic, c) = iconFor(e.type)
            Row1(ic, c, e.detail, listOfNotNull(e.host, ago(e.t)).joinToString(" · "), null)
            Spacer(Modifier.height(8.dp))
        }
        Spacer(Modifier.height(120.dp))
    }
}

private fun platformName(p: String) = when (p) { "win32" -> "Windows"; "darwin" -> "macOS"; "linux" -> "Linux"; else -> p }

@Composable
private fun StatTile(label: String, n: Int, c: Color) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(D.Card).border(1.dp, D.CardEdge, RoundedCornerShape(18.dp)).padding(16.dp)) {
        val shown by animateFloatAsState(n.toFloat(), tween(900, easing = FastOutSlowInEasing), label = "count")
        Text("%,d".format(shown.toInt()), color = c, fontSize = 26.sp, fontWeight = FontWeight.Medium)
        Text(label, color = D.Muted, fontSize = 12.5.sp)
    }
}

@Composable
private fun Card(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(D.Card).border(1.dp, D.CardEdge, RoundedCornerShape(18.dp)).padding(horizontal = 16.dp, vertical = 6.dp), content = content)
}

@Composable
private fun Fact(k: String, v: String, last: Boolean = false) {
    Column(Modifier.fillMaxWidth().padding(vertical = 10.dp)) {
        Text(k, color = D.Faint, fontSize = 12.sp)
        Text(v, color = D.Text, fontSize = 14.sp)
    }
    if (!last) HorizontalDivider(color = D.CardEdge)
}

// ------------------------------------------------------------------ pieces

@Composable
private fun TopBar(r: Report?, onMenu: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(44.dp).clip(CircleShape).background(Color(0x14FFFFFF)).border(1.dp, Color(0x1FFFFFFF), CircleShape).clickable(onClick = onMenu), contentAlignment = Alignment.Center) {
            Canvas(Modifier.size(16.dp, 12.dp)) {
                drawLine(D.Text, Offset(0f, size.height * 0.2f), Offset(size.width, size.height * 0.2f), strokeWidth = 2.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round)
                drawLine(D.Text, Offset(0f, size.height * 0.8f), Offset(size.width * 0.65f, size.height * 0.8f), strokeWidth = 2.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round)
            }
        }
        Spacer(Modifier.weight(1f))
        val bg = r?.color?.let { runCatching { Color(android.graphics.Color.parseColor(it)) }.getOrNull() } ?: D.Electric
        Box(Modifier.size(44.dp).clip(CircleShape).border(2.dp, Brush.linearGradient(listOf(Color(0xFF8FB0FF), Color(0xFF3346FF))), CircleShape).padding(3.dp).clip(CircleShape).background(bg), contentAlignment = Alignment.Center) {
            if (r?.initials.isNullOrBlank()) Image(painterResource(os.rovian.core.R.drawable.ic_rovian_mark), null, Modifier.size(16.dp, 18.dp))
            else Text(r!!.initials!!, color = Color.White, fontWeight = FontWeight.Medium, fontSize = 14.sp)
        }
    }
}

@Composable
private fun HeroCard(title: String, body: String, button: String, onButton: () -> Unit, footer: String? = null) {
    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(D.Hero).border(1.dp, Color(0x55FFFFFF), RoundedCornerShape(24.dp))) {
        // A soft frosted sheen across the top, like light on matte glass.
        Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Color(0x33FFFFFF), Color.Transparent))))
        Sculpture(Modifier.align(Alignment.CenterEnd).padding(end = 6.dp).size(138.dp))
        Column(Modifier.padding(start = 18.dp, top = 18.dp, bottom = 18.dp, end = 120.dp)) {
            Text(title, color = Color.White, fontSize = 19.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(6.dp))
            Text(body, color = Color.White.copy(alpha = 0.86f), fontSize = 12.sp, lineHeight = 17.sp)
            Spacer(Modifier.height(16.dp))
            PillButton(button, onButton)
            footer?.let { Text(it, color = Color.White.copy(alpha = 0.75f), fontSize = 10.5.sp, modifier = Modifier.padding(top = 10.dp), maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
    }
}

@Composable
private fun PillButton(text: String, onClick: () -> Unit) {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.95f else 1f, spring(dampingRatio = 0.6f, stiffness = Spring.StiffnessMedium), label = "p")
    Box(Modifier.graphicsLayer { scaleX = scale; scaleY = scale }.clip(RoundedCornerShape(50))
        .background(Brush.verticalGradient(listOf(Color(0xFF4A5CFF), Color(0xFF2235E6))))
        .border(1.dp, Color(0x66FFFFFF), RoundedCornerShape(50))
        .clickable(src, indication = null, onClick = onClick).padding(horizontal = 18.dp, vertical = 10.dp)) {
        Text(text, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}

/** The glossy 3D form from the design: three twisted petals that turn slowly and float. */
@Composable
private fun Sculpture(modifier: Modifier) {
    val t = rememberInfiniteTransition(label = "sculpture")
    val turn by t.animateFloat(0f, 360f, infiniteRepeatable(tween(24_000, easing = LinearEasing)), label = "turn")
    val bob by t.animateFloat(-5f, 5f, infiniteRepeatable(tween(2800, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "bob")
    Canvas(modifier.graphicsLayer { translationY = bob * density }) {
        val c = center
        val r = size.minDimension / 2f
        drawOval(Color(0x33000030), topLeft = Offset(c.x - r * 0.62f, c.y + r * 0.78f), size = Size(r * 1.24f, r * 0.2f))
        for (i in 0 until 3) {
            rotate(turn + i * 120f, c) {
                val p = Path().apply {
                    moveTo(c.x, c.y)
                    cubicTo(c.x + r * 0.95f, c.y - r * 1.0f, c.x + r * 1.08f, c.y + r * 0.18f, c.x + r * 0.22f, c.y + r * 0.6f)
                    cubicTo(c.x - r * 0.04f, c.y + r * 0.7f, c.x - r * 0.16f, c.y + r * 0.22f, c.x, c.y)
                    close()
                }
                drawPath(p, Brush.linearGradient(listOf(Color(0xFF1A2FE8), Color(0xFF4F6BFF), Color(0xFFC9D6FF)), start = Offset(c.x, c.y - r), end = Offset(c.x + r, c.y + r * 0.6f)))
                drawPath(p, Brush.radialGradient(listOf(Color.White.copy(alpha = 0.6f), Color.Transparent), center = Offset(c.x + r * 0.55f, c.y - r * 0.28f), radius = r * 0.5f))
                drawPath(p, Color.White.copy(alpha = 0.25f), style = Stroke(width = 1.2f))
            }
        }
        drawCircle(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.55f), Color.Transparent), center = c, radius = r * 0.32f), radius = r * 0.32f, center = c)
    }
}

@Composable
private fun Chip(label: String, n: Int, icon: ImageVector, c: Color, on: Boolean, onClick: () -> Unit) {
    val bg by animateFloatAsState(if (on) 0.2f else 0f, tween(220), label = "chip")
    Row(Modifier.clip(RoundedCornerShape(50)).background(c.copy(alpha = bg)).border(1.dp, c.copy(alpha = 0.75f), RoundedCornerShape(50)).clickable(onClick = onClick)
        .padding(horizontal = 14.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = c, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(6.dp))
        Text(label, color = c, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.width(6.dp))
        Text("%,d".format(n), color = c.copy(alpha = 0.8f), fontSize = 12.sp)
    }
}

@Composable
private fun Row1(icon: ImageVector, c: Color, text: String, sub: String?, onClick: (() -> Unit)?) {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.98f else 1f, spring(dampingRatio = 0.7f), label = "row")
    Row(Modifier.fillMaxWidth().graphicsLayer { scaleX = scale; scaleY = scale }.clip(RoundedCornerShape(16.dp)).background(D.Card).border(1.dp, D.CardEdge, RoundedCornerShape(16.dp))
        .let { if (onClick != null) it.clickable(src, indication = null, onClick = onClick) else it }.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(12.dp)).background(c.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) { Icon(icon, null, tint = c, modifier = Modifier.size(18.dp)) }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(text, color = D.Text, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            sub?.let { Text(it, color = D.Faint, fontSize = 11.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        if (onClick != null) { Spacer(Modifier.width(8.dp)); Icon(Icons.Default.ArrowForward, null, tint = D.Muted, modifier = Modifier.size(16.dp).rotate(-45f)) }
    }
}

@Composable
private fun BottomNav(modifier: Modifier, tab: Tab, busy: Boolean, onHome: () -> Unit, onCenter: () -> Unit, onReport: () -> Unit) {
    Box(modifier.fillMaxWidth().height(130.dp).background(Brush.verticalGradient(listOf(Color.Transparent, D.Ink.copy(alpha = 0.92f), D.Ink))), contentAlignment = Alignment.BottomCenter) {
        Row(Modifier.navigationBarsPadding().padding(bottom = 14.dp).clip(RoundedCornerShape(50)).background(Color(0xE61A1C30)).border(1.dp, Color(0x1FFFFFFF), RoundedCornerShape(50)).padding(6.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            NavDot(Icons.Default.Home, tab == Tab.HOME, onHome, "Home")
            val spin = rememberInfiniteTransition(label = "spin")
            val a by spin.animateFloat(0f, 360f, infiniteRepeatable(tween(1000, easing = LinearEasing)), label = "a")
            Box(Modifier.size(52.dp).drawBehind { drawCircle(Brush.radialGradient(listOf(Color(0x993346FF), Color.Transparent)), radius = size.minDimension) }
                .clip(CircleShape).background(Brush.linearGradient(listOf(Color(0xFF5B6CFF), Color(0xFF2234F0)))).border(1.dp, Color(0x66FFFFFF), CircleShape)
                .clickable(onClick = onCenter), contentAlignment = Alignment.Center) {
                Icon(Icons.Default.Refresh, "Refresh report", tint = Color.White, modifier = Modifier.size(22.dp).rotate(if (busy) a else 0f))
            }
            NavDot(Icons.Default.List, tab == Tab.REPORT, onReport, "Report")
        }
    }
}

@Composable
private fun NavDot(icon: ImageVector, on: Boolean, onClick: () -> Unit, label: String) {
    val bg by animateFloatAsState(if (on) 0.16f else 0.06f, tween(220), label = "nav")
    Box(Modifier.size(44.dp).clip(CircleShape).background(Color.White.copy(alpha = bg)).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(icon, label, tint = if (on) Color.White else D.Muted, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun MenuSheet(model: DefenderModel, onScan: () -> Unit, onUnlink: () -> Unit) {
    var confirm by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp).padding(bottom = 28.dp)) {
        Text("Linked PC", color = D.Faint, fontSize = 12.sp)
        Text(model.pc?.pcName ?: "", color = D.Text, fontSize = 20.sp, fontWeight = FontWeight.Medium)
        model.pc?.let { Text("Linked ${DateFormat.getDateInstance(DateFormat.MEDIUM).format(it.linkedAt)}", color = D.Muted, fontSize = 13.sp) }
        Spacer(Modifier.height(18.dp))
        SheetRow(Icons.Default.Refresh, "Link a different PC") { onScan() }
        SheetRow(Icons.Default.Close, if (confirm) "Tap again to unlink" else "Unlink this PC", D.Pink) { if (confirm) onUnlink() else confirm = true }
        Spacer(Modifier.height(14.dp))
        Text("Rovian Defender reads an encrypted report from Nude on your PC over your own Wi-Fi. The key is only in the code you scanned.",
            color = D.Faint, fontSize = 12.sp, lineHeight = 17.sp)
    }
}

@Composable
private fun SheetRow(icon: ImageVector, text: String, tint: Color = D.Text, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(vertical = 14.dp, horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(14.dp))
        Text(text, color = tint, fontSize = 15.sp)
    }
}

@Composable
private fun EventSheet(e: DEvent) {
    val (ic, c) = iconFor(e.type)
    Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp).padding(bottom = 30.dp)) {
        Box(Modifier.size(48.dp).clip(RoundedCornerShape(16.dp)).background(c.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) { Icon(ic, null, tint = c) }
        Spacer(Modifier.height(14.dp))
        Text(title(e.type), color = D.Text, fontSize = 20.sp, fontWeight = FontWeight.Medium)
        Text(DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(e.t), color = D.Muted, fontSize = 13.sp)
        Spacer(Modifier.height(14.dp))
        Text(e.detail, color = D.Text, fontSize = 15.sp, lineHeight = 22.sp)
        e.host?.let { Spacer(Modifier.height(12.dp)); Text("Site: $it", color = D.Muted, fontSize = 13.sp) }
        e.category?.let { Text("Category: ${it.replace('-', ' ')}", color = D.Muted, fontSize = 13.sp) }
    }
}

private fun ago(t: Long): String {
    if (t <= 0) return "never"
    val s = (System.currentTimeMillis() - t) / 1000
    return when {
        s < 45 -> "just now"
        s < 3600 -> "${s / 60} min ago"
        s < 86_400 -> "${s / 3600} h ago"
        else -> DateFormat.getDateInstance(DateFormat.MEDIUM).format(t)
    }
}

@Suppress("unused") private val keepPoppins = Poppins
