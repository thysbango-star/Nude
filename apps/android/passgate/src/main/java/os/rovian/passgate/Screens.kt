package os.rovian.passgate

import android.os.Build
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import os.rovian.core.Rise
import os.rovian.core.glass.GlassButton
import os.rovian.core.glass.GlassCard
import os.rovian.core.glass.LocalGlass
import os.rovian.core.glass.SectionTitle
import os.rovian.core.glass.StatusPill
import os.rovian.core.glass.glassEdge
import os.rovian.core.phoneName
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** Facts about this phone that PassGate's protection depends on, read when the screen opens. */
data class PhoneFacts(val screenLock: Boolean, val biometrics: Boolean, val hardwareKey: Boolean?)

/** One line of the security checklist. `ready == null` means it isn't available yet (and says so). */
data class Check(val icon: ImageVector, val title: String, val detail: String, val ready: Boolean?)

fun checks(vault: Vault, id: Identity?, phone: PhoneFacts): List<Check> {
    val a = id?.account
    return listOf(
        if (a?.provider == "rovian") Check(Icons.Default.CheckCircle, "Verified Rovian identity", a.username?.let { "$it@rovian.cloud" } ?: a.rovianId ?: a.email, true)
        else Check(Icons.Default.Person, "Verified Rovian identity", "In Nude on your PC: Account → Continue with Rovian", false),
        Check(Icons.Default.Lock, "Screen lock on this phone", if (phone.screenLock) "Set" else "Set a PIN, pattern or password in Android settings", phone.screenLock),
        Check(Icons.Default.Lock, "PassGate lock", if (vault.lockEnabled && phone.screenLock) (if (phone.biometrics) "Fingerprint, face or PIN to open" else "Your PIN to open")
            else if (!phone.screenLock) "Needs a screen lock first" else "Turn it on in Settings", vault.lockEnabled && phone.screenLock),
        Check(Icons.Default.Build, "Key in secure hardware", when (phone.hardwareKey) {
            true -> "PassGate's data key can't leave this phone's secure chip"
            false -> "This phone keeps the key in software (Android Keystore)"
            null -> "Android didn't say where the key is kept"
        }, phone.hardwareKey == true),
        Check(Icons.Default.Home, "Linked to ${id?.pcName ?: "your PC"}", if (id != null) "Checked ${ago(vault.identityAt)}" else "Scan the code in Nude", vault.pc != null && id != null),
        Check(Icons.Default.Info, "Rovian Defender", if (id?.devices?.any { it.app == "defender" } == true) "Linked to the same PC. It sees PassGate's status, never its keys"
            else "Not linked. In Nude: Connect your phone → Rovian Defender", id?.devices?.any { it.app == "defender" } == true),
        Check(Icons.Default.Star, "Passkeys", "Not available yet: PassGate doesn't hold passkeys in this version", null),
        Check(Icons.Default.Share, "Website sign-in requests", "Not available yet: needs Rovian's sign-in request service", null),
    )
}

// ------------------------------------------------------------------ home

