@file:OptIn(ExperimentalMaterial3Api::class)

package os.nude.browser

import android.os.Build
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.launch
import org.json.JSONObject

// ------------------------------------------------------------------ theme
private val Clay = Color(0xFFB5674D)
private val Violet = Color(0xFF8F7CFF)

@Composable
fun NudeTheme(store: Store, content: @Composable () -> Unit) {
    val dark = when (store.theme) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
    val ctx = LocalContext.current
    // Nude OS / Android 12+: use the system accent (Material You) colours.
    val scheme = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> if (dark) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx)
        dark -> darkColorScheme(primary = Color(0xFFD98A6C), background = Color(0xFF121113), surface = Color(0xFF1D1B1F), surfaceVariant = Color(0xFF26232A))
        else -> lightColorScheme(primary = Clay, background = Color(0xFFF4F1EE), surface = Color.White, surfaceVariant = Color(0xFFF0ECE8))
    }
    MaterialTheme(colorScheme = scheme, content = content)
}

enum class Screen { NONE, TABS, MENU, BOOKMARKS, HISTORY, SETTINGS, SECURITY, AI }

// ------------------------------------------------------------------ main screen
@Composable
fun BrowserScreen(browser: Browser) {
    val ctx = LocalContext.current
    val activity = ctx as MainActivity
    val tab = browser.active
    var screen by remember { mutableStateOf(Screen.NONE) }
    var editing by remember { mutableStateOf(false) }
    var findOpen by remember { mutableStateOf(false) }
    val focus = LocalFocusManager.current

    browser.toast?.let { msg ->
        LaunchedEffect(msg) { Toast.makeText(ctx, msg, Toast.LENGTH_SHORT).show(); browser.toast = null }
    }
    // Lazily load restored tabs when they're shown.
    LaunchedEffect(browser.activeId) {
        val t = browser.active ?: return@LaunchedEffect
        if (t.webView == null && !t.isHome && t.url.startsWith("http") && t.blocked == null) browser.load(t, t.url)
    }

    BackHandler(enabled = true) {
        when {
            browser.customView != null -> browser.exitFullscreen()
            screen != Screen.NONE -> screen = Screen.NONE
            findOpen -> { findOpen = false; tab?.webView?.clearMatches() }
            editing -> { editing = false; focus.clearFocus() }
            tab != null && tab.blocked != null -> browser.backToSafety(tab)
            tab != null && tab.webView?.canGoBack() == true && !tab.isHome -> tab.webView?.goBack()
            tab != null && !tab.isHome -> browser.goHome(tab)
            browser.tabs.size > 1 && tab != null -> browser.closeTab(tab)
            else -> activity.moveTaskToBack(true)
        }
    }

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f).fillMaxWidth().statusBarsPadding()) {
                if (tab != null) TabContent(browser, tab, onSearch = { editing = true })
                if (findOpen && tab?.webView != null) FindBar(tab) { findOpen = false }
            }
            BottomBar(browser, editing, onEditing = { editing = it }, onScreen = { screen = it })
        }

        browser.customView?.let { view ->
            AndroidView(factory = { c -> FrameLayout(c).apply { setBackgroundColor(android.graphics.Color.BLACK); (view.parent as? ViewGroup)?.removeView(view); addView(view) } },
                modifier = Modifier.fillMaxSize())
        }

        when (screen) {
            Screen.TABS -> TabsSheet(browser) { screen = Screen.NONE }
            Screen.MENU -> MenuSheet(browser, onDismiss = { screen = Screen.NONE }, onScreen = { screen = it }, onFind = { screen = Screen.NONE; findOpen = true })
            Screen.BOOKMARKS -> FullPage("Bookmarks", { screen = Screen.NONE }) { BookmarksPage(browser) { screen = Screen.NONE } }
            Screen.HISTORY -> FullPage("History", { screen = Screen.NONE }) { HistoryPage(browser) { screen = Screen.NONE } }
            Screen.SETTINGS -> FullPage("Settings", { screen = Screen.NONE }) { SettingsPage(browser) }
            Screen.SECURITY -> FullPage("Nude Security", { screen = Screen.NONE }) { SecurityPage(browser) }
            Screen.AI -> AiSheet(browser) { screen = Screen.NONE }
            Screen.NONE -> {}
        }

        browser.pendingDownload?.let { d ->
            AlertDialog(
                onDismissRequest = { browser.pendingDownload = null },
                icon = { Icon(painterResource(R.drawable.ic_shield), null, tint = MaterialTheme.colorScheme.error) },
                title = { Text("${d.filename} may be dangerous") },
                text = { Text(d.verdict.notes.joinToString("\n\n") + "\n\nNo warning doesn't guarantee a file is safe. Only keep it if you trust where it came from.") },
                confirmButton = { TextButton({ browser.pendingDownload = null }) { Text("Don't download") } },
                dismissButton = { TextButton({ browser.pendingDownload = null; browser.startDownload(d.url, d.filename, d.mime, d.userAgent) }) { Text("Download anyway") } },
            )
        }
        browser.pendingPermission?.let { p ->
            AlertDialog(
                onDismissRequest = { p.onResult(false); browser.pendingPermission = null },
                title = { Text("${p.origin} wants to ${p.label}") },
                confirmButton = { TextButton({ p.onResult(true); browser.pendingPermission = null }) { Text("Allow") } },
                dismissButton = { TextButton({ p.onResult(false); browser.pendingPermission = null }) { Text("Block") } },
            )
        }
    }
}

