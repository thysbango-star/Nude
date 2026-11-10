@file:OptIn(ExperimentalMaterial3Api::class)

package os.rovian.defender.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import os.rovian.core.Poppins
import os.rovian.core.Rise
import os.rovian.core.glass.GlassButton
import os.rovian.core.glass.GlassCard
import os.rovian.core.glass.LocalGlass
import os.rovian.core.glass.SectionTitle
import os.rovian.core.glass.StatusPill
import os.rovian.defender.apps.AppAnalyzer
import os.rovian.defender.apps.AppReport
import os.rovian.defender.apps.Sensitive
import os.rovian.defender.core.Assessment
import os.rovian.defender.core.Category
import os.rovian.defender.core.Protection
import os.rovian.defender.core.SecurityEvent
import os.rovian.defender.core.Severity
import os.rovian.defender.core.protectionOf
import os.rovian.defender.device.DeviceChecks
import os.rovian.defender.files.FileReport
import java.text.DateFormat

// ------------------------------------------------------------------ shared bits

@Composable
fun sevColor(s: Severity): Color {
    val c = LocalGlass.current
    return when (s) { Severity.HIGH -> c.danger; Severity.MEDIUM -> c.warn; Severity.LOW -> c.cyan; Severity.INFO -> c.good }
}

@Composable
fun assessColor(a: Assessment): Color {
    val c = LocalGlass.current
    return when (a) { Assessment.DANGEROUS -> c.danger; Assessment.SUSPICIOUS -> c.warn; Assessment.SAFE_INDICATORS -> c.good; Assessment.UNKNOWN -> c.muted }
}

fun ago(t: Long): String {
    if (t <= 0) return "never"
    val s = (System.currentTimeMillis() - t) / 1000
    return when { s < 45 -> "just now"; s < 3600 -> "${s / 60} min ago"; s < 86_400 -> "${s / 3600} h ago"; else -> DateFormat.getDateInstance(DateFormat.MEDIUM).format(t) }
}

fun openSettings(ctx: Context, action: String, pkg: String? = null) {
    val i = Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (pkg != null) i.data = Uri.fromParts("package", pkg, null)
    try { ctx.startActivity(i) } catch (e: Exception) { ctx.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

@Composable
fun ScreenColumn(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(horizontal = 20.dp), content = {
        Spacer(Modifier.height(10.dp)); content(); Spacer(Modifier.height(130.dp))
    })
}

@Composable
fun Header(title: String, subtitle: String?, onSettings: (() -> Unit)? = null) {
    val c = LocalGlass.current
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, color = c.ink, fontSize = 26.sp, fontWeight = FontWeight.Medium, fontFamily = Poppins)
            subtitle?.let { Text(it, color = c.muted, fontSize = 13.sp) }
        }
        if (onSettings != null) Box(Modifier.size(44.dp).clip(CircleShape).background(c.glassStrong).border(1.dp, os.rovian.core.glass.glassEdge(), CircleShape).clickable(onClick = onSettings), contentAlignment = Alignment.Center) {
            Icon(Icons.Default.Settings, "Settings", tint = c.ink, modifier = Modifier.size(20.dp))
        }
    }
}

@Composable
fun IconTile(icon: ImageVector, color: Color, size: Int = 38) {
    Box(Modifier.size(size.dp).clip(RoundedCornerShape(12.dp)).background(color.copy(alpha = 0.16f)), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = color, modifier = Modifier.size((size * 0.5f).dp))
    }
}

@Composable
fun Chip(text: String, on: Boolean, onClick: () -> Unit) {
    val c = LocalGlass.current
    Text(text, color = if (on) Color.White else c.ink, fontSize = 13.sp, fontWeight = if (on) FontWeight.Medium else FontWeight.Normal,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) c.electric else c.glass).border(1.dp, if (on) SolidColor(Color.Transparent) else SolidColor(c.edgeLo.copy(alpha = 0.4f)), RoundedCornerShape(50))
            .clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp))
}

// ------------------------------------------------------------------ home