@Composable
fun HomeScreen(vault: Vault, id: Identity, phone: PhoneFacts, busy: Boolean, error: String?, onScan: () -> Unit, onSecurity: () -> Unit, onTab: (Int) -> Unit, onSettings: () -> Unit) {
    val c = LocalGlass.current
    val a = id.account
    val list = checks(vault, id, phone)
    val ready = list.count { it.ready == true }
    val needs = list.count { it.ready == false }
    Page {
        Header(today(), "${greeting()}, ${a?.name?.split(' ')?.firstOrNull() ?: "there"}", Icons.Default.Settings, "Settings", onSettings)
        Rise(40) {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                IdentityOrb(a?.initials ?: "?", a?.color?.let(::parseColor), if (needs == 0) c.electric else c.warn,
                    listOf(OrbNode(Icons.Default.Home, id.pcName, true), OrbNode(Icons.Default.Phone, "This phone", true),
                        OrbNode(Icons.Default.Info, "Rovian Defender", id.devices.any { it.app == "defender" })),
                    Modifier.size(250.dp))
                Text(a?.name ?: "No one is signed in", color = c.ink, fontSize = 22.sp, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center)
                Text(when {
                    a == null -> "Sign in to Nude on ${id.pcName}, then refresh"
                    a.username != null -> "${a.username}@rovian.cloud"
                    else -> a.email
                }, color = c.muted, fontSize = 13.5.sp, textAlign = TextAlign.Center)
                Spacer(Modifier.height(8.dp))
                when {
                    a == null -> StatusPill("Not signed in on your PC", c.warn)
                    a.provider == "rovian" -> StatusPill("Verified Rovian ID", c.good)
                    else -> StatusPill("Nude account, not Rovian", c.warn)
                }
            }
        }
        error?.let { Notice(it) }

        SectionTitle("Security", action = "Details", onAction = onSecurity)
        Rise(80) {
            GlassCard(Modifier.fillMaxWidth(), onClick = onSecurity) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(if (needs == 0) "Everything available is set up" else "$needs ${if (needs == 1) "thing needs" else "things need"} your attention", color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                        Text("$ready of ${list.count { it.ready != null }} ready · ${list.count { it.ready == null }} not available yet", color = c.muted, fontSize = 12.5.sp)
                    }
                    Icon(Icons.Default.KeyboardArrowRight, null, tint = c.muted)
                }
                Spacer(Modifier.height(10.dp))
                list.filter { it.ready != null }.take(4).forEach { MiniCheck(it) }
            }
        }

        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Stat("${id.accounts.size.coerceAtLeast(if (a != null) 1 else 0)}", "Accounts", Modifier.weight(1f)) { onTab(1) }
            Stat("${1 + id.devices.size}", "Trusted devices", Modifier.weight(1f)) { onTab(2) }
            Stat("—", "Passkeys", Modifier.weight(1f), note = "Not yet") { onSecurity() }
        }

        SectionTitle("Sign-in requests")
        GlassCard(Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconChip(Icons.Default.Share, false)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("No requests", color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                    Text("Websites can't ask PassGate to approve a sign-in yet. That needs Rovian's sign-in request service; until then, sign in on your PC with Sign in with Rovian.",
                        color = c.muted, fontSize = 12.5.sp, lineHeight = 17.sp)
                }
            }
        }

        SectionTitle("Recent activity", action = "See all", onAction = { onTab(3) })
        val recent = merged(id, vault).take(3)
        GlassCard(Modifier.fillMaxWidth(), padding = 6.dp) {
            if (recent.isEmpty()) Text("Nothing yet.", color = c.muted, fontSize = 13.sp, modifier = Modifier.padding(10.dp))
            recent.forEachIndexed { i, e -> EventRow(e, last = i == recent.lastIndex) }
        }

        Spacer(Modifier.height(18.dp))
        GlassButton(if (busy) "Checking…" else "Scan a code from Nude", onScan, Modifier.fillMaxWidth(), icon = Icons.Default.Search, quiet = true, enabled = !busy)
        Foot("Updated ${ago(vault.identityAt)} from ${id.pcName}. PassGate holds your verified identity, never passwords or sign-in tokens.")
    }
}

// ------------------------------------------------------------------ accounts

