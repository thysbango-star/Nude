package os.nude.browser

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/** A Nude account kept on this device. The password is stored only as a salted PBKDF2 hash. */
data class Account(val id: String, val name: String, val email: String) {
    val firstName: String get() = name.trim().split(Regex("\\s+")).firstOrNull().orEmpty().ifBlank { name }
    val initials: String get() = name.trim().split(Regex("\\s+")).take(2).mapNotNull { it.firstOrNull()?.uppercaseChar() }.joinToString("").ifBlank { "?" }
}

class Accounts(context: Context) {
    private val prefs = context.getSharedPreferences("nude-accounts", Context.MODE_PRIVATE)

    /** Signed-in account, or null for guest. Compose re-renders when it changes. */
    var current by mutableStateOf<Account?>(null)
        private set
    /** True until the person creates an account, signs in or chooses to continue without one. */
    var needsWelcome by mutableStateOf(false)
        private set

    init {
        val id = prefs.getString("current", null)
        current = all().firstOrNull { it.first.id == id }?.first
        needsWelcome = current == null && !prefs.getBoolean("welcomed", false)
    }

    fun known(): List<Account> = all().map { it.first }

    /** Returns an error message, or null on success. */
    fun signUp(name: String, email: String, password: String): String? {
        val n = name.trim().take(80)
        val e = email.trim().lowercase()
        if (n.isEmpty()) return "Please enter your name."
        if (!Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$").matches(e)) return "Please enter a valid email address."
        if (password.length < 8) return "Use at least 8 characters for your password."
        if (all().any { it.first.email == e }) return "There's already an account for that email on this device. Sign in instead."
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val account = Account(java.util.UUID.randomUUID().toString(), n, e)
        val rec = JSONObject().put("id", account.id).put("name", n).put("email", e)
            .put("salt", b64(salt)).put("hash", b64(hash(password, salt))).put("failures", 0)
        save(all().map { it.second } + rec)
        setCurrent(account)
        return null
    }

    fun signIn(email: String, password: String): String? {
        val e = email.trim().lowercase()
        val records = all()
        val found = records.firstOrNull { it.first.email == e } ?: return "Email or password is incorrect."
        val rec = found.second
        val lockedUntil = rec.optLong("lockedUntil", 0)
        if (lockedUntil > System.currentTimeMillis()) return "Too many attempts. Try again in a minute."
        val ok = MessageDigest.isEqual(hash(password, unb64(rec.getString("salt"))), unb64(rec.getString("hash")))
        if (!ok) {
            val f = rec.optInt("failures", 0) + 1
            rec.put("failures", if (f >= 5) 0 else f)
            if (f >= 5) rec.put("lockedUntil", System.currentTimeMillis() + 60_000)
            save(records.map { it.second })
            return "Email or password is incorrect."
        }
        rec.put("failures", 0).remove("lockedUntil")
        save(records.map { it.second })
        setCurrent(found.first)
        return null
    }

    fun continueAsGuest() {
        prefs.edit().putBoolean("welcomed", true).apply()
        needsWelcome = false
    }

    fun signOut() {
        prefs.edit().remove("current").apply()
        current = null
    }

    fun showWelcome() { needsWelcome = true }

    private fun setCurrent(a: Account) {
        prefs.edit().putString("current", a.id).putBoolean("welcomed", true).apply()
        current = a
        needsWelcome = false
    }

    private fun all(): List<Pair<Account, JSONObject>> = runCatching {
        val arr = JSONArray(prefs.getString("accounts", "[]"))
        (0 until arr.length()).map { i -> arr.getJSONObject(i).let { Account(it.getString("id"), it.getString("name"), it.getString("email")) to it } }
    }.getOrDefault(emptyList())

    private fun save(list: List<JSONObject>) {
        val arr = JSONArray(); list.forEach { arr.put(it) }
        prefs.edit().putString("accounts", arr.toString()).apply()
    }

    companion object {
        fun hash(password: String, salt: ByteArray): ByteArray =
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(PBEKeySpec(password.toCharArray(), salt, 120_000, 256)).encoded
        private fun b64(b: ByteArray) = Base64.getEncoder().encodeToString(b)
        private fun unb64(s: String) = Base64.getDecoder().decode(s)
    }
}
