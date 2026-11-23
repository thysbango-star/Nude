@file:OptIn(ExperimentalMaterial3Api::class)

package os.nude.browser

import android.graphics.Bitmap
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import os.rovian.core.brand.NudeLogo
import os.rovian.core.nudeid.NudeDevice
import os.rovian.core.nudeid.NudeEvent
import os.rovian.core.nudeid.NudeIdError

// ------------------------------------------------------------------ colour themes (same six as Nude on Windows)

data class Palette(val id: String, val name: String, val frame: Color, val accent: Color,
                   val light: ColorScheme, val dark: ColorScheme, val backdropLight: List<Color>, val backdropDark: List<Color>)

private fun lightOf(accent: Color, bg: Color, surface: Color, variant: Color, onVariant: Color) =
    lightColorScheme(primary = accent, onPrimary = Color.White, secondary = accent, background = bg, surface = surface, surfaceVariant = variant,
        onSurfaceVariant = onVariant, outlineVariant = Color(0x17141420), error = RovianRed)
private fun darkOf(accent: Color, onAccent: Color, bg: Color, surface: Color, variant: Color, onVariant: Color) =
    darkColorScheme(primary = accent, onPrimary = onAccent, secondary = accent, background = bg, surface = surface, surfaceVariant = variant,
        onSurfaceVariant = onVariant, outlineVariant = Color(0x14FFFFFF), error = Color(0xFFFF6B5E))

val PALETTES = listOf(
    Palette("nude", "Nude", Color(0xFFE7E7EA), Color(0xFFE8742F),
        lightOf(Color(0xFFE8742F), Color(0xFFF3F3F5), Color.White, Color(0xFFEDEDF0), Color(0xFF5C5C66)),
        darkOf(Color(0xFFF08A4B), Color(0xFF1B0F07), Color(0xFF0C0C0E), Color(0xFF1C1C20), Color(0xFF222227), Color(0xFFA4A4AE)),
        listOf(Color(0xFFFF8A3D), Color(0xFFFFB07A), Color(0xFFE5533D)), listOf(Color(0xFFFF8A3D), Color(0xFFB0532A), Color(0xFF5A2A1A))),
    Palette("glass", "Liquid Glass", Color(0xFFCFE0FF), Color(0xFF2457FF),
        lightOf(Color(0xFF2457FF), Color(0xFFEEF3FF), Color.White, Color(0xFFE3EBFC), Color(0xFF4B587A)),
        darkOf(Color(0xFF4D7CFF), Color.White, Color(0xFF050B1F), Color(0xFF101D48), Color(0xFF13245A), Color(0xFFA3B3D8)),
        listOf(Color(0xFF6E9BFF), Color(0xFF9FD8FF), Color(0xFF2457FF)), listOf(Color(0xFF2457FF), Color(0xFF18B4E8), Color(0xFF0B1A46))),
    Palette("lavender", "Lavender", Color(0xFFE6D8FB), Color(0xFF8F4FE8),
        lightOf(Color(0xFF8F4FE8), Color(0xFFF7F2FD), Color.White, Color(0xFFEFE6FB), Color(0xFF5F5672)),
        darkOf(Color(0xFFB58CFF), Color(0xFF1A0D2E), Color(0xFF0F0B19), Color(0xFF221A36), Color(0xFF2A2042), Color(0xFFB2A6CC)),
        listOf(Color(0xFFB58CFF), Color(0xFFF0B8E6), Color(0xFF8F4FE8)), listOf(Color(0xFF8F4FE8), Color(0xFFC45B9A), Color(0xFF2A1450))),
    Palette("sunset", "Sunset", Color(0xFFFBD8BF), Color(0xFFE8742F),
        lightOf(Color(0xFFE8742F), Color(0xFFFDF5EE), Color(0xFFFFFAF6), Color(0xFFF9E7DA), Color(0xFF6D5A4D)),
        darkOf(Color(0xFFF59156), Color(0xFF1F0E05), Color(0xFF140D09), Color(0xFF2A1D15), Color(0xFF33231A), Color(0xFFC4AB98)),
        listOf(Color(0xFFF7875A), Color(0xFFFFC677), Color(0xFFE5533D)), listOf(Color(0xFFE8742F), Color(0xFF8B4A3D), Color(0xFF3A1A10))),
    Palette("forest", "Forest", Color(0xFFD6E8DC), Color(0xFF2F8A57),
        lightOf(Color(0xFF2F8A57), Color(0xFFF1F6F2), Color.White, Color(0xFFE5EFE8), Color(0xFF4F6356)),
        darkOf(Color(0xFF5CC98A), Color(0xFF06170D), Color(0xFF08110C), Color(0xFF15281D), Color(0xFF1A3024), Color(0xFF9FBBA9)),
        listOf(Color(0xFF7CC79A), Color(0xFFCFE6B8), Color(0xFF2F8A57)), listOf(Color(0xFF2F8A57), Color(0xFF1F5A40), Color(0xFF0B2016))),
    Palette("mono", "Mono", Color(0xFFF4F4F5), Color(0xFF18181B),
        lightOf(Color(0xFF18181B), Color(0xFFFAFAFA), Color.White, Color(0xFFEFEFF1), Color(0xFF5C5C66)),
        darkOf(Color(0xFFF4F4F5), Color(0xFF0B0B0C), Color(0xFF09090B), Color(0xFF18181B), Color(0xFF1C1C1F), Color(0xFFA4A4AE)),
        listOf(Color(0xFFBDBDC4), Color(0xFFE4E4E7), Color(0xFF8A8A93)), listOf(Color(0xFF3F3F46), Color(0xFF27272A), Color(0xFF18181B))),
)