@Composable
fun AccountsScreen(id: Identity, busy: Boolean, onRefresh: () -> Unit) {
    val c = LocalGlass.current
    val a = id.account
    Page {
        Header("Accounts", "Your identity", Icons.Default.Refresh, "Refresh", onRefresh)
        if (a != null) Rise(40) {
            GlassCard(Modifier.fillMaxWidth(), strong = true, tint = if (a.provider == "rovian") c.electric else c.warn) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Avatar(a.initials, a.color, 52)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(a.name, color = c.ink, fontSize = 18.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(if (a.provider == "rovian") "Rovian Account" else "Nude account on ${id.pcName}", color = c.muted, fontSize = 12.5.sp)
                    }
                    StatusPill(if (a.provider == "rovian") "Verified" else "Local", if (a.provider == "rovian") c.good else c.warn)
                }
                Spacer(Modifier.height(12.dp))
                a.username?.let { Fact("Rovian ID", "$it@rovian.cloud") }
                if (a.email.isNotBlank()) Fact("Email", a.email + if (a.emailVerified) " · verified" else "")
                Fact("Signed in on", "${id.pcName} · Nude ${id.nudeVersion}")
                if (a.lastSignIn > 0) Fact("Last sign-in", ago(a.lastSignIn))
            }
        } else Notice("No one is signed in to Nude on ${id.pcName}. Sign in there, then refresh.")

        val others = id.accounts.filter { !it.current }
        if (others.isNotEmpty()) {
            SectionTitle("Also on ${id.pcName}")
            GlassCard(Modifier.fillMaxWidth(), padding = 6.dp) {
                others.forEachIndexed { i, x ->
                    Line(if (x.provider == "rovian") Icons.Default.CheckCircle else Icons.Default.Person, x.name, x.id,
                        if (x.provider == "rovian") "Rovian" else "Nude", x.provider == "rovian", last = i == others.lastIndex)
                }
            }
        }

        SectionTitle("Add an account")
        GlassCard(Modifier.fillMaxWidth(), padding = 6.dp) {
            Line(Icons.Default.AccountCircle, "Rovian Account", "Sign in with Rovian in Nude on your PC; PassGate picks it up on the next refresh", if (a?.provider == "rovian") "Added" else "On your PC", a?.provider == "rovian")
            Line(Icons.Default.Email, "Google", "Needs setup: Rovian hasn't registered PassGate with Google yet, so it can't add Google accounts", "Not available", null)
            Line(Icons.Default.Star, "Passkeys", "Not available yet in this version of PassGate", "Not available", null, last = true)
        }
        Spacer(Modifier.height(16.dp))
        GlassButton(if (busy) "Refreshing…" else "Refresh from ${id.pcName}", onRefresh, Modifier.fillMaxWidth(), icon = Icons.Default.Refresh, enabled = !busy)
        Foot("Accounts come from Nude on your PC, sent encrypted with the key in the code you scanned.")
    }
}

// ------------------------------------------------------------------ devices

@Composable
fun DevicesScreen(vault: Vault, id: Identity, phone: PhoneFacts, busy: Boolean, onRefresh: () -> Unit, onScan: () -> Unit, onUnlink: () -> Unit) {
    val c = LocalGlass.current
    var confirm by remember { mutableStateOf(false) }
    val pc = vault.pc
    Page {
        Header("Trusted devices", "Where you're signed in", Icons.Default.Refresh, "Refresh", onRefresh)
        Rise(40) {
            GlassCard(Modifier.fillMaxWidth(), strong = true) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconChip(Icons.Default.Home, true)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(id.pcName, color = c.ink, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                        Text(listOf(id.platform.ifBlank { null }, "Nude ${id.nudeVersion}").filterNotNull().joinToString(" · "), color = c.muted, fontSize = 12.5.sp)
                    }
                    StatusPill("Linked", c.good)
                }
                Spacer(Modifier.height(10.dp))
                pc?.let { Fact("Linked", DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(it.linkedAt))) }
                Fact("Last checked", ago(vault.identityAt))
                Fact("Connection", "Your Wi-Fi only, encrypted end to end")
            }
        }
        Spacer(Modifier.height(12.dp))
        GlassCard(Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconChip(Icons.Default.Phone, true)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(remember { phoneName() }, color = c.ink, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                    Text("This phone · Android ${Build.VERSION.RELEASE}", color = c.muted, fontSize = 12.5.sp)
                }
                StatusPill("This phone", c.cyan)
            }
            Spacer(Modifier.height(10.dp))
            Fact("Unlock", if (vault.lockEnabled && phone.screenLock) (if (phone.biometrics) "Fingerprint, face or PIN" else "PIN") else "Off")
            Fact("Data key", when (phone.hardwareKey) { true -> "Secure hardware"; false -> "Android Keystore (software)"; null -> "Android Keystore" })
        }
        val others = id.devices
        if (others.isNotEmpty()) {
            SectionTitle("Other phones linked to ${id.pcName}")
            GlassCard(Modifier.fillMaxWidth(), padding = 6.dp) {
                others.forEachIndexed { i, d ->
                    Line(Icons.Default.Phone, d.name, "${if (d.app == "defender") "Rovian Defender" else "PassGate"} · seen ${ago(d.lastSeen)}",
                        if (d.app == "defender") "Defender" else "PassGate", true, last = i == others.lastIndex)
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            GlassButton(if (busy) "Checking…" else "Refresh", onRefresh, Modifier.weight(1f), icon = Icons.Default.Refresh, enabled = !busy)
            GlassButton("New code", onScan, Modifier.weight(1f), icon = Icons.Default.Search, quiet = true)
        }
        Spacer(Modifier.height(10.dp))
        GlassButton(if (confirm) "Tap again to unlink" else "Unlink this phone", { if (confirm) onUnlink() else confirm = true }, Modifier.fillMaxWidth(), icon = Icons.Default.ExitToApp, quiet = true)
        Foot("Unlinking removes this phone from Nude on ${id.pcName} and deletes the link key here. You can link again with a new code.")
    }
}