@Composable
fun HomeScreen(s: DefenderState, onScan: () -> Unit, onFile: () -> Unit, onTab: (Int) -> Unit, onSettings: () -> Unit, onEvent: (SecurityEvent) -> Unit) {
    val c = LocalGlass.current
    val r = s.scan
    val state = protectionOf(r)
    ScreenColumn {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Image(painterResource(os.rovian.core.R.drawable.ic_rovian_mark), null, Modifier.size(26.dp, 30.dp))
            Spacer(Modifier.width(10.dp))
            Text("Rovian Defender", color = c.ink, fontSize = 17.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
            Box(Modifier.size(42.dp).clip(CircleShape).background(c.glassStrong).border(1.dp, os.rovian.core.glass.glassEdge(), CircleShape).clickable(onClick = onSettings), contentAlignment = Alignment.Center) {
                Icon(Icons.Default.Settings, "Settings", tint = c.ink, modifier = Modifier.size(19.dp))
            }
        }
        Box(Modifier.fillMaxWidth().height(270.dp), contentAlignment = Alignment.Center) {
            GlassShield(state, s.scanning, s.scanProgress, Modifier.size(260.dp))
        }
        Text(if (s.scanning) "Scanning your phone" else state.title, color = c.ink, fontSize = 24.sp, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        Text(when {
            s.scanning -> s.scanStep
            r == null -> "Run a scan to check your settings and apps."
            else -> "Last scan ${ago(r.time)} · ${r.checksPassing} of ${r.checks.size} settings OK · ${r.apps.size} apps checked"
        }, color = c.muted, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 4.dp))
        Spacer(Modifier.height(16.dp))
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            GlassButton(if (s.scanning) "Scanning…" else "Scan device", onScan, icon = Icons.Default.Search, enabled = !s.scanning)
        }
        Spacer(Modifier.height(18.dp))
        val pcReport = s.pc.report
        val privacyApps = r?.apps?.count { a -> AppAnalyzer.sensitive(a.facts).any { it == Sensitive.CAMERA || it == Sensitive.MICROPHONE || it == Sensitive.LOCATION } }
        val tiles = listOf(
            Tile("Device health", r?.let { "${it.checksPassing}/${it.checks.size}" } ?: "–", r?.let { if (it.checksPassing == it.checks.size) "All settings OK" else "${it.checks.size - it.checksPassing} to fix" } ?: "Not scanned", Icons.Default.Phone, if (r != null && r.checksPassing < r.checks.size) c.warn else c.good) { onTab(0) },
            Tile("Threats detected", r?.threats?.toString() ?: "–", if (r == null) "Not scanned" else if (r.threats == 0) "None on threat lists" else "Remove them now", Icons.Default.Warning, if ((r?.threats ?: 0) > 0) c.danger else c.good) { onTab(1) },
            Tile("Suspicious apps", r?.appsNeedingAttention?.size?.toString() ?: "–", if (r == null) "Not scanned" else "of ${r.apps.size} apps", Icons.Default.Info, if ((r?.appsNeedingAttention?.size ?: 0) > 0) c.warn else c.good) { onTab(1) },
            Tile("Websites blocked", pcReport?.stats?.blockedSites?.toString() ?: "–", if (pcReport != null) "by Nude on ${pcReport.pcName}" else "Link Nude to see", Icons.Default.Lock, c.cyan) { onTab(2) },
            Tile("Privacy", privacyApps?.toString() ?: "–", "apps can use camera, mic or location", Icons.Default.Person, c.electric) { onTab(3) },
            Tile("Latest scan", r?.let { ago(it.time) } ?: "Never", "Daily scan runs on its own", Icons.Default.Refresh, c.ice) { onScan() },
        )
        tiles.chunked(2).forEachIndexed { row, pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                pair.forEachIndexed { i, t -> Rise((row * 2 + i) * 50, Modifier.weight(1f)) { StatTile(t) } }
            }
            Spacer(Modifier.height(12.dp))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            GlassCard(Modifier.weight(1f), onClick = { onTab(2) }) {
                IconTile(Icons.Default.Share, c.cyan); Spacer(Modifier.height(10.dp))
                Text("Check a link", color = c.ink, fontWeight = FontWeight.Medium, fontSize = 14.sp)
                Text("Paste or share it here", color = c.muted, fontSize = 12.sp)
            }
            GlassCard(Modifier.weight(1f), onClick = onFile) {
                IconTile(Icons.Default.Search, c.electric); Spacer(Modifier.height(10.dp))
                Text(if (s.fileBusy) "Scanning file…" else "Scan a file", color = c.ink, fontWeight = FontWeight.Medium, fontSize = 14.sp)
                Text("Pick a download or document", color = c.muted, fontSize = 12.sp)
            }
        }
        val recent = s.events.events.filter { !it.resolved }.take(4)
        SectionTitle("Recent security activity", action = "See all", onAction = { onTab(4) })
        if (recent.isEmpty()) Text("Nothing needs your attention.", color = c.muted, fontSize = 13.sp)
        recent.forEachIndexed { i, e -> key(e.id) { Rise(i * 50) { EventRow(e, compact = true) { onEvent(e) } }; Spacer(Modifier.height(10.dp)) } }
    }
}

