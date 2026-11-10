package os.rovian.passgate

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject
import os.rovian.core.LinkedPc
import os.rovian.core.SecureFile

/** Your account as Nude on the PC knows it: verified claims only. */
data class Acc(
    val name: String, val email: String, val provider: String, val rovianId: String?, val username: String?, val emailVerified: Boolean,
    val initials: String, val color: String?, val lastSignIn: Long, val linkedAt: Long,
)
data class AccRef(val name: String, val id: String, val provider: String, val current: Boolean)
data class IEvent(val t: Long, val kind: String, val detail: String)
data class Dev(val app: String, val name: String, val lastSeen: Long)

/** What PassGate shows: read from Nude on the linked PC. No passwords, no tokens. */
data class Identity(
    val pcName: String, val platform: String, val nudeVersion: String, val account: Acc?, val accounts: List<AccRef>,
    val events: List<IEvent>, val devices: List<Dev>, val level: String, val time: Long,
)

fun parseIdentity(j: JSONObject): Identity {
    val pc = j.optJSONObject("pc") ?: JSONObject()
    val a = j.optJSONObject("account")
    fun s(o: JSONObject, k: String) = o.optString(k).takeIf { it.isNotBlank() && it != "null" }
    val acc = a?.let {
        Acc(it.optString("name", "You"), it.optString("email"), it.optString("provider", "local"), s(it, "rovianId"), s(it, "username"),
            it.optBoolean("emailVerified"), it.optString("initials", "?"), s(it, "color"), it.optLong("lastSignIn"), it.optLong("linkedAt"))
    }
    val accs = j.optJSONArray("accounts")
    val ev = j.optJSONArray("events")
    val dv = j.optJSONArray("devices")
    return Identity(
        pc.optString("name", "Your PC"), pc.optString("platform"), pc.optString("nude"), acc,
        (0 until (accs?.length() ?: 0)).mapNotNull { i -> accs!!.optJSONObject(i)?.let { AccRef(it.optString("name"), it.optString("id"), it.optString("provider"), it.optBoolean("current")) } },
        (0 until (ev?.length() ?: 0)).mapNotNull { i -> ev!!.optJSONObject(i)?.let { IEvent(it.optLong("t"), it.optString("kind"), it.optString("detail").take(200)) } },
        (0 until (dv?.length() ?: 0)).mapNotNull { i -> dv!!.optJSONObject(i)?.let { Dev(it.optString("app"), it.optString("name"), it.optLong("lastSeen")) } },
        j.optJSONObject("protection")?.optString("level") ?: "standard", j.optLong("time"),
    )
}

/**
 * PassGate's data, encrypted with a key in the Android Keystore: the link to your PC and the last identity it sent.
 * The link key only ever came from the QR code you scanned.
 */
class Vault(ctx: Context) {
    private val file = SecureFile(ctx, "passgate-vault", "passgate.vault")
    private var raw: JSONObject? = null

    var pc by mutableStateOf<LinkedPc?>(null); private set
    var identity by mutableStateOf<Identity?>(null); private set
    var identityAt by mutableLongStateOf(0L); private set
    var lockEnabled by mutableStateOf(true); private set
    var loadError by mutableStateOf<String?>(null)
    /** What happened in PassGate on this phone: unlocks, codes scanned, links made or removed. No secrets. */
    var local by mutableStateOf<List<IEvent>>(emptyList()); private set

    init {
        try {
            file.read()?.let { text ->
                val j = JSONObject(text)
                lockEnabled = j.optBoolean("lock", true)
                pc = j.optJSONObject("pc")?.let(LinkedPc::fromJson)
                raw = j.optJSONObject("identity")
                identity = raw?.let(::parseIdentity)
                identityAt = j.optLong("identityAt")
                local = j.optJSONArray("local")?.let { a -> (0 until a.length()).mapNotNull { i -> a.optJSONObject(i)?.let { IEvent(it.optLong("t"), it.optString("kind"), it.optString("detail")) } } } ?: emptyList()
            }
        } catch (e: Exception) {
            // The Keystore key was removed (e.g. the screen lock was reset) or the file is damaged: start fresh.
            file.delete()
            loadError = "PassGate couldn't open its saved data on this phone, so it started fresh. Scan the code on your PC again."
        }
    }

    fun hardwareBacked() = file.hardwareBacked()

    private fun save() {
        file.write(JSONObject().put("lock", lockEnabled).put("pc", pc?.toJson()).put("identity", raw).put("identityAt", identityAt)
            .put("local", org.json.JSONArray(local.map { JSONObject().put("t", it.t).put("kind", it.kind).put("detail", it.detail) })).toString())
    }

    fun link(p: LinkedPc) { pc = p; raw = null; identity = null; identityAt = 0; log("linked", "Linked to ${p.pcName} with the code from Nude") }
    fun updatePc(p: LinkedPc) { pc = p; save() }
    fun setIdentity(j: JSONObject) { raw = j; identity = parseIdentity(j); identityAt = System.currentTimeMillis(); save() }
    fun signOut() { pc = null; raw = null; identity = null; identityAt = 0; log("unlinked", "This phone was unlinked from your PC") }
    fun setLock(on: Boolean) { lockEnabled = on; log("lock-${if (on) "on" else "off"}", if (on) "PassGate lock turned on" else "PassGate lock turned off") }

    /** Adds to this phone's activity (newest first, last 100 kept). */
    fun log(kind: String, detail: String) { local = (listOf(IEvent(System.currentTimeMillis(), kind, detail.take(200))) + local).take(100); save() }
}
