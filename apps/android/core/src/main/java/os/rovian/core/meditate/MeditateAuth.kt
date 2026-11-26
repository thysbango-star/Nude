package os.rovian.core.meditate

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigInteger
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.PublicKey
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.security.spec.RSAPublicKeySpec
import java.util.Base64

/** Where Meditate is: its issuer (…/auth/v1) and this app's client ID there. */
data class MeditateConfig(val issuer: String, val clientId: String)

/** The verified identity Nude keeps. No tokens. */
data class MeditateIdentity(val sub: String, val name: String, val email: String, val emailVerified: Boolean, val username: String, val picture: String?)

class MeditateError(val userMessage: String, val code: String) : Exception(code) {
    val withReference get() = "$userMessage (Reference: $code)"
}

/**
 * "Continue with Meditate" on Android: OAuth 2.1 Authorization Code + PKCE (S256) against Meditate, the Nude sign-in
 * site (Lovable Cloud's managed OAuth server). Same rules as Nude for Windows (apps/desktop/src/main/meditate-auth.ts):
 * public client (no secret), the one redirect nude://auth/callback, state and nonce checked, the code exchanged
 * from the app (never a web page), the ID token verified (RS256/ES256 against the JWKS, iss, aud, exp, iat, nonce,
 * sub), and then every token is dropped. Only the identity is returned. Nothing here is logged.
 *
 * The verifier, state and nonce wait in app-private storage (Android may close the app while you sign in) for at
 * most 10 minutes, and each is used once.
 */
class MeditateAuth(ctx: Context, private val config: () -> MeditateConfig, private val now: () -> Long = System::currentTimeMillis) {
    private val prefs = ctx.getSharedPreferences("meditate-pending", Context.MODE_PRIVATE)

    private fun cfg(): MeditateConfig {
        val c = config()
        val issuer = c.issuer.trim().trimEnd('/')
        if (!validIssuer(issuer) || !validClientId(c.clientId.trim())) throw MeditateError(
            "Meditate sign-in isn't set up yet. Add Meditate's address and Nude Browser's client ID in Settings → Sign-in.", "not_configured")
        return MeditateConfig(issuer, c.clientId.trim())
    }

    val configured get() = runCatching { cfg() }.isSuccess

    private class Discovery(val issuer: String, val authorize: String, val token: String, val jwks: String, val userinfo: String?)

    private fun discovery(): Discovery {
        val issuer = cfg().issuer
        val d = try { getJson("$issuer/.well-known/openid-configuration") } catch (e: Exception) {
            throw MeditateError("Nude couldn't reach Meditate. Check your internet connection and try again.", "discovery_unreachable")
        }
        val https = { k: String -> d.optString(k).takeIf { it.startsWith("https://") } }
        val authorize = https("authorization_endpoint"); val token = https("token_endpoint"); val jwks = https("jwks_uri")
        if (d.optString("issuer") != issuer || authorize == null || token == null || jwks == null)
            throw MeditateError("Meditate sent unexpected sign-in settings, so Nude stopped for your safety.", "discovery_mismatch")
        return Discovery(issuer, authorize, token, jwks, https("userinfo_endpoint"))
    }

    /** Steps 1–2: a fresh verifier, S256 challenge, state and nonce. Returns the address to open. Runs on a background thread. */
    fun begin(): String {
        val c = cfg()
        val d = discovery()
        sweep()
        val verifier = b64(random(32))
        val state = b64(random(24))
        val nonce = b64(random(24))
        prefs.edit().putString(state, JSONObject().put("v", verifier).put("n", nonce).put("t", now()).toString()).apply()
        val q = linkedMapOf("response_type" to "code", "client_id" to c.clientId, "redirect_uri" to REDIRECT_URI, "scope" to SCOPE,
            "state" to state, "nonce" to nonce, "code_challenge" to challengeFor(verifier), "code_challenge_method" to "S256")
        return d.authorize + (if ('?' in d.authorize) "&" else "?") + q.entries.joinToString("&") { "${it.key}=${enc(it.value)}" }
    }

