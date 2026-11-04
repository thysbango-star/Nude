@file:OptIn(ExperimentalMaterial3Api::class)

package os.rovian.passgate

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import os.rovian.core.LinkCode
import os.rovian.core.LinkError
import os.rovian.core.PhoneLinkClient
import os.rovian.core.Rise
import os.rovian.core.phoneName
import os.rovian.core.poppinsTypography
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** PassGate's palette: dusky rose glass, warm ink, and one near-black for the main action. */
private object P {
    val Top = Color(0xFF9A6C77)
    val Mid = Color(0xFFC3959A)
    val Bottom = Color(0xFFF3DDD5)
    val Glass = Color(0x2EFFFFFF)
    val GlassStrong = Color(0x47FFFFFF)
    val Edge = Color(0x59FFFFFF)
    val OnRose = Color(0xFFFFFFFF)
    val OnRoseMuted = Color(0xD9FFFFFF)
    val Ink = Color(0xFF2A1C22)
    val InkMuted = Color(0xFF7C646B)
    val Action = Color(0xFF17121A)
    val Ok = Color(0xFF3FBF7F)
    val Warn = Color(0xFFF2B562)
}

private enum class Screen { HOME, PROTECTION, ACTIVITY }

/** One line of the protection checklist. */
private data class Item(val icon: ImageVector, val title: String, val sub: String, val status: String, val ok: Boolean, val soon: Boolean = false)

class PassGateActivity : FragmentActivity() {
    private lateinit var vault: Vault
    private val unlocked = mutableStateOf(false)
    private val busy = mutableStateOf(false)
    private val error = mutableStateOf<String?>(null)
    private val client = PhoneLinkClient()
    /** The QR scanner covers PassGate for a moment; don't lock for that. */
    private var scanning = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        vault = Vault(applicationContext)
        setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = P.Action, background = P.Bottom, surface = Color.White), typography = poppinsTypography()) {
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to P.Top, 0.45f to P.Mid, 1f to P.Bottom))) {
                    val open = unlocked.value || !vault.lockEnabled || !deviceSecure()
                    AnimatedContent(open, transitionSpec = {
                        (fadeIn(tween(260)) + scaleIn(tween(340, easing = FastOutSlowInEasing), initialScale = 0.96f)) togetherWith fadeOut(tween(140))
                    }, label = "lock") { o ->
                        if (o) App(vault, busy.value, error.value, onLink = ::link, onRefresh = { lifecycleScope.launch { refresh() } },
                            onSignOut = ::signOut, onLock = { unlocked.value = false; unlock() }, deviceSecure = deviceSecure(), clearError = { error.value = null; scanning = true })
                        else LockScreen(::unlock)
                    }
                }
            }
        }
        if (vault.lockEnabled && deviceSecure()) unlock()
        lifecycleScope.launch {
            while (true) {
                if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) && vault.pc != null) refresh()
                delay(60_000)
            }
        }
    }

    override fun onStop() {
        super.onStop()
        // Lock again when PassGate leaves the screen.
        if (vault.lockEnabled && deviceSecure() && !isChangingConfigurations && !scanning) unlocked.value = false
    }

    override fun onRestart() {
        super.onRestart()
        scanning = false
        if (vault.lockEnabled && deviceSecure() && !unlocked.value) unlock()
    }

    private fun deviceSecure() = (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isDeviceSecure

    /** Fingerprint, face or the phone's PIN before anything in PassGate is shown. */
    private fun unlock() {
        val allowed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) BIOMETRIC_STRONG or DEVICE_CREDENTIAL else BIOMETRIC_WEAK or DEVICE_CREDENTIAL
        if (BiometricManager.from(this).canAuthenticate(allowed) != BiometricManager.BIOMETRIC_SUCCESS) { unlocked.value = !deviceSecure(); return }
        BiometricPrompt(this, mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { unlocked.value = true }
        }).authenticate(BiometricPrompt.PromptInfo.Builder().setTitle("Unlock PassGate").setSubtitle("Protected by Rovian Defender").setAllowedAuthenticators(allowed).build())
    }

    /** Sign in: the code on the PC carries the key; PassGate pairs, then reads the verified identity. */
    private fun link(text: String) {
        val code = LinkCode.parse(text)
        if (code == null) { error.value = "That isn't a code from Nude. On your PC, open Nude's menu and choose Connect your phone."; return }
        if (code.app != "passgate") { error.value = "That code is for Rovian Defender. On your PC, choose PassGate and scan again."; return }
        lifecycleScope.launch {
            busy.value = true; error.value = null
            try {
                val pc = withContext(Dispatchers.IO) { client.pair(code, phoneName()) }
                vault.link(pc)
                refresh()
            } catch (e: LinkError) { error.value = e.userMessage } catch (e: Exception) { error.value = "Signing in didn't work. Please try again." }
            busy.value = false
        }
    }

    private suspend fun refresh() {
        val pc = vault.pc ?: return
        busy.value = true
        try {
            val (j, updated) = withContext(Dispatchers.IO) { client.fetch(pc, "identity") }
            vault.setIdentity(j)
            if (updated.hosts != pc.hosts) vault.updatePc(updated)
            error.value = null
        } catch (e: LinkError) {
            error.value = e.userMessage
            if (e.code == "unlinked") vault.signOut()
        } catch (e: Exception) {
            error.value = "PassGate couldn't read from your PC. Try again in a moment."
        } finally { busy.value = false }
    }

    private fun signOut() {
        val pc = vault.pc
        lifecycleScope.launch {
            if (pc != null) withContext(Dispatchers.IO) { client.unlink(pc) }
            vault.signOut()
        }
    }
}

