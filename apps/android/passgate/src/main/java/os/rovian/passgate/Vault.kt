package os.rovian.passgate

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import os.rovian.core.RovianIdentity
import java.io.File
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

/** A connected Rovian account: the verified identity only. PassGate never stores Rovian tokens or passwords. */
data class LinkedAccount(val identity: RovianIdentity, val linkedAt: Long, val lastUsed: Long, val preferred: Boolean)

/** Something that happened, for the activity list. No secrets. */
data class Activity(val time: Long, val kind: String, val detail: String)

/**
 * PassGate's data, encrypted with an AES-256-GCM key that lives in the Android Keystore (hardware-backed where the
 * phone supports it). The key never leaves the Keystore; the file on disk is ciphertext.
 */
class Vault(private val ctx: Context) {
    private val file = File(ctx.filesDir, "passgate.vault")
    val accounts = mutableStateListOf<LinkedAccount>()
    val activity = mutableStateListOf<Activity>()
    var lockEnabled by mutableStateOf(true)
        private set
    var loadError by mutableStateOf<String?>(null)
        private set

    init { load() }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        return g.generateKey()
    }

    /** True when the vault key is held in secure hardware (TEE or StrongBox); null if Android won't say. */
    fun hardwareBacked(): Boolean? = try {
        val k = key()
        val info = SecretKeyFactory.getInstance(k.algorithm, "AndroidKeyStore").getKeySpec(k, KeyInfo::class.java) as KeyInfo
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) info.securityLevel != KeyProperties.SECURITY_LEVEL_SOFTWARE
        else @Suppress("DEPRECATION") info.isInsideSecureHardware
    } catch (e: Exception) { null }

    private fun load() {
        if (!file.exists()) return
        try {
            val raw = Base64.getDecoder().decode(file.readText())
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, 12))
            val j = JSONObject(String(c.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8))
            val a = j.optJSONArray("accounts") ?: JSONArray()
            for (i in 0 until a.length()) a.getJSONObject(i).let {
                accounts += LinkedAccount(RovianIdentity.fromJson(it.getJSONObject("identity")), it.optLong("linkedAt"), it.optLong("lastUsed"), it.optBoolean("preferred"))
            }
            val ev = j.optJSONArray("activity") ?: JSONArray()
            for (i in 0 until ev.length()) ev.getJSONObject(i).let { activity += Activity(it.getLong("t"), it.getString("k"), it.getString("d")) }
            lockEnabled = j.optBoolean("lock", true)
        } catch (e: Exception) {
            // The key was removed (e.g. screen lock reset) or the file is damaged: start fresh rather than guess.
            loadError = "PassGate couldn't open its saved data on this phone, so it started fresh. Add your accounts again."
            file.delete()
        }
    }

    private fun save() {
        val j = JSONObject()
        j.put("accounts", JSONArray().apply { accounts.forEach { put(JSONObject().put("identity", it.identity.toJson()).put("linkedAt", it.linkedAt).put("lastUsed", it.lastUsed).put("preferred", it.preferred)) } })
        j.put("activity", JSONArray().apply { activity.forEach { put(JSONObject().put("t", it.time).put("k", it.kind).put("d", it.detail)) } })
        j.put("lock", lockEnabled)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val out = c.iv + c.doFinal(j.toString().toByteArray(Charsets.UTF_8))
        val tmp = File(file.path + ".tmp")
        tmp.writeText(Base64.getEncoder().encodeToString(out))
        tmp.renameTo(file)
    }

    fun log(kind: String, detail: String) {
        activity.add(0, Activity(System.currentTimeMillis(), kind, detail.take(200)))
        while (activity.size > 60) activity.removeAt(activity.lastIndex)
        save()
    }

    /** Adds or refreshes an account (matched by Rovian's subject id). The first account becomes preferred. */
    fun link(id: RovianIdentity): LinkedAccount {
        val now = System.currentTimeMillis()
        val i = accounts.indexOfFirst { it.identity.sub == id.sub }
        val acc = if (i >= 0) accounts[i].copy(identity = id, lastUsed = now) else LinkedAccount(id, now, now, accounts.isEmpty())
        if (i >= 0) accounts[i] = acc else accounts += acc
        log(if (i >= 0) "signin" else "linked", "${if (i >= 0) "Signed in" else "Connected"} ${id.rovianId ?: id.email} with Rovian")
        return acc
    }

    fun makePreferred(sub: String) {
        for (i in accounts.indices) accounts[i] = accounts[i].copy(preferred = accounts[i].identity.sub == sub)
        log("preferred", "Made ${accounts.first { it.identity.sub == sub }.identity.let { it.rovianId ?: it.email }} the default account")
    }

    fun remove(sub: String) {
        val a = accounts.firstOrNull { it.identity.sub == sub } ?: return
        accounts.remove(a)
        if (accounts.none { it.preferred } && accounts.isNotEmpty()) accounts[0] = accounts[0].copy(preferred = true)
        log("removed", "Removed ${a.identity.rovianId ?: a.identity.email} from PassGate")
    }

    fun setLock(on: Boolean) { lockEnabled = on; log("settings", if (on) "Turned on the PassGate lock" else "Turned off the PassGate lock") }
    fun clearActivity() { activity.clear(); save() }

    companion object { private const val ALIAS = "passgate-vault" }
}
