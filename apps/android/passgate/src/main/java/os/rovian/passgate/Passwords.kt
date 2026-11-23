package os.rovian.passgate

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import os.rovian.core.glass.GlassButton
import os.rovian.core.glass.GlassCard
import os.rovian.core.glass.LocalGlass
import os.rovian.core.glass.StatusPill
import os.rovian.core.glass.glassEdge
import java.util.UUID

/** Your saved logins, with search. Passwords stay hidden until you open one. */
@Composable
fun PasswordsScreen(vault: Vault, onScan: () -> Unit, onEdit: (Login?) -> Unit) {
    val c = LocalGlass.current
    var q by remember { mutableStateOf("") }
    val shown = vault.logins.filter { q.isBlank() || it.site.contains(q.trim(), true) || it.username.contains(q.trim(), true) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(horizontal = 20.dp)) {
        Spacer(Modifier.height(18.dp))
        Text("Your logins", color = c.muted, fontSize = 12.sp)
        Text("Passwords", color = c.ink, fontSize = 24.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(12.dp))
        GlassCard(Modifier.fillMaxWidth(), strong = true) {
            Text("Sign in on your computer", color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            Text("On a sign-in page in Nude, click the key in the address bar, then scan the code here and pick your login. It's sent encrypted, for that site only.",
                color = c.muted, fontSize = 12.5.sp, lineHeight = 17.sp, modifier = Modifier.padding(top = 4.dp, bottom = 12.dp))
            GlassButton("Scan Nude's code", onScan, Modifier.fillMaxWidth(), icon = Icons.Default.Search)
        }
        Spacer(Modifier.height(14.dp))
        OutlinedTextField(q, { q = it }, Modifier.fillMaxWidth(), placeholder = { Text("Search sites and usernames") }, singleLine = true,
            leadingIcon = { Icon(Icons.Default.Search, null) }, shape = RoundedCornerShape(16.dp),
            colors = OutlinedTextFieldDefaults.colors(focusedTextColor = c.ink, unfocusedTextColor = c.ink, focusedBorderColor = c.electric, unfocusedBorderColor = c.ink.copy(alpha = 0.12f), cursorColor = c.electric))
        Spacer(Modifier.height(12.dp))
        GlassCard(Modifier.fillMaxWidth(), padding = 6.dp) {
            if (shown.isEmpty()) Text(if (vault.logins.isEmpty()) "No logins yet. Add the ones you use, then send them to Nude when you sign in." else "Nothing matches.",
                color = c.muted, fontSize = 13.sp, modifier = Modifier.padding(12.dp))
            shown.forEach { l -> LoginRow(l) { onEdit(l) } }
        }
        Spacer(Modifier.height(14.dp))
        GlassButton("Add a login", { onEdit(null) }, Modifier.fillMaxWidth(), icon = Icons.Default.Add, quiet = true)
        Text("Logins stay encrypted on this phone. PassGate never sends them to Rovian Defender, Nebula or anyone else, only to Nude when you pick one.",
            color = c.faint, fontSize = 11.5.sp, lineHeight = 16.sp, modifier = Modifier.padding(top = 14.dp, bottom = 120.dp))
    }
}

@Composable
private fun LoginRow(l: Login, onClick: () -> Unit) {
    val c = LocalGlass.current
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(11.dp)).background(c.electric.copy(alpha = 0.9f)), contentAlignment = Alignment.Center) {
            Text(l.site.firstOrNull()?.uppercase() ?: "?", color = Color.White, fontWeight = FontWeight.Medium)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(l.site, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(l.username.ifBlank { "No username" }, color = c.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(Icons.Default.KeyboardArrowRight, null, tint = c.muted)
    }
}

/** Add or change a login. The password is hidden unless you show it; Generate makes a strong one. */
@Composable
fun LoginEditor(existing: Login?, prefillSite: String? = null, onSave: (Login) -> Unit, onDelete: (() -> Unit)?, onCancel: () -> Unit) {
    val c = LocalGlass.current
    var site by remember { mutableStateOf(existing?.site ?: prefillSite ?: "") }
    var user by remember { mutableStateOf(existing?.username ?: "") }
    var pw by remember { mutableStateOf(existing?.password ?: "") }
    var notes by remember { mutableStateOf(existing?.notes ?: "") }
    var show by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 30.dp)) {
        Text(if (existing == null) "Add a login" else existing.site, color = c.ink, fontSize = 20.sp, fontWeight = FontWeight.Medium)
        Field(site, { site = it }, "Site (for example github.com)", KeyboardType.Uri)
        Field(user, { user = it }, "Username or email", KeyboardType.Email)
        Field(pw, { pw = it }, "Password", KeyboardType.Password, secret = !show, mono = show)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
            TextButton({ show = !show }) { Text(if (show) "Hide" else "Show", color = c.electric) }
            TextButton({ pw = Logins.generate(); show = true }) { Text("Generate a strong one", color = c.electric) }
        }
        Field(notes, { notes = it.take(500) }, "Notes (optional)", KeyboardType.Text)
        Spacer(Modifier.height(14.dp))
        GlassButton("Save", { onSave(Login(existing?.id ?: UUID.randomUUID().toString(), site, user.trim(), pw, notes, 0, 0)) }, Modifier.fillMaxWidth(),
            enabled = Logins.clean(site).contains('.') && pw.isNotEmpty())
        Spacer(Modifier.height(8.dp))
        GlassButton("Cancel", onCancel, Modifier.fillMaxWidth(), quiet = true)
        if (onDelete != null) TextButton({ if (confirmDelete) onDelete() else confirmDelete = true }, Modifier.align(Alignment.CenterHorizontally).padding(top = 6.dp)) {
            Text(if (confirmDelete) "Tap again to delete" else "Delete this login", color = c.danger)
        }
    }
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, label: String, kind: KeyboardType, secret: Boolean = false, mono: Boolean = false) {
    val c = LocalGlass.current
    OutlinedTextField(value, onChange, Modifier.fillMaxWidth().padding(top = 10.dp), label = { Text(label) }, singleLine = true,
        visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
        textStyle = LocalTextStyle.current.copy(fontFamily = if (mono) FontFamily.Monospace else LocalTextStyle.current.fontFamily),
        keyboardOptions = KeyboardOptions(keyboardType = kind, autoCorrectEnabled = false), shape = RoundedCornerShape(14.dp),
        colors = OutlinedTextFieldDefaults.colors(focusedTextColor = c.ink, unfocusedTextColor = c.ink, focusedBorderColor = c.electric, unfocusedBorderColor = c.ink.copy(alpha = 0.15f),
            focusedLabelColor = c.electric, unfocusedLabelColor = c.muted, cursorColor = c.electric))
}