// ------------------------------------------------------------------ screens

@Composable
private fun App(vault: Vault, busy: Boolean, error: String?, onLink: (String) -> Unit, onRefresh: () -> Unit, onSignOut: () -> Unit, onLock: () -> Unit, deviceSecure: Boolean, clearError: () -> Unit) {
    var screen by remember { mutableStateOf(Screen.HOME) }
    var settings by remember { mutableStateOf(false) }
    val scan = rememberLauncherForActivityResult(ScanContract()) { r -> r.contents?.let(onLink) }
    val startScan = {
        clearError()
        scan.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE).setPrompt("Scan the PassGate code on your PC").setBeepEnabled(false).setOrientationLocked(false))
    }
    BackHandler(screen != Screen.HOME) { screen = Screen.HOME }
    val id = vault.identity
    AnimatedContent(Pair(vault.pc != null && id != null, screen), transitionSpec = {
        val forward = targetState.second.ordinal >= initialState.second.ordinal
        (slideInHorizontally(tween(380, easing = FastOutSlowInEasing)) { if (forward) it / 5 else -it / 5 } + fadeIn(tween(260))) togetherWith
            (slideOutHorizontally(tween(300)) { if (forward) -it / 8 else it / 8 } + fadeOut(tween(180)))
    }, label = "screen") { (signedIn, s) ->
        when {
            !signedIn -> Welcome(busy, error ?: vault.loadError, vault.pc != null, startScan)
            s == Screen.PROTECTION -> Protection(vault, id!!, busy, deviceSecure, onBack = { screen = Screen.HOME }, onMenu = { settings = true }, onRefresh = onRefresh)
            s == Screen.ACTIVITY -> Activity(id!!, onBack = { screen = Screen.HOME })
            else -> Home(vault, id!!, error, onProtection = { screen = Screen.PROTECTION }, onActivity = { screen = Screen.ACTIVITY })
        }
    }
    if (settings) {
        ModalBottomSheet(onDismissRequest = { settings = false }, containerColor = Color(0xFFFBF3F0), contentColor = P.Ink) {
            Settings(vault, deviceSecure, onLock = { settings = false; onLock() }, onSignOut = { settings = false; screen = Screen.HOME; onSignOut() })
        }
    }
}

@Composable
private fun LockScreen(onUnlock: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        GateMark(84)
        Text("PassGate is locked", color = P.OnRose, fontSize = 24.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 18.dp))
        Text("Use your fingerprint, face or PIN to open it.", color = P.OnRoseMuted, fontSize = 14.sp, modifier = Modifier.padding(top = 4.dp))
        Spacer(Modifier.height(26.dp))
        ActionButton("Unlock", Icons.Default.Lock, onUnlock, Modifier.widthIn(min = 200.dp))
    }
}