// ------------------------------------------------------------------ activity

/** An event with where it came from. */
data class Shown(val e: IEvent, val fromPc: Boolean)

fun merged(id: Identity, vault: Vault): List<Shown> =
    (id.events.map { Shown(it, true) } + vault.local.map { Shown(it, false) }).sortedByDescending { it.e.t }

@Composable
fun ActivityScreen(id: Identity, vault: Vault) {
    val c = LocalGlass.current
    var filter by remember { mutableIntStateOf(0) }
    val all = merged(id, vault)
    val shown = when (filter) {
        1 -> all.filter { it.fromPc && it.e.kind in setOf("rovian-signin", "signin", "signup", "signout", "switch", "website-rovian") }
        2 -> all.filter { problem(it.e.kind) }
        3 -> all.filter { !it.fromPc }
        else -> all
    }
    Page {
        Header("Activity", "Everything that happened", null, "", {})
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("All", "Sign-ins", "Problems", "This phone").forEachIndexed { i, t -> FilterChip(t, filter == i) { filter = i } }
        }
        Spacer(Modifier.height(14.dp))
        GlassCard(Modifier.fillMaxWidth(), padding = 6.dp) {
            if (shown.isEmpty()) Text(if (filter == 2) "No problems recorded." else "Nothing here yet.", color = c.muted, fontSize = 13.sp, modifier = Modifier.padding(12.dp))
            shown.forEachIndexed { i, e -> EventRow(e, last = i == shown.lastIndex) }
        }
        Foot("Sign-ins come from Nude on ${id.pcName}; the rest happened in PassGate on this phone.")
    }
}

// ------------------------------------------------------------------ welcome, security, settings

@Composable
fun WelcomeScreen(busy: Boolean, error: String?, relink: Boolean, onScan: () -> Unit) {
    val c = LocalGlass.current
    Page(bottom = 40.dp) {
        Spacer(Modifier.height(20.dp))
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            IdentityOrb("", null, c.electric, listOf(OrbNode(Icons.Default.Home, "Your PC", false), OrbNode(Icons.Default.Phone, "This phone", true), OrbNode(Icons.Default.Lock, "PassGate", true)),
                Modifier.size(240.dp))
            Text("PassGate", color = c.ink, fontSize = 30.sp, fontWeight = FontWeight.Medium)
            Text("Your Rovian identity, on your phone.", color = c.muted, fontSize = 15.sp, textAlign = TextAlign.Center)
        }
        Spacer(Modifier.height(22.dp))
        Rise(60) {
            GlassCard(Modifier.fillMaxWidth(), padding = 6.dp) {
                Line(Icons.Default.Home, "Open Nude on your PC", "Signed in with your Rovian Account", "1", true)
                Line(Icons.Default.Menu, "Menu → Connect your phone", "Choose PassGate", "2", true)
                Line(Icons.Default.Search, "Scan the code", "PassGate checks it with your PC", "3", true, last = true)
            }
        }
        error?.let { Notice(it) }
        Spacer(Modifier.height(18.dp))
        GlassButton(if (busy) "Signing in…" else if (relink) "Scan a new code" else "Scan code on your PC", onScan, Modifier.fillMaxWidth(), icon = Icons.Default.Search, enabled = !busy)
        Foot("PassGate keeps only your verified identity, encrypted on this phone. Never passwords or sign-in tokens, and none of it is shared with Rovian Defender or Nebula.")
    }
}

