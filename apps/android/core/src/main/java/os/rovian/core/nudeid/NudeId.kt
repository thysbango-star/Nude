package os.rovian.core.nudeid

import android.content.Context
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import os.rovian.core.SecureFile
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** A Nude ID as Nude Accounts describes it. */
data class NudeAccount(val id: String, val username: String, val nudeId: String, val name: String, val avatar: String?, val created: Long) {
    val firstName: String get() = name.trim().split(Regex("\\s+")).firstOrNull().orEmpty().ifBlank { name }
    val initials: String get() = name.trim().split(Regex("\\s+")).let { p -> ((p.firstOrNull()?.firstOrNull()?.toString() ?: "") + (if (p.size > 1) p.last().first().toString() else "")).uppercase() }.ifBlank { "?" }

    companion object {
        fun from(j: JSONObject) = NudeAccount(j.getString("id"), j.getString("username"), j.optString("nudeId", "${j.getString("username")}@nude"), j.getString("name"),
            j.optString("avatar").takeIf { it.isNotBlank() && it != "null" }, j.optLong("created"))
    }
}

data class NudeDevice(val id: String, val name: String, val platform: String, val app: String, val lastSeen: Long, val ip: String?, val current: Boolean)
data class NudeEvent(val t: Long, val kind: String, val detail: String, val device: String?)

class NudeIdError(message: String, val code: String = "error", val status: Int = 0) : Exception(message)

/**
 * Talks to Nude Accounts for this phone. The device's session token is kept only in [SecureFile]
 * (encrypted with a key in Android Keystore). Calls block: run them on Dispatchers.IO.
 */
class NudeId(ctx: Context, private val app: String, private val defaultServer: String = DEFAULT_SERVER) {
    private val vault = SecureFile(ctx, "nude-id-$app", "nude-id-$app.json")
    private var state: JSONObject = runCatching { JSONObject(vault.read() ?: "{}") }.getOrDefault(JSONObject())

    val server: String get() = state.optString("server").ifBlank { defaultServer }.trimEnd('/')
    val account: NudeAccount? get() = state.optJSONObject("account")?.let { runCatching { NudeAccount.from(it) }.getOrNull() }
    val signedIn: Boolean get() = state.optString("token").isNotBlank() && account != null

    private fun save() = vault.write(state.toString())

    /** Forget this phone's sign-in (after signing out, or when the server says the device was signed out). */
    fun forget() { state = JSONObject().put("server", state.optString("server")); save() }

    private fun device() = JSONObject().put("name", deviceName()).put("platform", "Android ${Build.VERSION.RELEASE}").put("app", app)

