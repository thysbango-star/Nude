@file:OptIn(ExperimentalMaterial3Api::class)

package os.nude.companion

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import os.rovian.core.glass.GlassBackground
import os.rovian.core.glass.GlassButton
import os.rovian.core.glass.GlassCard
import os.rovian.core.glass.GlassNavBar
import os.rovian.core.glass.GlassTheme
import os.rovian.core.glass.LocalGlass
import os.rovian.core.glass.NavItem
import os.rovian.core.glass.SectionTitle
import os.rovian.core.glass.StatusPill
import os.rovian.core.glass.glassEdge
import os.rovian.core.nudeid.NudeAccount
import os.rovian.core.nudeid.NudeDevice
import os.rovian.core.nudeid.NudeEvent
import os.rovian.core.nudeid.NudeId
import os.rovian.core.nudeid.NudeIdError
import java.io.ByteArrayOutputStream

/**
 * Nude Companion: your Nude ID on your phone. Sign in by scanning the code Nude shows on a signed-in computer
 * (the computer must approve this phone), or with your Nude ID and password. Then manage your picture, name,
 * password, devices and security activity. The sign-in token is kept encrypted with an Android Keystore key.
 */
class CompanionActivity : ComponentActivity() {
    private lateinit var id: NudeId
    private val account = mutableStateOf<NudeAccount?>(null)
    private val persistent = mutableStateOf(true)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        id = NudeId(applicationContext, "companion")
        account.value = id.account?.takeIf { id.signedIn }
        setContent { GlassTheme(isSystemInDarkTheme()) { GlassBackground { App() } } }
        lifecycleScope.launch { refresh() }
    }

    private suspend fun refresh() = withContext(Dispatchers.IO) {
        runCatching { persistent.value = id.status() }
        if (!id.signedIn) return@withContext
        try { account.value = id.me() } catch (e: NudeIdError) { if (e.code == "signed_out") account.value = null }
    }

    @Composable
    private fun App() {
        AnimatedContent(account.value != null, transitionSpec = {
            (fadeIn(tween(320)) + scaleIn(tween(420, easing = FastOutSlowInEasing), initialScale = 0.96f)) togetherWith fadeOut(tween(160))
        }, label = "signed-in") { signed ->
            if (signed) Centre() else Welcome()
        }
    }

    // ---------------------------------------------------------------- signed out: scan a code or use a password

    private enum class Link { IDLE, SCANNING, CLAIMING, WAITING, DONE }

    @Composable
    private fun Welcome() {
        val c = LocalGlass.current
        val scope = rememberCoroutineScope()
        var link by remember { mutableStateOf(Link.IDLE) }
        var error by remember { mutableStateOf<String?>(null) }
        var withPassword by remember { mutableStateOf(false) }

        fun scanned(text: String) {
            val code = NudeId.parseLink(text)
            if (code == null) { link = Link.IDLE; error = "That isn't a Nude sign-in code. In Nude on your computer, open Account → Sign in to Nude Companion."; return }
            link = Link.CLAIMING
            scope.launch {
                try {
                    val claim = withContext(Dispatchers.IO) { id.claim(code) }
                    link = Link.WAITING
                    val until = System.currentTimeMillis() + 2 * 60_000
                    while (System.currentTimeMillis() < until) {
                        val (state, a) = withContext(Dispatchers.IO) { id.poll(code, claim) }
                        if (state == "approved" && a != null) { link = Link.DONE; account.value = a; return@launch }
                        if (state == "denied") { link = Link.IDLE; error = "Your computer didn't allow this phone."; return@launch }
                        delay(2000)
                    }
                    link = Link.IDLE; error = "Nobody approved this phone in time. Show a new code and try again."
                } catch (e: NudeIdError) { link = Link.IDLE; error = e.message }
            }
        }

        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(22.dp),
            horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(36.dp))
            Box(Modifier.size(96.dp).clip(RoundedCornerShape(30.dp)).background(Brush.linearGradient(listOf(Color(0xFF1A1D2E), Color(0xFF2A2140)))).border(1.dp, glassEdge(), RoundedCornerShape(30.dp)),
                contentAlignment = Alignment.Center) {
                Image(painterResource(R.drawable.ic_nude_mark), "Nude", Modifier.size(96.dp))
            }
            Spacer(Modifier.height(16.dp))
            Text("Nude Companion", color = c.ink, fontSize = 30.sp, fontWeight = FontWeight.SemiBold)
            Text("Your Nude ID, devices and security, on your phone.", color = c.muted, fontSize = 15.sp, textAlign = TextAlign.Center)
            if (!persistent.value) Text("Nude Accounts is in test mode: Nude IDs are deleted when its server restarts.", color = c.warn, fontSize = 12.5.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 10.dp))
            Spacer(Modifier.height(26.dp))
            GlassCard(Modifier.fillMaxWidth(), strong = true) {
                when (link) {
                    Link.CLAIMING, Link.WAITING, Link.DONE -> {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(Modifier.size(22.dp), color = c.electric, strokeWidth = 2.5.dp)
                            Spacer(Modifier.width(14.dp))
                            Column {
                                Text(if (link == Link.WAITING) "Approve on your computer" else "Checking the code…", color = c.ink, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                                Text(if (link == Link.WAITING) "Nude on your computer is asking whether to allow ${NudeId.deviceName()}. Press Allow there." else "One moment.",
                                    color = c.muted, fontSize = 13.sp)
                            }
                        }
                    }
                    else -> {
                        Text("Sign in with your computer", color = c.ink, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                        Text("In Nude on a computer where you're signed in, open Account → Sign in to Nude Companion, then scan the code.", color = c.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp, bottom = 14.dp))
                        GlassButton("Scan code", { error = null; link = Link.SCANNING }, Modifier.fillMaxWidth(), icon = Icons.Default.Search)
                    }
                }
            }
            error?.let { Text(it, color = c.danger, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 12.dp)) }
            Spacer(Modifier.height(14.dp))
            if (!withPassword) TextButton({ withPassword = true }) { Text("Sign in with your Nude ID and password instead", color = c.muted) }
            AnimatedVisibility(withPassword) { PasswordSignIn { e -> error = e } }
        }
        AnimatedVisibility(link == Link.SCANNING, enter = slideInVertically(tween(360)) { it / 3 } + fadeIn(), exit = slideOutVertically(tween(260)) { it / 3 } + fadeOut()) {
            Scanner("Point at the Nude Companion code on your computer", onResult = { scanned(it) }, onClose = { link = Link.IDLE })
        }
    }

    @Composable
    private fun PasswordSignIn(onError: (String?) -> Unit) {
        val c = LocalGlass.current
        val scope = rememberCoroutineScope()
        var user by remember { mutableStateOf("") }
        var pw by remember { mutableStateOf("") }
        var busy by remember { mutableStateOf(false) }
        var server by remember { mutableStateOf(id.server) }
        var editServer by remember { mutableStateOf(false) }
        GlassCard(Modifier.fillMaxWidth()) {
            GlassField(user, { user = it.lowercase().replace(" ", "") }, "Nude ID", suffix = "@nude")
            GlassField(pw, { pw = it }, "Password", secret = true)
            Text("Server: ${server.removePrefix("https://")} · ${if (editServer) "Done" else "Change"}", color = c.faint, fontSize = 12.sp,
                modifier = Modifier.padding(top = 8.dp).clickable { editServer = !editServer })
            if (editServer) GlassField(server, { server = it.trim() }, "Nude Accounts server")
            Spacer(Modifier.height(12.dp))
            GlassButton(if (busy) "Signing in…" else "Sign in", {
                if (server.trimEnd('/') != id.server && !id.useServer(server)) { onError("That isn't a valid server address. It should start with https://"); return@GlassButton }
                busy = true; onError(null)
                scope.launch {
                    try { account.value = withContext(Dispatchers.IO) { id.signIn(user.removeSuffix("@nude"), pw) } }
                    catch (e: NudeIdError) { onError(e.message) }
                    busy = false
                }
            }, Modifier.fillMaxWidth(), enabled = !busy && user.isNotBlank() && pw.isNotBlank())
            Text("No Nude ID yet? Create one in the Nude browser.", color = c.faint, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp))
        }
    }

    // ---------------------------------------------------------------- signed in: the account centre

    @Composable
    private fun Centre() {
        val c = LocalGlass.current
        var tab by remember { mutableIntStateOf(0) }
        BackHandler(tab != 0) { tab = 0 }
        Box(Modifier.fillMaxSize()) {
            AnimatedContent(tab, transitionSpec = { fadeIn(tween(240)) togetherWith fadeOut(tween(120)) }, label = "tab") { t ->
                when (t) {
                    0 -> Profile()
                    1 -> Devices()
                    2 -> ActivityLog()
                    else -> Security()
                }
            }
            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, c.bgBottom.copy(alpha = 0.92f))))
                .navigationBarsPadding().padding(top = 24.dp, bottom = 12.dp), contentAlignment = Alignment.Center) {
                GlassNavBar(listOf(NavItem(Icons.Default.Person, "Profile"), NavItem(Icons.Default.Phone, "Devices"), NavItem(Icons.Default.List, "Activity"), NavItem(Icons.Default.Lock, "Security")), tab, { tab = it })
            }
        }
    }

    @Composable
    private fun Page(title: String, sub: String, content: @Composable ColumnScope.() -> Unit) {
        val c = LocalGlass.current
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(horizontal = 20.dp)) {
            Spacer(Modifier.height(14.dp))
            Text(sub, color = c.muted, fontSize = 12.5.sp)
            Text(title, color = c.ink, fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(14.dp))
            content()
            Spacer(Modifier.height(120.dp))
        }
    }

    @Composable
    private fun Profile() {
        val c = LocalGlass.current
        val a = account.value ?: return
        val scope = rememberCoroutineScope()
        var picture by remember { mutableStateOf<Bitmap?>(null) }
        var name by remember(a.name) { mutableStateOf(a.name) }
        var note by remember { mutableStateOf<String?>(null) }
        LaunchedEffect(a.avatar) { picture = withContext(Dispatchers.IO) { id.avatarBytes()?.let { BitmapFactory.decodeByteArray(it, 0, it.size) } } }
        val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri == null) return@rememberLauncherForActivityResult
            scope.launch {
                note = "Uploading…"
                note = try {
                    val jpeg = withContext(Dispatchers.IO) { squareJpeg(contentResolver.openInputStream(uri)!!.use { it.readBytes() }) }
                    account.value = withContext(Dispatchers.IO) { id.setAvatar(jpeg) }
                    "Picture updated"
                } catch (e: NudeIdError) { e.message } catch (e: Exception) { "That picture couldn't be used." }
            }
        }
        Page("Your Nude ID", "Nude Companion") {
            if (!persistent.value) Text("Nude Accounts is in test mode: Nude IDs are deleted when its server restarts.", color = c.warn, fontSize = 12.5.sp, modifier = Modifier.padding(bottom = 10.dp))
            GlassCard(Modifier.fillMaxWidth(), strong = true) {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(104.dp).clip(CircleShape).background(Brush.linearGradient(listOf(c.electric, c.sapphire))).border(2.dp, glassEdge(), CircleShape)
                        .clickable { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, contentAlignment = Alignment.Center) {
                        picture?.let { Image(it.asImageBitmap(), "Profile picture", Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
                            ?: Text(a.initials, color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Medium)
                    }
                    Text("Tap to change", color = c.faint, fontSize = 11.5.sp, modifier = Modifier.padding(top = 6.dp))
                    Spacer(Modifier.height(8.dp))
                    Text(a.name, color = c.ink, fontSize = 22.sp, fontWeight = FontWeight.Medium)
                    Text(a.nudeId, color = c.electric, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                    StatusPill("Nude ID since ${java.text.SimpleDateFormat("MMMM yyyy", java.util.Locale.getDefault()).format(java.util.Date(a.created))}", c.good, Modifier.padding(top = 10.dp))
                }
            }
            SectionTitle("Name")
            GlassCard(Modifier.fillMaxWidth()) {
                GlassField(name, { name = it.take(60) }, "Shown in Nude and on sites you sign in to with Nude")
                Spacer(Modifier.height(10.dp))
                GlassButton("Save name", {
                    scope.launch { note = try { account.value = withContext(Dispatchers.IO) { id.rename(name) }; "Saved" } catch (e: NudeIdError) { e.message } }
                }, Modifier.fillMaxWidth(), enabled = name.isNotBlank() && name != a.name, quiet = true)
            }
            note?.let { Text(it, color = c.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 10.dp)) }
        }
    }

    @Composable
    private fun Devices() {
        val c = LocalGlass.current
        val scope = rememberCoroutineScope()
        var list by remember { mutableStateOf<List<NudeDevice>?>(null) }
        var error by remember { mutableStateOf<String?>(null) }
        suspend fun load() { try { list = withContext(Dispatchers.IO) { id.devices() }; error = null } catch (e: NudeIdError) { error = e.message; if (e.code == "signed_out") account.value = null } }
        LaunchedEffect(Unit) { load() }
        Page("Devices", "Everywhere you're signed in") {
            Text("Sign out anything you don't recognise, then change your password under Security.", color = c.muted, fontSize = 13.sp, modifier = Modifier.padding(bottom = 10.dp))
            error?.let { Text(it, color = c.danger, fontSize = 13.sp) }
            val l = list
            if (l == null) CircularProgressIndicator(Modifier.size(24.dp), color = c.electric, strokeWidth = 2.dp)
            else GlassCard(Modifier.fillMaxWidth(), padding = 6.dp) {
                l.forEachIndexed { i, d ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(38.dp).clip(RoundedCornerShape(12.dp)).background(if (d.current) c.electric else c.glassStrong), contentAlignment = Alignment.Center) {
                            Icon(if (d.app == "browser" || d.app == "web") Icons.Default.Home else Icons.Default.Phone, null, tint = if (d.current) Color.White else c.muted, modifier = Modifier.size(19.dp))
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(d.name, color = c.ink, fontSize = 14.5.sp, fontWeight = FontWeight.Medium)
                            Text("${APPS[d.app] ?: d.app}${if (d.platform.isNotBlank()) " · ${d.platform}" else ""} · ${ago(d.lastSeen)}", color = c.muted, fontSize = 12.sp)
                        }
                        if (d.current) StatusPill("This phone", c.cyan)
                        else TextButton({ scope.launch { runCatching { withContext(Dispatchers.IO) { id.revoke(d.id) } }; load() } }) { Text("Sign out", color = c.danger) }
                    }
                    if (i != l.lastIndex) HorizontalDivider(Modifier.padding(horizontal = 10.dp), color = c.ink.copy(alpha = 0.07f))
                }
            }
        }
    }

    @Composable
    private fun ActivityLog() {
        val c = LocalGlass.current
        var list by remember { mutableStateOf<List<NudeEvent>?>(null) }
        var filter by remember { mutableIntStateOf(0) }
        LaunchedEffect(Unit) { list = runCatching { withContext(Dispatchers.IO) { id.events() } }.getOrNull() }
        val problem = { e: NudeEvent -> e.kind.contains("failed") || e.kind.contains("denied") }
        Page("Activity", "Your security log") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("All", "Sign-ins", "Problems").forEachIndexed { i, t ->
                    Text(t, color = if (filter == i) Color.White else c.ink, fontSize = 13.sp, modifier = Modifier.clip(RoundedCornerShape(50)).background(if (filter == i) c.electric else c.glass)
                        .border(1.dp, glassEdge(), RoundedCornerShape(50)).clickable { filter = i }.padding(horizontal = 14.dp, vertical = 8.dp))
                }
            }
            Spacer(Modifier.height(12.dp))
            val shown = list?.filter { when (filter) { 1 -> it.kind.startsWith("signin") || it.kind == "signout" || it.kind == "created"; 2 -> problem(it); else -> true } }
            if (shown == null) CircularProgressIndicator(Modifier.size(24.dp), color = c.electric, strokeWidth = 2.dp)
            else GlassCard(Modifier.fillMaxWidth(), padding = 6.dp) {
                if (shown.isEmpty()) Text(if (filter == 2) "No problems recorded." else "Nothing yet.", color = c.muted, fontSize = 13.sp, modifier = Modifier.padding(12.dp))
                shown.take(60).forEach { e ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(9.dp).clip(CircleShape).background(if (problem(e)) c.danger else c.electric))
                        Spacer(Modifier.width(12.dp))
                        Column { Text(e.detail, color = c.ink, fontSize = 14.sp); Text("${ago(e.t)}${e.device?.let { " · $it" } ?: ""}", color = c.muted, fontSize = 12.sp) }
                    }
                }
            }
        }
    }

    @Composable
    private fun Security() {
        val c = LocalGlass.current
        val scope = rememberCoroutineScope()
        var current by remember { mutableStateOf("") }
        var next by remember { mutableStateOf("") }
        var note by remember { mutableStateOf<String?>(null) }
        var confirm by remember { mutableStateOf(false) }
        Page("Security", account.value?.nudeId ?: "") {
            SectionTitle("Change password")
            GlassCard(Modifier.fillMaxWidth()) {
                GlassField(current, { current = it }, "Current password", secret = true)
                GlassField(next, { next = it }, "New password (10+ characters)", secret = true)
                Spacer(Modifier.height(10.dp))
                GlassButton("Change password", {
                    scope.launch {
                        note = try {
                            val n = withContext(Dispatchers.IO) { id.changePassword(current, next) }
                            current = ""; next = ""
                            "Password changed. $n other device${if (n == 1) "" else "s"} signed out."
                        } catch (e: NudeIdError) { e.message }
                    }
                }, Modifier.fillMaxWidth(), enabled = current.isNotBlank() && next.length >= 10)
                note?.let { Text(it, color = c.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 10.dp)) }
            }
            SectionTitle("This phone")
            GlassCard(Modifier.fillMaxWidth()) {
                Text("Nude Companion keeps an encrypted sign-in key on this phone (Android Keystore), never your password.", color = c.muted, fontSize = 13.sp)
                Spacer(Modifier.height(12.dp))
                GlassButton(if (confirm) "Tap again to sign out" else "Sign out of Nude Companion", {
                    if (!confirm) confirm = true else scope.launch { withContext(Dispatchers.IO) { id.signOut() }; account.value = null }
                }, Modifier.fillMaxWidth(), icon = Icons.Default.ExitToApp, quiet = true)
            }
        }
    }

    @Composable
    private fun GlassField(value: String, onChange: (String) -> Unit, label: String, secret: Boolean = false, suffix: String? = null) {
        val c = LocalGlass.current
        OutlinedTextField(value, onChange, Modifier.fillMaxWidth().padding(top = 8.dp), label = { Text(label) }, singleLine = true,
            suffix = suffix?.let { { Text(it, color = c.muted) } },
            visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = if (secret) KeyboardType.Password else KeyboardType.Ascii, autoCorrectEnabled = false),
            shape = RoundedCornerShape(14.dp),
            colors = OutlinedTextFieldDefaults.colors(focusedTextColor = c.ink, unfocusedTextColor = c.ink, focusedBorderColor = c.electric, unfocusedBorderColor = c.ink.copy(alpha = 0.15f),
                focusedLabelColor = c.electric, unfocusedLabelColor = c.muted, cursorColor = c.electric))
    }
}

private val APPS = mapOf("browser" to "Nude browser", "companion" to "Nude Companion", "passgate" to "PassGate", "nebula" to "Nebula", "web" to "Web browser")

/** Centre-crops a picture to a square and scales it to 512 px, as JPEG (Nude Accounts takes up to 512 KB). */
private fun squareJpeg(bytes: ByteArray): ByteArray {
    val src = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: throw IllegalArgumentException("not an image")
    val side = minOf(src.width, src.height)
    val sq = Bitmap.createBitmap(src, (src.width - side) / 2, (src.height - side) / 2, side, side)
    val out = Bitmap.createScaledBitmap(sq, 512, 512, true)
    return ByteArrayOutputStream().use { out.compress(Bitmap.CompressFormat.JPEG, 86, it); it.toByteArray() }
}

private fun ago(t: Long): String {
    if (t <= 0) return "never"
    val s = (System.currentTimeMillis() - t) / 1000
    return when {
        s < 90 -> "just now"
        s < 3600 -> "${s / 60} min ago"
        s < 86_400 -> "${s / 3600} h ago"
        else -> java.text.DateFormat.getDateInstance(java.text.DateFormat.MEDIUM).format(java.util.Date(t))
    }
}