@Composable
fun SecuritySheet(vault: Vault, id: Identity?, phone: PhoneFacts) {
    val c = LocalGlass.current
    val list = checks(vault, id, phone)
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 30.dp)) {
        Text("How PassGate protects you", color = c.ink, fontSize = 20.sp, fontWeight = FontWeight.Medium)
        Text("Checked on this phone just now.", color = c.muted, fontSize = 12.5.sp)
        Spacer(Modifier.height(12.dp))
        list.forEachIndexed { i, x ->
            Line(x.icon, x.title, x.detail, when (x.ready) { true -> "Ready"; false -> "Needs setup"; null -> "Not yet" }, x.ready, last = i == list.lastIndex)
        }
        Spacer(Modifier.height(14.dp))
        Text("What PassGate never shares", color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
        Text("PassGate doesn't hold passwords. Its link key and data stay encrypted on this phone. Rovian Defender and Nebula never receive them: Defender can only see whether PassGate is linked.",
            color = c.muted, fontSize = 12.5.sp, lineHeight = 18.sp, modifier = Modifier.padding(top = 4.dp))
    }
}

@Composable
fun SettingsSheet(vault: Vault, phone: PhoneFacts, theme: String, onTheme: (String) -> Unit, onLockNow: () -> Unit, onSignOut: () -> Unit) {
    val c = LocalGlass.current
    var confirm by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp).padding(bottom = 30.dp)) {
        Text("Settings", color = c.ink, fontSize = 20.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(14.dp))
        Text("Appearance", color = c.faint, fontSize = 12.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
            listOf("system" to "System", "dark" to "Dark", "light" to "Light").forEach { (k, v) -> FilterChip(v, theme == k) { onTheme(k) } }
        }
        Spacer(Modifier.height(18.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Lock PassGate", color = c.ink, fontWeight = FontWeight.Medium)
                Text(if (phone.screenLock) "Ask for your fingerprint, face or PIN whenever PassGate opens" else "Set a screen lock on this phone first", fontSize = 12.5.sp, color = c.muted)
            }
            Switch(vault.lockEnabled && phone.screenLock, { vault.setLock(it) }, enabled = phone.screenLock)
        }
        HorizontalDivider(Modifier.padding(vertical = 14.dp), color = c.ink.copy(alpha = 0.08f))
        if (vault.lockEnabled && phone.screenLock) SheetRow(Icons.Default.Lock, "Lock now", c.ink, onLockNow)
        if (vault.pc != null) SheetRow(Icons.Default.ExitToApp, if (confirm) "Tap again to sign out" else "Sign out and unlink", c.danger) { if (confirm) onSignOut() else confirm = true }
        Spacer(Modifier.height(10.dp))
        Text("PassGate's data is encrypted with a key in this phone's ${if (phone.hardwareKey == true) "secure hardware" else "Android Keystore"}. It holds your verified identity from Nude and the link key from the code you scanned.",
            fontSize = 12.sp, color = c.muted, lineHeight = 17.sp)
    }
}

@Composable
fun LockScreen(phase: LockPhase, message: String?, onUnlock: () -> Unit) {
    val c = LocalGlass.current
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        BiometricOrb(phase, Modifier.size(200.dp).clip(CircleShape).clickable(enabled = phase != LockPhase.ASKING && phase != LockPhase.SUCCESS, onClick = onUnlock))
        Spacer(Modifier.height(18.dp))
        Text(when (phase) { LockPhase.SUCCESS -> "Unlocked"; LockPhase.ASKING -> "Confirm it's you"; else -> "PassGate is locked" }, color = c.ink, fontSize = 24.sp, fontWeight = FontWeight.Medium)
        Text(message ?: "Use your fingerprint, face or PIN to open it.", color = c.muted, fontSize = 14.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp))
        Spacer(Modifier.height(26.dp))
        AnimatedVisibility(phase == LockPhase.IDLE || phase == LockPhase.FAILED) { GlassButton("Unlock", onUnlock, Modifier.widthIn(min = 200.dp), icon = Icons.Default.Lock) }
    }
}

