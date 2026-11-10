package os.rovian.defender

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import os.rovian.defender.apps.AppAnalyzer
import os.rovian.defender.apps.AppFacts
import os.rovian.defender.core.Assessment
import os.rovian.defender.core.Protection
import os.rovian.defender.core.ScanResult
import os.rovian.defender.core.Severity
import os.rovian.defender.core.protectionOf
import os.rovian.defender.device.DeviceChecks
import os.rovian.defender.files.FileScanner
import os.rovian.defender.web.LinkScanner
import java.time.LocalDate

class DefenderRulesTest {
    private fun app(
        installer: String? = "com.android.vending", granted: Set<String> = emptySet(), requested: Set<String> = setOf("android.permission.INTERNET"),
        accessibility: Boolean = false, admin: Boolean = false, listener: Boolean = false, target: Int = 34, debuggable: Boolean = false, pkg: String = "com.example.app",
    ) = AppFacts(pkg, "Example", installer, target, granted, requested + granted, accessibility, listener, admin, debuggable, 0L, "ab")

    @Test fun storeAppWithNothingRiskyIsInfo() {
        val r = AppAnalyzer.assess(app())
        assertEquals(Severity.INFO, r.severity)
        assertTrue(r.fromStore)
        assertTrue(r.reasons.isEmpty())
    }

    @Test fun sideloadedSmsReaderIsHigh() {
        val r = AppAnalyzer.assess(app(installer = "com.whatsapp", granted = setOf("android.permission.READ_SMS")))
        assertEquals(Severity.HIGH, r.severity)
        assertFalse(r.fromStore)
        assertTrue(r.reasons.any { it.contains("text messages") })
    }

    @Test fun accessibilityPlusOverlayOutsideStoreIsHigh() {
        val r = AppAnalyzer.assess(app(installer = null, accessibility = true, granted = setOf("android.permission.SYSTEM_ALERT_WINDOW")))
        assertEquals(Severity.HIGH, r.severity)
        assertTrue(r.reasons.any { it.contains("banking trojans") })
    }

    @Test fun storeAppWithAccessibilityIsOnlyLow() {
        assertEquals(Severity.LOW, AppAnalyzer.assess(app(accessibility = true)).severity)
    }

    @Test fun veryOldTargetIsMedium() {
        assertEquals(Severity.MEDIUM, AppAnalyzer.assess(app(target = 21)).severity)
    }

    @Test fun threatListMatchIsHighAndNamed() {
        AppAnalyzer.knownBadPackages["com.bad.trojan"] = "banking trojan"
        val r = AppAnalyzer.assess(app(pkg = "com.bad.trojan"))
        assertEquals(Severity.HIGH, r.severity)
        assertEquals("banking trojan", r.knownBad)
        AppAnalyzer.knownBadPackages.clear()
    }

    @Test fun patchLevelAges() {
        val now = LocalDate.parse("2026-11-10")
        assertTrue(DeviceChecks.patchLevel("2026-10-05", now).ok)
        assertEquals(Severity.MEDIUM, DeviceChecks.patchLevel("2026-06-01", now).severity)
        assertEquals(Severity.HIGH, DeviceChecks.patchLevel("2025-12-01", now).severity)
        assertTrue(DeviceChecks.patchLevel("not a date", now).ok)
    }

    @Test fun screenLockAndUsbDebugging() {
        assertEquals(Severity.HIGH, DeviceChecks.screenLock(false).severity)
        assertTrue(DeviceChecks.screenLock(true).ok)
        assertEquals(Severity.HIGH, DeviceChecks.developerOptions(true, true).severity)
        assertEquals(Severity.LOW, DeviceChecks.developerOptions(true, false).severity)
        assertTrue(DeviceChecks.developerOptions(false, false).ok)
    }

    @Test fun protectionFollowsTheWorstFinding() {
        assertEquals(Protection.UNKNOWN, protectionOf(null))
        val ok = ScanResult(0, listOf(DeviceChecks.screenLock(true)), listOf(AppAnalyzer.assess(app())))
        assertEquals(Protection.PROTECTED, protectionOf(ok))
        val bad = ScanResult(0, listOf(DeviceChecks.screenLock(false)), emptyList())
        assertEquals(Protection.AT_RISK, protectionOf(bad))
        val meh = ScanResult(0, listOf(DeviceChecks.patchLevel("2026-06-01", LocalDate.parse("2026-11-10"))), emptyList())
        assertEquals(Protection.ATTENTION, protectionOf(meh))
    }

    @Test fun disguisedExecutableIsDangerous() {
        val r = FileScanner.assess("invoice.pdf", "application/pdf", byteArrayOf(0x4D, 0x5A, 0x90.toByte(), 0x00), null)
        assertEquals(Assessment.DANGEROUS, r.assessment)
        assertEquals("Windows program", r.realType)
    }

    @Test fun plainImageHasSafeIndicatorsNotSafe() {
        val r = FileScanner.assess("photo.png", "image/png", byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A), null)
        assertEquals(Assessment.SAFE_INDICATORS, r.assessment)
        assertTrue(r.advice.contains("doesn't guarantee"))
    }

    @Test fun knownBadHashIsDangerous() {
        FileScanner.knownBadHashes["deadbeef"] = "ransomware"
        assertEquals(Assessment.DANGEROUS, FileScanner.assess("notes.txt", "text/plain", "hello".toByteArray(), "deadbeef").assessment)
        FileScanner.knownBadHashes.clear()
    }

    @Test fun linkExtractionFromMessages() {
        assertEquals("https://example.com/a", LinkScanner.extract("Hi! see https://example.com/a."))
        assertEquals("https://paypal-login.top/x", LinkScanner.extract("Your account is locked: paypal-login.top/x"))
        assertEquals(null, LinkScanner.extract("no links here"))
    }

    @Test fun lookalikeLinkIsNotSafe() {
        val r = LinkScanner.scan("https://paypa1-secure-login.top/verify")
        assertNotNull(r)
        assertTrue(r!!.assessment == Assessment.DANGEROUS || r.assessment == Assessment.SUSPICIOUS)
        assertTrue(r.indicators.any { it.bad })
    }

    @Test fun ordinaryLinkGetsSafeIndicatorsAtBest() {
        val r = LinkScanner.scan("https://www.wikipedia.org/")!!
        assertEquals(Assessment.SAFE_INDICATORS, r.assessment)
        assertTrue(r.advice.contains("isn't a guarantee"))
    }

    @Test fun redirectToAnotherSiteIsReported() {
        val r = LinkScanner.scan("https://bit.ly/abc", redirects = listOf("https://paypa1-secure-login.top/verify"), checkedOnline = true)!!
        assertTrue(r.indicators.any { it.text.contains("different site") })
        assertTrue(r.assessment == Assessment.DANGEROUS || r.assessment == Assessment.SUSPICIOUS)
    }
}