    /** Steps 4–7: checks the callback, exchanges the code, verifies the ID token. Single-use either way. Background thread. */
    fun complete(callback: String): MeditateIdentity {
        val u = Uri.parse(callback)
        val state = u.getQueryParameter("state")
        val pending = state?.let { prefs.getString(it, null) }?.let { runCatching { JSONObject(it) }.getOrNull() }
        if (state != null) prefs.edit().remove(state).apply()
        if (state == null || pending == null || now() - pending.optLong("t") > PENDING_TTL)
            throw MeditateError("This sign-in link has expired or didn't come from this phone. Please start again.", "state_mismatch")
        u.getQueryParameter("error")?.let { err ->
            throw MeditateError(if (err == "access_denied") "You chose not to share your Meditate account with Nude. Nothing was changed."
                else "Meditate couldn't complete the sign-in. Please try again.", "authorize_" + err.replace(Regex("\\W"), "").take(40))
        }
        val code = u.getQueryParameter("code") ?: throw MeditateError("Meditate didn't send a sign-in code. Please try again.", "missing_code")
        val c = cfg()
        val d = discovery()
        val form = listOf("grant_type" to "authorization_code", "code" to code, "redirect_uri" to REDIRECT_URI, "client_id" to c.clientId,
            "code_verifier" to pending.getString("v")).joinToString("&") { "${it.first}=${enc(it.second)}" }
        val (status, tokens) = try { post(d.token, form) } catch (e: Exception) {
            throw MeditateError("Nude couldn't finish signing you in with Meditate. Check your connection and try again.", "token_unreachable")
        }
        if (status !in 200..299) throw MeditateError("Meditate didn't accept the sign-in. Please start again.",
            "token_$status" + (tokens.optString("error").takeIf { it.isNotBlank() }?.let { "_" + it.replace(Regex("\\W"), "").take(40) } ?: ""))
        val idToken = tokens.optString("id_token").takeIf { it.isNotBlank() } ?: throw MeditateError("Meditate didn't send an identity token.", "missing_id_token")
        val claims = verifyIdToken(idToken, pending.getString("n"), d, c)
        var username = pickUsername(claims)
        val access = tokens.optString("access_token")
        if (username == null && d.userinfo != null && access.isNotBlank()) {
            username = runCatching { getJson(d.userinfo, access).takeIf { it.optString("sub") == claims.optString("sub") }?.let { pickUsername(it) } }.getOrNull()
        }
        // The tokens go out of scope here: Nude keeps the identity, not the tokens.
        val meta = claims.optJSONObject("user_metadata") ?: JSONObject()
        val email = claims.optString("email").lowercase()
        val name = listOf(claims.optString("name"), meta.optString("full_name"), meta.optString("name"), username ?: "", email.substringBefore('@'))
            .firstOrNull { it.isNotBlank() }?.take(80) ?: "Nude user"
        val local = (username ?: email.substringBefore('@')).lowercase().replace(Regex("[^a-z0-9._-]"), "").take(40)
            .ifBlank { "user" + claims.optString("sub").replace(Regex("[^A-Za-z0-9]"), "").take(8).lowercase() }
        val picture = listOf(claims.optString("picture"), meta.optString("avatar_url")).firstOrNull { it.startsWith("https://") }?.take(2000)
        return MeditateIdentity(claims.optString("sub"), name, email, claims.optBoolean("email_verified"), local, picture)
    }

    /** Signature (RS256/ES256, matching the key type; "none" and HMAC refused), then iss, aud, azp, exp, iat, nonce, sub. */
    private fun verifyIdToken(token: String, nonce: String, d: Discovery, c: MeditateConfig): JSONObject {
        fun fail(code: String): Nothing = throw MeditateError("Nude couldn't verify your Meditate sign-in, so it didn't sign you in. Please try again.", code)
        val parts = token.split('.')
        if (parts.size != 3) fail("id_token_format")
        val header = runCatching { JSONObject(String(unb64(parts[0]))) }.getOrNull() ?: fail("id_token_format")
        val claims = runCatching { JSONObject(String(unb64(parts[1]))) }.getOrNull() ?: fail("id_token_format")
        val alg = header.optString("alg")
        if (alg != "RS256" && alg != "ES256") fail("id_token_alg")
        val key = signingKey(d, header.optString("kid").takeIf { it.isNotBlank() }, alg) ?: fail("id_token_key")
        val sig = runCatching { unb64(parts[2]) }.getOrNull() ?: fail("id_token_signature")
        val ok = runCatching {
            val data = "${parts[0]}.${parts[1]}".toByteArray(Charsets.US_ASCII)
            if (alg == "RS256") Signature.getInstance("SHA256withRSA").run { initVerify(key); update(data); verify(sig) }
            else sig.size == 64 && Signature.getInstance("SHA256withECDSA").run { initVerify(key); update(data); verify(rawToDer(sig)) }
        }.getOrDefault(false)
        if (!ok) fail("id_token_signature")
        val nowS = now() / 1000
        if (claims.optString("iss") != c.issuer) fail("id_token_iss")
        val aud = claims.opt("aud")
        val auds = when (aud) { is String -> listOf(aud); is JSONArray -> (0 until aud.length()).map { aud.optString(it) }; else -> emptyList() }
        if (c.clientId !in auds) fail("id_token_aud")
        if (auds.size > 1 && claims.optString("azp") != c.clientId) fail("id_token_azp")
        if (!claims.has("exp") || claims.optLong("exp") + CLOCK_SKEW < nowS) fail("id_token_expired")
        if (claims.has("iat") && claims.optLong("iat") - CLOCK_SKEW > nowS) fail("id_token_iat")
        if (claims.optString("nonce") != nonce || nonce.isEmpty()) fail("id_token_nonce")
        if (claims.optString("sub").isBlank()) fail("id_token_sub")
        return claims
    }