data class Tile(val label: String, val value: String, val sub: String, val icon: ImageVector, val color: Color, val onClick: () -> Unit)

@Composable
fun StatTile(t: Tile) {
    val c = LocalGlass.current
    GlassCard(Modifier.fillMaxWidth(), onClick = t.onClick, padding = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconTile(t.icon, t.color, 32)
            Spacer(Modifier.weight(1f))
            Text(t.value, color = c.ink, fontSize = 22.sp, fontWeight = FontWeight.Medium, maxLines = 1)
        }
        Spacer(Modifier.height(10.dp))
        Text(t.label, color = c.ink, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        Text(t.sub, color = c.muted, fontSize = 11.5.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

// ------------------------------------------------------------------ device + apps

@Composable
fun AppsScreen(s: DefenderState, onScan: () -> Unit, onApp: (AppReport) -> Unit) {
    val c = LocalGlass.current
    val ctx = LocalContext.current
    var filter by remember { mutableStateOf("attention") }
    val r = s.scan
    ScreenColumn {
        Header("Device & apps", r?.let { "${it.apps.size} apps checked ${ago(it.time)}" } ?: "Not scanned yet")
        if (r == null) {
            Spacer(Modifier.height(16.dp))
            GlassCard(Modifier.fillMaxWidth()) {
                Text("Scan your phone to see how its settings and apps are doing.", color = c.ink, fontSize = 14.sp)
                Spacer(Modifier.height(12.dp)); GlassButton(if (s.scanning) "Scanning…" else "Scan device", onScan, enabled = !s.scanning)
            }
            return@ScreenColumn
        }
        SectionTitle("Device settings")
        GlassCard(Modifier.fillMaxWidth().animateContentSize(), padding = 6.dp) {
            r.checks.forEachIndexed { i, ch ->
                var open by remember(ch.id) { mutableStateOf(!ch.ok) }
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable { open = !open }.padding(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconTile(if (ch.ok) Icons.Default.CheckCircle else Icons.Default.Warning, if (ch.ok) c.good else sevColor(ch.severity), 32)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(ch.title, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                            Text(ch.status, color = c.muted, fontSize = 12.sp)
                        }
                        if (!ch.ok) StatusPill(ch.severity.label, sevColor(ch.severity))
                    }
                    AnimatedVisibility(open, enter = expandVertically(spring(dampingRatio = 0.85f, stiffness = Spring.StiffnessMediumLow)) + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                        Column(Modifier.padding(start = 44.dp, top = 8.dp)) {
                            Text(ch.explanation, color = c.ink, fontSize = 13.sp, lineHeight = 18.sp)
                            if (!ch.ok) Text(ch.action, color = c.muted, fontSize = 12.5.sp, modifier = Modifier.padding(top = 4.dp))
                            if (!ch.ok && ch.settings != null) { Spacer(Modifier.height(10.dp)); GlassButton("Open Settings", { DeviceChecks.intentFor(ch)?.let { runCatching { ctx.startActivity(it) } } }, quiet = true) }
                        }
                    }
                }
                if (i < r.checks.lastIndex) HorizontalDivider(color = c.edgeLo.copy(alpha = 0.18f), modifier = Modifier.padding(horizontal = 10.dp))
            }
        }
        SectionTitle("Apps")
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("Needs a look (${r.appsNeedingAttention.size})", filter == "attention") { filter = "attention" }
            Chip("Not from a store (${r.apps.count { !it.fromStore }})", filter == "outside") { filter = "outside" }
            Chip("All (${r.apps.size})", filter == "all") { filter = "all" }
        }
        Spacer(Modifier.height(12.dp))
        val list = when (filter) { "attention" -> r.appsNeedingAttention; "outside" -> r.apps.filter { !it.fromStore }; else -> r.apps }
        if (list.isEmpty()) Text(if (filter == "attention") "No app needs a look right now." else "None.", color = c.muted, fontSize = 13.sp)
        list.take(200).forEach { a ->
            key(a.facts.packageName) {
                GlassCard(Modifier.fillMaxWidth(), onClick = { onApp(a) }, padding = 14.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconTile(if (a.knownBad != null) Icons.Default.Warning else Icons.Default.Info, sevColor(a.severity), 34)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(a.facts.label, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(AppAnalyzer.storeName(a.facts)?.let { "From $it" } ?: "Not from an app store", color = c.muted, fontSize = 12.sp)
                        }
                        StatusPill(if (a.severity == Severity.INFO) "OK" else a.severity.label, sevColor(a.severity))
                    }
                    a.reasons.firstOrNull { !it.startsWith("Installed from outside") }?.let { Text(it, color = c.muted, fontSize = 12.5.sp, modifier = Modifier.padding(top = 8.dp), maxLines = 2, overflow = TextOverflow.Ellipsis) }
                }
                Spacer(Modifier.height(10.dp))
            }
        }
    }
}