@Composable
private fun Welcome(busy: Boolean, error: String?, linking: Boolean, onScan: () -> Unit) {
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(horizontal = 20.dp)) {
            Spacer(Modifier.height(12.dp))
            HeaderPill {
                GateMark(38)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(today(), color = P.OnRoseMuted, fontSize = 11.sp)
                    Text("Welcome to PassGate", color = P.OnRose, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                }
            }
            Spacer(Modifier.height(22.dp))
            StatusChip(if (busy) "Linking to your PC…" else "Ready to sign in", if (busy) P.Warn else P.Ok)
            Spacer(Modifier.height(12.dp))
            Headline("Sign in with the code", "on your PC.")
            Spacer(Modifier.height(18.dp))
            Rise(60) {
                GlassCard {
                    SectionLabel("How it works")
                    Step(Icons.Default.Home, "Open Nude on your PC", "Signed in with your Rovian Account", "Step 1")
                    Step(Icons.Default.Menu, "Menu → Connect your phone", "Choose PassGate", "Step 2")
                    Step(Icons.Default.Search, "Scan the code", "PassGate signs you in", "Step 3", last = true)
                }
            }
            Spacer(Modifier.height(14.dp))
            Rise(140) {
                WhiteCard {
                    Text("What PassGate keeps", color = P.Ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                    Text("Read from Nude on your PC, encrypted with the key in the code", color = P.InkMuted, fontSize = 12.sp)
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Tile("ID", "Rovian ID", "Verified", Modifier.weight(1f))
                        Tile("A", "Sign-ins", "From Nude", Modifier.weight(1f))
                        Tile("P", "Passwords", "Never", Modifier.weight(1f), dark = true)
                    }
                }
            }
            AnimatedVisibility(error != null) {
                Text(error ?: "", color = Color(0xFF7A1F2B), fontSize = 13.sp, modifier = Modifier.padding(top = 14.dp).clip(RoundedCornerShape(14.dp)).background(Color(0x66FFFFFF)).padding(12.dp))
            }
            Spacer(Modifier.height(14.dp))
            FootNote("PassGate keeps only your verified identity. Never passwords or sign-in tokens.")
            Spacer(Modifier.height(120.dp))
        }
        BottomAction(if (busy) "Signing in…" else if (linking) "Scan a new code" else "Scan code on your PC", onScan)
    }
}