    private fun call(method: String, path: String, body: JSONObject? = null, auth: Boolean = false, base: String = server, raw: ByteArray? = null, rawType: String? = null): JSONObject {
        val c = (URL(base + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000; readTimeout = 20_000
            setRequestProperty("accept", "application/json")
            if (auth) {
                val t = state.optString("token")
                if (t.isBlank()) throw NudeIdError("Sign in first.", "signed_out", 401)
                setRequestProperty("authorization", "Bearer $t")
            }
            if (body != null || raw != null) {
                doOutput = true
                setRequestProperty("content-type", rawType ?: "application/json")
            }
        }
        try {
            if (raw != null) c.outputStream.use { it.write(raw) } else if (body != null) c.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = c.responseCode
            val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            val j = runCatching { JSONObject(text.ifBlank { "{}" }) }.getOrDefault(JSONObject())
            if (code !in 200..299) {
                if (code == 401 && auth && j.optString("code") == "signed_out") forget()
                throw NudeIdError(j.optString("error").ifBlank { "Nude Accounts answered $code." }, j.optString("code").ifBlank { "error" }, code)
            }
            return j
        } catch (e: IOException) {
            throw NudeIdError("Couldn't reach Nude Accounts. Check your connection and try again.", "offline")
        } finally { c.disconnect() }
    }

    private fun keep(j: JSONObject, base: String): NudeAccount {
        val a = j.getJSONObject("account")
        state = JSONObject().put("server", base).put("token", j.getString("token")).put("account", a)
        save()
        return NudeAccount.from(a)
    }

    fun status(): Boolean = call("GET", "/v1/status").optBoolean("persistent", true)
    fun signUp(username: String, name: String, password: String) =
        keep(call("POST", "/v1/accounts", JSONObject().put("username", username.trim().lowercase()).put("name", name).put("password", password).put("device", device())), server)
    fun signIn(username: String, password: String) =
        keep(call("POST", "/v1/sessions", JSONObject().put("username", username.trim().lowercase()).put("password", password).put("device", device())), server)

    fun signOut() { runCatching { call("DELETE", "/v1/session", auth = true) }; forget() }

    fun me(): NudeAccount {
        val a = call("GET", "/v1/me", auth = true).getJSONObject("account")
        state.put("account", a); save()
        return NudeAccount.from(a)
    }
    fun rename(name: String): NudeAccount = NudeAccount.from(call("PATCH", "/v1/me", JSONObject().put("name", name), auth = true).getJSONObject("account").also { state.put("account", it); save() })
    fun setAvatar(jpeg: ByteArray): NudeAccount = NudeAccount.from(call("PUT", "/v1/me/avatar", auth = true, raw = jpeg, rawType = "image/jpeg").getJSONObject("account").also { state.put("account", it); save() })
    fun changePassword(current: String, next: String): Int = call("POST", "/v1/me/password", JSONObject().put("current", current).put("next", next), auth = true).optInt("signedOut")

    fun devices(): List<NudeDevice> = call("GET", "/v1/me/sessions", auth = true).getJSONArray("sessions").objects().map {
        NudeDevice(it.getString("id"), it.getString("name"), it.optString("platform"), it.optString("app"), it.optLong("lastSeen"), it.optString("ip").takeIf { s -> s.isNotBlank() && s != "null" }, it.optBoolean("current"))
    }
    fun revoke(id: String) { call("DELETE", "/v1/me/sessions/$id", auth = true) }
    fun events(): List<NudeEvent> = call("GET", "/v1/me/events?limit=100", auth = true).getJSONArray("events").objects().map {
        NudeEvent(it.optLong("t"), it.optString("kind"), it.optString("detail"), it.optString("device").takeIf { s -> s.isNotBlank() && s != "null" })
    }

    /** Downloads the profile picture (from Nude Accounts only). */
    fun avatarBytes(): ByteArray? {
        val url = account?.avatar ?: return null
        if (!url.startsWith(server)) return null
        return runCatching { (URL(url).openConnection() as HttpURLConnection).run { connectTimeout = 10_000; readTimeout = 15_000; inputStream.use { it.readBytes() }.also { disconnect() } } }.getOrNull()
    }

    // ---------------------------------------------------------------- sign in by scanning a code on a signed-in computer

    data class LinkCode(val server: String, val id: String, val secret: String)

    /** Step 1: send the scanned code; the computer then asks you to approve this phone. Returns the claim handle. */
    fun claim(code: LinkCode): String =
        call("POST", "/v1/links/claim", JSONObject().put("id", code.id).put("secret", code.secret).put("device", device()), base = code.server).getString("claim")

    /** Step 2 (repeat every couple of seconds): "waiting", "denied", or the account once approved. */
    fun poll(code: LinkCode, claim: String): Pair<String, NudeAccount?> {
        val j = call("POST", "/v1/links/poll", JSONObject().put("id", code.id).put("claim", claim), base = code.server)
        return when (j.optString("state")) {
            "approved" -> "approved" to keep(j, code.server)
            else -> j.optString("state", "waiting") to null
        }
    }

    // ---------------------------------------------------------------- sync (Nebula conversations, settings)

    fun syncGet(space: String, since: Long): Pair<List<Triple<String, Long, Any?>>, Long> {
        val j = call("GET", "/v1/sync/$space?since=$since", auth = true)
        val items = j.getJSONArray("items").objects().map { Triple(it.getString("key"), it.getLong("t"), if (it.isNull("value")) null else it.get("value")) }
        return items to j.optLong("now")
    }
    fun syncPut(space: String, key: String, value: Any) { call("PUT", "/v1/sync/$space/$key", JSONObject().put("value", value), auth = true) }
    fun syncDelete(space: String, key: String) { call("DELETE", "/v1/sync/$space/$key", auth = true) }

    companion object {
        const val DEFAULT_SERVER = "https://nude-accounts.onrender.com"

        /** Reads the code Nude shows on a signed-in computer: NUDEID1:{"s":server,"i":id,"k":secret}. */
        fun parseLink(text: String): LinkCode? {
            if (!text.startsWith("NUDEID1:")) return null
            return runCatching {
                val j = JSONObject(text.removePrefix("NUDEID1:"))
                val s = j.getString("s").trimEnd('/')
                val u = URL(s)
                // Only https, or http to a computer on this network (a server you run at home).
                require(u.protocol == "https" || (u.protocol == "http" && os.rovian.core.LinkCode.isLanHost(u.host)))
                require(j.getString("i").matches(Regex("[A-Za-z0-9_-]{8,40}")))
                require(j.getString("k").startsWith("nls_"))
                LinkCode(s, j.getString("i"), j.getString("k"))
            }.getOrNull()
        }

        fun deviceName(): String = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}".trim().take(60)
    }
}

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