@Composable
fun AppSheet(a: AppReport) {
    val c = LocalGlass.current
    val ctx = LocalContext.current
    Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp).padding(bottom = 30.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconTile(Icons.Default.Info, sevColor(a.severity), 44)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(a.facts.label, color = c.ink, fontSize = 19.sp, fontWeight = FontWeight.Medium)
                Text(a.facts.packageName, color = c.muted, fontSize = 12.sp)
            }
            StatusPill(if (a.severity == Severity.INFO) "OK" else a.severity.label, sevColor(a.severity))
        }
        Spacer(Modifier.height(14.dp))
        if (a.reasons.isEmpty()) Text("Nothing stands out about this app.", color = c.ink, fontSize = 14.sp)
        a.reasons.forEach { Row(Modifier.padding(vertical = 4.dp)) { Text("•", color = c.cyan); Spacer(Modifier.width(8.dp)); Text(it, color = c.ink, fontSize = 14.sp, lineHeight = 20.sp) } }
        val groups = AppAnalyzer.sensitive(a.facts)
        if (groups.isNotEmpty()) Text("Has access to: ${groups.joinToString(", ") { it.label.lowercase() }}.", color = c.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 10.dp))
        Text("Installed ${DateFormat.getDateInstance(DateFormat.MEDIUM).format(a.facts.firstInstall)} · built for API ${a.facts.targetSdk}", color = c.faint, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            GlassButton("Permissions", { openSettings(ctx, Settings.ACTION_APPLICATION_DETAILS_SETTINGS, a.facts.packageName) }, quiet = true)
            GlassButton("Uninstall", { runCatching { ctx.startActivity(Intent(Intent.ACTION_DELETE, Uri.fromParts("package", a.facts.packageName, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } })
        }
    }
}

// ------------------------------------------------------------------ web protection

@Composable
fun WebScreen(s: DefenderState, incoming: String?, onLinkPc: () -> Unit) {
    val c = LocalGlass.current
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    var follow by remember { mutableStateOf(false) }
    LaunchedEffect(incoming) { if (!incoming.isNullOrBlank()) { text = incoming; s.checkLink(incoming, false) } }
    ScreenColumn {
        Header("Web protection", "Check links and messages before you open them")
        Spacer(Modifier.height(14.dp))
        GlassCard(Modifier.fillMaxWidth(), strong = true) {
            Text("Link or message", color = c.muted, fontSize = 12.sp)
            Spacer(Modifier.height(6.dp))
            BasicTextField(text, { text = it }, textStyle = TextStyle(color = c.ink, fontSize = 15.sp, fontFamily = Poppins), cursorBrush = SolidColor(c.cyan),
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(14.dp)).background(c.glass).padding(12.dp),
                decorationBox = { inner -> if (text.isEmpty()) Text("Paste a link, or a whole message with links in it", color = c.faint, fontSize = 14.sp); inner() })
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 10.dp)) {
                Switch(follow, { follow = it })
                Spacer(Modifier.width(8.dp))
                Text("Also check where it redirects (contacts the site, never opens it)", color = c.muted, fontSize = 12.sp, modifier = Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
            GlassButton(if (s.linkBusy) "Checking…" else "Check", { scope.launch { s.checkLink(text, follow) } }, icon = Icons.Default.Search, enabled = text.isNotBlank() && !s.linkBusy)
            s.linkError?.let { Text(it, color = c.warn, fontSize = 12.5.sp, modifier = Modifier.padding(top = 8.dp)) }
        }
        AnimatedVisibility(s.link != null, enter = expandVertically(spring(dampingRatio = 0.85f)) + fadeIn(), exit = shrinkVertically() + fadeOut()) {
            s.link?.let { r ->
                GlassCard(Modifier.fillMaxWidth().padding(top = 14.dp), tint = assessColor(r.assessment)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconTile(if (r.assessment == Assessment.SAFE_INDICATORS) Icons.Default.CheckCircle else if (r.assessment == Assessment.UNKNOWN) Icons.Default.Info else Icons.Default.Warning, assessColor(r.assessment), 40)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(r.headline, color = c.ink, fontSize = 17.sp, fontWeight = FontWeight.Medium)
                            Text(r.host, color = c.muted, fontSize = 12.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        StatusPill(r.assessment.label, assessColor(r.assessment))
                    }
                    Spacer(Modifier.height(10.dp))
                    r.indicators.forEach { ind ->
                        Row(Modifier.padding(vertical = 3.dp)) {
                            Icon(if (ind.bad) Icons.Default.Warning else Icons.Default.Check, null, tint = if (ind.bad) c.warn else c.good, modifier = Modifier.size(15.dp).padding(top = 2.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(ind.text, color = c.ink, fontSize = 13.sp, lineHeight = 18.sp)
                        }
                    }
                    if (r.redirects.isNotEmpty()) Text("Redirects: ${r.redirects.joinToString(" → ")}", color = c.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
                    else if (r.checkedOnline) Text("No redirects.", color = c.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
                    Text(r.advice, color = c.ink, fontSize = 13.5.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 10.dp))
                }
            }
        }
        s.message?.let { m ->
            GlassCard(Modifier.fillMaxWidth().padding(top = 14.dp)) {
                Text("The message: ${m.assessment}", color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                m.indicators.forEach { Text("• $it", color = c.ink, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp)) }
                Text(m.summary, color = c.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
            }
        }
        SectionTitle("Nude on your PC")
        PcCard(s, onLinkPc)
        SectionTitle("Threat intelligence")
        ListsCard(s)
        Text("Rovian Defender checks links you give it. Protection inside every app (a VPN-based filter) is planned and isn't switched on in this version.", color = c.faint, fontSize = 12.sp, modifier = Modifier.padding(top = 12.dp))
    }
}

@Composable
fun PcCard(s: DefenderState, onLink: () -> Unit) {
    val c = LocalGlass.current
    val scope = rememberCoroutineScope()
    val r = s.pc.report
    GlassCard(Modifier.fillMaxWidth()) {
        if (s.pc.pc == null) {
            Text("See what Rovian Defender blocks in Nude Browser on your computer.", color = c.ink, fontSize = 14.sp)
            Text("In Nude: menu → Connect your phone → Rovian Defender, then scan the code.", color = c.muted, fontSize = 12.5.sp, modifier = Modifier.padding(top = 4.dp))
            Spacer(Modifier.height(12.dp)); GlassButton(if (s.pc.busy) "Linking…" else "Scan code", onLink, quiet = true)
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(s.pc.pc?.pcName ?: "", color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                    Text(r?.let { "${it.levelName} · updated ${ago(s.pc.reportAt)}" } ?: "Waiting for the first report", color = c.muted, fontSize = 12.sp)
                }
                GlassButton(if (s.pc.busy) "…" else "Refresh", { scope.launch { s.pc.refresh() } }, quiet = true)
            }
            r?.let {
                Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    MiniStat("Sites", it.stats.blockedSites + it.stats.warnedSites, Modifier.weight(1f))
                    MiniStat("Trackers", it.stats.blockedTrackers, Modifier.weight(1f))
                    MiniStat("Downloads", it.stats.blockedDownloads + it.stats.flaggedDownloads, Modifier.weight(1f))
                }
                it.events.take(3).forEach { e -> Text("• ${e.detail}", color = c.ink, fontSize = 12.5.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp)) }
            }
            s.pc.error?.let { Text(it, color = c.warn, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp)) }
            Text("Unlink", color = c.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp).clip(RoundedCornerShape(6.dp)).clickable { scope.launch { s.pc.unlink() } }.padding(4.dp))
        }
    }
}

