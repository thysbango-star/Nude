package os.rovian.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import os.rovian.core.nudeid.NudeId

class NudeIdTest {
    private val good = """NUDEID1:{"s":"https://nude-accounts.onrender.com/","i":"Nk5w8KbAqWZ8HzGZ","k":"nls_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"}"""

    @Test fun readsTheCodeNudeShows() {
        val c = NudeId.parseLink(good)
        assertNotNull(c)
        assertEquals("https://nude-accounts.onrender.com", c!!.server)
        assertEquals("Nk5w8KbAqWZ8HzGZ", c.id)
    }

    @Test fun refusesOtherCodes() {
        assertNull(NudeId.parseLink("NUDE1:{}"))
        assertNull(NudeId.parseLink("https://example.com"))
        // Plain http over the internet is refused; only https, or http to a computer on this network.
        assertNull(NudeId.parseLink(good.replace("https://nude-accounts.onrender.com/", "http://evil.example")))
        assertNotNull(NudeId.parseLink(good.replace("https://nude-accounts.onrender.com/", "http://192.168.1.20:8792")))
        assertNull(NudeId.parseLink(good.replace("nls_", "xyz_")))
        assertNull(NudeId.parseLink(good.replace("Nk5w8KbAqWZ8HzGZ", "../../x")))
    }
}
