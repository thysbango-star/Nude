package os.rovian.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Same vectors as apps/desktop/tests/unit/phone-link.test.ts: the phone and the PC must agree byte for byte. */
class PhoneLinkTest {
    private val key = ByteArray(32) { it.toByte() }
    private val iv = ByteArray(12) { it.toByte() }

    @Test fun derivedKeysMatchDesktop() {
        val (enc, mac) = LinkCrypto.keys(key)
        assertEquals("uciKU85TEzNyINaJoMVS01WmuAbiWC83Ye8eU6hn33w", LinkCrypto.enc(enc))
        assertEquals("Slr4KAzcAJxC36o-2oO1vkD3RoGCW8vuU8IBKji6h4A", LinkCrypto.enc(mac))
    }

    @Test fun signaturesMatchDesktop() {
        val (_, mac) = LinkCrypto.keys(key)
        assertEquals("O1VSAn0Z18jwUdbT9xfylebpfUXtC8X0Ywqx38eIscU", LinkCrypto.sign(mac, "GET\n/v1/device/abc/report\n1700000000000"))
        assertEquals("T_ww6WxGuv9A3ituxnm_HTX4iEXS8uaFCNCTph3tyVg", LinkCrypto.sign(mac, "pair\nOFFER\nPixel 8\n1700000000000"))
    }

    @Test fun encryptionMatchesDesktop() {
        val (enc, _) = LinkCrypto.keys(key)
        val env = JSONObject().put("iv", "AAECAwQFBgcICQoL").put("ct", "SlHH-FzKCWTjI_iyv7ddxWKNHW4Zxu3z6cHjYyXyi8NbrEQf")
        val j = JSONObject(LinkCrypto.open(enc, "/v1/device/abc/report", env))
        assertEquals(1, j.getInt("a"))
        assertEquals("héllo", j.getString("s"))
        assertEquals(env.getString("ct"), LinkCrypto.seal(enc, "/v1/device/abc/report", """{"a":1,"s":"héllo"}""", iv).getString("ct"))
        try { LinkCrypto.open(enc, "/v1/device/abc/identity", env); fail("must be bound to its path") } catch (e: Exception) { /* expected */ }
    }

    @Test fun parsesOnlyNudeCodesWithLanAddresses() {
        val k = LinkCrypto.enc(key)
        val ok = LinkCode.parse("""NUDE1:{"v":1,"a":"passgate","h":["192.168.1.23","8.8.8.8"],"p":47830,"i":"abc","k":"$k","n":"SIMON-PC"}""")
        assertNotNull(ok)
        assertEquals(listOf("192.168.1.23"), ok!!.hosts)
        assertEquals("SIMON-PC", ok.pcName)
        assertTrue(!ok.toString().contains(k))
        assertNull(LinkCode.parse("""NUDE1:{"v":1,"a":"passgate","h":["8.8.8.8"],"p":47830,"i":"abc","k":"$k"}"""))
        assertNull(LinkCode.parse("""NUDE1:{"v":2,"a":"passgate","h":["10.0.0.2"],"p":47830,"i":"abc","k":"$k"}"""))
        assertNull(LinkCode.parse("https://example.com"))
        assertNull(LinkCode.parse("""NUDE1:{"v":1,"a":"passgate","h":["10.0.0.2"],"p":47830,"i":"abc","k":"short"}"""))
    }

    @Test fun lanHosts() {
        listOf("10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "100.64.1.1").forEach { assertTrue(it, LinkCode.isLanHost(it)) }
        listOf("172.32.0.1", "8.8.8.8", "192.169.0.1", "999.1.1.1", "localhost", "example.com", "").forEach { assertTrue(it, !LinkCode.isLanHost(it)) }
    }
}
