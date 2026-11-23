package os.rovian.passgate

import org.json.JSONArray
import org.json.JSONObject
import os.rovian.core.LinkCode
import os.rovian.core.LinkCrypto
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom

/** A saved login. Kept only in PassGate's vault (encrypted with an Android Keystore key). */
data class Login(val id: String, val site: String, val username: String, val password: String, val notes: String, val created: Long, val updated: Long) {
    fun toJson(): JSONObject = JSONObject().put("id", id).put("site", site).put("username", username).put("password", password).put("notes", notes).put("created", created).put("updated", updated)

    /** True when this login belongs to the site asking for it (the same host, or one of its subdomains). */
    fun matches(host: String): Boolean = Logins.sameSite(site, host)

    override fun toString() = "Login($site, $username)" // never the password

    companion object {
        fun fromJson(j: JSONObject) = Login(j.getString("id"), j.getString("site"), j.optString("username"), j.getString("password"), j.optString("notes"), j.optLong("created"), j.optLong("updated"))
        fun list(a: JSONArray?): List<Login> = (0 until (a?.length() ?: 0)).mapNotNull { i -> a!!.optJSONObject(i)?.let { runCatching { fromJson(it) }.getOrNull() } }
    }
}

/** Nude on a computer asking for one login, from the single-use code it shows (NUDEPW1). */
data class LoginRequest(val origin: String, val host: String, val hosts: List<String>, val port: Int, val id: String, val key: ByteArray, val pcName: String) {
    override fun toString() = "LoginRequest($host from $pcName)" // never the key
}

class LoginSendError(message: String) : Exception(message)

object Logins {
    /** Reads NUDEPW1:{"v":1,"h":[LAN addresses],"p":port,"i":id,"k":key,"o":origin,"n":pc}. Only https sites and private-network hosts. */
    fun parseRequest(text: String): LoginRequest? = try {
        if (!text.startsWith("NUDEPW1:")) null else {
            val j = JSONObject(text.removePrefix("NUDEPW1:"))
            val origin = j.getString("o")
            val u = URL(origin)
            val hosts = j.getJSONArray("h").let { a -> (0 until a.length()).map { a.getString(it) } }.filter { LinkCode.isLanHost(it) }.take(4)
            val key = LinkCrypto.dec(j.getString("k"))
            val port = j.getInt("p")
            val ok = j.getInt("v") == 1 && hosts.isNotEmpty() && key.size == 32 && port in 1024..65535 &&
                (u.protocol == "https" || (u.protocol == "http" && LinkCode.isLanHost(u.host))) && u.path.isEmpty() && origin == "${u.protocol}://${u.authority}" &&
                j.getString("i").matches(Regex("[\\w-]{10,40}"))
            if (!ok) null else LoginRequest(origin, u.host.lowercase(), hosts, port, j.getString("i"), key, j.optString("n", "Your PC").take(40))
        }
    } catch (e: Exception) { null }

    /** The same site: equal hosts, or one is a subdomain of the other (accounts.google.com and google.com). */
    fun sameSite(saved: String, host: String): Boolean {
        val a = clean(saved); val b = clean(host)
        if (a.isEmpty() || b.isEmpty()) return false
        return a == b || b.endsWith(".$a") || (a.endsWith(".$b") && b.count { it == '.' } >= 1)
    }

    /** What you typed as the site, reduced to its host: "https://www.Example.com/login" → "example.com". */
    fun clean(site: String): String {
        val s = site.trim().lowercase()
        val host = runCatching { if (s.contains("://")) URL(s).host else s.substringBefore('/').substringBefore(':') }.getOrDefault(s)
        return host.removePrefix("www.").trim('.')
    }

    /** Sends one login to Nude, encrypted with the code's key and bound to its site. Tries each address in the code. */
    fun send(req: LoginRequest, login: Login) {
        val (enc, mac) = LinkCrypto.keys(req.key)
        val path = "/v1/credential/${req.id}"
        val t = System.currentTimeMillis()
        val env = LinkCrypto.seal(enc, path, JSONObject().put("origin", req.origin).put("username", login.username).put("password", login.password).toString())
        val body = JSONObject().put("t", t).put("s", LinkCrypto.sign(mac, "cred\n${req.id}\n${req.origin}\n$t")).put("env", env).toString()
        var last: String = "Nude on ${req.pcName} didn't answer. Make sure your phone is on the same Wi-Fi."
        for (h in req.hosts) {
            try {
                val c = (URL("http://$h:${req.port}$path").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"; connectTimeout = 4000; readTimeout = 8000; doOutput = true
                    setRequestProperty("content-type", "application/json")
                }
                c.outputStream.use { it.write(body.toByteArray()) }
                val code = c.responseCode
                c.disconnect()
                when (code) {
                    200 -> return
                    410 -> throw LoginSendError("That code has expired. Ask Nude for a new one.")
                    400 -> throw LoginSendError("Nude didn't accept that login for ${req.host}.")
                    else -> last = "Nude answered $code."
                }
            } catch (e: LoginSendError) { throw e } catch (e: Exception) { /* try the next address */ }
        }
        throw LoginSendError(last)
    }

    /** A strong password: 20 characters from letters, digits and symbols, from a secure random source. */
    fun generate(length: Int = 20): String {
        val lower = "abcdefghijkmnpqrstuvwxyz"; val upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"; val digits = "23456789"; val sym = "!@#$%^&*-_=+?"
        val all = lower + upper + digits + sym
        val r = SecureRandom()
        val chars = mutableListOf(lower[r.nextInt(lower.length)], upper[r.nextInt(upper.length)], digits[r.nextInt(digits.length)], sym[r.nextInt(sym.length)])
        while (chars.size < length) chars += all[r.nextInt(all.length)]
        chars.shuffle(r)
        return chars.joinToString("")
    }
}