@Composable
fun MiniStat(label: String, n: Int, modifier: Modifier) {
    val c = LocalGlass.current
    Column(modifier.clip(RoundedCornerShape(14.dp)).background(c.glass).padding(10.dp)) {
        Text("%,d".format(n), color = c.ink, fontSize = 18.sp, fontWeight = FontWeight.Medium)
        Text(label, color = c.muted, fontSize = 11.sp)
    }
}

@Composable
fun ListsCard(s: DefenderState) {
    val c = LocalGlass.current
    val scope = rememberCoroutineScope()
    var url by remember { mutableStateOf(s.lists.url) }
    GlassCard(Modifier.fillMaxWidth()) {
        Text(if (s.lists.updated > 0) "${"%,d".format(s.lists.domains)} known dangerous sites · updated ${ago(s.lists.updated)}" else "Built-in checks only", color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
        Text("Add your Rovian threat-intel server to check links, apps and files against its lists.", color = c.muted, fontSize = 12.5.sp, modifier = Modifier.padding(top = 2.dp))
        Spacer(Modifier.height(8.dp))
        BasicTextField(url, { url = it }, singleLine = true, textStyle = TextStyle(color = c.ink, fontSize = 14.sp), cursorBrush = SolidColor(c.cyan),
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.glass).padding(12.dp),
            decorationBox = { inner -> if (url.isEmpty()) Text("https://threats.example.com", color = c.faint, fontSize = 14.sp); inner() })
        Spacer(Modifier.height(10.dp))
        GlassButton(if (s.listsBusy) "Updating…" else "Update lists", { s.lists.chooseUrl(url); scope.launch { s.updateLists() } }, quiet = true, enabled = !s.listsBusy)
        s.listsMessage?.let { Text(it, color = c.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp)) }
    }
}