/** While PassGate pairs with the PC: a real network step, shown until it answers. */
@Composable
fun LinkingOverlay(pcHint: String?) {
    val c = LocalGlass.current
    Box(Modifier.fillMaxSize().background(c.bgBottom.copy(alpha = 0.86f)).clickable(enabled = true, onClick = {}), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            IdentityOrb("", null, c.cyan, listOf(OrbNode(Icons.Default.Home, "PC", true), OrbNode(Icons.Default.Phone, "Phone", true)), Modifier.size(200.dp))
            Text("Checking the code with ${pcHint ?: "your PC"}…", color = c.ink, fontSize = 16.sp, fontWeight = FontWeight.Medium)
            Text("Over your Wi-Fi, encrypted with the key in the code.", color = c.muted, fontSize = 13.sp)
        }
    }
}

// ------------------------------------------------------------------ pieces

@Composable
private fun Page(bottom: androidx.compose.ui.unit.Dp = 120.dp, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(horizontal = 20.dp)) {
        Spacer(Modifier.height(10.dp))
        content()
        Spacer(Modifier.height(bottom))
    }
}

@Composable
private fun Header(small: String, big: String, icon: ImageVector?, label: String, onClick: () -> Unit) {
    val c = LocalGlass.current
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        GateMark(36)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(small, color = c.muted, fontSize = 12.sp)
            Text(big, color = c.ink, fontSize = 18.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (icon != null) Box(Modifier.size(40.dp).clip(CircleShape).background(c.glassStrong).border(1.dp, glassEdge(), CircleShape).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
            Icon(icon, label, tint = c.ink, modifier = Modifier.size(19.dp))
        }
    }
}

@Composable
fun Avatar(initials: String, color: String?, size: Int) {
    val c = LocalGlass.current
    val bg = color?.let(::parseColor) ?: c.electric
    Box(Modifier.size(size.dp).clip(CircleShape).background(androidx.compose.ui.graphics.Brush.linearGradient(listOf(bg, c.sapphire))).border(1.5.dp, glassEdge(), CircleShape), contentAlignment = Alignment.Center) {
        Text(initials, color = Color.White, fontSize = (size * 0.32f).sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun IconChip(icon: ImageVector, on: Boolean) {
    val c = LocalGlass.current
    Box(Modifier.size(36.dp).clip(RoundedCornerShape(11.dp)).background(if (on) c.electric.copy(alpha = 0.9f) else c.glassStrong).border(1.dp, glassEdge(), RoundedCornerShape(11.dp)),
        contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = if (on) Color.White else c.muted, modifier = Modifier.size(18.dp))
    }
}

/** A row with an icon, two lines and a status. `ok == null` = not available yet. */
@Composable
private fun Line(icon: ImageVector, title: String, sub: String, status: String, ok: Boolean?, last: Boolean = false) {
    val c = LocalGlass.current
    Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
        IconChip(icon, ok == true)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(sub, color = c.muted, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.width(8.dp))
        StatusPill(status, when (ok) { true -> c.good; false -> c.warn; null -> c.faint })
    }
    if (!last) HorizontalDivider(Modifier.padding(horizontal = 10.dp), color = c.ink.copy(alpha = 0.07f))
}

@Composable
private fun MiniCheck(x: Check) {
    val c = LocalGlass.current
    Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(if (x.ready == true) c.good else c.warn))
        Spacer(Modifier.width(10.dp))
        Text(x.title, color = c.ink, fontSize = 13.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(if (x.ready == true) "Ready" else "Needs setup", color = if (x.ready == true) c.good else c.warn, fontSize = 12.sp)
    }
}

