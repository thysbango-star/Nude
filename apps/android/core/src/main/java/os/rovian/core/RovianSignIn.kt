package os.rovian.core

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.math.BigInteger
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.RSAPublicKeySpec
import java.util.Base64

/**
 * Sign in with Rovian: OAuth 2.1 Authorization Code + PKCE (S256) with OpenID Connect. A public client (no secret).
 *
 * The verifier, state and nonce live only in memory. The token exchange and ID-token checks run in this app's own
 * code (never in a web page). Tokens are dropped after verification: only [RovianIdentity] is returned. Nothing here
 * is logged.
 */
object Rovian {
    const val ISSUER = "https://oaupnrdlgxavdvefhbnp.supabase.co/auth/v1"
    const val CLIENT_ID = "84d370e0-9203-4a58-b516-d05ded71bac3"
    const val SCOPE = "openid email profile"
    /** Loopback redirect (RFC 8252 §7.3): the app listens on this port only while a sign-in is open. */
    const val REDIRECT_PORT = 47811
    const val REDIRECT_PATH = "/nude-browser/callback"
    const val REDIRECT_URI = "http://127.0.0.1:$REDIRECT_PORT$REDIRECT_PATH"
    const val IDENTITY_DOMAIN = "rovian.cloud"
}

/** The verified identity. No tokens. */
data class RovianIdentity(
    val sub: String, val name: String, val email: String, val emailVerified: Boolean,
    val username: String?, val rovianId: String?, val picture: String?,
) {
    fun toJson(): JSONObject = JSONObject().put("sub", sub).put("name", name).put("email", email).put("emailVerified", emailVerified)
        .put("username", username ?: JSONObject.NULL).put("rovianId", rovianId ?: JSONObject.NULL).put("picture", picture ?: JSONObject.NULL)

    companion object {
        fun fromJson(j: JSONObject) = RovianIdentity(
            j.getString("sub"), j.optString("name"), j.optString("email"), j.optBoolean("emailVerified"),
            j.optString("username").takeIf { it.isNotEmpty() && !j.isNull("username") },
            j.optString("rovianId").takeIf { it.isNotEmpty() && !j.isNull("rovianId") },
            j.optString("picture").takeIf { it.isNotEmpty() && !j.isNull("picture") },
        )
    }
}

/** A failure with a message that's safe to show. [code] is for tests and support, never contains secrets. */
class RovianError(val userMessage: String, val code: String) : Exception(code)

/** One sign-in attempt. Lives in memory only. */
class PendingSignIn internal constructor(val verifier: String, val state: String, val nonce: String, val created: Long) {
    // Keep secrets out of logs and crash reports.
    override fun toString() = "PendingSignIn(…)"
}

/** Small HTTP abstraction so the flow can be tested without a network. */
fun interface Http {
    /** Returns status and body. [form] is sent as application/x-www-form-urlencoded when not null. */
    fun request(url: String, form: Map<String, String>?, bearer: String?): Pair<Int, String>
}

object UrlConnectionHttp : Http {
    override fun request(url: String, form: Map<String, String>?, bearer: String?): Pair<Int, String> {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 10_000; c.readTimeout = 15_000
        c.setRequestProperty("Accept", "application/json")
        if (bearer != null) c.setRequestProperty("Authorization", "Bearer $bearer")
        if (form != null) {
            c.requestMethod = "POST"; c.doOutput = true
            c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            c.outputStream.use { it.write(formEncode(form).toByteArray()) }
        }
        val code = c.responseCode
        val body = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        c.disconnect()
        return code to body
    }
}

internal fun formEncode(m: Map<String, String>) = m.entries.joinToString("&") { "${URLEncoder.encode(it.key, "UTF-8")}=${URLEncoder.encode(it.value, "UTF-8")}" }

class RovianSignIn(private val http: Http = UrlConnectionHttp, private val now: () -> Long = System::currentTimeMillis) {
    private data class Discovery(val authorize: String, val token: String, val jwks: String, val userinfo: String?)
    private var disco: Pair<Discovery, Long>? = null
    private var keys: Pair<JSONArray, Long>? = null
    private val random = SecureRandom()