@Composable
private fun Home(vault: Vault, id: Identity, error: String?, onProtection: () -> Unit, onActivity: () -> Unit) {
    val a = id.account
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(horizontal = 20.dp)) {
            Spacer(Modifier.height(12.dp))
            HeaderPill {
                GateMark(38)
                Spacer(Modifier.width(8.dp))
                Avatar(a?.initials ?: "?", a?.color)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(today(), color = P.OnRoseMuted, fontSize = 11.sp)
                    Text("${greeting()}, ${a?.name?.split(' ')?.firstOrNull() ?: "there"}", color = P.OnRose, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                RoundIcon(Icons.Default.Notifications, "Activity", onActivity)
            }
            Spacer(Modifier.height(22.dp))
            StatusChip("Protected by Rovian Defender", P.Ok, onClick = onProtection)
            Spacer(Modifier.height(12.dp))
            when {
                a == null -> Headline("No one is signed in to", "Nude on ${id.pcName}.")
                a.provider == "rovian" -> Headline("Your Rovian ID is", "verified.")
                else -> Headline("You're signed in with a", "Nude account.")
            }
            error?.let { Text(it, color = P.OnRoseMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp)) }
            Spacer(Modifier.height(18.dp))
            SectionHead("Your identity", "See all", onProtection)
            Rise(40) {
                GlassCard {
                    if (a == null) {
                        CheckRow(Icons.Default.Person, "Sign in on your PC", "Open Nude and sign in, then PassGate shows your identity", "Needs info", false, last = true)
                    } else {
                        if (a.provider == "rovian") CheckRow(Icons.Default.CheckCircle, "Rovian ID", a.rovianId ?: a.email, "Verified", true)
                        else CheckRow(Icons.Default.Person, "Rovian Account", "Connect it in Nude: Account → Continue with Rovian", "Not linked", false)
                        if (a.email.isNotBlank()) CheckRow(Icons.Default.Email, "Email", a.email, if (a.emailVerified) "Verified" else if (a.provider == "rovian") "Not verified" else "On this PC", a.emailVerified)
                        CheckRow(Icons.Default.Home, "Signed in on ${id.pcName}", "Nude ${id.nudeVersion}${if (a.lastSignIn > 0) " · ${ago(a.lastSignIn)}" else ""}", "Active", true, last = true)
                    }
                }
            }
            Spacer(Modifier.height(18.dp))
            SectionHead("Recent activity", "See all", onActivity)
            val recent = id.events.take(2)
            if (recent.isEmpty()) Text("Nothing yet.", color = P.InkMuted, fontSize = 13.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                recent.forEachIndexed { i, e -> Rise(80 + i * 60, Modifier.weight(1f)) { EventTile(e) } }
                if (recent.size == 1) Spacer(Modifier.weight(1f))
            }
            if (id.accounts.size > 1) {
                Spacer(Modifier.height(18.dp))
                SectionHead("Accounts on ${id.pcName}", null, {})
                GlassCard {
                    id.accounts.forEachIndexed { i, x ->
                        CheckRow(if (x.provider == "rovian") Icons.Default.CheckCircle else Icons.Default.Person, x.name, x.id,
                            if (x.current) "Signed in" else if (x.provider == "rovian") "Rovian" else "Nude", x.current, last = i == id.accounts.lastIndex)
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
            FootNote("Updated ${ago(vault.identityAt)} from ${id.pcName}. PassGate never stores passwords or sign-in tokens.")
            Spacer(Modifier.height(120.dp))
        }
        BottomAction("See how you're protected", onProtection)
    }
}

@Composable
private fun Protection(vault: Vault, id: Identity, busy: Boolean, deviceSecure: Boolean, onBack: () -> Unit, onMenu: () -> Unit, onRefresh: () -> Unit) {
    val a = id.account
    val defenderLinked = id.devices.any { it.app == "defender" }
    val items = listOf(
        if (a?.provider == "rovian") Item(Icons.Default.CheckCircle, "Verified Rovian identity", a.rovianId ?: a.email, "Ready", true)
        else Item(Icons.Default.Person, "Verified Rovian identity", "In Nude: Account → Continue with Rovian", "Needs setup", false),
        if (deviceSecure && vault.lockEnabled) Item(Icons.Default.Lock, "PassGate lock", "Fingerprint, face or PIN to open", "Ready", true)
        else Item(Icons.Default.Lock, "PassGate lock", if (!deviceSecure) "Set a screen lock on this phone" else "Turn it on in settings", "Needs setup", false),
        Item(Icons.Default.Home, "Linked to ${id.pcName}", "Checked ${ago(vault.identityAt)}", "Ready", true),
        Item(Icons.Default.Info, "Rovian Defender on your PC", "${id.level.replaceFirstChar { it.uppercase() }} protection is on", "Ready", true),
        Item(Icons.Default.Star, "Passkeys", "PassGate will hold passkeys in a later version", "Coming soon", false, soon = true),
    )
    val done = items.count { it.ok }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(horizontal = 20.dp)) {
            Spacer(Modifier.height(12.dp))
            HeaderPill {
                RoundIcon(Icons.Default.ArrowBack, "Back", onBack)
                Spacer(Modifier.width(8.dp))
                GateMark(34)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("Protection", color = P.OnRoseMuted, fontSize = 11.sp)
                    Text("PassGate", color = P.OnRose, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                }
                RoundIcon(Icons.Default.MoreVert, "Settings", onMenu)
            }
            Spacer(Modifier.height(22.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    StatusChip(id.pcName.uppercase(Locale.getDefault()) + " · NUDE ${id.nudeVersion}", Color.White)
                    Spacer(Modifier.height(12.dp))
                    Headline("Here's how PassGate", "protects you")
                }
                Ring(done, items.size)
            }
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SmallPill("$done Ready", P.Ok)
                val needs = items.count { !it.ok && !it.soon }
                if (needs > 0) SmallPill("$needs Needs setup", P.Warn)
                SmallPill("${items.count { it.soon }} Coming soon", Color.White)
            }
            Spacer(Modifier.height(14.dp))
            Rise(40) {
                GlassCard {
                    items.forEachIndexed { i, x -> CheckRow(x.icon, x.title, x.sub, x.status, x.ok, last = i == items.lastIndex) }
                }
            }
            Spacer(Modifier.height(14.dp))
            Rise(120) {
                WhiteCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Linked apps", color = P.Ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                            Text(if (defenderLinked) "Everything is linked" else "1 more to link", color = P.InkMuted, fontSize = 12.sp)
                        }
                        SmallPill(if (defenderLinked) "All set" else "Needs info", if (defenderLinked) P.Ok else P.Warn, dark = true)
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Tile("N", "Nude", "Linked", Modifier.weight(1f))
                        Tile("P", "PassGate", "Linked", Modifier.weight(1f))
                        Tile("R", "Defender", if (defenderLinked) "Linked" else "Link in Nude", Modifier.weight(1f), dark = !defenderLinked)
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
            FootNote("Nothing is shared with PassGate until you scan a code on your PC.")
            Spacer(Modifier.height(120.dp))
        }
        BottomAction(if (busy) "Checking…" else "Refresh from ${id.pcName}", onRefresh)
    }
}