// ------------------------------------------------------------------ privacy

@Composable
fun PrivacyScreen(s: DefenderState, onScan: () -> Unit) {
    val c = LocalGlass.current
    val ctx = LocalContext.current
    val r = s.scan
    ScreenColumn {
        Header("Privacy", "Which apps can reach what's sensitive")
        if (r == null) {
            Spacer(Modifier.height(16.dp))
            GlassCard(Modifier.fillMaxWidth()) {
                Text("Scan your phone to see which apps hold access to your camera, microphone, location and more.", color = c.ink, fontSize = 14.sp)
                Spacer(Modifier.height(12.dp)); GlassButton("Scan device", onScan, enabled = !s.scanning)
            }
            return@ScreenColumn
        }
        val outsideWithLocation = r.apps.count { !it.fromStore && Sensitive.LOCATION in AppAnalyzer.sensitive(it.facts) }
        Spacer(Modifier.height(14.dp))
        GlassCard(Modifier.fillMaxWidth(), tint = c.electric) {
            Text("Recommendations", color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            val recs = buildList {
                if (outsideWithLocation > 0) add("$outsideWithLocation app${if (outsideWithLocation == 1) "" else "s"} from outside an app store can use your location. Check whether they need it.")
                val bg = r.apps.count { "android.permission.ACCESS_BACKGROUND_LOCATION" in it.facts.granted }
                if (bg > 0) add("$bg app${if (bg == 1) "" else "s"} can use your location all the time, even when closed.")
                val sms = r.apps.count { Sensitive.SMS in AppAnalyzer.sensitive(it.facts) && !it.fromStore }
                if (sms > 0) add("$sms app${if (sms == 1) "" else "s"} from outside a store can read your texts.")
                if (isEmpty()) add("Nothing stands out. Review the lists below now and then.")
            }
            recs.forEach { Text("• $it", color = c.ink, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp), lineHeight = 18.sp) }
            Spacer(Modifier.height(10.dp))
            GlassButton("Android privacy dashboard", { openSettings(ctx, "android.settings.PRIVACY_SETTINGS") }, quiet = true)
        }
        Text("Android shows which apps used these recently in its own privacy dashboard; other apps can't read that history.", color = c.faint, fontSize = 11.5.sp, modifier = Modifier.padding(top = 8.dp))
        Sensitive.entries.forEach { g ->
            val holders = r.apps.filter { g in AppAnalyzer.sensitive(it.facts) }
            var open by remember(g) { mutableStateOf(false) }
            Spacer(Modifier.height(12.dp))
            GlassCard(Modifier.fillMaxWidth().animateContentSize(), onClick = { open = !open }, padding = 14.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconTile(when (g) { Sensitive.CAMERA, Sensitive.FILES -> Icons.Default.Face; Sensitive.MICROPHONE -> Icons.Default.Call; Sensitive.LOCATION -> Icons.Default.LocationOn; Sensitive.CONTACTS -> Icons.Default.Person; Sensitive.SMS -> Icons.Default.Email; Sensitive.CALLS -> Icons.Default.Call }, c.cyan, 34)
                    Spacer(Modifier.width(12.dp))
                    Text(g.label, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                    Text("${holders.size} app${if (holders.size == 1) "" else "s"}", color = c.muted, fontSize = 13.sp)
                }
                if (open) {
                    if (holders.isEmpty()) Text("No app has this access.", color = c.muted, fontSize = 12.5.sp, modifier = Modifier.padding(top = 10.dp))
                    holders.forEach { a ->
                        Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(a.facts.label, color = c.ink, fontSize = 13.5.sp)
                                Text(AppAnalyzer.storeName(a.facts)?.let { "From $it" } ?: "Not from an app store", color = if (a.fromStore) c.muted else c.warn, fontSize = 11.5.sp)
                            }
                            Text("Manage", color = c.cyan, fontSize = 13.sp, modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { openSettings(ctx, Settings.ACTION_APPLICATION_DETAILS_SETTINGS, a.facts.packageName) }.padding(6.dp))
                        }
                    }
                }
            }
        }
        SectionTitle("Tracker protection")
        GlassCard(Modifier.fillMaxWidth()) {
            val pr = s.pc.report
            Text(if (pr != null) "Nude blocked ${"%,d".format(pr.stats.blockedTrackers)} trackers on ${pr.pcName}." else "Tracker blocking works in Nude Browser. Link Nude on your PC to see it here.", color = c.ink, fontSize = 13.5.sp)
        }
    }
}