@Composable
private fun Stat(value: String, label: String, modifier: Modifier, note: String? = null, onClick: () -> Unit) {
    val c = LocalGlass.current
    GlassCard(modifier, onClick = onClick, padding = 14.dp) {
        Text(value, color = c.ink, fontSize = 24.sp, fontWeight = FontWeight.Medium)
        Text(label, color = c.muted, fontSize = 11.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        note?.let { Text(it, color = c.faint, fontSize = 10.5.sp) }
    }
}

@Composable
private fun Fact(label: String, value: String) {
    val c = LocalGlass.current
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(label, color = c.faint, fontSize = 12.5.sp, modifier = Modifier.width(110.dp))
        Text(value, color = c.ink, fontSize = 12.5.sp, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun EventRow(s: Shown, last: Boolean) {
    val e = s.e
    Line(eventIcon(e.kind), e.detail.ifBlank { label(e.kind) }, "${ago(e.t)} · ${if (s.fromPc) "Nude on your PC" else "This phone"}", label(e.kind), !problem(e.kind), last)
}

@Composable
fun FilterChip(text: String, on: Boolean, onClick: () -> Unit) {
    val c = LocalGlass.current
    Text(text, color = if (on) Color.White else c.ink, fontSize = 12.5.sp, fontWeight = if (on) FontWeight.Medium else FontWeight.Normal,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) c.electric else c.glass).border(1.dp, glassEdge(), RoundedCornerShape(50))
            .clickable(onClick = onClick).padding(horizontal = 13.dp, vertical = 7.dp))
}

@Composable
private fun Notice(text: String) {
    val c = LocalGlass.current
    Text(text, color = c.ink, fontSize = 13.sp, lineHeight = 18.sp, modifier = Modifier.padding(top = 14.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp))
        .background(c.warn.copy(alpha = 0.16f)).border(1.dp, c.warn.copy(alpha = 0.35f), RoundedCornerShape(16.dp)).padding(12.dp))
}

@Composable
private fun Foot(text: String) {
    val c = LocalGlass.current
    Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.Top) {
        Icon(Icons.Default.Lock, null, tint = c.faint, modifier = Modifier.size(13.dp).padding(top = 2.dp))
        Spacer(Modifier.width(6.dp))
        Text(text, color = c.faint, fontSize = 11.5.sp, lineHeight = 16.sp)
    }
}

@Composable
private fun SheetRow(icon: ImageVector, text: String, tint: Color, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(vertical = 14.dp, horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(14.dp))
        Text(text, color = tint, fontSize = 15.sp)
    }
}

// ------------------------------------------------------------------ helpers

fun parseColor(s: String): Color? = runCatching { Color(android.graphics.Color.parseColor(s)) }.getOrNull()

private fun problem(kind: String) = kind.endsWith("failed") || kind == "code-rejected" || kind == "unlock-failed"

private fun eventIcon(kind: String): ImageVector = when (kind) {
    "rovian-signin", "signin", "signup", "linked" -> Icons.Default.CheckCircle
    "signout", "unlinked" -> Icons.Default.ExitToApp
    "switch" -> Icons.Default.Person
    "website-rovian" -> Icons.Default.Share
    "unlocked", "lock-on", "lock-off" -> Icons.Default.Lock
    else -> if (problem(kind)) Icons.Default.Warning else Icons.Default.Info
}

private fun label(kind: String) = when (kind) {
    "rovian-signin" -> "Rovian"; "signin" -> "Sign-in"; "signup" -> "New"; "signout" -> "Signed out"; "switch" -> "Switch"
    "website-rovian" -> "Website"; "linked" -> "Linked"; "unlinked" -> "Unlinked"; "unlocked" -> "Unlocked"
    "lock-on", "lock-off" -> "Setting"; "code-rejected" -> "Rejected"; "unlock-failed" -> "Failed"
    else -> if (problem(kind)) "Failed" else "Event"
}

fun today(): String = SimpleDateFormat("EEEE, MMM d", Locale.getDefault()).format(Date())

fun greeting(): String = when (Calendar.getInstance().get(Calendar.HOUR_OF_DAY)) {
    in 5..11 -> "Good morning"; in 12..17 -> "Good afternoon"; else -> "Good evening"
}

fun ago(t: Long): String {
    if (t <= 0) return "never"
    val s = (System.currentTimeMillis() - t) / 1000
    return when {
        s < 45 -> "just now"
        s < 3600 -> "${s / 60} min ago"
        s < 86_400 -> "${s / 3600} h ago"
        else -> DateFormat.getDateInstance(DateFormat.MEDIUM).format(t)
    }
}