@Composable
private fun Activity(id: Identity, onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(horizontal = 20.dp)) {
        Spacer(Modifier.height(12.dp))
        HeaderPill {
            RoundIcon(Icons.Default.ArrowBack, "Back", onBack)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("From ${id.pcName}", color = P.OnRoseMuted, fontSize = 11.sp)
                Text("Sign-in activity", color = P.OnRose, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            }
        }
        Spacer(Modifier.height(22.dp))
        Headline("Everything that happened", "to your sign-in.")
        Spacer(Modifier.height(16.dp))
        if (id.events.isEmpty()) Text("Nothing yet.", color = P.InkMuted)
        else GlassCard {
            id.events.forEachIndexed { i, e ->
                val (icon, ok) = eventIcon(e.kind)
                CheckRow(icon, e.detail, ago(e.t), label(e.kind), ok, last = i == id.events.lastIndex)
            }
        }
        Spacer(Modifier.height(40.dp))
    }
}

@Composable
private fun Settings(vault: Vault, deviceSecure: Boolean, onLock: () -> Unit, onSignOut: () -> Unit) {
    var confirm by remember { mutableStateOf(false) }
    val hw = remember { vault.hardwareBacked() }
    Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp).padding(bottom = 28.dp)) {
        Text("Settings", fontSize = 20.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(14.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Lock PassGate", fontWeight = FontWeight.Medium)
                Text(if (deviceSecure) "Fingerprint, face or PIN when PassGate opens" else "Set a screen lock on this phone first", fontSize = 12.5.sp, color = P.InkMuted)
            }
            Switch(vault.lockEnabled && deviceSecure, { vault.setLock(it) }, enabled = deviceSecure)
        }
        HorizontalDivider(Modifier.padding(vertical = 12.dp), color = Color(0x1A000000))
        SheetRow(Icons.Default.Lock, "Lock now", P.Ink, onLock)
        SheetRow(Icons.Default.ExitToApp, if (confirm) "Tap again to sign out" else "Sign out of PassGate", Color(0xFF9B2335)) { if (confirm) onSignOut() else confirm = true }
        Spacer(Modifier.height(10.dp))
        Text("PassGate's data is encrypted with a key in this phone's ${if (hw == true) "secure hardware" else "Android Keystore"}. It holds your verified identity from Nude and the link key from the code you scanned.",
            fontSize = 12.sp, color = P.InkMuted, lineHeight = 17.sp)
    }
}

// ------------------------------------------------------------------ pieces

@Composable
private fun GateMark(size: Int) {
    Box(Modifier.size(size.dp).clip(CircleShape).background(Brush.linearGradient(listOf(Color(0xFFE9C2BC), Color(0xFF5A2F45)))).border(1.dp, P.Edge, CircleShape), contentAlignment = Alignment.Center) {
        Image(painterResource(R.drawable.ic_passgate_mark), "PassGate", Modifier.size((size * 1.25f).dp))
    }
}

