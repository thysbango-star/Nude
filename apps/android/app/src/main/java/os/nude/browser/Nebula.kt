@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package os.nude.browser

import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
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
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

private enum class NebulaSection(val label: String) { ASK("Ask"), SPACES("Spaces"), MODES("Modes") }

private data class Quick(val label: String, val prompt: String, val page: Boolean)

private val QUICK = mapOf(
    "shopping" to listOf(
        Quick("Smart Compare", "Compare the main products on this page: price, quality signals, ratings and value. Recommend the best pick and why. Use product cards.", true),
        Quick("Mix & Match", "Give me outfit or combination ideas using the item I'm looking at and other items on this page.", true),
        Quick("Price Pulse", "Find the cheapest option on this page. Is anything on sale? Point out the best value.", true),
    ),
    "research" to listOf(
        Quick("Key facts", "List the key facts and claims on this page, with which parts are supported by evidence.", true),
        Quick("Fact-check", "Which claims on this page might be misleading or need verification?", true),
    ),
    "study" to listOf(
        Quick("Study guide", "Create a study guide from this page: key ideas, definitions and a short summary.", true),
        Quick("Quiz me", "Make 5 quiz questions (with answers at the end) from this page.", true),
    ),
    "focus" to listOf(Quick("TL;DR", "TL;DR of this page in 2 sentences.", true)),
    "everyday" to listOf(
        Quick("Summarise", "Summarise this page in five points.", true),
        Quick("Explain simply", "Explain this page like I'm in Grade 8.", true),
        Quick("Is this safe?", "Is this website safe?", false),
    ),
)

private val MODE_INFO = listOf(
    "everyday" to ("Everyday" to "Summaries, explanations and quick answers."),
    "shopping" to ("Shopping" to "Smart Compare, Mix & Match and Price Pulse."),
    "research" to ("Research" to "Key facts, sources and fact-checks."),
    "study" to ("Study" to "Study guides, notes and quizzes."),
    "focus" to ("Focus" to "Short answers about the page you're on."),
)

/** Nebula's turning orb. */
@Composable
internal fun NebulaOrb(size: androidx.compose.ui.unit.Dp, spinning: Boolean = true) {
    val t = rememberInfiniteTransition(label = "orb")
    val a by t.animateFloat(0f, 360f, infiniteRepeatable(tween(if (spinning) 5000 else 60000, easing = LinearEasing)), label = "a")
    Box(Modifier.size(size).rotate(a).clip(CircleShape).background(NebulaBrush))
}

/**
 * Nebula as a floating matte panel over the page. It grows out of its button (bottom right), the neon frame
 * flares while it opens and while it works, and the page behind frosts over on Android 12+.
 */
@Composable
internal fun NebulaOverlay(browser: Browser, visible: Boolean, onDismiss: () -> Unit) {
    val tab = browser.active
    // Matte glass: frost the live page behind Nebula (RenderEffect needs Android 12).
    LaunchedEffect(visible, tab?.id) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            browser.tabs.forEach { it.webView?.setRenderEffect(null) }
            if (visible) tab?.webView?.setRenderEffect(RenderEffect.createBlurEffect(48f, 48f, Shader.TileMode.CLAMP))
        }
    }
    val scrim by animateFloatAsState(if (visible) 1f else 0f, tween(220), label = "scrim")
    if (scrim > 0f) {
        Box(Modifier.fillMaxSize().graphicsLayer { alpha = scrim }.background(Color.Black.copy(alpha = 0.28f))
            .clickable(remember { MutableInteractionSource() }, indication = null, onClick = onDismiss))
    }
    AnimatedVisibility(
        visible,
        enter = scaleIn(spring(dampingRatio = 0.82f, stiffness = Spring.StiffnessMediumLow), initialScale = 0.6f, transformOrigin = TransformOrigin(0.92f, 1f)) + fadeIn(tween(160)),
        exit = scaleOut(tween(150), targetScale = 0.9f, transformOrigin = TransformOrigin(0.92f, 1f)) + fadeOut(tween(130)),
    ) {
        NebulaPanel(browser, onDismiss)
    }
}

