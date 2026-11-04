@file:OptIn(ExperimentalMaterial3Api::class)

package os.rovian.passgate

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
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
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import os.rovian.core.LoopbackReceiver
import os.rovian.core.MatteCard
import os.rovian.core.Rise
import os.rovian.core.RovianColors
import os.rovian.core.RovianError
import os.rovian.core.RovianIdentity
import os.rovian.core.RovianSignIn
import os.rovian.core.RovianTheme
import java.net.BindException
import java.text.DateFormat

/** Sign-in progress, shown on the provider card. */
sealed interface LinkState {
    data object Idle : LinkState
    data object Opening : LinkState
    data object Waiting : LinkState
    data object Verifying : LinkState
    data class Done(val account: LinkedAccount) : LinkState
    data class Failed(val message: String) : LinkState
}

class PassGateActivity : FragmentActivity() {
    private lateinit var vault: Vault
    private val unlocked = mutableStateOf(false)
    private val link = mutableStateOf<LinkState>(LinkState.Idle)
    private val signIn = RovianSignIn()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        vault = Vault(applicationContext)
        setContent {
            RovianTheme {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    AnimatedContent(unlocked.value || !vault.lockEnabled || !deviceSecure(), transitionSpec = {
                        (fadeIn(tween(260)) + scaleIn(tween(320, easing = FastOutSlowInEasing), initialScale = 0.96f)) togetherWith fadeOut(tween(140))
                    }, label = "lock") { open ->
                        if (open) Dashboard(vault, link.value, ::startRovian, onResetLink = { link.value = LinkState.Idle }, deviceSecure = deviceSecure())
                        else LockScreen(::unlock)
                    }
                }
            }
        }
        if (vault.lockEnabled && deviceSecure()) unlock()
    }

    private fun deviceSecure() = (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isDeviceSecure

    /** Rovian Defender's gate: fingerprint, face or the phone's PIN before anything in PassGate is shown. */
    private fun unlock() {
        val allowed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) BIOMETRIC_STRONG or DEVICE_CREDENTIAL else BIOMETRIC_WEAK or DEVICE_CREDENTIAL
        if (BiometricManager.from(this).canAuthenticate(allowed) != BiometricManager.BIOMETRIC_SUCCESS) { unlocked.value = !deviceSecure(); return }
        BiometricPrompt(this, mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { unlocked.value = true }
        }).authenticate(BiometricPrompt.PromptInfo.Builder().setTitle("Unlock PassGate").setSubtitle("Protected by Rovian Defender").setAllowedAuthenticators(allowed).build())
    }

    /**
     * Sign in with Rovian: PKCE in memory, Rovian's own pages in a secure browser tab, the loopback redirect caught by
     * this app on 127.0.0.1, then the token exchange and ID-token checks here. Only the verified identity is kept.
     */
    private fun startRovian() {
        if (link.value is LinkState.Opening || link.value is LinkState.Waiting || link.value is LinkState.Verifying) return
        link.value = LinkState.Opening
        lifecycleScope.launch {
            val receiver = try { withContext(Dispatchers.IO) { LoopbackReceiver() } }
                catch (e: BindException) { link.value = LinkState.Failed("Another sign-in is already open. Finish or close it, then try again."); return@launch }
                catch (e: Exception) { link.value = LinkState.Failed("PassGate couldn't start the sign-in. Please try again."); return@launch }
            try {
                val (url, pending) = withContext(Dispatchers.IO) { signIn.begin() }
                CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this@PassGateActivity, Uri.parse(url))
                link.value = LinkState.Waiting
                val query = withContext(Dispatchers.IO) { receiver.await("PassGate") }
                    ?: run { link.value = LinkState.Failed("The sign-in took too long. Please start again."); return@launch }
                // Back to PassGate (this also closes Rovian's tab).
                startActivity(Intent(this@PassGateActivity, PassGateActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
                link.value = LinkState.Verifying
                val identity: RovianIdentity = withContext(Dispatchers.IO) { signIn.complete(query, pending) }
                link.value = LinkState.Done(vault.link(identity))
            } catch (e: RovianError) {
                vault.log("failed", "A Rovian sign-in didn't complete (${e.code})")
                link.value = LinkState.Failed(e.userMessage)
            } catch (e: Exception) {
                link.value = LinkState.Failed("Signing in with Rovian didn't work. Please try again.")
            } finally {
                receiver.close()
            }
        }
    }
}