@Composable
private fun Avatar(initials: String, color: String?) {
    val bg = color?.let { runCatching { Color(android.graphics.Color.parseColor(it)) }.getOrNull() } ?: Color(0xFF5A2F45)
    Box(Modifier.size(38.dp).clip(CircleShape).background(bg).border(2.dp, Color(0x99FFFFFF), CircleShape), contentAlignment = Alignment.Center) {
        Text(initials, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun HeaderPill(content: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(50)).background(P.Glass).border(1.dp, P.Edge, RoundedCornerShape(50)).padding(6.dp),
        verticalAlignment = Alignment.CenterVertically, content = content)
}

@Composable
private fun RoundIcon(icon: ImageVector, label: String, onClick: () -> Unit) {
    Box(Modifier.size(38.dp).clip(CircleShape).background(P.GlassStrong).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(icon, label, tint = Color.White, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun StatusChip(text: String, dot: Color, onClick: (() -> Unit)? = null) {
    Row(Modifier.clip(RoundedCornerShape(50)).background(P.Glass).border(1.dp, P.Edge, RoundedCornerShape(50))
        .let { if (onClick != null) it.clickable(onClick = onClick) else it }.padding(horizontal = 10.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(7.dp).clip(CircleShape).background(dot))
        Spacer(Modifier.width(6.dp))
        Text(text, color = P.OnRose, fontSize = 11.sp)
    }
}

/** Two-weight headline: light first line, bold second, like the design. */
@Composable
private fun Headline(light: String, bold: String) {
    Text(buildAnnotatedString {
        withStyle(SpanStyle(fontWeight = FontWeight.Light)) { append(light) }
        append("\n")
        withStyle(SpanStyle(fontWeight = FontWeight.Medium)) { append(bold) }
    }, color = P.OnRose, fontSize = 27.sp, lineHeight = 35.sp)
}

@Composable
private fun SectionHead(title: String, action: String?, onAction: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, color = P.OnRose, fontSize = 12.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
        if (action != null) Text(action, color = P.OnRose, fontSize = 12.sp, modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onAction).padding(4.dp))
    }
}

@Composable
private fun SectionLabel(t: String) { Text(t, color = P.OnRoseMuted, fontSize = 12.sp, modifier = Modifier.padding(bottom = 4.dp)) }

@Composable
private fun GlassCard(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(P.Glass).border(1.dp, P.Edge, RoundedCornerShape(22.dp)).padding(horizontal = 14.dp, vertical = 8.dp), content = content)
}

@Composable
private fun WhiteCard(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Color.White).padding(16.dp), content = content)
}

@Composable
private fun CheckRow(icon: ImageVector, title: String, sub: String, status: String, ok: Boolean, last: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(30.dp).clip(RoundedCornerShape(9.dp)).background(if (ok) Color(0xF2FFFFFF) else Color(0x33FFFFFF)).border(1.dp, P.Edge, RoundedCornerShape(9.dp)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = if (ok) P.Ink else Color.White, modifier = Modifier.size(16.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = P.OnRose, fontSize = 13.5.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(sub, color = P.OnRoseMuted, fontSize = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.width(8.dp))
        Text(status, color = P.OnRose, fontSize = 10.5.sp, modifier = Modifier.clip(RoundedCornerShape(50)).background(Color(0x2EFFFFFF)).border(1.dp, P.Edge, RoundedCornerShape(50)).padding(horizontal = 9.dp, vertical = 3.dp))
    }
    if (!last) HorizontalDivider(color = Color(0x26FFFFFF))
}

@Composable
private fun Step(icon: ImageVector, title: String, sub: String, status: String, last: Boolean = false) = CheckRow(icon, title, sub, status, true, last)

@Composable
private fun Tile(letter: String, title: String, status: String, modifier: Modifier, dark: Boolean = false) {
    Row(modifier.clip(RoundedCornerShape(14.dp)).background(if (dark) P.Action else Color(0xFFF6EEEC)).padding(horizontal = 8.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(24.dp).clip(RoundedCornerShape(7.dp)).background(if (dark) Color(0x33FFFFFF) else Color.White), contentAlignment = Alignment.Center) {
            Text(letter, color = if (dark) Color.White else P.Ink, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(6.dp))
        Column {
            Text(title, color = if (dark) Color.White else P.Ink, fontSize = 11.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(status, color = if (dark) Color(0xB3FFFFFF) else Color(0xFF3E9C6A), fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun SmallPill(text: String, dot: Color, dark: Boolean = false) {
    Row(Modifier.clip(RoundedCornerShape(50)).background(if (dark) Color(0xFFF6EEEC) else P.Glass).border(1.dp, if (dark) Color.Transparent else P.Edge, RoundedCornerShape(50)).padding(horizontal = 9.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(if (dark) P.Ink else dot))
        Spacer(Modifier.width(5.dp))
        Text(text, color = if (dark) P.Ink else P.OnRose, fontSize = 10.5.sp)
    }
}

/** The "x/y Done" ring: fills with a spring when it first appears. */
@Composable
private fun Ring(done: Int, total: Int) {
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { delay(150); shown = true }
    val p by animateFloatAsState(if (shown) done / total.toFloat() else 0f, spring(dampingRatio = 0.8f, stiffness = Spring.StiffnessVeryLow), label = "ring")
    Box(Modifier.size(84.dp).clip(CircleShape).background(Color.White), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(76.dp)) {
            val w = 7.dp.toPx()
            drawArc(Color(0xFFEFE4E2), 0f, 360f, false, topLeft = Offset(w / 2, w / 2), size = Size(size.width - w, size.height - w), style = Stroke(w))
            drawArc(P.Action, -90f, 360f * p, false, topLeft = Offset(w / 2, w / 2), size = Size(size.width - w, size.height - w), style = Stroke(w, cap = StrokeCap.Round))
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.Bold, fontSize = 18.sp)) { append("$done") }
                withStyle(SpanStyle(fontSize = 12.sp, color = P.InkMuted)) { append("/$total") }
            }, color = P.Ink)
            Text("Done", color = P.InkMuted, fontSize = 10.sp)
        }
    }
}

@Composable
private fun EventTile(e: IEvent) {
    val (icon, _) = eventIcon(e.kind)
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(P.Glass).border(1.dp, P.Edge, RoundedCornerShape(16.dp)).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(28.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xF2FFFFFF)), contentAlignment = Alignment.Center) { Icon(icon, null, tint = P.Ink, modifier = Modifier.size(15.dp)) }
        Spacer(Modifier.width(8.dp))
        Column {
            Text(e.detail, color = P.OnRose, fontSize = 11.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 14.sp)
            Text(ago(e.t), color = P.OnRoseMuted, fontSize = 10.sp)
        }
    }
}

