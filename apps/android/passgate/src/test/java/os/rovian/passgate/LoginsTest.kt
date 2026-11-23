package os.rovian.passgate

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LoginsTest {
    private val key = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
    private fun code(origin: String, hosts: String = "[\"192.168.1.20\"]") =
        """NUDEPW1:{"v":1,"h":$hosts,"p":47830,"i":"abcdefghijklmnop","k":"$key","o":"$origin","n":"Simon-PC"}"""

    @Test fun readsTheCodeNudeShows() {
        val r = Logins.parseRequest(code("https://accounts.google.com"))
        assertNotNull(r)
        assertEquals("accounts.google.com", r!!.host)
        assertEquals("Simon-PC", r.pcName)
        assertEquals(32, r.key.size)
    }

    @Test fun refusesUnsafeCodes() {
        assertNull(Logins.parseRequest(code("http://bank.example")))            // plain http on the internet
        assertNull(Logins.parseRequest(code("https://bank.example/login")))     // must be an origin, not a page
        assertNull(Logins.parseRequest(code("https://bank.example", "[\"8.8.8.8\"]"))) // Nude must be on your network
        assertNull(Logins.parseRequest("NUDE1:{}"))
        assertNull(Logins.parseRequest("https://example.com"))
    }

    @Test fun matchesTheSiteOnly() {
        assertTrue(Logins.sameSite("google.com", "accounts.google.com"))
        assertTrue(Logins.sameSite("https://www.GitHub.com/login", "github.com"))
        assertFalse(Logins.sameSite("google.com", "google.com.evil.example"))
        assertFalse(Logins.sameSite("bank.example", "notbank.example"))
        assertEquals("example.com", Logins.clean("https://www.Example.com/login"))
    }

    @Test fun generatesStrongPasswords() {
        val p = Logins.generate()
        assertEquals(20, p.length)
        assertTrue(p.any { it.isUpperCase() } && p.any { it.isLowerCase() } && p.any { it.isDigit() } && p.any { !it.isLetterOrDigit() })
        assertFalse(p == Logins.generate())
    }
}