    private fun b64url(b: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(b)
    private fun randomToken(n: Int) = ByteArray(n).also { random.nextBytes(it) }.let(::b64url)

    fun challengeFor(verifier: String) = b64url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

    private fun discovery(): Discovery {
        disco?.let { (d, at) -> if (now() - at < 3_600_000) return d }
        val (code, body) = try { http.request("${Rovian.ISSUER}/.well-known/openid-configuration", null, null) }
            catch (e: Exception) { throw RovianError("Couldn't reach Rovian Account. Check your internet connection and try again.", "discovery_unreachable") }
        val j = try { if (code != 200) throw Exception(); JSONObject(body) }
            catch (e: Exception) { throw RovianError("Couldn't reach Rovian Account. Check your internet connection and try again.", "discovery_unreachable") }
        val https = { k: String -> j.optString(k).startsWith("https://") }
        if (j.optString("issuer") != Rovian.ISSUER || !https("authorization_endpoint") || !https("token_endpoint") || !https("jwks_uri")) {
            throw RovianError("Rovian Account sent unexpected sign-in settings, so the sign-in was stopped for your safety.", "discovery_mismatch")
        }
        val d = Discovery(j.getString("authorization_endpoint"), j.getString("token_endpoint"), j.getString("jwks_uri"),
            j.optString("userinfo_endpoint").takeIf { it.startsWith("https://") })
        disco = d to now()
        return d
    }

    /** Steps 1–2. Call off the main thread. */
    fun begin(): Pair<String, PendingSignIn> {
        val d = discovery()
        val p = PendingSignIn(verifier = randomToken(32), state = randomToken(24), nonce = randomToken(24), created = now())
        val q = linkedMapOf(
            "response_type" to "code", "client_id" to Rovian.CLIENT_ID, "redirect_uri" to Rovian.REDIRECT_URI, "scope" to Rovian.SCOPE,
            "state" to p.state, "nonce" to p.nonce, "code_challenge" to challengeFor(p.verifier), "code_challenge_method" to "S256",
        )
        return "${d.authorize}${if (d.authorize.contains('?')) "&" else "?"}${formEncode(q)}" to p
    }

    /** Steps 4–7. [query] is the callback's query parameters. Call off the main thread. */
    fun complete(query: Map<String, String>, p: PendingSignIn): RovianIdentity {
        val state = query["state"]
        if (state == null || state != p.state || now() - p.created > 10 * 60_000) {
            throw RovianError("This sign-in has expired or didn't come from PassGate. Please start again.", "state_mismatch")
        }
        query["error"]?.let { e ->
            throw RovianError(if (e == "access_denied") "You chose not to share your Rovian Account. Nothing was changed."
                else "Rovian Account couldn't complete the sign-in. Please try again.", "authorize_" + e.filter { it.isLetterOrDigit() || it == '_' }.take(40))
        }
        val code = query["code"] ?: throw RovianError("Rovian Account didn't send a sign-in code. Please try again.", "missing_code")
        val d = discovery()
        val (status, body) = try {
            http.request(d.token, mapOf("grant_type" to "authorization_code", "code" to code, "redirect_uri" to Rovian.REDIRECT_URI,
                "client_id" to Rovian.CLIENT_ID, "code_verifier" to p.verifier), null)
        } catch (e: Exception) { throw RovianError("Couldn't finish signing in with Rovian. Check your connection and try again.", "token_unreachable") }
        if (status !in 200..299) throw RovianError("Rovian Account didn't accept the sign-in. Please start again.", "token_$status")
        var tokens = try { JSONObject(body) } catch (e: Exception) { throw RovianError("Rovian Account sent an unreadable reply.", "token_format") }
        val idToken = tokens.optString("id_token").ifEmpty { throw RovianError("Rovian Account didn't send an identity token.", "missing_id_token") }
        val claims = verifyIdToken(idToken, p.nonce)
        var username = pickUsername(claims)
        val access = tokens.optString("access_token")
        if (username == null && d.userinfo != null && access.isNotEmpty()) {
            username = try {
                val (s, b) = http.request(d.userinfo, null, access)
                JSONObject(b).takeIf { s == 200 && it.optString("sub") == claims.getString("sub") }?.let(::pickUsername)
            } catch (e: Exception) { null }
        }
        tokens = JSONObject() // drop the tokens: PassGate keeps the identity, not the tokens
        val meta = claims.optJSONObject("user_metadata") ?: JSONObject()
        val email = claims.optString("email").lowercase()
        val name = listOf(claims.optString("name"), meta.optString("full_name"), meta.optString("name"), username ?: "", email.substringBefore('@'))
            .firstOrNull { it.isNotBlank() }?.take(80) ?: "Rovian user"
        return RovianIdentity(
            sub = claims.getString("sub"), name = name, email = email, emailVerified = claims.optBoolean("email_verified", false),
            username = username, rovianId = username?.let { "$it@${Rovian.IDENTITY_DOMAIN}" },
            picture = claims.optString("picture").takeIf { it.startsWith("https://") },
        )
    }

    /** RS256 against Rovian's JWKS, then iss, aud (and azp), exp, iat, nonce and sub. Any failure fails the sign-in. */
    fun verifyIdToken(token: String, nonce: String): JSONObject {
        fun fail(code: String): Nothing = throw RovianError("PassGate couldn't verify your Rovian sign-in, so it didn't sign you in. Please try again.", code)
        val parts = token.split('.')
        if (parts.size != 3) fail("id_token_format")
        val dec = Base64.getUrlDecoder()
        val header = try { JSONObject(String(dec.decode(parts[0]), Charsets.UTF_8)) } catch (e: Exception) { fail("id_token_format") }
        val claims = try { JSONObject(String(dec.decode(parts[1]), Charsets.UTF_8)) } catch (e: Exception) { fail("id_token_format") }
        if (header.optString("alg") != "RS256") fail("id_token_alg")
        val jwk = signingKey(header.optString("kid").ifEmpty { null }) ?: fail("id_token_key")
        val ok = try {
            val n = BigInteger(1, dec.decode(jwk.getString("n")))
            val e = BigInteger(1, dec.decode(jwk.getString("e")))
            val key = KeyFactory.getInstance("RSA").generatePublic(RSAPublicKeySpec(n, e))
            Signature.getInstance("SHA256withRSA").run {
                initVerify(key)
                update("${parts[0]}.${parts[1]}".toByteArray(Charsets.US_ASCII))
                verify(dec.decode(parts[2]))
            }
        } catch (e: Exception) { false }
        if (!ok) fail("id_token_signature")
        val nowS = now() / 1000
        if (claims.optString("iss") != Rovian.ISSUER) fail("id_token_iss")
        val aud = claims.opt("aud")
        val audOk = aud == Rovian.CLIENT_ID || (aud is JSONArray && (0 until aud.length()).any { aud.optString(it) == Rovian.CLIENT_ID })
        if (!audOk) fail("id_token_aud")
        if (aud is JSONArray && aud.length() > 1 && claims.optString("azp") != Rovian.CLIENT_ID) fail("id_token_azp")
        val exp = claims.opt("exp")
        if (exp !is Number || exp.toLong() + 60 < nowS) fail("id_token_expired")
        val iat = claims.opt("iat")
        if (iat is Number && iat.toLong() - 60 > nowS) fail("id_token_iat")
        if (!claims.has("nonce") || claims.optString("nonce") != nonce) fail("id_token_nonce")
        if (claims.optString("sub").isEmpty()) fail("id_token_sub")
        return claims
    }

    private fun signingKey(kid: String?): JSONObject? {
        fun find(a: JSONArray): JSONObject? = (0 until a.length()).map { a.getJSONObject(it) }
            .firstOrNull { it.optString("kty") == "RSA" && (it.optString("use").isEmpty() || it.optString("use") == "sig") && (kid == null || it.optString("kid") == kid) }
        keys?.let { (a, at) -> if (now() - at < 3_600_000) find(a)?.let { return it } }
        // Unknown key id: Rovian may have rotated its keys, so fetch the set again.
        return try {
            val (s, b) = http.request(discovery().jwks, null, null)
            if (s != 200) return null
            val a = JSONObject(b).optJSONArray("keys") ?: JSONArray()
            keys = a to now()
            find(a)
        } catch (e: Exception) { null }
    }

    private fun pickUsername(c: JSONObject): String? {
        val meta = c.optJSONObject("user_metadata") ?: JSONObject()
        for (v in listOf(c.optString("username"), c.optString("preferred_username"), meta.optString("username"), meta.optString("user_name"))) {
            val u = v.trim().lowercase().removeSuffix("@${Rovian.IDENTITY_DOMAIN}")
            if (Regex("^[a-z0-9._-]{1,64}$").matches(u)) return u
        }
        return null
    }
}

/**
 * Waits for Rovian's redirect on 127.0.0.1 only, for one sign-in. Answers with a plain "return to the app" page and
 * hands back the query. Requests for any other path are refused. The state check in [RovianSignIn.complete] stops a
 * forged request from another app.
 */
class LoopbackReceiver(private val port: Int = Rovian.REDIRECT_PORT) : AutoCloseable {
    private val server = ServerSocket(port, 4, InetAddress.getByName("127.0.0.1")).apply { soTimeout = 10 * 60_000 }

