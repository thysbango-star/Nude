package os.rovian.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import os.rovian.core.meditate.MeditateAuth
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec

class MeditateAuthTest {
    @Test fun s256ChallengeMatchesRfc7636() {
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", MeditateAuth.challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
    }

    /** JWS carries ES256 signatures as r‖s; Java verifies DER. Round-trip many keys (leading zeros, high bits). */
    @Test fun es256RawSignaturesVerifyAfterConversion() {
        val gen = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }
        repeat(40) { i ->
            val kp = gen.generateKeyPair()
            val data = "header.payload-$i".toByteArray()
            val der = Signature.getInstance("SHA256withECDSA").run { initSign(kp.private); update(data); sign() }
            val raw = derToRaw(der)
            assertEquals(64, raw.size)
            assertTrue(Signature.getInstance("SHA256withECDSA").run { initVerify(kp.public); update(data); verify(MeditateAuth.rawToDer(raw)) })
            raw[5] = (raw[5].toInt() xor 1).toByte()
            assertFalse(runCatching { Signature.getInstance("SHA256withECDSA").run { initVerify(kp.public); update(data); verify(MeditateAuth.rawToDer(raw)) } }.getOrDefault(false))
        }
    }

    @Test fun issuerAndClientRules() {
        assertTrue(MeditateAuth.validIssuer("https://abcdefgh.supabase.co/auth/v1"))
        assertFalse(MeditateAuth.validIssuer("http://abcdefgh.supabase.co/auth/v1"))
        assertFalse(MeditateAuth.validIssuer("https://abcdefgh.supabase.co/auth/v1/"))
        assertTrue(MeditateAuth.validClientId("84d370e0-9203-4a58-b516-d05ded71bac3"))
        assertFalse(MeditateAuth.validClientId("has space"))
    }

    @Test fun usernameFromClaims() {
        assertEquals("thysbango", MeditateAuth.pickUsername(JSONObject().put("preferred_username", "ThysBango@nude")))
        assertEquals("simon", MeditateAuth.pickUsername(JSONObject().put("user_metadata", JSONObject().put("username", "simon"))))
        assertNull(MeditateAuth.pickUsername(JSONObject().put("username", "bad name!")))
    }

    private fun derToRaw(der: ByteArray): ByteArray {
        var i = 2
        fun int(): ByteArray { val len = der[i + 1].toInt(); val v = der.copyOfRange(i + 2, i + 2 + len); i += 2 + len
            val t = v.dropWhile { it == 0.toByte() }.toByteArray(); return ByteArray(32 - t.size) + t }
        return int() + int()
    }
}