fun palette(id: String) = PALETTES.firstOrNull { it.id == id } ?: PALETTES[0]

// ------------------------------------------------------------------ launch animation

private val LETTER_FROM = listOf(Triple(-1f, -0.75f, -24f), Triple(1f, -0.75f, 24f), Triple(-1f, 0.75f, 24f), Triple(1f, 0.75f, -24f))
private val NudeSpring = CubicBezierEasing(0.34f, 1.45f, 0.5f, 1f)
private val Swift = CubicBezierEasing(0.2f, 0.9f, 0.25f, 1f)

/**
 * The launch animation, the same as on Windows: N U D E fly in from the corners, lock into the block, turn 45 degrees
 * into the Nude mark, light up in Nude orange with a ring of light, then open out to the browser. Tap to skip.
 */
@Composable
fun NudeIntro(onDone: () -> Unit) {
    val letters = remember { NudeLogo.LETTERS.map { PathParser().parsePathString(it).toPath() } }
    val centres = remember { letters.map { it.getBounds().center } }
    val inP = remember { List(4) { Animatable(0f) } }
    val turn = remember { Animatable(0f) }
    val lit = remember { Animatable(0f) }
    val ring = remember { Animatable(0f) }
    val out = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    var finished by remember { mutableStateOf(false) }
    val finish = { if (!finished) { finished = true; onDone() } }
    BackHandler(true) {}
    LaunchedEffect(Unit) {
        inP.forEachIndexed { i, a -> launch { delay(i * 55L); a.animateTo(1f, tween(620, easing = Swift)) } }
        launch { delay(620); turn.animateTo(1f, tween(550, easing = NudeSpring)) }
        launch { delay(1000); lit.animateTo(1f, tween(400)) }
        launch { delay(1050); ring.animateTo(1f, tween(900, easing = FastOutSlowInEasing)) }
        delay(1450); out.animateTo(1f, tween(450, easing = FastOutSlowInEasing)); finish()
    }
    val cream = Color(0xFFF4EFE9)
    Box(Modifier.fillMaxSize().graphicsLayer { alpha = 1f - out.value }
        .background(Brush.radialGradient(listOf(Color(0xFF1A1D2E), Color(0xFF0B0C14), Color(0xFF050509))))
        .clickable(remember { MutableInteractionSource() }, indication = null) { scope.launch { out.animateTo(1f, tween(220)); finish() } },
        contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val c = center
            val side = size.minDimension * 0.5f * (1f + 0.25f * out.value)
            val k = side / NudeLogo.VIEWBOX
            drawCircle(Brush.radialGradient(listOf(Color(0xFFED7D3A).copy(alpha = 0.32f * lit.value), Color.Transparent), center = c, radius = side * 1.3f), side * 1.3f, c)
            if (ring.value in 0.001f..0.999f) drawCircle(Color(0xFFED7D3A).copy(alpha = 0.7f * (1f - ring.value)), side * (0.6f + 1.4f * ring.value), c, style = Stroke(2.dp.toPx()))
            translate(c.x - side / 2, c.y - side / 2) {
                scale(k, k, Offset.Zero) {
                    rotate(-45f * turn.value, Offset(NudeLogo.VIEWBOX / 2, NudeLogo.VIEWBOX / 2)) {
                        letters.forEachIndexed { i, path ->
                            val p = inP[i].value
                            val (fx, fy, fr) = LETTER_FROM[i]
                            val lc = centres[i]
                            translate((1 - p) * fx * 700f, (1 - p) * fy * 700f) {
                                rotate((1 - p) * fr, lc) {
                                    scale(0.6f + 0.4f * p, 0.6f + 0.4f * p, lc) {
                                        drawPath(path, lerp(cream, Color(0xFFED7D3A), lit.value).copy(alpha = p))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        Text("N U D E", color = cream.copy(alpha = 0.9f * lit.value), fontSize = 22.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(top = 300.dp).graphicsLayer { translationY = (1f - lit.value) * 16f })
    }
}


// ------------------------------------------------------------------ tab strip (Top) and side panel (Side)

/** A preview of the page, taken when you leave a tab (shown in the tab cards). */
fun capturePreview(tab: Tab) {
    val v = tab.webView ?: return
    if (v.width <= 0 || v.height <= 0) return
    runCatching {
        val w = (v.width / 3).coerceAtLeast(1); val h = (v.height / 3).coerceAtLeast(1)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.RGB_565)
        val canvas = android.graphics.Canvas(bmp)
        canvas.scale(1f / 3f, 1f / 3f)
        v.draw(canvas)
        tab.preview = bmp
    }
}

@Composable
fun TabStrip(browser: Browser) {
    val scroll = rememberScrollState()
    Row(Modifier.fillMaxWidth().horizontalScroll(scroll).padding(horizontal = 10.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        browser.tabs.forEach { t -> key(t.id) { TabChip(browser, t, vertical = false) } }
        IconButton({ browser.newTab() }, Modifier.size(32.dp)) { Icon(Icons.Default.Add, "New tab", Modifier.size(18.dp)) }
    }
}

@Composable
private fun TabChip(browser: Browser, t: Tab, vertical: Boolean, onPick: () -> Unit = {}) {
    val active = t.id == browser.activeId
    // New tabs grow in, like the + button opening them.
    val born = remember { Animatable(0f) }
    LaunchedEffect(Unit) { born.animateTo(1f, tween(380, easing = NudeSpring)) }
    val bg = if (active) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceVariant
    Row(Modifier.graphicsLayer { scaleX = if (vertical) 1f else 0.3f + 0.7f * born.value; scaleY = if (vertical) 0.3f + 0.7f * born.value else 1f; alpha = born.value }
        .then(if (vertical) Modifier.fillMaxWidth().height(44.dp) else Modifier.widthIn(min = 90.dp, max = 180.dp).height(34.dp))
        .clip(RoundedCornerShape(12.dp)).background(bg)
        .then(if (active) Modifier.border(1.5.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.6f), RoundedCornerShape(12.dp)) else Modifier)
        .clickable { browser.activeId = t.id; onPick() }.padding(start = 10.dp, end = 2.dp),
        verticalAlignment = Alignment.CenterVertically) {
        t.favicon?.let { Image(it.asImageBitmap(), null, Modifier.size(16.dp)) } ?: Icon(if (t.isPrivate) Icons.Default.Lock else Icons.Default.Search, null, Modifier.size(15.dp))
        Spacer(Modifier.width(8.dp))
        Text(if (t.isHome) "New Tab" else t.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp, modifier = Modifier.weight(1f, fill = vertical))
        IconButton({ browser.closeTab(t) }, Modifier.size(28.dp)) { Icon(Icons.Default.Close, "Close tab", Modifier.size(14.dp)) }
    }
}

/** Tabs down the side: a panel beside the page on tablets, sliding in from the left on phones. */
@Composable
fun TabSidePanel(browser: Browser, docked: Boolean, onClose: () -> Unit) {
    Column(Modifier.fillMaxHeight().width(if (docked) 240.dp else 290.dp).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.96f)).statusBarsPadding().padding(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("TABS", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f).padding(start = 6.dp))
            if (!docked) IconButton(onClose, Modifier.size(32.dp)) { Icon(Icons.Default.Close, "Close", Modifier.size(18.dp)) }
        }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            items(browser.tabs, key = { it.id }) { t -> TabChip(browser, t, vertical = true) { if (!docked) onClose() } }
        }
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { browser.newTab(); if (!docked) onClose() }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.Add, null, Modifier.size(18.dp)); Spacer(Modifier.width(10.dp)); Text("New tab", fontSize = 13.sp)
        }
    }
}

