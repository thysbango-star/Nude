@file:OptIn(ExperimentalMaterial3Api::class)

package os.rovian.defender

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.launch
import os.rovian.core.glass.GlassBackground
import os.rovian.core.glass.GlassButton
import os.rovian.core.glass.GlassNavBar
import os.rovian.core.glass.GlassTheme
import os.rovian.core.glass.LocalGlass
import os.rovian.core.glass.NavItem
import os.rovian.defender.apps.AppReport
import os.rovian.defender.core.SecurityEvent
import os.rovian.defender.notify.Notifier
import os.rovian.defender.ui.*

/**
 * Rovian Defender: the dashboard, device and app checks, web protection, privacy centre and activity centre.
 * The screens only show and ask; the checks live in core/, device/, apps/, files/, web/ and privacy logic.
 */
class DefenderActivity : ComponentActivity() {
    private lateinit var state: DefenderState
    private val sharedText = mutableStateOf<String?>(null)
    private val sharedFile = mutableStateOf<Uri?>(null)
    private val startTab = mutableStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        state = DefenderState(applicationContext)
        handle(intent)
        Notifier.ensureChannel(this)
        Notifier.scheduleDaily(this)
        setContent {
            val dark = when (state.theme) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
            GlassTheme(dark) { App() }
        }
        // A quiet scan on open, so the dashboard always shows today's real state.
        lifecycleScope.launch { state.scan(quiet = true) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    override fun onResume() {
        super.onResume()
        if (state.pc.pc != null) lifecycleScope.launch { state.pc.refresh() }
    }

    private fun handle(i: Intent?) {
        if (i == null) return
        if (i.getStringExtra("tab") == "activity") startTab.value = 4
        if (i.action != Intent.ACTION_SEND) return
        val file = if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else @Suppress("DEPRECATION") i.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        if (file != null) { sharedFile.value = file; startTab.value = 0 }
        else i.getStringExtra(Intent.EXTRA_TEXT)?.let { sharedText.value = it; startTab.value = 2 }
    }

    @Composable
    private fun App() {
        val c = LocalGlass.current
        val scope = rememberCoroutineScope()
        var tab by remember { startTab }
        var app by remember { mutableStateOf<AppReport?>(null) }
        var event by remember { mutableStateOf<SecurityEvent?>(null) }
        var settings by remember { mutableStateOf(false) }
        var pcError by remember { mutableStateOf<String?>(null) }

        val notifyPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
        val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let { scope.launch { state.scanFile(it) } } }
        val scanQr = rememberLauncherForActivityResult(ScanContract()) { r -> r.contents?.let { text -> scope.launch { state.pc.link(text)?.let { state.pc.error = it; pcError = it } } } }
        val startScan: () -> Unit = {
            if (Build.VERSION.SDK_INT >= 33 && !Notifier.canNotify(this@DefenderActivity)) notifyPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            scope.launch { state.scan() }
        }
        val linkPc: () -> Unit = { scanQr.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE).setPrompt("Scan the Rovian Defender code in Nude on your PC").setBeepEnabled(false).setOrientationLocked(false)) }

        LaunchedEffect(sharedFile.value) { sharedFile.value?.let { state.scanFile(it); sharedFile.value = null } }
        BackHandler(tab != 0) { tab = 0 }

        GlassBackground {
            AnimatedContent(tab, transitionSpec = {
                (fadeIn(tween(260)) + scaleIn(tween(380, easing = FastOutSlowInEasing), initialScale = 0.98f)) togetherWith fadeOut(tween(140))
            }, label = "tab") { t ->
                when (t) {
                    0 -> HomeScreen(state, startScan, { pickFile.launch(arrayOf("*/*")) }, { tab = it }, { settings = true }, { event = it })
                    1 -> AppsScreen(state, startScan) { app = it }
                    2 -> WebScreen(state, sharedText.value, linkPc)
                    3 -> PrivacyScreen(state, startScan)
                    else -> ActivityScreen(state) { event = it }
                }
            }
            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, c.bgBottom.copy(alpha = 0.9f)))).navigationBarsPadding().padding(top = 24.dp, bottom = 12.dp),
                contentAlignment = Alignment.Center) {
                GlassNavBar(listOf(NavItem(Icons.Default.Home, "Home"), NavItem(Icons.Default.Phone, "Device"), NavItem(Icons.Default.Search, "Web"), NavItem(Icons.Default.Lock, "Privacy"), NavItem(Icons.Default.List, "Activity")), tab, { tab = it })
            }
        }

        val sheetColor = if (c.dark) Color(0xFF0A1640) else Color(0xFFF4F8FF)
        app?.let { a -> ModalBottomSheet(onDismissRequest = { app = null }, containerColor = sheetColor, contentColor = c.ink) { AppSheet(a) } }
        event?.let { e -> ModalBottomSheet(onDismissRequest = { event = null }, containerColor = sheetColor, contentColor = c.ink) { EventSheet(state, e) { event = null } } }
        state.file?.let { f -> ModalBottomSheet(onDismissRequest = { state.file = null }, containerColor = sheetColor, contentColor = c.ink) { FileSheet(f) } }
        if (settings) ModalBottomSheet(onDismissRequest = { settings = false }, containerColor = sheetColor, contentColor = c.ink) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp).padding(bottom = 30.dp)) {
                Text("Settings", color = c.ink, fontSize = 20.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.height(14.dp))
                Text("Appearance", color = c.faint, fontSize = 12.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                    listOf("system" to "System", "dark" to "Dark", "light" to "Light").forEach { (k, v) -> Chip(v, state.theme == k) { state.chooseTheme(k) } }
                }
                Spacer(Modifier.height(16.dp))
                Text("Alerts", color = c.faint, fontSize = 12.sp)
                Text(if (Notifier.canNotify(this@DefenderActivity)) "Rovian Defender will tell you about dangerous apps, files and critical settings. It checks your phone once a day on its own."
                    else "Notifications are off, so Rovian Defender can't warn you when its daily check finds something.", color = c.ink, fontSize = 13.5.sp, modifier = Modifier.padding(top = 4.dp))
                if (!Notifier.canNotify(this@DefenderActivity) && Build.VERSION.SDK_INT >= 33) {
                    Spacer(Modifier.height(8.dp)); GlassButton("Allow alerts", { notifyPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }, quiet = true)
                }
                Spacer(Modifier.height(16.dp))
                Text("History", color = c.faint, fontSize = 12.sp)
                Spacer(Modifier.height(6.dp))
                GlassButton("Clear security history", { state.events.clear() }, quiet = true)
                pcError?.let { Text(it, color = c.warn, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp)) }
                Spacer(Modifier.height(16.dp))
                Text("What Rovian Defender can and can't do", color = c.faint, fontSize = 12.sp)
                Text("Android keeps each app's files private, so no app can scan the whole phone for viruses. Rovian Defender checks your settings, what every app is allowed to do and where it came from, files you give it, and links you share. It never claims something is safe; it tells you what it found.",
                    color = c.muted, fontSize = 12.5.sp, lineHeight = 18.sp, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}