@Composable
private fun LockScreen(onUnlock: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        GateMark(84)
        Text("PassGate is locked", fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 18.dp))
        Text("Use your fingerprint, face or PIN to open it.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
        Button(onUnlock, Modifier.padding(top = 22.dp).height(52.dp), shape = RoundedCornerShape(16.dp)) { Icon(Icons.Default.Lock, null); Spacer(Modifier.width(8.dp)); Text("Unlock") }
        DefenderChip(Modifier.padding(top = 28.dp)) {}
    }
}

@Composable
private fun GateMark(size: Int) {
    Box(Modifier.size(size.dp).clip(RoundedCornerShape((size * 0.3f).dp)).background(RovianColors.ShieldBrush), contentAlignment = Alignment.Center) {
        Image(painterResource(R.drawable.ic_passgate_mark), "PassGate", Modifier.size((size * 1.3f).dp))
    }
}

@Composable
private fun DefenderChip(modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(modifier.clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.surfaceVariant).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Image(painterResource(os.rovian.core.R.drawable.ic_rovian_mark), null, Modifier.size(14.dp, 16.dp))
        Spacer(Modifier.width(6.dp))
        Text("Protected by Rovian Defender", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun Dashboard(vault: Vault, link: LinkState, onRovian: () -> Unit, onResetLink: () -> Unit, deviceSecure: Boolean) {
    var adding by remember { mutableStateOf(false) }
    var security by remember { mutableStateOf(false) }
    LaunchedEffect(link) { if (link is LinkState.Done) { kotlinx.coroutines.delay(900); adding = false; onResetLink() } }
    BackHandler(adding || security) { adding = false; security = false; if (link is LinkState.Failed) onResetLink() }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().navigationBarsPadding().padding(horizontal = 18.dp)) {
        Row(Modifier.fillMaxWidth().padding(top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            GateMark(40)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("PassGate", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
            }
        }
        DefenderChip(Modifier.padding(top = 10.dp)) { security = !security }
        vault.loadError?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp, modifier = Modifier.padding(top = 10.dp)) }
        AnimatedVisibility(security, enter = expandVertically(spring(dampingRatio = 0.85f, stiffness = Spring.StiffnessMediumLow)) + fadeIn(), exit = shrinkVertically(tween(200)) + fadeOut()) {
            SecurityOverview(vault, deviceSecure)
        }

        // The Add Account button grows into the provider selector.
        AnimatedContent(adding, Modifier.padding(top = 18.dp), transitionSpec = {
            (fadeIn(tween(220, 60)) togetherWith fadeOut(tween(120))) using SizeTransform { _, _ -> spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow) }
        }, label = "add") { open ->
            if (!open) {
                Button({ adding = true }, Modifier.fillMaxWidth().height(56.dp), shape = RoundedCornerShape(18.dp)) {
                    Icon(Icons.Default.Add, null); Spacer(Modifier.width(8.dp)); Text("Add account", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }
            } else ProviderPicker(link, onRovian, onClose = { adding = false; onResetLink() })
        }

        Section("Connected accounts")
        if (vault.accounts.isEmpty()) Text("No accounts yet. Add your Rovian Account to get started.", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
        vault.accounts.forEachIndexed { i, a -> key(a.identity.sub) { Rise(i * 60, Modifier.fillMaxWidth().padding(bottom = 10.dp)) { AccountCard(vault, a) } } }

        Section("Passkey Vault")
        MatteCard(Modifier.fillMaxWidth()) {
            Text("Your passkeys stay with your phone's passkey provider", fontWeight = FontWeight.SemiBold)
            Text("Android keeps passkeys in Google Password Manager (or the provider you chose), protected by your screen lock. Android doesn't let other apps list them, so PassGate can't show them here yet. Making PassGate a passkey provider is next.",
                fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
        }

        Section("Rovian Portal")
        MatteCard(Modifier.fillMaxWidth()) {
            Text("Manage your Rovian identity", fontWeight = FontWeight.SemiBold)
            Text("Connected services, devices, sessions and recovery live in the Rovian Portal. PassGate will open it from here once its address is published.",
                fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
        }

        Section("Recent activity")
        if (vault.activity.isEmpty()) Text("Nothing yet.", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
        vault.activity.take(8).forEach { ev ->
            Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(if (ev.kind == "failed") RovianColors.Amber else RovianColors.Sky))
                Spacer(Modifier.width(12.dp))
                Column { Text(ev.detail, fontSize = 14.sp); Text(ago(ev.time), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }

        Section("Settings")
        MatteCard(Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Lock PassGate", fontWeight = FontWeight.SemiBold)
                    Text(if (deviceSecure) "Ask for your fingerprint, face or PIN when PassGate opens." else "Set a screen lock on your phone first.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(vault.lockEnabled && deviceSecure, { vault.setLock(it) }, enabled = deviceSecure)
            }
            HorizontalDivider(Modifier.padding(vertical = 12.dp), color = MaterialTheme.colorScheme.outlineVariant)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { Text("Recent activity", fontWeight = FontWeight.SemiBold); Text("Kept encrypted on this phone.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                TextButton({ vault.clearActivity() }) { Text("Clear") }
            }
        }
        Text("PassGate keeps your verified Rovian identity, encrypted with a key in your phone's secure keystore. It never stores your Rovian password or sign-in tokens.",
            fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 22.dp))
    }
}

@Composable
private fun Section(title: String) {
    Text(title, fontWeight = FontWeight.Bold, fontSize = 17.sp, modifier = Modifier.padding(top = 26.dp, bottom = 10.dp))
}

@Composable
private fun ProviderPicker(link: LinkState, onRovian: () -> Unit, onClose: () -> Unit) {
    MatteCard(Modifier.fillMaxWidth().animateContentSize(spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow))) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Add an account", fontWeight = FontWeight.Bold, fontSize = 17.sp, modifier = Modifier.weight(1f))
            IconButton(onClose) { Icon(Icons.Default.Close, "Close") }
        }
        // Rovian: the selected provider card expands to show progress.
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable(enabled = link is LinkState.Idle || link is LinkState.Failed, onClick = onRovian).padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Image(painterResource(os.rovian.core.R.drawable.ic_rovian_mark), null, Modifier.size(30.dp, 34.dp))
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Rovian Account", fontWeight = FontWeight.SemiBold)
                    Text("Your name@rovian.cloud identity", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                when (link) {
                    is LinkState.Opening, is LinkState.Waiting, is LinkState.Verifying -> Spinner()
                    is LinkState.Done -> Icon(Icons.Default.CheckCircle, "Connected", tint = RovianColors.Green)
                    else -> Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null)
                }
            }
            AnimatedContent(link, transitionSpec = { fadeIn(tween(200)) togetherWith fadeOut(tween(120)) }, label = "status") { s ->
                val msg = when (s) {
                    LinkState.Opening -> "Opening Rovian Account…"
                    LinkState.Waiting -> "Sign in and approve on Rovian's page, then you'll come back here."
                    LinkState.Verifying -> "Checking your sign-in with Rovian Defender…"
                    is LinkState.Done -> "Connected ${s.account.identity.rovianId ?: s.account.identity.email}"
                    is LinkState.Failed -> s.message
                    LinkState.Idle -> null
                }
                if (msg != null) Text(msg, fontSize = 13.sp, color = if (s is LinkState.Failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 10.dp))
            }
        }
        Spacer(Modifier.height(10.dp))
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(18.dp)).padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(32.dp).clip(CircleShape).background(Color.White), contentAlignment = Alignment.Center) { Text("G", fontWeight = FontWeight.Bold, color = Color(0xFF4285F4)) }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Google account", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("Needs a Google sign-in client for PassGate before it can be turned on.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun Spinner() {
    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.5.dp)
}

