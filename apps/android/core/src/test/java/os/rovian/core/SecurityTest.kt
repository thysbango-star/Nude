package os.rovian.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SecurityTest {
    private val std = Security.Level.STANDARD

    @Test fun legitimateSitesAllowed() {
        for (u in listOf("https://www.paypal.com/signin", "https://online.fnb.co.za/login", "https://accounts.google.com/", "https://www.google.de/")) {
            assertEquals(u, Security.Action.ALLOW, Security.analyze(u, std).action)
        }
    }

    @Test fun typosquatsDetected() {
        assertEquals("paypal", Security.detectTyposquat("paypa1.com")?.brand)
        assertEquals("standardbank", Security.detectTyposquat("standardbnak.co.za")?.brand)
        val v = Security.analyze("https://paypa1-login.com/verify", std)
        assertNotEquals(Security.Action.ALLOW, v.action)
        assertEquals("https://paypal.com/", v.intendedSite)
    }

    @Test fun brandInSubdomainBlocked() {
        assertEquals(Security.Action.BLOCK, Security.analyze("https://paypal.com.account-verify.top/login", std).action)
    }

    @Test fun trackers() {
        assertTrue(Security.shouldBlockTracker("stats.g.doubleclick.net", "news24.com", std))
        assertTrue(!Security.shouldBlockTracker("www.google-analytics.com", "news24.com", std))
        assertTrue(Security.shouldBlockTracker("www.google-analytics.com", "news24.com", Security.Level.ENHANCED))
    }

    @Test fun downloads() {
        assertEquals(Security.Action.BLOCK, Security.analyzeDownload("invoice.pdf.exe", null, "https://x.com/a", null, std).action)
        assertEquals(Security.Action.ALLOW, Security.analyzeDownload("report.pdf", "application/pdf", "https://x.com/a", null, std).action)
    }

    @Test fun scamMessage() {
        val m = Security.analyzeMessage("Dear customer, your account will be deleted within 24 hours. Verify your account at https://paypa1-secure.com/login and enter the OTP.")
        assertEquals("Likely a scam", m.assessment)
    }
}