// ------------------------------------------------------------------ activity centre

@Composable
fun ActivityScreen(s: DefenderState, onEvent: (SecurityEvent) -> Unit) {
    val c = LocalGlass.current
    var filter by remember { mutableStateOf<Category?>(null) }
    var showResolved by remember { mutableStateOf(false) }
    ScreenColumn {
        Header("Activity", "${s.events.events.count { !it.resolved }} open · ${s.events.events.size} in history")
        Spacer(Modifier.height(12.dp))
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("All", filter == null) { filter = null }
            listOf(Category.THREAT, Category.WEB, Category.APP, Category.FILE, Category.DEVICE, Category.PRIVACY, Category.PASSGATE).forEach { k -> Chip(k.label, filter == k) { filter = k } }
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
            Switch(showResolved, { showResolved = it }); Spacer(Modifier.width(8.dp)); Text("Show resolved", color = c.muted, fontSize = 13.sp)
        }
        val list = s.events.events.filter { (filter == null || it.category == filter) && (showResolved || !it.resolved) }
        Spacer(Modifier.height(8.dp))
        if (list.isEmpty()) Text(if (filter == Category.PASSGATE) "PassGate alerts appear here once PassGate is linked to Rovian Defender." else "Nothing here.", color = c.muted, fontSize = 13.sp)
        list.forEach { e -> key(e.id) { EventRow(e, compact = false) { onEvent(e) }; Spacer(Modifier.height(10.dp)) } }
    }
}