    /** Blocks until the callback arrives (or 10 minutes pass). Returns null on timeout or close. */
    fun await(appName: String): Map<String, String>? {
        while (!server.isClosed) {
            val s = try { server.accept() } catch (e: SocketTimeoutException) { return null } catch (e: Exception) { return null }
            s.use { sock ->
                sock.soTimeout = 5_000
                val line = try { BufferedReader(InputStreamReader(sock.getInputStream())).readLine() } catch (e: Exception) { null } ?: return@use
                val target = line.split(' ').getOrNull(1) ?: return@use
                val uri = try { URI("http://127.0.0.1$target") } catch (e: Exception) { null }
                val out = sock.getOutputStream()
                if (uri?.path != Rovian.REDIRECT_PATH) {
                    out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray()); out.flush()
                    return@use
                }
                val html = """<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>$appName</title>
                    <body style="font:17px system-ui;background:#0e1014;color:#f2f4f8;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
                    <div><div style="font-size:42px">✓</div><p>You can go back to <b>$appName</b> now.</p></div></body>"""
                val bytes = html.toByteArray()
                out.write("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                out.write(bytes); out.flush()
                return parseQuery(uri.rawQuery)
            }
        }
        return null
    }

    override fun close() { try { server.close() } catch (_: Exception) {} }

    companion object {
        fun parseQuery(raw: String?): Map<String, String> = raw.orEmpty().split('&').filter { it.isNotEmpty() }.associate {
            val i = it.indexOf('=')
            val k = URLDecoder.decode(if (i < 0) it else it.substring(0, i), "UTF-8")
            val v = if (i < 0) "" else URLDecoder.decode(it.substring(i + 1), "UTF-8")
            k to v
        }
    }
}