@Composable
private fun NebulaPanel(browser: Browser, onDismiss: () -> Unit) {
    val store = browser.store
    val scope = rememberCoroutineScope()
    val tab = browser.active
    val activity = LocalContext.current as MainActivity
    val accounts = (LocalContext.current.applicationContext as NudeApplication).accounts
    val dark = when (store.theme) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
    val messages = remember { NebulaMemory.messages }
    var input by remember { mutableStateOf("") }
    var sharePage by remember(tab?.id) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var section by remember { mutableStateOf(if (messages.isEmpty()) NebulaSection.ASK else NebulaSection.ASK) }
    var mode by remember { mutableStateOf(store.mode) }
    var speed by remember { mutableStateOf(store.nebulaSpeed) }
    var flare by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) { kotlinx.coroutines.delay(700); flare = false }
    val listState = rememberLazyListState()
    val web = tab != null && tab.url.startsWith("http") && !tab.isHome

    fun send(text: String) {
        if (text.isBlank() || busy) return
        section = NebulaSection.ASK
        messages += ChatMessage("user", text.trim())
        input = ""
        busy = true
        scope.launch {
            val sources = mutableListOf<JSONObject>()
            val used = mutableListOf<String>()
            val wv = tab?.webView
            if (sharePage && tab != null && wv != null && tab.url.startsWith("http")) {
                val (title, body) = NudeAi.pageText(wv)
                sources += JSONObject().put("id", "S1").put("kind", "page").put("title", title).put("url", tab.url).put("content", body)
                val v = Security.analyze(tab.url, store.level)
                sources += JSONObject().put("id", "S2").put("kind", "security").put("title", "Rovian Defender site check").put("url", tab.url)
                    .put("content", JSONObject().put("action", v.action.name).put("confirmed", v.confirmed).put("signals", v.signals.joinToString("; ") { it.message }).toString())
                used += title
            }
            if (store.aiGateway.isBlank()) {
                val local = NudeAi.localAnswer(text, tab?.url, store.level)
                messages += if (local != null) ChatMessage("assistant", local, note = "Answered on your phone by Rovian Defender.")
                else ChatMessage("assistant", "Nebula isn't set up yet. Add your Nebula gateway address in Settings → Nude services (see docs/NEBULA_SETUP.md). Safety questions like \"Is this website safe?\" work without it.", error = true)
                busy = false
                return@launch
            }
            messages += ChatMessage("assistant", "", sources = used)
            val idx = messages.lastIndex
            val r = NudeAi.ask(store.aiGateway, store.serviceToken, messages.dropLast(1), sources, mode = mode, speed = speed) { delta ->
                activity.runOnUiThread { if (idx < messages.size) messages[idx] = messages[idx].copy(text = messages[idx].text + delta) }
            }
            r.onFailure { e ->
                val local = NudeAi.localAnswer(text, tab?.url, store.level)
                if (idx < messages.size) messages[idx] = if (local != null) ChatMessage("assistant", local, note = "Answered on your phone — Nebula isn't reachable.")
                else ChatMessage("assistant", "Nebula isn't reachable (${e.message}).", error = true)
            }
            busy = false
        }
    }

    LaunchedEffect(Unit) { NebulaMemory.pending?.let { NebulaMemory.pending = null; send(it) } }
    LaunchedEffect(messages.size, messages.lastOrNull()?.text?.length) { if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex) }

    val glass = if (dark) Color(0xFF1A1A1E).copy(alpha = 0.94f) else Color(0xFFF6F6F8).copy(alpha = 0.95f)
    val ink = if (dark) Color(0xFFF1F1F3) else Color(0xFF18181B)
    val sub = ink.copy(alpha = 0.6f)
    val neon = rememberInfiniteTransition(label = "neon")
    val angle by neon.animateFloat(0f, 360f, infiniteRepeatable(tween(2400, easing = LinearEasing)), label = "angle")
    val frame by animateFloatAsState(if (busy || flare) 1f else 0f, tween(350), label = "frame")

    Box(
        Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().padding(10.dp)
            // The neon frame (video 2): drawn around the panel while Nebula opens and while it works.
            .drawBehind {
                if (frame > 0f) rotateBrush(angle) { brush ->
                    drawRoundRect(brush, cornerRadius = androidx.compose.ui.geometry.CornerRadius(30.dp.toPx()), style = Stroke(3.dp.toPx()), alpha = frame)
                }
            }
            .padding(3.dp)
            .clip(RoundedCornerShape(27.dp)).background(glass)
            .border(1.dp, ink.copy(alpha = 0.07f), RoundedCornerShape(27.dp)),
    ) {
        Column(Modifier.fillMaxSize()) {
            // Header: orb, name, sections
            Row(Modifier.fillMaxWidth().padding(start = 6.dp, end = 10.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onDismiss) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Close Nebula", tint = sub) }
                NebulaOrb(22.dp, spinning = busy)
                Spacer(Modifier.width(10.dp))
                Text("Nebula", fontSize = 19.sp, fontWeight = FontWeight.Bold, color = ink, modifier = Modifier.weight(1f))
                if (messages.isNotEmpty()) IconButton({ messages.clear() }) { Icon(Icons.Default.Edit, "New conversation", tint = sub) }
            }
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                NebulaSection.entries.forEach { s ->
                    val on = s == section
                    val bg by animateFloatAsState(if (on) 1f else 0f, tween(200), label = "seg")
                    Box(Modifier.clip(RoundedCornerShape(12.dp)).background(ink.copy(alpha = 0.06f + 0.06f * bg)).clickable { section = s }.padding(horizontal = 14.dp, vertical = 8.dp)) {
                        Text(s.label, color = if (on) ink else sub, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium, fontSize = 13.sp)
                    }
                }
            }

            AnimatedContent(section, Modifier.weight(1f), transitionSpec = {
                (fadeIn(tween(200, 60)) + slideInVertically(tween(260, easing = FastOutSlowInEasing)) { it / 14 }) togetherWith fadeOut(tween(120))
            }, label = "section") { s ->
                when (s) {
                    NebulaSection.ASK -> LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), state = listState, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        if (messages.isEmpty()) item {
                            Column(Modifier.fillMaxWidth().padding(top = 36.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                NebulaOrb(48.dp)
                                Spacer(Modifier.height(14.dp))
                                Text(accounts.current?.let { "Hi ${it.firstName}, I'm Nebula" } ?: "Hi, I'm Nebula", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = ink)
                                Text(if (web) "Ask me anything, or pick an action and I'll read this page for you." else "Ask me anything. Open a page and I can read it when you ask.",
                                    color = sub, fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp, bottom = 16.dp))
                                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    (QUICK[mode] ?: QUICK.getValue("everyday")).filter { !it.page || web }.forEach { q ->
                                        Box(Modifier.clip(RoundedCornerShape(16.dp)).background(ink.copy(alpha = 0.06f)).clickable { sharePage = q.page; send(q.prompt) }.padding(horizontal = 14.dp, vertical = 9.dp)) {
                                            Text(q.label, color = ink, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                                        }
                                    }
                                }
                            }
                        }
                        itemsIndexed(messages) { i, m -> NebulaMessage(m, ink, sub, busy && i == messages.lastIndex) }
                        item { Spacer(Modifier.height(8.dp)) }
                    }
                    NebulaSection.SPACES -> SpacesView(browser, ink, sub, onPick = { t -> browser.activeId = t.id; onDismiss() })
                    NebulaSection.MODES -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        MODE_INFO.forEach { (key, info) ->
                            val on = key == mode
                            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(if (on) Color(0xFFE4B6BA) else ink.copy(alpha = 0.05f))
                                .clickable { mode = key; store.mode = key; browser.toast = "${info.first} mode on" }.padding(16.dp)) {
                                Text(info.first, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = if (on) Color(0xFF2A1416) else ink)
                                Text(info.second, fontSize = 13.sp, color = if (on) Color(0xFF2A1416).copy(alpha = 0.75f) else sub)
                            }
                        }
                    }
                }
            }

            // Composer: the floating prompt, as in the reference.
            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp)) {
                if (sharePage && tab != null) {
                    Row(Modifier.align(Alignment.CenterHorizontally).padding(bottom = 6.dp).clip(RoundedCornerShape(14.dp)).background(ink.copy(alpha = 0.07f)).padding(start = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(tab.title.take(30), fontSize = 12.sp, color = ink, fontWeight = FontWeight.SemiBold)
                        IconButton({ sharePage = false }, Modifier.size(28.dp)) { Icon(Icons.Default.Close, "Stop sharing", Modifier.size(14.dp), tint = sub) }
                    }
                }
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(if (dark) Color(0xFF26262B) else Color.White).padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton({ if (web) sharePage = !sharePage else browser.toast = "Open a web page to share it with Nebula" }) {
                        Icon(if (sharePage) Icons.Default.Check else Icons.Default.Add, "Share this page", tint = if (sharePage) Clay else sub)
                    }
                    Box(Modifier.weight(1f).padding(vertical = 10.dp)) {
                        if (input.isEmpty()) Text(if (sharePage) "Ask about this page" else "Ask Nebula anything", color = sub, fontSize = 16.sp)
                        BasicTextField(input, { input = it }, Modifier.fillMaxWidth(), textStyle = androidx.compose.ui.text.TextStyle(color = ink, fontSize = 16.sp), cursorBrush = SolidColor(Clay), maxLines = 5)
                    }
                    Box(Modifier.clip(RoundedCornerShape(14.dp)).background(ink.copy(alpha = 0.07f)).clickable {
                        speed = when (speed) { "auto" -> "fast"; "fast" -> "thorough"; else -> "auto" }
                        store.nebulaSpeed = speed
                        browser.toast = mapOf("auto" to "Auto: fast for chat, deep when you share a page", "fast" to "Fast answers", "thorough" to "Deep answers: slower, more careful").getValue(speed)
                    }.padding(horizontal = 10.dp, vertical = 6.dp)) {
                        Text(mapOf("auto" to "Auto", "fast" to "Fast", "thorough" to "Deep").getValue(speed), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = sub)
                    }
                    Spacer(Modifier.width(6.dp))
                    val canSend = input.isNotBlank() && !busy
                    val sendScale by animateFloatAsState(if (canSend) 1f else 0.88f, spring(dampingRatio = 0.6f), label = "send")
                    Box(Modifier.size(44.dp).graphicsLayer { scaleX = sendScale; scaleY = sendScale }.clip(CircleShape).background(ink.copy(alpha = if (canSend) 1f else 0.25f))
                        .clickable(enabled = canSend) { send(input) }, contentAlignment = Alignment.Center) {
                        Icon(Icons.Default.KeyboardArrowUp, "Send", tint = if (dark) Color.Black else Color.White)
                    }
                }
                Text("Nebula only sees what you share. It can make mistakes.", fontSize = 11.sp, color = sub, modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 6.dp))
            }
        }
    }
}

