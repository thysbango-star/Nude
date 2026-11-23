package os.nude.browser

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import os.rovian.core.nudeid.NudeAccount
import os.rovian.core.nudeid.NudeId
import os.rovian.core.nudeid.NudeIdError

/**
 * Your Nude ID in the Nude browser on this phone. Who you are comes from Nude Accounts; the sign-in token is kept
 * encrypted by [NudeId] (Android Keystore). Your password is sent to Nude Accounts and never stored here.
 */
class Accounts(context: Context) {
    private val prefs = context.getSharedPreferences("nude-accounts", Context.MODE_PRIVATE)
    val id = NudeId(context, "browser")

    /** Signed-in Nude ID, or null for guest. Compose re-renders when it changes. */
    var current by mutableStateOf<NudeAccount?>(id.account?.takeIf { id.signedIn })
        private set
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
                prefs.edit().putBoolean("welcomed", true).putString("lastUser", a.username).apply()
            }
            null
        } catch (e: NudeIdError) { e.message }
    }

    /** Refreshes your name and picture, and notices if this phone was signed out elsewhere. */
    suspend fun refresh() = withContext(Dispatchers.IO) {
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
        withContext(Dispatchers.IO) { id.signOut() }
        current = null
    }

    fun showWelcome() { needsWelcome = true }
}
