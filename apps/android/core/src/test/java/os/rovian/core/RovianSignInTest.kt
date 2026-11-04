package os.rovian.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.math.BigInteger
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.RSAPublicKey
import java.util.Base64

class RovianSignInTest {
    private val key: KeyPair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.genKeyPair()
    private val other: KeyPair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.genKeyPair()
    private val enc = Base64.getUrlEncoder().withoutPadding()
    private fun unsigned(b: BigInteger) = b.toByteArray().let { if (it[0] == 0.toByte()) it.copyOfRange(1, it.size) else it }
    private val jwk = (key.public as RSAPublicKey).let {
        JSONObject().put("kty", "RSA").put("kid", "k1").put("use", "sig").put("alg", "RS256").put("n", enc.encodeToString(unsigned(it.modulus))).put("e", enc.encodeToString(unsigned(it.publicExponent)))
    }
    private val disco = JSONObject().put("issuer", Rovian.ISSUER).put("authorization_endpoint", "${Rovian.ISSUER}/oauth/authorize")
        .put("token_endpoint", "${Rovian.ISSUER}/oauth/token").put("jwks_uri", "${Rovian.ISSUER}/.well-known/jwks.json").put("userinfo_endpoint", "${Rovian.ISSUER}/oauth/userinfo")

    private fun jwt(claims: JSONObject, alg: String = "RS256", kid: String = "k1", signer: KeyPair = key): String {
        val h = enc.encodeToString(JSONObject().put("alg", alg).put("kid", kid).toString().toByteArray())
        val b = enc.encodeToString(claims.toString().toByteArray())
        val sig = Signature.getInstance("SHA256withRSA").run { initSign(signer.private); update("$h.$b".toByteArray()); sign() }
        return "$h.$b.${enc.encodeToString(sig)}"
    }

    private fun good(nonce: String) = JSONObject().put("iss", Rovian.ISSUER).put("aud", Rovian.CLIENT_ID).put("sub", "user-1")
        .put("exp", System.currentTimeMillis() / 1000 + 3600).put("iat", System.currentTimeMillis() / 1000).put("nonce", nonce)
        .put("email", "Simon@Example.com").put("email_verified", true).put("name", "Simon Adamson").put("username", "simon")

    /** A fake Rovian that checks PKCE and lets the test decide what the ID token looks like. */
    private fun setup(discovery: JSONObject = disco, token: (nonce: String) -> String): Triple<RovianSignIn, PendingSignIn, MutableList<Map<String, String>>> {
        val forms = mutableListOf<Map<String, String>>()
        var challenge = ""
        var nonce = ""
        val http = Http { url, form, _ ->
            when {
                url.endsWith("openid-configuration") -> 200 to discovery.toString()
                url.endsWith("jwks.json") -> 200 to JSONObject().put("keys", JSONArray().put(jwk)).toString()
                url.endsWith("/oauth/token") -> {
                    forms += form!!
                    val sent = enc.encodeToString(MessageDigest.getInstance("SHA-256").digest(form.getValue("code_verifier").toByteArray()))
                    if (sent != challenge) 400 to "{\"error\":\"invalid_grant\"}"
                    else 200 to JSONObject().put("id_token", token(nonce)).put("access_token", "AT").put("refresh_token", "RT").toString()
                }
                else -> 404 to ""
            }
        }
        val s = RovianSignIn(http)
        val (url, p) = s.begin()
        val q = LoopbackReceiver.parseQuery(url.substringAfter('?'))
        challenge = q.getValue("code_challenge"); nonce = q.getValue("nonce")
        return Triple(s, p, forms)
    }

    private fun expectError(code: String, block: () -> Unit) {
        try { block(); fail("expected $code") } catch (e: RovianError) { assertEquals(code, e.code) }
    }

    @Test fun rfc7636TestVector() {
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", RovianSignIn().challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
    }

    @Test fun authorizeUrlHasEveryParameter() {
        val http = Http { url, _, _ -> if (url.endsWith("openid-configuration")) 200 to disco.toString() else 404 to "" }
        val (url, p) = RovianSignIn(http).begin()
        assertTrue(url.startsWith("${Rovian.ISSUER}/oauth/authorize?"))
        val q = LoopbackReceiver.parseQuery(url.substringAfter('?'))
        assertEquals("code", q["response_type"]); assertEquals(Rovian.CLIENT_ID, q["client_id"]); assertEquals(Rovian.REDIRECT_URI, q["redirect_uri"])
        assertEquals("openid email profile", q["scope"]); assertEquals("S256", q["code_challenge_method"])
        assertEquals(p.state, q["state"]); assertEquals(p.nonce, q["nonce"])
        assertTrue(p.verifier.length in 43..128)
        assertFalse(p.toString().contains(p.verifier))
    }

    @Test fun goodSignInKeepsOnlyTheIdentity() {
        val (s, p, forms) = setup { jwt(good(it)) }
        val id = s.complete(mapOf("code" to "abc", "state" to p.state), p)
        assertEquals("user-1", id.sub); assertEquals("simon@example.com", id.email); assertEquals("simon@rovian.cloud", id.rovianId); assertEquals("Simon Adamson", id.name)
        assertTrue(id.emailVerified)
        val f = forms.single()
        assertEquals("authorization_code", f["grant_type"]); assertEquals(Rovian.CLIENT_ID, f["client_id"]); assertNull(f["client_secret"])
        assertFalse(id.toJson().toString().contains("AT"))
    }

    @Test fun stateMustMatch() {
        val (s, p, _) = setup { jwt(good(it)) }
        expectError("state_mismatch") { s.complete(mapOf("code" to "abc", "state" to "forged"), p) }
        expectError("state_mismatch") { s.complete(mapOf("code" to "abc"), p) }
    }

    @Test fun deniedAndMissingCode() {
        val (s, p, _) = setup { jwt(good(it)) }
        expectError("authorize_access_denied") { s.complete(mapOf("error" to "access_denied", "state" to p.state), p) }
        expectError("missing_code") { s.complete(mapOf("state" to p.state), p) }
    }

    @Test fun rejectsBadIdTokens() {
        val cases = listOf<Pair<String, (String) -> String>>(
            "id_token_signature" to { n -> jwt(good(n), signer = other) },
            "id_token_alg" to { n -> jwt(good(n), alg = "HS256") },
            "id_token_iss" to { n -> jwt(good(n).put("iss", "https://evil.example/auth/v1")) },
            "id_token_aud" to { n -> jwt(good(n).put("aud", "someone-else")) },
            "id_token_expired" to { n -> jwt(good(n).put("exp", System.currentTimeMillis() / 1000 - 600)) },
            "id_token_nonce" to { _ -> jwt(good("replayed")) },
            "id_token_key" to { n -> jwt(good(n), kid = "unknown") },
        )
        for ((code, make) in cases) {
            val (s, p, _) = setup(token = make)
            expectError(code) { s.complete(mapOf("code" to "abc", "state" to p.state), p) }
        }
    }

    @Test fun refusesDiscoveryForAnotherIssuer() {
        expectError("discovery_mismatch") { setup(JSONObject(disco.toString()).put("issuer", "https://evil.example")) { jwt(good(it)) } }
    }
}