/**
 * Nude asked for a login. Shows which site and which computer asked, and only the logins saved for that site.
 * Sending needs your fingerprint, face or PIN (onSend does that).
 */
@Composable
fun SendLoginSheet(req: LoginRequest, vault: Vault, sending: Boolean, result: String?, onSend: (Login) -> Unit, onAdd: () -> Unit, onClose: () -> Unit) {
    val c = LocalGlass.current
    val matches = vault.logins.filter { it.matches(req.host) }
    val linkedPc = vault.pc?.pcName
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 30.dp)) {
        Text("Sign in on ${req.pcName}", color = c.ink, fontSize = 20.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(10.dp))
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.glassStrong).border(1.dp, glassEdge(), RoundedCornerShape(16.dp)).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.Lock, null, tint = c.good)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(req.host, color = c.ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Text("The site Nude is showing. Check it's the one you meant to sign in to.", color = c.muted, fontSize = 12.sp)
            }
        }
        if (linkedPc != null && linkedPc != req.pcName) {
            Text("This code says it's from \"${req.pcName}\", not your linked PC \"$linkedPc\". Only continue if you're sitting at that computer.",
                color = c.warn, fontSize = 12.5.sp, modifier = Modifier.padding(top = 10.dp))
        }
        Spacer(Modifier.height(12.dp))
        when {
            result != null -> {
                Text(result, color = c.ink, fontSize = 14.sp)
                Spacer(Modifier.height(12.dp)); GlassButton("Done", onClose, Modifier.fillMaxWidth())
            }
            matches.isEmpty() -> {
                Text("You have no login saved for ${req.host}. PassGate only sends a login to the site it was saved for.", color = c.muted, fontSize = 13.sp)
                Spacer(Modifier.height(12.dp))
                GlassButton("Add a login for ${req.host}", onAdd, Modifier.fillMaxWidth(), icon = Icons.Default.Add)
                Spacer(Modifier.height(8.dp)); GlassButton("Cancel", onClose, Modifier.fillMaxWidth(), quiet = true)
            }
            else -> {
                Text("Pick the login to send. You'll confirm with your fingerprint, face or PIN.", color = c.muted, fontSize = 13.sp)
                Spacer(Modifier.height(8.dp))
                GlassCard(Modifier.fillMaxWidth(), padding = 6.dp) {
                    matches.forEach { l ->
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable(enabled = !sending) { onSend(l) }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(l.username.ifBlank { "No username" }, color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                                Text(l.site, color = c.muted, fontSize = 12.sp)
                            }
                            if (sending) CircularProgressIndicator(Modifier.size(18.dp), color = c.electric, strokeWidth = 2.dp) else StatusPill("Send", c.electric)
                        }
                    }
                }
                Spacer(Modifier.height(8.dp)); GlassButton("Cancel", onClose, Modifier.fillMaxWidth(), quiet = true)
            }
        }
    }
}