    private fun signingKey(d: Discovery, kid: String?, alg: String): PublicKey? {
        val keys = runCatching { getJson(d.jwks).optJSONArray("keys") }.getOrNull() ?: return null
        for (i in 0 until keys.length()) {
            val k = keys.optJSONObject(i) ?: continue
            if (kid != null && k.optString("kid") != kid) continue
            if (k.has("alg") && k.optString("alg") != alg) continue
            if (k.has("use") && k.optString("use") != "sig") continue
            val key = runCatching {
                when {
                    alg == "RS256" && k.optString("kty") == "RSA" ->
                        KeyFactory.getInstance("RSA").generatePublic(RSAPublicKeySpec(BigInteger(1, unb64(k.getString("n"))), BigInteger(1, unb64(k.getString("e")))))
                    alg == "ES256" && k.optString("kty") == "EC" && k.optString("crv") == "P-256" -> {
                        val params = AlgorithmParameters.getInstance("EC").apply { init(ECGenParameterSpec("secp256r1")) }.getParameterSpec(ECParameterSpec::class.java)
                        KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(ECPoint(BigInteger(1, unb64(k.getString("x"))), BigInteger(1, unb64(k.getString("y")))), params))
                    }
                    else -> null
                }
            }.getOrNull()
            if (key != null) return key
        }
        return null
    }

    private fun sweep() {
        val e = prefs.edit()
        prefs.all.forEach { (k, v) -> if (runCatching { now() - JSONObject(v as String).optLong("t") > PENDING_TTL }.getOrDefault(true)) e.remove(k) }
        e.apply()
    }

    private fun getJson(url: String, bearer: String? = null): JSONObject {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 10_000; c.readTimeout = 10_000
        c.setRequestProperty("accept", "application/json")
        bearer?.let { c.setRequestProperty("authorization", "Bearer $it") }
        if (c.responseCode !in 200..299) error("HTTP ${c.responseCode}")
        return JSONObject(c.inputStream.bufferedReader().readText())
    }

    private fun post(url: String, form: String): Pair<Int, JSONObject> {
        val c = URL(url).openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true
        c.connectTimeout = 10_000; c.readTimeout = 15_000
        c.setRequestProperty("content-type", "application/x-www-form-urlencoded")
        c.setRequestProperty("accept", "application/json")
        c.outputStream.use { it.write(form.toByteArray()) }
        val code = c.responseCode
        val body = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.readText().orEmpty()
        return code to (runCatching { JSONObject(body) }.getOrDefault(JSONObject()))
    }

    companion object {
        const val REDIRECT_URI = "nude://auth/callback"
        const val SCOPE = "openid email profile"
        private const val PENDING_TTL = 10 * 60_000L
        private const val CLOCK_SKEW = 60L

        fun isCallback(url: String): Boolean = runCatching {
            val u = Uri.parse(url)
            u.scheme == "nude" && u.host == "auth" && u.path == "/callback"
        }.getOrDefault(false)

        fun validIssuer(u: String) = Regex("^https://[A-Za-z0-9.-]+(:\\d+)?(/[A-Za-z0-9._~/-]*[^/])?$").matches(u)
        fun validClientId(c: String) = Regex("^[A-Za-z0-9._:-]{1,120}$").matches(c)

        private val rng = SecureRandom()
        private fun random(n: Int) = ByteArray(n).also { rng.nextBytes(it) }
        fun b64(b: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(b)
        fun unb64(s: String): ByteArray = Base64.getUrlDecoder().decode(s)
        fun challengeFor(verifier: String) = b64(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
        private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

        fun pickUsername(c: JSONObject): String? {
            val meta = c.optJSONObject("user_metadata") ?: JSONObject()
            for (v in listOf(c.optString("username"), c.optString("preferred_username"), meta.optString("username"), meta.optString("user_name"))) {
                val u = v.trim().lowercase().removeSuffix("@nude")
                if (Regex("^[a-z0-9._-]{1,64}$").matches(u)) return u
            }
            return null
        }

        /** JWS ES256 signatures are r‖s (64 bytes); Java wants DER. */
        fun rawToDer(raw: ByteArray): ByteArray {
            fun int(b: ByteArray): ByteArray {
                var x = b.dropWhile { it == 0.toByte() }.toByteArray()
                if (x.isEmpty()) x = byteArrayOf(0)
                if (x[0] < 0) x = byteArrayOf(0) + x
                return byteArrayOf(0x02, x.size.toByte()) + x
            }
            val body = int(raw.copyOfRange(0, 32)) + int(raw.copyOfRange(32, 64))
            return byteArrayOf(0x30, body.size.toByte()) + body
        }
    }
}