@Composable
private fun AccountCard(vault: Vault, a: LinkedAccount) {
    var confirm by remember { mutableStateOf(false) }
    val id = a.identity
    MatteCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(44.dp).clip(CircleShape).background(RovianColors.ShieldBrush), contentAlignment = Alignment.Center) {
                Text(id.name.split(' ').take(2).mapNotNull { it.firstOrNull()?.uppercaseChar() }.joinToString(""), color = Color.White, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(id.name, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(id.rovianId ?: id.email, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Image(painterResource(os.rovian.core.R.drawable.ic_rovian_mark), "Rovian", Modifier.size(18.dp, 21.dp))
        }
        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Pill("Verified by Rovian", RovianColors.Green)
            if (id.emailVerified) Pill("Email verified", RovianColors.Sky)
            if (a.preferred) Pill("Default", RovianColors.Blue)
        }
        Text("Connected ${DateFormat.getDateInstance(DateFormat.MEDIUM).format(a.linkedAt)} · last used ${ago(a.lastUsed)}", fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
        Row(Modifier.padding(top = 4.dp)) {
            if (!a.preferred) TextButton({ vault.makePreferred(id.sub) }) { Text("Make default") }
            Spacer(Modifier.weight(1f))
            TextButton({ if (confirm) vault.remove(id.sub) else confirm = true }) {
                Text(if (confirm) "Tap again to remove" else "Remove", color = if (confirm) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
            }
        }
    }
}

@Composable
private fun Pill(text: String, color: Color) {
    Text(text, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = color,
        modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(color.copy(alpha = 0.13f)).padding(horizontal = 8.dp, vertical = 3.dp))
}

/** Real state only: what PassGate actually does today. */
@Composable
private fun SecurityOverview(vault: Vault, deviceSecure: Boolean) {
    val hw = remember { vault.hardwareBacked() }
    MatteCard(Modifier.fillMaxWidth().padding(top = 12.dp)) {
        Text("Rovian Defender", fontWeight = FontWeight.Bold, fontSize = 16.sp)
        val rows = listOf(
            Triple("Account protection", if (hw == true) "Encrypted with a hardware-backed key" else "Encrypted with a key in the Android Keystore", true),
            Triple("App lock", if (!deviceSecure) "Your phone has no screen lock" else if (vault.lockEnabled) "Fingerprint, face or PIN required" else "Off", deviceSecure && vault.lockEnabled),
            Triple("Sign-in checks", "Rovian sign-ins use PKCE, state and nonce, and a verified ID token", true),
            Triple("Stored tokens", "None. PassGate keeps only verified identities", true),
            Triple("Passkeys", "Held by your phone's passkey provider", true),
            Triple("Linked devices and sessions", "None yet. Pairing with Nude is coming", true),
        )
        rows.forEach { (k, v, ok) ->
            Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.Top) {
                Icon(if (ok) Icons.Default.CheckCircle else Icons.Default.Warning, null, tint = if (ok) RovianColors.Green else RovianColors.Amber, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(10.dp))
                Column { Text(k, fontWeight = FontWeight.SemiBold, fontSize = 14.sp); Text(v, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
        val failed = vault.activity.count { it.kind == "failed" && System.currentTimeMillis() - it.time < 7 * 86_400_000L }
        if (failed > 0) Text("$failed sign-in${if (failed == 1) "" else "s"} didn't complete in the last week. If that wasn't you, change your Rovian password.",
            fontSize = 13.sp, color = RovianColors.Amber, modifier = Modifier.padding(top = 12.dp))
    }
}

private fun ago(t: Long): String {
    val s = (System.currentTimeMillis() - t) / 1000
    return when { s < 60 -> "just now"; s < 3600 -> "${s / 60} min ago"; s < 86_400 -> "${s / 3600} h ago"; else -> DateFormat.getDateInstance(DateFormat.SHORT).format(t) }
}
