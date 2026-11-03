package os.nude.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OmniboxTest {
    private fun r(s: String) = Omnibox.resolve(s, Omnibox.Engine.DUCKDUCKGO)

    @Test fun hostsBecomeHttps() {
        assertEquals(Omnibox.Result.Navigate("https://example.com"), r("example.com"))
        assertEquals(Omnibox.Result.Navigate("https://news24.co.za/sport"), r("news24.co.za/sport"))
        assertEquals(Omnibox.Result.Navigate("http://localhost:3000"), r("localhost:3000"))
    }

    @Test fun textIsSearched() {
        assertTrue(r("best braai recipes") is Omnibox.Result.Search)
        assertTrue(r("hello") is Omnibox.Result.Search)
        assertTrue(r("?example.com") is Omnibox.Result.Search)
    }

    @Test fun dangerousSchemesBlocked() {
        assertTrue(r("javascript:alert(1)") is Omnibox.Result.Blocked)
        assertTrue(r("file:///sdcard") is Omnibox.Result.Blocked)
    }

    @Test fun display() {
        assertEquals("example.com/a", Omnibox.display("https://www.example.com/a"))
        assertEquals("http://example.com/", Omnibox.display("http://example.com/"))
    }
}
