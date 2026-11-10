package os.rovian.defender.core

import android.content.Context
import os.rovian.defender.apps.AppAnalyzer
import os.rovian.defender.apps.AppReport
import os.rovian.defender.device.DeviceCheck
import os.rovian.defender.device.DeviceChecks

/** What one device scan found. Every number here was counted on this phone just now. */
data class ScanResult(
    val time: Long,
    val checks: List<DeviceCheck>,
    val apps: List<AppReport>,
) {
    val checksPassing get() = checks.count { it.ok }
    val appsNeedingAttention get() = apps.filter { it.needsAttention }
    val threats get() = apps.count { it.knownBad != null }
    val worst: Severity get() = (checks.filter { !it.ok }.map { it.severity } + apps.map { it.severity }.filter { it.rank >= Severity.MEDIUM.rank }).maxByOrNull { it.rank } ?: Severity.INFO
}

/** Overall protection state for the dashboard, from real findings only. */
enum class Protection(val title: String) { UNKNOWN("Not scanned yet"), PROTECTED("Your phone is protected"), ATTENTION("A few things need a look"), AT_RISK("Your phone is at risk") }

fun protectionOf(r: ScanResult?): Protection = when {
    r == null -> Protection.UNKNOWN
    r.threats > 0 || r.worst == Severity.HIGH -> Protection.AT_RISK
    r.worst == Severity.MEDIUM -> Protection.ATTENTION
    else -> Protection.PROTECTED
}

/**
 * Defender Core: runs the device and app checks (blocking; call off the main thread) and turns findings into events.
 * Recording happens separately, on the main thread, so the activity centre stays consistent.
 */
object DefenderCore {
    fun scan(ctx: Context, onProgress: (String, Float) -> Unit = { _, _ -> }): ScanResult {
        onProgress("Checking device settings…", 0.05f)
        val checks = DeviceChecks.run(ctx)
        onProgress("Looking at your apps…", 0.15f)
        val facts = AppAnalyzer.collect(ctx) { done, total -> onProgress("Checking app $done of $total…", 0.15f + 0.8f * done / maxOf(1, total)) }
        val apps = facts.map(AppAnalyzer::assess).sortedByDescending { it.severity.rank }
        onProgress("Done", 1f)
        return ScanResult(System.currentTimeMillis(), checks, apps)
    }

    /** Records what a scan found; returns the new high-severity events (for a notification). */
    fun record(store: EventStore, r: ScanResult): List<String> {
        val fresh = mutableListOf<String>()
        val deviceKeys = mutableSetOf<String>()
        for (c in r.checks.filter { !it.ok }) {
            val key = "device:${c.id}"
            deviceKeys += key
            if (store.record(Category.DEVICE, c.severity, c.title, "${c.title}: ${c.status}", c.explanation, c.action, key) && c.severity == Severity.HIGH) fresh += "${c.title}: ${c.status}"
        }
        store.resolveMissing("device:", deviceKeys)
        val appKeys = mutableSetOf<String>()
        for (a in r.apps.filter { it.needsAttention }) {
            val key = "app:${a.facts.packageName}"
            appKeys += key
            val cat = if (a.knownBad != null) Category.THREAT else Category.APP
            val title = if (a.knownBad != null) "${a.facts.label} is a known ${a.knownBad} app" else "${a.facts.label} has risky access"
            val action = if (a.knownBad != null || !a.fromStore) "Uninstall it unless you know exactly why you installed it." else "Check its permissions, and remove access it doesn't need."
            if (store.record(cat, a.severity, a.facts.label, title, a.reasons.joinToString(" "), action, key) && a.severity == Severity.HIGH) fresh += title
        }
        store.resolveMissing("app:", appKeys)
        store.markScanned(apps = true)
        return fresh
    }
}