@Composable
fun SideDrawer(browser: Browser, open: Boolean, onClose: () -> Unit) {
    AnimatedVisibility(open, enter = fadeIn(), exit = fadeOut()) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.35f)).clickable(remember { MutableInteractionSource() }, indication = null, onClick = onClose))
    }
    AnimatedVisibility(open, enter = slideInHorizontally { -it }, exit = slideOutHorizontally { -it }) {
        BackHandler(true, onClose)
        TabSidePanel(browser, docked = false, onClose = onClose)
    }
}

@Composable
fun isWide(): Boolean = LocalConfiguration.current.screenWidthDp >= 600

// ------------------------------------------------------------------ appearance settings

@Composable
fun AppearanceSettings(store: Store, onChanged: () -> Unit) {
    var pal by remember { mutableStateOf(store.palette) }
    var layout by remember { mutableStateOf(store.tabLayout) }
    var intro by remember { mutableStateOf(store.launchIntro) }
    Text("Colour theme", fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 10.dp, bottom = 6.dp))
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        PALETTES.forEach { p ->
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clip(RoundedCornerShape(14.dp)).clickable { pal = p.id; store.palette = p.id; onChanged() }.padding(6.dp)) {
                Box(Modifier.size(54.dp).clip(CircleShape).background(Brush.linearGradient(listOf(p.frame, p.accent)))
                    .then(if (pal == p.id) Modifier.border(3.dp, MaterialTheme.colorScheme.primary, CircleShape) else Modifier))
                Text(p.name, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
    Text("Tabs", fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 14.dp, bottom = 6.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(layout == "horizontal", { layout = "horizontal"; store.tabLayout = "horizontal"; onChanged() }, { Text("Top strip") })
        FilterChip(layout == "vertical", { layout = "vertical"; store.tabLayout = "vertical"; onChanged() }, { Text("Side panel") })
    }
    Text(if (layout == "vertical") "Tabs slide in from the left (beside the page on tablets)." else "Your tabs sit in a strip above the page.",
        fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
    Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("Opening animation", fontWeight = FontWeight.Medium)
            Text("Plays the Nude logo animation when Nude starts.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(intro, { intro = it; store.launchIntro = it })
    }
}

// ------------------------------------------------------------------ welcome: create a Nude ID or sign in

@Composable
fun NudeIdWelcome(accounts: Accounts) {
    val scope = rememberCoroutineScope()
    var signIn by remember { mutableStateOf(accounts.lastUsername().isNotEmpty()) }
    var name by remember { mutableStateOf("") }
    var user by remember { mutableStateOf(accounts.lastUsername()) }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { accounts.refresh() }
    BackHandler(true) {}
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFFF7875A), Color(0xFFFFBF72), Color(0xFFE7703A))))
        .clickable(remember { MutableInteractionSource() }, indication = null) {}) {
        Column(Modifier.fillMaxSize().statusBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text("Nude Browser", color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.ExtraBold)
            Text("One Nude ID, every device", color = Color.White.copy(alpha = 0.85f), fontSize = 15.sp)
            Spacer(Modifier.height(22.dp))
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(26.dp)).background(Color(0xFFFBF8F5)).padding(22.dp)) {
                Text(if (signIn) "Welcome back" else "Create your Nude ID", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Clay)
                Text(if (signIn) "Sign in with your Nude ID." else "For Nude on your phone and computer, Nude Companion and Sign in with Nude.",
                    fontSize = 13.sp, color = Color(0xFF6D6460), modifier = Modifier.padding(top = 4.dp))
                if (!accounts.persistent) Text("Nude Accounts is in test mode: Nude IDs are deleted when its server restarts.", fontSize = 12.sp, color = Color(0xFFA33A17), modifier = Modifier.padding(top = 8.dp))
                if (!signIn) Field(name, { name = it; error = null }, "Your name", false, KeyboardType.Text)
                Field(user, { user = it.lowercase().replace(" ", ""); error = null }, "Nude ID", false, KeyboardType.Ascii, suffix = "@nude")
                Field(password, { password = it; error = null }, if (signIn) "Password" else "Password (10+ characters)", true, KeyboardType.Password)
                error?.let { Text(it, color = Color(0xFFA33A17), fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp)) }
                Spacer(Modifier.height(16.dp))
                Button({
                    busy = true
                    scope.launch { error = if (signIn) accounts.signIn(user, password) else accounts.signUp(user, name, password); busy = false }
                }, Modifier.fillMaxWidth().height(50.dp), enabled = !busy, shape = RoundedCornerShape(14.dp), colors = ButtonDefaults.buttonColors(containerColor = Clay)) {
                    if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp) else Text(if (signIn) "Sign in" else "Create Nude ID", fontWeight = FontWeight.SemiBold)
                }
                TextButton({ signIn = !signIn; error = null }, Modifier.align(Alignment.CenterHorizontally)) {
                    Text(if (signIn) "New to Nude? Create a Nude ID" else "Already have a Nude ID? Sign in", color = Clay)
                }
                TextButton({ accounts.continueAsGuest() }, Modifier.align(Alignment.CenterHorizontally)) { Text("Continue without an account", color = Color(0xFF6D6460)) }
                Text("Your password goes only to Nude Accounts. This phone keeps your Nude ID and an encrypted sign-in key.", fontSize = 11.sp, color = Color(0xFF9A918C))
            }
        }
    }
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, label: String, secret: Boolean, kind: KeyboardType, suffix: String? = null) {
    OutlinedTextField(value, onChange, Modifier.fillMaxWidth().padding(top = 10.dp), label = { Text(label) }, singleLine = true,
        suffix = suffix?.let { { Text(it, color = Color(0xFF9A918C)) } },
        visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = kind, autoCorrectEnabled = false),
        colors = OutlinedTextFieldDefaults.colors(focusedTextColor = Color(0xFF1F1A17), unfocusedTextColor = Color(0xFF1F1A17), focusedBorderColor = Clay, focusedLabelColor = Clay, cursorColor = Clay))
}

