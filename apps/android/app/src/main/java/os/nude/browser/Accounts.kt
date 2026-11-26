package os.nude.browser

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import os.rovian.core.meditate.MeditateAuth
import os.rovian.core.meditate.MeditateConfig
import os.rovian.core.meditate.MeditateError
import os.rovian.core.meditate.MeditateIdentity
import os.rovian.core.nudeid.NudeAccount
import os.rovian.core.nudeid.NudeId
import os.rovian.core.nudeid.NudeIdError

/**
 * Your Nude ID in the Nude browser on this phone. Who you are comes from Nude Accounts; the sign-in token is kept
 * encrypted by [NudeId] (Android Keystore). Your password is sent to Nude Accounts and never stored here.
 */
class Accounts(context: Context, meditateConfig: () -> MeditateConfig) {
    private val prefs = context.getSharedPreferences("nude-accounts", Context.MODE_PRIVATE)
    val id = NudeId(context, "browser")
    /** Continue with Meditate (the Nude sign-in site). */
    val meditate = MeditateAuth(context, meditateConfig)

    /** The Nude ID you signed in to with Meditate (identity only, no token), if any. */
    private fun savedMeditate(): NudeAccount? = prefs.getString("meditate", null)?.let { runCatching { NudeAccount.from(JSONObject(it)) }.getOrNull() }

    /** Signed-in Nude ID, or null for guest. Compose re-renders when it changes. */
    var current by mutableStateOf<NudeAccount?>(savedMeditate() ?: id.account?.takeIf { id.signedIn })
        private set
    /** True when the current Nude ID signs in with Meditate (so Nude Accounts features don't apply). */
    val isMeditate get() = current?.id?.startsWith("meditate:") == true
    /** True while Meditate is open in a tab for you to sign in. */
    var meditateOpen by mutableStateOf(false)
    /** True until you sign in, create a Nude ID or choose to continue without one. */
    var needsWelcome by mutableStateOf(current == null && !prefs.getBoolean("welcomed", false))
        private set
    /** False when Nude Accounts runs without permanent storage (test mode). */
    var persistent by mutableStateOf(true)
        private set

    init {
        // Accounts from before Nude IDs lived only on this phone; they can't sign in any more.
        if (prefs.contains("accounts")) prefs.edit().remove("accounts").remove("current").apply()
    }

    /** The Nude ID last used here, to prefill the sign-in form. */
    fun lastUsername(): String = prefs.getString("lastUser", "") ?: ""

    /** Returns an error message, or null on success. */
    suspend fun signUp(username: String, name: String, password: String): String? = attempt { id.signUp(username, name.trim(), password) }

    suspend fun signIn(username: String, password: String): String? = attempt { id.signIn(username.removeSuffix("@nude"), password) }

    private suspend fun attempt(block: () -> NudeAccount): String? = withContext(Dispatchers.IO) {
        try {
            val a = block()
            withContext(Dispatchers.Main) {
                current = a; needsWelcome = false
                prefs.edit().putBoolean("welcomed", true).putString("lastUser", a.username).remove("meditate").apply()
            }
            null
        } catch (e: NudeIdError) { e.message }
    }

    /** Starts Continue with Meditate: returns the address to open in a tab, or an error message. */
    suspend fun meditateBegin(): Result<String> = withContext(Dispatchers.IO) {
        try { Result.success(meditate.begin()) } catch (e: MeditateError) { Result.failure(Exception(e.userMessage)) } catch (e: Exception) { Result.failure(Exception("Something went wrong. Please try again.")) }
    }

    /** Meditate sent you back (nude://auth/callback). Returns null when you're signed in, or what went wrong. */
    suspend fun meditateFinish(callback: String): String? = withContext(Dispatchers.IO) {
        try {
            val i: MeditateIdentity = meditate.complete(callback)
            val a = NudeAccount("meditate:${i.sub}", i.username, "${i.username}@nude", i.name, i.picture, System.currentTimeMillis())
            val j = JSONObject().put("id", a.id).put("username", a.username).put("nudeId", a.nudeId).put("name", a.name).put("avatar", a.avatar ?: "").put("created", a.created)
                .put("email", i.email).put("emailVerified", i.emailVerified)
            withContext(Dispatchers.Main) {
                prefs.edit().putString("meditate", j.toString()).putBoolean("welcomed", true).putString("lastUser", a.username).apply()
                current = a; needsWelcome = false; meditateOpen = false
            }
            null
        } catch (e: MeditateError) { withContext(Dispatchers.Main) { meditateOpen = false }; e.withReference }
        catch (e: Exception) { withContext(Dispatchers.Main) { meditateOpen = false }; "Nude couldn't finish signing you in with Meditate. Please try again." }
    }

    /** Email from Meditate for the current Nude ID (shown on the account page). */
    fun meditateEmail(): Pair<String, Boolean>? = prefs.getString("meditate", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
        ?.let { j -> j.optString("email").takeIf { it.isNotBlank() }?.let { it to j.optBoolean("emailVerified") } }

    /** Refreshes your name and picture, and notices if this phone was signed out elsewhere. */
    suspend fun refresh() = withContext(Dispatchers.IO) {
        if (isMeditate) return@withContext
        runCatching { persistent = id.status() }
        if (!id.signedIn) return@withContext
        try { val a = id.me(); withContext(Dispatchers.Main) { current = a } }
        catch (e: NudeIdError) { if (e.code == "signed_out") withContext(Dispatchers.Main) { current = null } }
    }

    fun continueAsGuest() {
        prefs.edit().putBoolean("welcomed", true).apply()
        needsWelcome = false
    }

    suspend fun signOut() {
        if (isMeditate) prefs.edit().remove("meditate").apply()
        else withContext(Dispatchers.IO) { id.signOut() }
        current = null
    }

    fun showWelcome() { needsWelcome = true }
}