@Composable
private fun TabContent(browser: Browser, tab: Tab, onSearch: () -> Unit) {
    val blocked = tab.blocked
    when {
        blocked != null -> BlockedPage(browser, tab, blocked)
        tab.isHome -> HomePage(browser, tab, onSearch)
        else -> Box(Modifier.fillMaxSize()) {
            key(tab.id) {
                AndroidView(
                    factory = { browser.ensureWebView(tab).also { (it.parent as? ViewGroup)?.removeView(it) } },
                    modifier = Modifier.fillMaxSize(),
                )
            }
            if (tab.progress < 100) {
                LinearProgressIndicator(progress = { tab.progress / 100f }, modifier = Modifier.fillMaxWidth().height(2.dp), color = MaterialTheme.colorScheme.primary)
            }
            tab.error?.let { err ->
                Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.Warning, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.height(16.dp))
                    Text("This page couldn't load", style = MaterialTheme.typography.headlineSmall)
                    Spacer(Modifier.height(8.dp))
                    Text(err, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(20.dp))
                    Button({ tab.error = null; if (tab.webView == null) browser.load(tab, tab.url) else tab.webView?.reload() }) { Text("Try again") }
                }
            }
        }
    }
}

// ------------------------------------------------------------------ bottom bar (address + actions)
@Composable
private fun BottomBar(browser: Browser, editing: Boolean, onEditing: (Boolean) -> Unit, onScreen: (Screen) -> Unit) {
    val tab = browser.active
    var text by remember { mutableStateOf("") }
    val focusRequester = remember { FocusRequester() }
    val focus = LocalFocusManager.current
    val store = browser.store
    LaunchedEffect(editing) {
        if (editing) { text = tab?.url ?: ""; focusRequester.requestFocus() }
    }
    Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp, shadowElevation = 8.dp) {
        Column(Modifier.navigationBarsPadding().imePadding()) {
            if (editing) {
                val suggestions = remember(text) { store.suggestions(text) }
                LazyColumn(Modifier.heightIn(max = 300.dp)) {
                    if (text.isNotBlank()) item {
                        SuggestionRow(Icons.Default.Search, text, "Search ${store.engine.label}") { browser.navigate("?$text"); onEditing(false); focus.clearFocus() }
                    }
                    items(suggestions) { (title, url) ->
                        SuggestionRow(Icons.Default.Star, title, Omnibox.display(url)) { tab?.let { browser.load(it, url) }; onEditing(false); focus.clearFocus() }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(
                    Modifier.weight(1f).height(44.dp).clip(RoundedCornerShape(22.dp))
                        .background(if (tab?.isPrivate == true) Violet.copy(alpha = 0.18f) else MaterialTheme.colorScheme.surfaceVariant)
                        .clickable(enabled = !editing) { onEditing(true) }.padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val secure = tab?.url?.startsWith("https://") == true
                    val icon = when {
                        tab?.blocked != null -> Icons.Default.Warning
                        tab != null && tab.isPrivate && tab.isHome -> Icons.Default.Lock
                        tab?.isHome != false -> Icons.Default.Search
                        secure -> Icons.Default.Lock
                        else -> Icons.Default.Info
                    }
                    Icon(icon, null, Modifier.size(18.dp).clickable { onScreen(Screen.SECURITY) },
                        tint = if (tab?.blocked != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.width(10.dp))
                    if (editing) {
                        BasicTextField(
                            value = text, onValueChange = { text = it }, singleLine = true,
                            textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                            keyboardActions = KeyboardActions(onGo = { browser.navigate(text); onEditing(false); focus.clearFocus() }),
                            modifier = Modifier.weight(1f).focusRequester(focusRequester).onFocusChanged { if (!it.isFocused && editing) onEditing(false) },
                            decorationBox = { inner -> if (text.isEmpty()) Text("Search or enter address", color = MaterialTheme.colorScheme.onSurfaceVariant); inner() },
                        )
                        IconButton({ text = "" }, Modifier.size(32.dp)) { Icon(Icons.Default.Close, "Clear", Modifier.size(18.dp)) }
                    } else {
                        Text(
                            if (tab == null || tab.isHome) (if (tab?.isPrivate == true) "Search privately" else "Search or enter address") else Omnibox.display(tab.url),
                            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                            color = if (tab == null || tab.isHome) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                        )
                        if (tab != null && !tab.isHome && tab.trackers > 0) {
                            Text("${tab.trackers}", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimary,
                                modifier = Modifier.clip(CircleShape).background(MaterialTheme.colorScheme.primary).padding(horizontal = 6.dp, vertical = 1.dp))
                        }
                        if (tab != null && !tab.isHome) {
                            IconButton({ if (tab.progress < 100) tab.webView?.stopLoading() else tab.webView?.reload() }, Modifier.size(34.dp)) {
                                Icon(if (tab.progress < 100) Icons.Default.Close else Icons.Default.Refresh, "Reload", Modifier.size(18.dp))
                            }
                        }
                    }
                }
                if (!editing) {
                    IconButton({ onScreen(Screen.AI) }) {
                        Box(Modifier.size(32.dp).clip(RoundedCornerShape(10.dp)).background(Brush.linearGradient(listOf(Clay, Violet))), contentAlignment = Alignment.Center) {
                            Icon(painterResource(R.drawable.ic_sparkle), "Nude AI", Modifier.size(18.dp), tint = Color.White)
                        }
                    }
                    IconButton({ onScreen(Screen.TABS) }) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(painterResource(R.drawable.ic_tabs), "Tabs", tint = MaterialTheme.colorScheme.onSurface)
                            Text("${browser.tabs.size}", fontSize = 10.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                    IconButton({ onScreen(Screen.MENU) }) { Icon(Icons.Default.MoreVert, "Menu") }
                }
            }
        }
    }
}

@Composable
private fun SuggestionRow(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, detail: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(detail, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun FindBar(tab: Tab, onClose: () -> Unit) {
    var q by remember { mutableStateOf("") }
    var result by remember { mutableStateOf("") }
    DisposableEffect(tab.id) {
        tab.webView?.setFindListener { active, count, done -> if (done) result = if (count == 0) "No matches" else "${active + 1} of $count" }
        onDispose { tab.webView?.setFindListener(null) }
    }
    Surface(Modifier.fillMaxWidth().padding(8.dp), shape = RoundedCornerShape(16.dp), tonalElevation = 6.dp, shadowElevation = 6.dp) {
        Row(Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(q, { q = it; tab.webView?.findAllAsync(it) }, Modifier.weight(1f).padding(vertical = 6.dp), placeholder = { Text("Find in page") }, singleLine = true)
            Text(result, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 8.dp))
            IconButton({ tab.webView?.findNext(false) }) { Icon(Icons.Default.KeyboardArrowUp, "Previous") }
            IconButton({ tab.webView?.findNext(true) }) { Icon(Icons.Default.KeyboardArrowDown, "Next") }
            IconButton({ tab.webView?.clearMatches(); onClose() }) { Icon(Icons.Default.Close, "Close") }
        }
    }
}

// ------------------------------------------------------------------ home (new tab)
private val DEFAULT_SHORTCUTS = listOf("Wikipedia" to "https://www.wikipedia.org/", "GitHub" to "https://github.com/", "News24" to "https://www.news24.com/", "YouTube" to "https://m.youtube.com/")

@Composable
private fun HomePage(browser: Browser, tab: Tab, onSearch: () -> Unit) {
    val store = browser.store
    val recent = remember(tab.id) { if (tab.isPrivate) emptyList() else store.history().take(5) }
    val shortcuts = remember(tab.id) { (store.bookmarks().take(8).map { it.title to it.url } + DEFAULT_SHORTCUTS).distinctBy { it.second }.take(8) }
    Column(
        Modifier.fillMaxSize().background(Brush.verticalGradient(listOf((if (tab.isPrivate) Violet else Clay).copy(alpha = 0.14f), MaterialTheme.colorScheme.background)))
            .verticalScroll(rememberScrollState()).padding(horizontal = 22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(72.dp))
        Box(Modifier.size(64.dp).clip(RoundedCornerShape(21.dp)).background(Brush.linearGradient(listOf(Clay, Violet))), contentAlignment = Alignment.Center) {
            Icon(painterResource(R.drawable.ic_sparkle), null, Modifier.size(34.dp), tint = Color.White)
        }
        Spacer(Modifier.height(16.dp))
        Text(if (tab.isPrivate) "Private browsing" else greeting(), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(22.dp))
        Row(
            Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(27.dp)).background(MaterialTheme.colorScheme.surface)
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(27.dp)).clickable(onClick = onSearch).padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Default.Search, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(12.dp))
            Text("Search ${store.engine.label} or type an address", color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (tab.isPrivate) {
            Spacer(Modifier.height(18.dp))
            Text(
                if (browser.privateProfilesSupported) "Nude won't save your history, cookies or site data from private tabs after you close them. Downloads and bookmarks are kept. Your internet provider and the sites you visit can still see your activity."
                else "Nude won't save history from private tabs. Your Android WebView version doesn't support separate private storage, so cookies are shared with normal tabs — update Android System WebView for full private browsing.",
                color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp,
            )
        } else {
            Spacer(Modifier.height(26.dp))
            shortcuts.chunked(4).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    row.forEach { (title, url) ->
                        Column(Modifier.width(76.dp).clip(RoundedCornerShape(16.dp)).clickable { browser.load(tab, url) }.padding(vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Box(Modifier.size(50.dp).clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surface).border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(16.dp)), contentAlignment = Alignment.Center) {
                                Text(Omnibox.host(url).take(1).uppercase(), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                            }
                            Spacer(Modifier.height(6.dp))
                            Text(title, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
            if (recent.isNotEmpty()) {
                Spacer(Modifier.height(20.dp))
                Text("Jump back in", Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(8.dp))
                recent.forEach { h ->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable { browser.load(tab, h.url) }.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Refresh, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.width(12.dp))
                        Column { Text(h.title, maxLines = 1, overflow = TextOverflow.Ellipsis); Text(Omnibox.host(h.url), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
            }
        }
        Spacer(Modifier.height(28.dp))
        Text("Nude Security has blocked ${store.blockedTrackers} trackers and ${store.blockedSites} dangerous sites", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(24.dp))
    }
}

private fun greeting(): String {
    val h = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
    return when { h < 5 -> "Good night"; h < 12 -> "Good morning"; h < 18 -> "Good afternoon"; else -> "Good evening" }
}

// ------------------------------------------------------------------ Nude Security warning page
@Composable
private fun BlockedPage(browser: Browser, tab: Tab, v: Security.Verdict) {
    val info = Security.categoryInfo[v.category ?: "suspicious"] ?: Security.categoryInfo.getValue("suspicious")
    val severe = v.action == Security.Action.BLOCK
    var understood by remember(v.url) { mutableStateOf(false) }
    val tint = if (severe) MaterialTheme.colorScheme.error else Color(0xFFB7791F)
    Column(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(tint.copy(alpha = 0.12f), MaterialTheme.colorScheme.background))).verticalScroll(rememberScrollState()).padding(24.dp)) {
        Spacer(Modifier.height(32.dp))
        Box(Modifier.size(68.dp).clip(RoundedCornerShape(22.dp)).background(tint.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
            Icon(painterResource(R.drawable.ic_shield), null, Modifier.size(36.dp), tint = tint)
        }
        Spacer(Modifier.height(16.dp))
        Text("NUDE SECURITY", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(info.first, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text(v.host, Modifier.clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal = 10.dp, vertical = 4.dp), fontSize = 13.sp)
        Spacer(Modifier.height(12.dp))
        Text(info.second, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(14.dp))
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text(if (v.confirmed) "Confirmed threat (on a known-threat list)" else "Suspected — based on warning signs, not confirmed", fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(8.dp))
                v.signals.forEach { Text("• ${it.message}", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
        Spacer(Modifier.height(12.dp))
        Text("What to do: ${info.third}", fontSize = 14.sp)
        Spacer(Modifier.height(20.dp))
        Button({ browser.backToSafety(tab) }, Modifier.fillMaxWidth().height(50.dp)) { Text("Back to safety") }
        v.intendedSite?.let { site ->
            Spacer(Modifier.height(8.dp))
            OutlinedButton({ tab.blocked = null; browser.load(tab, site) }, Modifier.fillMaxWidth().height(50.dp)) { Text("Go to ${Omnibox.host(site)} instead") }
        }
        if (!(v.confirmed && browser.store.level == Security.Level.MAXIMUM)) {
            Spacer(Modifier.height(24.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(understood, { understood = it })
                Text("I understand this site may steal my information or harm my device", fontSize = 13.sp)
            }
            TextButton({ browser.continueAnyway(tab) }, enabled = understood) { Text("Continue to ${v.host} (unsafe)", color = if (understood) MaterialTheme.colorScheme.error else Color.Gray) }
        }
    }
}

// ------------------------------------------------------------------ sheets
@Composable
private fun TabsSheet(browser: Browser, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxHeight(0.9f).padding(horizontal = 16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("${browser.tabs.size} tabs", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                FilledTonalButton({ browser.newTab(isPrivate = true); onDismiss() }) { Icon(Icons.Default.Lock, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Private") }
                Spacer(Modifier.width(8.dp))
                Button({ browser.newTab(); onDismiss() }) { Icon(Icons.Default.Add, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("New tab") }
            }
            Spacer(Modifier.height(12.dp))
            LazyVerticalGrid(GridCells.Adaptive(150.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(browser.tabs, key = { it.id }) { t ->
                    val active = t.id == browser.activeId
                    Card(
                        Modifier.fillMaxWidth().height(140.dp).clickable { browser.activeId = t.id; onDismiss() }
                            .then(if (active) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(12.dp)) else Modifier),
                        colors = CardDefaults.cardColors(containerColor = if (t.isPrivate) Violet.copy(alpha = 0.16f) else MaterialTheme.colorScheme.surfaceVariant),
                    ) {
                        Column(Modifier.padding(12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                t.favicon?.let { Image(it.asImageBitmap(), null, Modifier.size(16.dp)) } ?: Icon(if (t.isPrivate) Icons.Default.Lock else Icons.Default.Search, null, Modifier.size(16.dp))
                                Spacer(Modifier.weight(1f))
                                IconButton({ browser.closeTab(t) }, Modifier.size(24.dp)) { Icon(Icons.Default.Close, "Close tab", Modifier.size(16.dp)) }
                            }
                            Spacer(Modifier.height(10.dp))
                            Text(if (t.isHome) "New Tab" else t.title, maxLines = 3, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
                            Spacer(Modifier.weight(1f))
                            Text(if (t.isPrivate) "Private" else Omnibox.host(t.url), fontSize = 11.sp, maxLines = 1, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MenuSheet(browser: Browser, onDismiss: () -> Unit, onScreen: (Screen) -> Unit, onFind: () -> Unit) {
    val activity = LocalContext.current as MainActivity
    val tab = browser.active
    val store = browser.store
    var bookmarked by remember(tab?.url) { mutableStateOf(tab?.url?.let { store.isBookmarked(it) } ?: false) }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = 12.dp).padding(bottom = 24.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                IconButton({ tab?.webView?.goBack(); onDismiss() }, enabled = tab?.canGoBack == true) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                IconButton({ tab?.webView?.goForward(); onDismiss() }, enabled = tab?.canGoForward == true) { Icon(Icons.AutoMirrored.Filled.ArrowForward, "Forward") }
                IconButton({ tab?.webView?.reload(); onDismiss() }, enabled = tab?.isHome == false) { Icon(Icons.Default.Refresh, "Reload") }
                IconButton({ if (tab != null && tab.url.startsWith("http")) { bookmarked = store.toggleBookmark(tab.url, tab.title); browser.toast = if (bookmarked) "Bookmark added" else "Bookmark removed" } },
                    enabled = tab?.url?.startsWith("http") == true) { Icon(Icons.Default.Star, "Bookmark", tint = if (bookmarked) MaterialTheme.colorScheme.primary else LocalContentColor.current) }
                IconButton({ tab?.let { activity.share(it.url, it.title) } }, enabled = tab?.url?.startsWith("http") == true) { Icon(Icons.Default.Share, "Share") }
            }
            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            MenuItem(Icons.Default.Add, "New tab") { browser.newTab(); onDismiss() }
            MenuItem(Icons.Default.Lock, "New private tab") { browser.newTab(isPrivate = true); onDismiss() }
            MenuItem(Icons.Default.Star, "Bookmarks") { onScreen(Screen.BOOKMARKS) }
            MenuItem(Icons.Default.Refresh, "History") { onScreen(Screen.HISTORY) }
            MenuItem(Icons.Default.KeyboardArrowDown, "Downloads") { activity.openDownloads(); onDismiss() }
            MenuItem(Icons.Default.Search, "Find in page", enabled = tab?.isHome == false) { onFind() }
            MenuItem(Icons.Default.Info, if (store.desktopMode) "Request mobile site" else "Request desktop site") {
                store.desktopMode = !store.desktopMode
                browser.tabs.forEach { it.webView?.destroy(); it.webView = null }
                tab?.let { if (!it.isHome) browser.load(it, it.url) }
                onDismiss()
            }
            MenuItem(Icons.Default.Warning, "Nude Security") { onScreen(Screen.SECURITY) }
            MenuItem(Icons.Default.Settings, "Settings") { onScreen(Screen.SETTINGS) }
        }
    }
}

@Composable
private fun MenuItem(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 14.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, Modifier.size(20.dp), tint = if (enabled) MaterialTheme.colorScheme.onSurfaceVariant else Color.Gray)
        Spacer(Modifier.width(16.dp))
        Text(label, color = if (enabled) MaterialTheme.colorScheme.onSurface else Color.Gray)
    }
}

@Composable
private fun FullPage(title: String, onClose: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClose) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Close") }
                Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            }
            Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), content = content)
        }
    }
}

@Composable
private fun BookmarksPage(browser: Browser, onOpen: () -> Unit) {
    var list by remember { mutableStateOf(browser.store.bookmarks()) }
    if (list.isEmpty()) EmptyState("No bookmarks yet", "Tap ⋮ then ☆ to bookmark a page.")
    LazyColumn {
        items(list, key = { it.url }) { b ->
            ListRow(b.title, Omnibox.host(b.url), onClick = { browser.active?.let { browser.load(it, b.url) }; onOpen() }) {
                browser.store.removeBookmark(b.url); list = browser.store.bookmarks()
            }
        }
    }
}

@Composable
private fun HistoryPage(browser: Browser, onOpen: () -> Unit) {
    var list by remember { mutableStateOf(browser.store.history()) }
    var query by remember { mutableStateOf("") }
    OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), placeholder = { Text("Search history") }, singleLine = true, leadingIcon = { Icon(Icons.Default.Search, null) })
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.End) {
        TextButton({ browser.store.clearHistory(); list = emptyList() }) { Text("Clear all history") }
    }
    val shown = list.filter { query.isBlank() || it.title.contains(query, true) || it.url.contains(query, true) }
    if (shown.isEmpty()) EmptyState(if (query.isBlank()) "No history yet" else "No matches", "Private tabs are never saved.")
    LazyColumn {
        items(shown, key = { it.url }) { h ->
            ListRow(h.title, "${Omnibox.host(h.url)} · ${android.text.format.DateUtils.getRelativeTimeSpanString(h.lastVisit)}", onClick = { browser.active?.let { browser.load(it, h.url) }; onOpen() }) {
                browser.store.removeHistory(h.url); list = browser.store.history()
            }
        }
    }
}

@Composable
private fun ListRow(title: String, sub: String, onClick: () -> Unit, onDelete: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(vertical = 10.dp, horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
            Text(sub, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        IconButton(onDelete) { Icon(Icons.Default.Delete, "Delete", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
private fun EmptyState(title: String, body: String) {
    Column(Modifier.fillMaxWidth().padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(6.dp))
        Text(body, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
    }
}

// ------------------------------------------------------------------ settings & security
private val LEVEL_TEXT = mapOf(
    Security.Level.STANDARD to Triple("Standard Protection", "Blocks known dangerous sites and downloads, plus advertising and fingerprinting trackers.", "Best compatibility. All checks run on your phone."),
    Security.Level.ENHANCED to Triple("Enhanced Protection", "Also blocks suspicious sites, analytics trackers and third-party cookies.", "Catches more threats; a few sites may break."),
    Security.Level.MAXIMUM to Triple("Maximum Protection", "Strictest: blocks social trackers and risky downloads by default.", "Most private and secure; more sites will break or need your approval."),
)

@Composable
private fun SettingsPage(browser: Browser) {
    val store = browser.store
    val activity = LocalContext.current as MainActivity
    var engine by remember { mutableStateOf(store.engine) }
    var level by remember { mutableStateOf(store.level) }
    var theme by remember { mutableStateOf(store.theme) }
    var gateway by remember { mutableStateOf(store.aiGateway) }
    var search by remember { mutableStateOf(store.searchServer) }
    var token by remember { mutableStateOf(store.serviceToken) }
    Column(Modifier.verticalScroll(rememberScrollState())) {
        SectionTitle("Search engine")
        Omnibox.Engine.entries.forEach { e ->
            Row(Modifier.fillMaxWidth().clickable { engine = e; store.engine = e }.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                RadioButton(engine == e, { engine = e; store.engine = e }); Text(e.label)
            }
        }
        SectionTitle("Protection level")
        Security.Level.entries.forEach { l ->
            val (name, what, tradeoff) = LEVEL_TEXT.getValue(l)
            Card(
                Modifier.fillMaxWidth().padding(vertical = 4.dp).clickable { level = l; store.level = l }
                    .then(if (level == l) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(12.dp)) else Modifier),
            ) {
                Column(Modifier.padding(14.dp)) {
                    Text(name, fontWeight = FontWeight.SemiBold)
                    Text(what, fontSize = 13.sp)
                    Text("Trade-off: $tradeoff", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        SectionTitle("Appearance")
        Row { listOf("system" to "System", "light" to "Light", "dark" to "Dark").forEach { (k, l) ->
            FilterChip(theme == k, { theme = k; store.theme = k; activity.recreate() }, { Text(l) }, Modifier.padding(end = 8.dp))
        } }
        SectionTitle("Nude services")
        Text("Nude AI and Nude Search run on Nude servers. Enter their addresses here (API keys stay on the server).", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(gateway, { gateway = it; store.aiGateway = it }, Modifier.fillMaxWidth().padding(top = 8.dp), label = { Text("Nude AI gateway") }, placeholder = { Text("https://ai.example.com") }, singleLine = true)
        OutlinedTextField(search, { search = it; store.searchServer = it }, Modifier.fillMaxWidth().padding(top = 8.dp), label = { Text("Nude Search server") }, placeholder = { Text("https://search.example.com") }, singleLine = true)
        OutlinedTextField(token, { token = it; store.serviceToken = it }, Modifier.fillMaxWidth().padding(top = 8.dp), label = { Text("Access token (optional)") }, singleLine = true)
        SectionTitle("Default browser")
        Button({ activity.openDefaultBrowserSettings() }) { Text("Make Nude your default browser") }
        SectionTitle("About")
        Text("Nude ${BuildConfig.VERSION_NAME} for Android · Engine: Android System WebView (Chromium)", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(32.dp))
    }
}

@Composable
private fun SectionTitle(t: String) = Text(t, Modifier.padding(top = 22.dp, bottom = 8.dp), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)

@Composable
private fun SecurityPage(browser: Browser) {
    val store = browser.store
    val tab = browser.active
    var check by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<Security.Verdict?>(null) }
    val events = remember { store.events() }
    LazyColumn {
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp)) {
                    Text("● Protection is on", color = Color(0xFF2F8A57), fontWeight = FontWeight.SemiBold)
                    Text(LEVEL_TEXT.getValue(store.level).first, style = MaterialTheme.typography.titleLarge)
                    Spacer(Modifier.height(8.dp))
                    Text("${store.blockedSites} dangerous sites · ${store.blockedTrackers} trackers · ${store.blockedDownloads} downloads blocked", fontSize = 13.sp)
                }
            }
            if (tab != null && tab.url.startsWith("http")) {
                val v = Security.analyze(tab.url, store.level)
                Spacer(Modifier.height(12.dp))
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text("This page: ${v.host}", fontWeight = FontWeight.SemiBold)
                        Text(if (tab.url.startsWith("https")) "Connection is encrypted." else "Connection is NOT encrypted — don't enter passwords or card details.", fontSize = 13.sp)
                        Text(if (v.action == Security.Action.ALLOW) "No known threats. That isn't a guarantee — stay alert." else "Warning signs: " + v.signals.joinToString("; ") { it.message }, fontSize = 13.sp)
                        Text("${tab.trackers} trackers blocked on this page", fontSize = 13.sp)
                    }
                }
            }
            SectionTitle("Check a link")
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(check, { check = it }, Modifier.weight(1f), placeholder = { Text("Paste a link") }, singleLine = true)
                Spacer(Modifier.width(8.dp))
                Button({ result = Security.analyze(if (check.startsWith("http")) check else "https://$check", Security.Level.ENHANCED) }) { Text("Check") }
            }
            result?.let { r ->
                Text(
                    when { r.action == Security.Action.ALLOW -> "No warning signs found (not a guarantee)."; r.confirmed -> "Known dangerous site."; else -> "Suspicious: " + r.signals.joinToString("; ") { it.message } },
                    Modifier.padding(top = 8.dp), color = if (r.action == Security.Action.ALLOW) Color(0xFF2F8A57) else MaterialTheme.colorScheme.error,
                )
            }
            SectionTitle("Recent security events")
            if (events.isEmpty()) Text("All quiet — Nude Security hasn't had to step in yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        items(events) { e ->
            Column(Modifier.padding(vertical = 6.dp)) {
                Text(e.type.replace('-', ' ').replaceFirstChar { it.uppercase() }, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Text(e.detail, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

// ------------------------------------------------------------------ Nude AI
@Composable
private fun AiSheet(browser: Browser, onDismiss: () -> Unit) {
    val store = browser.store
    val scope = rememberCoroutineScope()
    val tab = browser.active
    val messages = remember { mutableStateListOf<ChatMessage>() }
    var input by remember { mutableStateOf("") }
    var sharePage by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()
    val activity = LocalContext.current as MainActivity

    fun send(text: String) {
        if (text.isBlank() || busy) return
        messages += ChatMessage("user", text)
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
                sources += JSONObject().put("id", "S2").put("kind", "security").put("title", "Nude Security site check").put("url", tab.url)
                    .put("content", JSONObject().put("action", v.action.name).put("confirmed", v.confirmed).put("signals", v.signals.joinToString("; ") { it.message }).toString())
                used += title
            }
            if (store.aiGateway.isBlank()) {
                val local = NudeAi.localAnswer(text, tab?.url, store.level)
                messages += if (local != null) ChatMessage("assistant", local, note = "Answered on your phone by Nude Security.")
                else ChatMessage("assistant", "Nude AI isn't set up yet. Add your Nude AI gateway address in Settings → Nude services. Safety questions like \"Is this website safe?\" or pasting a suspicious message work without it.", error = true)
                busy = false
                return@launch
            }
            messages += ChatMessage("assistant", "", sources = used)
            val idx = messages.lastIndex
            val r = NudeAi.ask(store.aiGateway, store.serviceToken, messages.dropLast(1), sources) { delta ->
                activity.runOnUiThread { messages[idx] = messages[idx].copy(text = messages[idx].text + delta) }
            }
            r.onFailure { e ->
                val local = NudeAi.localAnswer(text, tab?.url, store.level)
                messages[idx] = if (local != null) ChatMessage("assistant", local, note = "Answered on your phone — Nude AI isn't reachable.")
                else ChatMessage("assistant", "Nude AI isn't reachable (${e.message}).", error = true)
            }
            busy = false
        }
    }

    LaunchedEffect(messages.size, messages.lastOrNull()?.text?.length) { if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxHeight(0.92f).padding(horizontal = 16.dp).imePadding()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(28.dp).clip(RoundedCornerShape(9.dp)).background(Brush.linearGradient(listOf(Clay, Violet))), contentAlignment = Alignment.Center) {
                    Icon(painterResource(R.drawable.ic_sparkle), null, Modifier.size(16.dp), tint = Color.White)
                }
                Spacer(Modifier.width(10.dp))
                Text("Nude AI", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                IconButton({ messages.clear() }) { Icon(Icons.Default.Refresh, "New conversation") }
            }
            LazyColumn(Modifier.weight(1f), state = listState, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (messages.isEmpty()) item {
                    Column(Modifier.fillMaxWidth().padding(top = 32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("How can I help?", style = MaterialTheme.typography.titleLarge)
                        Spacer(Modifier.height(12.dp))
                        listOf("Summarise this page in five points" to true, "Is this website safe?" to false, "Explain this page like I'm in Grade 8" to true).forEach { (p, page) ->
                            AssistChip({ sharePage = page; send(p) }, { Text(p) }, Modifier.padding(4.dp))
                        }
                    }
                }
                items(messages) { m ->
                    val mine = m.role == "user"
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                        Column(
                            Modifier.widthIn(max = 320.dp).clip(RoundedCornerShape(18.dp))
                                .background(if (mine) MaterialTheme.colorScheme.primary else if (m.error) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant)
                                .padding(12.dp),
                        ) {
                            if (m.text.isEmpty() && !mine) Text("…") else Text(markdown(m.text), color = if (mine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface)
                            if (!mine && m.sources.isNotEmpty()) Text("Used: ${m.sources.joinToString()}", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
                            if (!mine && m.sources.isEmpty() && m.text.isNotEmpty() && !m.error) Text("No page content was shared.", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
                            m.note?.let { Text(it, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp)) }
                        }
                    }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 6.dp)) {
                FilterChip(sharePage, { sharePage = !sharePage }, { Text("Share this page") }, enabled = tab != null && tab.url.startsWith("http") && !tab.isHome)
            }
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 12.dp)) {
                OutlinedTextField(input, { input = it }, Modifier.weight(1f), placeholder = { Text("Ask anything…") }, maxLines = 5, shape = RoundedCornerShape(22.dp))
                Spacer(Modifier.width(8.dp))
                FilledIconButton({ send(input) }, enabled = !busy && input.isNotBlank()) { Icon(Icons.AutoMirrored.Filled.ArrowForward, "Send") }
            }
            Text("Nude AI only sees what you share. It can make mistakes.", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 8.dp))
        }
    }
}

/** Renders **bold** segments; everything else is plain text. */
private fun markdown(s: String) = buildAnnotatedString {
    val parts = s.split("**")
    parts.forEachIndexed { i, p -> if (i % 2 == 1) withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(p) } else append(p) }
}

@Suppress("unused")
@Composable
private fun FadeIn(visible: Boolean, content: @Composable () -> Unit) = AnimatedVisibility(visible, enter = fadeIn(), exit = fadeOut()) { content() }