@Composable
private fun FootNote(text: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Default.Lock, null, tint = P.InkMuted, modifier = Modifier.size(13.dp))
        Spacer(Modifier.width(6.dp))
        Text(text, color = P.InkMuted, fontSize = 11.sp, lineHeight = 15.sp)
    }
}

@Composable
private fun BoxScope.BottomAction(text: String, onClick: () -> Unit) {
    Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, P.Bottom.copy(alpha = 0.95f), P.Bottom)))
        .navigationBarsPadding().padding(start = 20.dp, end = 20.dp, top = 28.dp, bottom = 16.dp)) {
        ActionButton(text, Icons.Default.ArrowForward, onClick, Modifier.fillMaxWidth())
    }
}

@Composable
private fun ActionButton(text: String, icon: ImageVector, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.97f else 1f, spring(dampingRatio = 0.6f, stiffness = Spring.StiffnessMedium), label = "btn")
    Row(modifier.graphicsLayer { scaleX = scale; scaleY = scale }.height(54.dp).clip(RoundedCornerShape(50)).background(P.Action)
        .drawBehind { drawRect(Brush.verticalGradient(listOf(Color(0x1FFFFFFF), Color.Transparent))) }
        .clickable(src, indication = null, onClick = onClick).padding(horizontal = 22.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f, fill = false))
        Spacer(Modifier.weight(1f))
        Icon(icon, null, tint = Color.White, modifier = Modifier.size(20.dp))
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

private fun eventIcon(kind: String): Pair<ImageVector, Boolean> = when (kind) {
    "rovian-signin", "signin", "signup" -> Icons.Default.CheckCircle to true
    "signout" -> Icons.Default.ExitToApp to true
    "switch" -> Icons.Default.Person to true
    "website-rovian" -> Icons.Default.Share to true
    "rovian-failed", "signin-failed" -> Icons.Default.Warning to false
    else -> Icons.Default.Info to true
}

private fun label(kind: String) = when (kind) {
    "rovian-signin" -> "Rovian"; "signin" -> "Sign-in"; "signup" -> "New"; "signout" -> "Signed out"; "switch" -> "Switch"
    "website-rovian" -> "Website"; "rovian-failed", "signin-failed" -> "Failed"; else -> "Event"
}

private fun today(): String = SimpleDateFormat("EEEE, MMM d", Locale.getDefault()).format(Date())

private fun greeting(): String = when (Calendar.getInstance().get(Calendar.HOUR_OF_DAY)) {
    in 5..11 -> "Good morning"; in 12..17 -> "Good afternoon"; else -> "Good evening"
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
