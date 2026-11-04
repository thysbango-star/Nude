package os.rovian.core

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The phone side of Nude's phone link (see apps/desktop/src/main/phone-link.ts for the protocol). The QR code on the
 * PC carries a fresh 256-bit key; requests are signed with it and replies are encrypted with it, so other devices
 * on the Wi-Fi can't read or forge them.
 */
object LinkCrypto {
    private val b64 = Base64.getUrlEncoder().withoutPadding()
    private val unb64 = Base64.getUrlDecoder()
    fun enc(b: ByteArray): String = b64.encodeToString(b)
    fun dec(s: String): ByteArray = unb64.decode(s)

    private fun hmac(key: ByteArray, msg: ByteArray): ByteArray =
        Mac.getInstance("HmacSHA256").run { init(SecretKeySpec(key, "HmacSHA256")); doFinal(msg) }

    /** (encryption key, signing key) derived from the link key. */
    fun keys(key: ByteArray): Pair<ByteArray, ByteArray> =
        hmac(key, "nude-link enc".toByteArray()) to hmac(key, "nude-link mac".toByteArray())

    fun sign(mac: ByteArray, msg: String): String = enc(hmac(mac, msg.toByteArray(Charsets.UTF_8)))

    private fun aad(path: String) = "nude-link-v1|$path".toByteArray(Charsets.UTF_8)

    fun seal(encKey: ByteArray, path: String, json: String, iv: ByteArray = ByteArray(12).also { SecureRandom().nextBytes(it) }): JSONObject {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(encKey, "AES"), GCMParameterSpec(128, iv))
        c.updateAAD(aad(path))
        return JSONObject().put("iv", enc(iv)).put("ct", enc(c.doFinal(json.toByteArray(Charsets.UTF_8))))
    }

    /** Decrypts a reply; throws if it was changed, or was meant for another path. */
    fun open(encKey: ByteArray, path: String, envelope: JSONObject): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(encKey, "AES"), GCMParameterSpec(128, dec(envelope.getString("iv"))))
        c.updateAAD(aad(path))
        return String(c.doFinal(dec(envelope.getString("ct"))), Charsets.UTF_8)
    }
}

/** What a Nude QR code says. */
data class LinkCode(val app: String, val hosts: List<String>, val port: Int, val offerId: String, val key: ByteArray, val pcName: String) {
    override fun toString() = "LinkCode(app=$app, pc=$pcName, hosts=$hosts)" // never the key

    companion object {
        /** Parses "NUDE1:{...}". Returns null for anything else, including codes with public addresses. */
        fun parse(text: String): LinkCode? = try {
            if (!text.startsWith("NUDE1:")) null else {
                val j = JSONObject(text.removePrefix("NUDE1:"))
                val hosts = j.getJSONArray("h").let { a -> (0 until a.length()).map { a.getString(it) } }.filter(::isLanHost).take(4)
                val key = LinkCrypto.dec(j.getString("k"))
                val port = j.getInt("p")
                if (j.getInt("v") != 1 || hosts.isEmpty() || key.size != 32 || port !in 1024..65535) null
                else LinkCode(j.getString("a"), hosts, port, j.getString("i"), key, j.optString("n", "Your PC").take(40))
            }
        } catch (e: Exception) { null }

        /** Only private-network IPv4 addresses: the link never goes over the internet. */
        fun isLanHost(h: String): Boolean {
            val m = Regex("""^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$""").matchEntire(h) ?: return false
            val (a, b) = m.destructured.let { it.component1().toInt() to it.component2().toInt() }
            if (m.groupValues.drop(1).any { it.toInt() > 255 }) return false
            return a == 10 || (a == 172 && b in 16..31) || (a == 192 && b == 168) || (a == 100 && b in 64..127)
        }
    }
}

/** A PC this phone is linked to. Stored encrypted (SecureFile). */
data class LinkedPc(val deviceId: String, val app: String, val pcName: String, val hosts: List<String>, val port: Int, val key: ByteArray, val linkedAt: Long) {
    override fun toString() = "LinkedPc(app=$app, pc=$pcName)"
    fun toJson(): JSONObject = JSONObject().put("deviceId", deviceId).put("app", app).put("pcName", pcName).put("hosts", JSONArray(hosts))
        .put("port", port).put("key", LinkCrypto.enc(key)).put("linkedAt", linkedAt)
    companion object {
        fun fromJson(j: JSONObject) = LinkedPc(j.getString("deviceId"), j.getString("app"), j.getString("pcName"),
            j.getJSONArray("hosts").let { a -> (0 until a.length()).map { a.getString(it) } }, j.getInt("port"), LinkCrypto.dec(j.getString("key")), j.getLong("linkedAt"))
    }
}

class LinkError(val userMessage: String, val code: String) : Exception(code)

