@file:OptIn(ExperimentalMaterial3Api::class)

package os.rovian.passgate

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.BackHandler
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
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import os.rovian.core.LinkCode
import os.rovian.core.LinkError
import os.rovian.core.PhoneLinkClient
import os.rovian.core.glass.GlassBackground
import os.rovian.core.glass.GlassNavBar
import os.rovian.core.glass.GlassTheme
import os.rovian.core.glass.LocalGlass
import os.rovian.core.glass.NavItem
import os.rovian.core.phoneName

/**
 * PassGate: your Rovian identity on your phone, in Blue Liquid Glass.
 * It signs in only by scanning the code Nude shows on your PC (which carries the link key), opens only after
 * Android's BiometricPrompt says yes, and keeps its data encrypted with a Keystore key. It holds no passwords
 * or tokens, and shares nothing with Rovian Defender or Nebula.
 */
class PassGateActivity : FragmentActivity() {
    private lateinit var vault: Vault
    private val unlocked = mutableStateOf(false)
    private val phase = mutableStateOf(LockPhase.IDLE)
    private val lockMessage = mutableStateOf<String?>(null)
    private val busy = mutableStateOf(false)
    private val linking = mutableStateOf(false)
    private val error = mutableStateOf<String?>(null)
    private val phone = mutableStateOf(PhoneFacts(false, false, null))
    private val client = PhoneLinkClient()
    private val prefs by lazy { getSharedPreferences("passgate-ui", Context.MODE_PRIVATE) }
    private val theme = mutableStateOf("system")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        vault = Vault(applicationContext)
        theme.value = prefs.getString("theme", "system") ?: "system"
        readPhone()
        setContent {
            val dark = when (theme.value) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
            GlassTheme(dark) {
                GlassBackground {
                    val open = unlocked.value || !vault.lockEnabled || !phone.value.screenLock
                    AnimatedContent(open, transitionSpec = {
                        (fadeIn(tween(320)) + scaleIn(tween(420, easing = FastOutSlowInEasing), initialScale = 0.94f)) togetherWith fadeOut(tween(160))
                    }, label = "lock") { o ->
                        if (o) App() else LockScreen(phase.value, lockMessage.value, ::unlock)
                    }
                }
            }
        }
        if (vault.lockEnabled && phone.value.screenLock) unlock()
        lifecycleScope.launch {
            while (true) {
                if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) && vault.pc != null && isOpen()) refresh()
                delay(60_000)
            }
        }
    }

    override fun onStop() {
        super.onStop()
        // Lock again when PassGate leaves the screen.
        if (vault.lockEnabled && phone.value.screenLock && !isChangingConfigurations) { unlocked.value = false; phase.value = LockPhase.IDLE; lockMessage.value = null }
    }

    override fun onRestart() {
        super.onRestart()
        readPhone()
        if (vault.lockEnabled && phone.value.screenLock && !unlocked.value) unlock()
    }

    private fun isOpen() = unlocked.value || !vault.lockEnabled || !phone.value.screenLock

    private fun allowed() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) BIOMETRIC_STRONG or DEVICE_CREDENTIAL else BIOMETRIC_WEAK or DEVICE_CREDENTIAL

    private fun readPhone() {
        val secure = (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isDeviceSecure
        val bio = BiometricManager.from(this).canAuthenticate(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) BIOMETRIC_STRONG else BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS
        phone.value = PhoneFacts(secure, bio, vault.hardwareBacked())
    }

    /** Fingerprint, face or the phone's PIN before anything in PassGate is shown. The animation follows the prompt's real answer. */
    private fun unlock() {
        if (phase.value == LockPhase.ASKING || phase.value == LockPhase.SUCCESS) return
        if (BiometricManager.from(this).canAuthenticate(allowed()) != BiometricManager.BIOMETRIC_SUCCESS) {
            // No way to check on this phone: only open when the phone itself has no lock.
            unlocked.value = !phone.value.screenLock
            if (!unlocked.value) { phase.value = LockPhase.FAILED; lockMessage.value = "Android can't check your fingerprint or PIN right now. Try again in a moment." }
            return
        }
        phase.value = LockPhase.ASKING
        lockMessage.value = null
        BiometricPrompt(this, mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                phase.value = LockPhase.SUCCESS
                lifecycleScope.launch {
                    delay(650)
                    unlocked.value = true
                    phase.value = LockPhase.IDLE
                    vault.log("unlocked", "PassGate unlocked")
                    if (vault.pc != null) refresh()
                }
            }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                phase.value = LockPhase.FAILED
                lockMessage.value = when (errorCode) {
                    BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_CANCELED -> "Tap the fingerprint to try again."
                    BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> { vault.log("unlock-failed", "Too many tries to unlock PassGate"); "Too many tries. Unlock your phone with its PIN, then try again." }
                    else -> errString.toString()
                }
            }
        }).authenticate(BiometricPrompt.PromptInfo.Builder().setTitle("Unlock PassGate").setSubtitle("Confirm it's you").setAllowedAuthenticators(allowed()).build())
    }

    private fun lockNow() { unlocked.value = false; phase.value = LockPhase.IDLE; unlock() }

    /** Sign in: the code on the PC carries the key; PassGate pairs, then reads the verified identity. */
    private fun link(text: String) {
        val code = LinkCode.parse(text)
        if (code == null) {
            vault.log("code-rejected", "A code that isn't from Nude was scanned and ignored")
            error.value = "That isn't a code from Nude. On your PC, open Nude's menu and choose Connect your phone."; return
        }
        if (code.app != "passgate") {
            vault.log("code-rejected", "A Rovian Defender code was scanned in PassGate and ignored")
            error.value = "That code is for Rovian Defender. On your PC, choose PassGate and scan again."; return
        }
        lifecycleScope.launch {
            busy.value = true; linking.value = true; error.value = null
            try {
                val pc = withContext(Dispatchers.IO) { client.pair(code, phoneName()) }
                vault.link(pc)
                refresh()
            } catch (e: LinkError) {
                vault.log("link-failed", "Linking failed: ${e.userMessage}"); error.value = e.userMessage
            } catch (e: Exception) {
                vault.log("link-failed", "Linking failed"); error.value = "Signing in didn't work. Please try again."
            }
            busy.value = false; linking.value = false
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
            error.value = "PassGate couldn't reach ${pc.pcName}. Make sure it's on the same Wi-Fi with Nude open."
        } finally { busy.value = false }
    }

    private fun signOut() {
        val pc = vault.pc
        lifecycleScope.launch {
            if (pc != null) withContext(Dispatchers.IO) { client.unlink(pc) }
            vault.signOut()
        }
    }

    @Composable
    private fun App() {
        val c = LocalGlass.current
        var tab by remember { mutableIntStateOf(0) }
        var scanning by remember { mutableStateOf(false) }
        var security by remember { mutableStateOf(false) }
        var settings by remember { mutableStateOf(false) }
        val id = vault.identity
        val signedIn = vault.pc != null && id != null
        val scan = { error.value = null; scanning = true }
        val refreshNow: () -> Unit = { lifecycleScope.launch { refresh() } }
        BackHandler(signedIn && tab != 0 && !scanning) { tab = 0 }

        Box(Modifier.fillMaxSize()) {
            AnimatedContent(if (signedIn) tab else -1, transitionSpec = {
                (fadeIn(tween(260)) + scaleIn(tween(380, easing = FastOutSlowInEasing), initialScale = 0.98f)) togetherWith fadeOut(tween(140))
            }, label = "tab") { t ->
                if (t < 0 || id == null) WelcomeScreen(busy.value, error.value ?: vault.loadError, vault.pc != null, scan)
                else when (t) {
                    0 -> HomeScreen(vault, id, phone.value, busy.value, error.value, scan, { security = true }, { tab = it }, { settings = true })
                    1 -> AccountsScreen(id, busy.value, refreshNow)
                    2 -> DevicesScreen(vault, id, phone.value, busy.value, refreshNow, scan) { tab = 0; signOut() }
                    else -> ActivityScreen(id, vault)
                }
            }
            if (signedIn) {
                Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, c.bgBottom.copy(alpha = 0.92f))))
                    .navigationBarsPadding().padding(top = 24.dp, bottom = 12.dp), contentAlignment = Alignment.Center) {
                    GlassNavBar(listOf(NavItem(Icons.Default.Home, "Home"), NavItem(Icons.Default.AccountCircle, "Accounts"), NavItem(Icons.Default.Phone, "Devices"), NavItem(Icons.Default.List, "Activity")),
                        tab, { tab = it })
                }
            }
            AnimatedVisibility(scanning, enter = slideInVertically(tween(360, easing = FastOutSlowInEasing)) { it / 3 } + fadeIn(tween(240)),
                exit = slideOutVertically(tween(260)) { it / 3 } + fadeOut(tween(200))) {
                Scanner("Point at the PassGate code in Nude on your PC", onResult = { text -> scanning = false; link(text) }, onClose = { scanning = false })
            }
            AnimatedVisibility(linking.value, enter = fadeIn(tween(200)), exit = fadeOut(tween(300))) { LinkingOverlay(vault.pc?.pcName) }
        }

        val sheet = if (c.dark) Color(0xFF0A1640) else Color(0xFFF4F8FF)
        if (security) ModalBottomSheet(onDismissRequest = { security = false }, containerColor = sheet, contentColor = c.ink) { SecuritySheet(vault, id, phone.value) }
        if (settings) ModalBottomSheet(onDismissRequest = { settings = false }, containerColor = sheet, contentColor = c.ink) {
            SettingsSheet(vault, phone.value, theme.value, { t -> theme.value = t; prefs.edit().putString("theme", t).apply() },
                onLockNow = { settings = false; lockNow() }, onSignOut = { settings = false; tab = 0; signOut() })
        }
    }
}