/** Draws with a sweep gradient rotated by [angle] degrees around the centre. */
private fun androidx.compose.ui.graphics.drawscope.DrawScope.rotateBrush(angle: Float, block: androidx.compose.ui.graphics.drawscope.DrawScope.(Brush) -> Unit) {
    val colors = listOf(Color(0xFFFFD400), Color(0xFFFF2BD6), Color(0xFF7A3CFF), Color(0xFF1F7BFF), Color(0xFF22E3FF), Color(0xFFFFD400))
    rotate(angle) { block(Brush.sweepGradient(colors, center)) }
}

@Composable
private fun NebulaMessage(m: ChatMessage, ink: Color, sub: Color, streaming: Boolean) {
    val mine = m.role == "user"
    // Each message rises in when it arrives.
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { shown = true }
    val p by animateFloatAsState(if (shown) 1f else 0f, tween(260, easing = FastOutSlowInEasing), label = "msg")
    Row(Modifier.fillMaxWidth().graphicsLayer { alpha = p; translationY = (1 - p) * 24f }, horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        if (mine) {
            Box(Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(18.dp, 18.dp, 6.dp, 18.dp)).background(ink).padding(horizontal = 14.dp, vertical = 10.dp)) {
                Text(m.text, color = if (ink.red > 0.5f) Color.Black else Color.White, fontSize = 15.sp)
            }
        } else {
            NebulaOrb(18.dp, spinning = streaming)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                if (m.text.isEmpty()) Text("…", color = sub) else Text(markdown(m.text), color = if (m.error) MaterialTheme.colorScheme.error else ink, fontSize = 15.sp, lineHeight = 22.sp)
                if (m.sources.isNotEmpty()) Text("Used: ${m.sources.joinToString()}", fontSize = 11.sp, color = sub, modifier = Modifier.padding(top = 6.dp))
                else if (m.text.isNotEmpty() && !m.error && !streaming) Text("No page content was shared.", fontSize = 11.sp, color = sub, modifier = Modifier.padding(top = 6.dp))
                m.note?.let { Text(it, fontSize = 11.sp, color = sub, modifier = Modifier.padding(top = 4.dp)) }
            }
        }
    }
}