/** Talks to Nude on the PC. Blocking: call from a background thread. */
class PhoneLinkClient(private val now: () -> Long = System::currentTimeMillis) {
    private class Reply(val status: Int, val body: String)

    private fun request(host: String, port: Int, method: String, path: String, body: String?, headers: Map<String, String>, timeoutMs: Int): Reply {
        require(LinkCode.isLanHost(host))
        val c = URL("http://$host:$port$path").openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = timeoutMs; c.readTimeout = 8000
        c.instanceFollowRedirects = false
        c.useCaches = false
        headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
        if (body != null) {
            c.doOutput = true
            c.setRequestProperty("content-type", "application/json")
            c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        }
        val status = c.responseCode
        val text = (if (status < 400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText().take(2_000_000) } ?: ""
        c.disconnect()
        return Reply(status, text)
    }

    /** Pairs with the PC whose code was scanned. Tries each of its addresses. */
    fun pair(code: LinkCode, deviceName: String): LinkedPc {
        val (encKey, macKey) = LinkCrypto.keys(code.key)
        val name = deviceName.take(60)
        val t = now()
        val sig = LinkCrypto.sign(macKey, "pair\n${code.offerId}\n$name\n$t")
        val body = JSONObject().put("i", code.offerId).put("d", name).put("t", t).put("s", sig).toString()
        var last: LinkError = LinkError("Your phone couldn't reach your PC. Make sure both are on the same Wi-Fi, then try again.", "unreachable")
        for (h in code.hosts) {
            val r = try { request(h, code.port, "POST", "/v1/pair", body, emptyMap(), 4000) } catch (e: Exception) { continue }
            when (r.status) {
                200 -> {
                    val j = JSONObject(LinkCrypto.open(encKey, "/v1/pair", JSONObject(r.body)))
                    if (j.getString("app") != code.app) throw LinkError("That code is for another app.", "wrong_app")
                    return LinkedPc(j.getString("deviceId"), code.app, j.optString("pc", code.pcName), listOf(h) + code.hosts.filter { it != h }, code.port, code.key, now())
                }
                410 -> throw LinkError("That code has expired or was already used. Make a new one on your PC.", "expired")
                401 -> throw LinkError("Your PC didn't accept this phone. Check the time on your phone, then scan a new code.", "signature")
                429 -> throw LinkError("Too many tries. Wait a minute, then scan a new code.", "slow_down")
                else -> last = LinkError("Your PC couldn't link this phone. Please try again.", "pair_${r.status}")
            }
        }
        throw last
    }

    /** Reads "identity" (PassGate) or "report" (Rovian Defender). Returns the decrypted JSON. */
    fun fetch(pc: LinkedPc, resource: String): Pair<JSONObject, LinkedPc> = signed(pc, "GET", resource)

    /** Tells the PC to forget this phone (best effort). */
    fun unlink(pc: LinkedPc) { try { signed(pc, "POST", "unlink") } catch (e: Exception) { /* forget locally anyway */ } }

    private fun signed(pc: LinkedPc, method: String, resource: String): Pair<JSONObject, LinkedPc> {
        val (encKey, macKey) = LinkCrypto.keys(pc.key)
        val path = "/v1/device/${pc.deviceId}/$resource"
        var reached = false
        for (h in pc.hosts) {
            val t = now()
            val r = try {
                request(h, pc.port, method, path, if (method == "POST") "{}" else null,
                    mapOf("x-nude-time" to t.toString(), "x-nude-sig" to LinkCrypto.sign(macKey, "$method\n$path\n$t")), 3000)
            } catch (e: Exception) { continue }
            reached = true
            when (r.status) {
                200 -> return JSONObject(LinkCrypto.open(encKey, path, JSONObject(r.body))) to pc.copy(hosts = listOf(h) + pc.hosts.filter { it != h })
                401 -> throw LinkError("This phone is no longer linked to ${pc.pcName}. Scan a new code to link it again.", "unlinked")
                429 -> throw LinkError("Your PC asked this phone to slow down. Try again in a minute.", "slow_down")
                else -> continue
            }
        }
        throw if (reached) LinkError("Your PC answered with an error. Try again in a moment.", "server")
        else LinkError("Can't reach ${pc.pcName}. Make sure it's on, Nude is open and your phone is on the same Wi-Fi.", "unreachable")
    }
}

/** A short, friendly name for this phone (shown on the PC). */
fun phoneName(): String {
    val maker = android.os.Build.MANUFACTURER.orEmpty().replaceFirstChar { it.uppercase() }
    val model = android.os.Build.MODEL.orEmpty()
    return (if (model.startsWith(maker, ignoreCase = true)) model else "$maker $model").trim().ifBlank { "Android phone" }.take(60)
}