// ------------------------------------------------------------------ account centre

private val APP_NAMES = mapOf("browser" to "Nude browser", "companion" to "Nude Companion", "passgate" to "PassGate", "nebula" to "Nebula", "web" to "Web browser")

@Composable
fun AccountPage(accounts: Accounts, onSignedOut: () -> Unit) {
    val a = accounts.current ?: run { EmptyAccount(accounts); return }
    val scope = rememberCoroutineScope()
    var devices by remember { mutableStateOf<List<NudeDevice>?>(null) }
    var events by remember { mutableStateOf<List<NudeEvent>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var picture by remember { mutableStateOf<Bitmap?>(null) }
    suspend fun load() {
        accounts.refresh()
        try {
            devices = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { accounts.id.devices() }
            events = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { accounts.id.events() }
            picture = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { accounts.id.avatarBytes()?.let { android.graphics.BitmapFactory.decodeByteArray(it, 0, it.size) } }
            error = null
        } catch (e: NudeIdError) { error = e.message }
    }
    LaunchedEffect(a.id) { load() }
    Column(Modifier.verticalScroll(rememberScrollState())) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 12.dp)) {
            Box(Modifier.size(64.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), contentAlignment = Alignment.Center) {
                picture?.let { Image(it.asImageBitmap(), null, Modifier.fillMaxSize()) } ?: Text(a.initials, color = MaterialTheme.colorScheme.onPrimary, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.width(14.dp))
            Column {
                Text(a.name, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Text(a.nudeId, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Medium)
            }
        }
        if (!accounts.persistent) Text("Nude Accounts is in test mode: Nude IDs are deleted when its server restarts.", fontSize = 12.sp, color = MaterialTheme.colorScheme.error)
        error?.let { Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(vertical = 6.dp)) }
        Text("Devices", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
        Text("Everywhere your Nude ID is signed in. Sign out anything you don't recognise.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        devices?.forEach { d ->
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (d.app == "browser" || d.app == "web") Icons.Default.Search else Icons.Default.Phone, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(d.name + if (d.current) " · this phone" else "", fontWeight = FontWeight.Medium)
                    Text("${APP_NAMES[d.app] ?: d.app}${if (d.platform.isNotBlank()) " · ${d.platform}" else ""} · active ${ago(d.lastSeen)}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (!d.current) TextButton({ scope.launch { runCatching { kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { accounts.id.revoke(d.id) } }; load() } }) { Text("Sign out") }
            }
        } ?: CircularProgressIndicator(Modifier.padding(12.dp).size(22.dp), strokeWidth = 2.dp)
        Text("Recent activity", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 18.dp, bottom = 6.dp))
        events?.take(20)?.forEach { e ->
            Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(if (e.kind.contains("failed") || e.kind.contains("denied")) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary))
                Spacer(Modifier.width(12.dp))
                Column { Text(e.detail, fontSize = 14.sp); Text("${ago(e.t)}${e.device?.let { " · $it" } ?: ""}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
        Spacer(Modifier.height(18.dp))
        OutlinedButton({ scope.launch { accounts.signOut(); onSignedOut() } }, Modifier.fillMaxWidth()) { Text("Sign out of ${a.nudeId}") }
        Text("Manage your picture, password and devices from anywhere with Nude Companion.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 10.dp, bottom = 32.dp))
    }
}

@Composable
private fun EmptyAccount(accounts: Accounts) {
    Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("You're not signed in", fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
        Text("Sign in with your Nude ID to see your devices and security.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 8.dp))
        Button({ accounts.showWelcome() }) { Text("Sign in") }
    }
}

fun ago(t: Long): String {
    if (t <= 0) return "never"
    val s = (System.currentTimeMillis() - t) / 1000
    return when {
        s < 90 -> "just now"
        s < 3600 -> "${s / 60} min ago"
        s < 86_400 -> "${s / 3600} h ago"
        else -> java.text.DateFormat.getDateInstance(java.text.DateFormat.MEDIUM).format(java.util.Date(t))
    }
}