/** Spaces on a phone: your open tabs, grouped by site, the current one highlighted (pink, as in the reference). */
@Composable
private fun SpacesView(browser: Browser, ink: Color, sub: Color, onPick: (Tab) -> Unit) {
    val groups = browser.tabs.groupBy { if (it.isHome || !it.url.startsWith("http")) "New tabs" else Omnibox.host(it.url).removePrefix("www.") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        groups.entries.forEachIndexed { gi, (name, tabs) ->
            val current = tabs.any { it.id == browser.activeId }
            var shown by remember { mutableStateOf(false) }
            LaunchedEffect(Unit) { kotlinx.coroutines.delay(gi * 40L); shown = true }
            val p by animateFloatAsState(if (shown) 1f else 0f, tween(280, easing = FastOutSlowInEasing), label = "space")
            Column(Modifier.fillMaxWidth().graphicsLayer { alpha = p; translationY = (1 - p) * 30f }.clip(RoundedCornerShape(18.dp))
                .background(if (current) Color(0xFFE4B6BA) else ink.copy(alpha = 0.05f)).padding(vertical = 8.dp)) {
                val c = if (current) Color(0xFF2A1416) else ink
                Text(name, fontWeight = FontWeight.SemiBold, color = c.copy(alpha = 0.8f), modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
                tabs.forEach { t ->
                    Row(Modifier.fillMaxWidth().clickable { onPick(t) }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(t.title.ifBlank { t.url }, Modifier.weight(1f), color = c, fontWeight = if (t.id == browser.activeId) FontWeight.Bold else FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Icon(Icons.Default.Close, "Close tab", Modifier.size(18.dp).clip(CircleShape).clickable { browser.closeTab(t) }, tint = c.copy(alpha = 0.5f))
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}

/** Keeps the conversation while Nebula is closed and reopened. */
internal object NebulaMemory {
    val messages = mutableStateListOf<ChatMessage>()
    /** A question typed in the address bar, sent when Nebula opens. */
    var pending: String? = null
}