@Composable
fun EventRow(e: SecurityEvent, compact: Boolean, onClick: () -> Unit) {
    val c = LocalGlass.current
    GlassCard(Modifier.fillMaxWidth(), onClick = onClick, padding = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(width = 4.dp, height = 34.dp).clip(RoundedCornerShape(2.dp)).background(sevColor(e.severity)))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(e.title, color = if (e.resolved) c.muted else c.ink, fontSize = 13.5.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text("${e.category.label} · ${e.severity.label} · ${ago(e.time)}${if (e.resolved) " · Resolved" else ""}", color = c.muted, fontSize = 11.5.sp)
            }
        }
        if (!compact) Text(e.action, color = c.muted, fontSize = 12.5.sp, modifier = Modifier.padding(top = 8.dp, start = 16.dp), maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun EventSheet(s: DefenderState, e: SecurityEvent, onDone: () -> Unit) {
    val c = LocalGlass.current
    Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp).padding(bottom = 30.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            StatusPill(e.severity.label, sevColor(e.severity)); Spacer(Modifier.width(8.dp)); StatusPill(e.category.label, c.cyan)
            Spacer(Modifier.weight(1f)); StatusPill(if (e.resolved) "Resolved" else "Open", if (e.resolved) c.good else c.warn)
        }
        Spacer(Modifier.height(12.dp))
        Text(e.title, color = c.ink, fontSize = 19.sp, fontWeight = FontWeight.Medium)
        Text("${e.subject} · ${DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(e.time)}", color = c.muted, fontSize = 12.5.sp)
        Spacer(Modifier.height(12.dp))
        Text("Why", color = c.faint, fontSize = 12.sp); Text(e.explanation.ifBlank { "No more detail." }, color = c.ink, fontSize = 14.sp, lineHeight = 20.sp)
        Spacer(Modifier.height(10.dp))
        Text("What to do", color = c.faint, fontSize = 12.sp); Text(e.action, color = c.ink, fontSize = 14.sp, lineHeight = 20.sp)
        Spacer(Modifier.height(16.dp))
        GlassButton(if (e.resolved) "Reopen" else "Mark as resolved", { s.events.setResolved(e.id, !e.resolved); onDone() }, quiet = e.resolved)
    }
}

@Composable
fun FileSheet(r: FileReport) {
    val c = LocalGlass.current
    Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp).padding(bottom = 30.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconTile(if (r.assessment == Assessment.DANGEROUS || r.assessment == Assessment.SUSPICIOUS) Icons.Default.Warning else Icons.Default.CheckCircle, assessColor(r.assessment), 44)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(r.name, color = c.ink, fontSize = 17.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(listOfNotNull(r.realType, r.size?.let { "%,d bytes".format(it) }).joinToString(" · "), color = c.muted, fontSize = 12.sp)
            }
        }
        Spacer(Modifier.height(10.dp))
        StatusPill(r.assessment.label, assessColor(r.assessment))
        Spacer(Modifier.height(10.dp))
        r.findings.forEach { Text("• $it", color = c.ink, fontSize = 13.5.sp, lineHeight = 19.sp, modifier = Modifier.padding(top = 4.dp)) }
        Text(r.advice, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 12.dp))
        r.sha256?.let { Text("SHA-256 $it", color = c.faint, fontSize = 10.5.sp, modifier = Modifier.padding(top = 10.dp)) }
    }
}
