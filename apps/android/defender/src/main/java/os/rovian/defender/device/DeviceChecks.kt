package os.rovian.defender.device

import android.app.KeyguardManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import os.rovian.defender.core.Severity
import java.io.File
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/** One device setting Rovian Defender looked at. `ok` = nothing to do. */
data class DeviceCheck(
    val id: String,
    val title: String,
    val ok: Boolean,
    val severity: Severity,
    val status: String,
    val explanation: String,
    val action: String,
    /** The Settings screen that fixes it, if there is one. */
    val settings: String? = null,
)

/**
 * Android security settings Rovian Defender can read. It can't change them (Android doesn't allow that), so every
 * check explains the setting and opens the right Settings screen.
 */
object DeviceChecks {
    fun run(ctx: Context, now: LocalDate = LocalDate.now()): List<DeviceCheck> {
        val out = mutableListOf<DeviceCheck>()
        val keyguard = ctx.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        out += screenLock(keyguard.isDeviceSecure)
        out += patchLevel(Build.VERSION.SECURITY_PATCH, now)
        out += androidVersion(Build.VERSION.SDK_INT, Build.VERSION.RELEASE)
        out += encryption((ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager).storageEncryptionStatus)
        val dev = Settings.Global.getInt(ctx.contentResolver, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1
        val adb = Settings.Global.getInt(ctx.contentResolver, Settings.Global.ADB_ENABLED, 0) == 1
        out += developerOptions(dev, adb)
        out += rootSigns(ROOT_PATHS.filter { File(it).exists() }, Build.TAGS)
        return out
    }

    fun screenLock(secure: Boolean) = if (secure) DeviceCheck("screen-lock", "Screen lock", true, Severity.INFO, "On",
        "Your phone needs a PIN, pattern, password or biometric to unlock.", "Nothing to do.")
    else DeviceCheck("screen-lock", "Screen lock", false, Severity.HIGH, "Off",
        "Anyone who picks up your phone can open it, and apps' stored data isn't protected by your lock.",
        "Set a PIN, pattern or password.", Settings.ACTION_SECURITY_SETTINGS)

    /** Monthly Android security patches fix known attacks. Older than 3 months = behind; older than 6 = exposed. */
    fun patchLevel(patch: String?, now: LocalDate): DeviceCheck {
        val date = runCatching { LocalDate.parse(patch) }.getOrNull()
            ?: return DeviceCheck("patch", "Security update", true, Severity.INFO, "Unknown", "Your phone didn't report its security patch date.", "Check for updates in Settings.", ACTION_SYSTEM_UPDATE)
        val days = ChronoUnit.DAYS.between(date, now)
        val months = days / 30
        return when {
            days <= 92 -> DeviceCheck("patch", "Security update", true, Severity.INFO, "Patched $patch", "Your phone has a recent Android security patch.", "Nothing to do.")
            days <= 183 -> DeviceCheck("patch", "Security update", false, Severity.MEDIUM, "$months months old",
                "Your last security patch is from $patch. Newer patches fix attacks that are already known.", "Install the latest system update.", ACTION_SYSTEM_UPDATE)
            else -> DeviceCheck("patch", "Security update", false, Severity.HIGH, "$months months old",
                "Your last security patch is from $patch. Attacks fixed since then can work on this phone.", "Install the latest system update. If none is offered, your phone may no longer get updates.", ACTION_SYSTEM_UPDATE)
        }
    }

    fun androidVersion(sdk: Int, release: String) = if (sdk >= 31) DeviceCheck("android", "Android version", true, Severity.INFO, "Android $release",
        "A version of Android that still receives security fixes on most phones.", "Nothing to do.")
    else DeviceCheck("android", "Android version", false, Severity.MEDIUM, "Android $release",
        "Older Android versions get fewer or no security fixes and lack newer privacy protections.", "Update if your phone offers it.", ACTION_SYSTEM_UPDATE)

    fun encryption(status: Int) = when (status) {
        DevicePolicyManager.ENCRYPTION_STATUS_ACTIVE, DevicePolicyManager.ENCRYPTION_STATUS_ACTIVE_PER_USER ->
            DeviceCheck("encryption", "Storage encryption", true, Severity.INFO, "On", "Your files are encrypted when the phone is locked.", "Nothing to do.")
        DevicePolicyManager.ENCRYPTION_STATUS_ACTIVE_DEFAULT_KEY ->
            DeviceCheck("encryption", "Storage encryption", false, Severity.MEDIUM, "Not tied to your lock", "Storage is encrypted, but not with your screen lock, so it's weaker.", "Set a screen lock.", Settings.ACTION_SECURITY_SETTINGS)
        else -> DeviceCheck("encryption", "Storage encryption", false, Severity.HIGH, "Off", "Your files aren't encrypted, so someone with the phone could read them.", "Turn on encryption in security settings.", Settings.ACTION_SECURITY_SETTINGS)
    }

    fun developerOptions(dev: Boolean, adb: Boolean) = when {
        adb -> DeviceCheck("developer", "USB debugging", false, Severity.HIGH, "On",
            "A computer you plug into could install apps and read data. Attackers use this on lost or unlocked phones.",
            "Turn off USB debugging unless you're developing apps.", Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)
        dev -> DeviceCheck("developer", "Developer options", false, Severity.LOW, "On",
            "Developer options are switched on. They aren't dangerous by themselves but expose settings most people don't need.",
            "Turn them off if you don't use them.", Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)
        else -> DeviceCheck("developer", "Developer options", true, Severity.INFO, "Off", "Developer options and USB debugging are off.", "Nothing to do.")
    }

    /** Signs, not proof: a `su` binary or test-keys build usually means the phone is rooted. */
    fun rootSigns(found: List<String>, tags: String?) = if (found.isEmpty() && tags?.contains("test-keys") != true)
        DeviceCheck("root", "System integrity", true, Severity.INFO, "No signs of rooting", "Rovian Defender found no common signs that the phone is rooted.", "Nothing to do.")
    else DeviceCheck("root", "System integrity", false, Severity.MEDIUM, "Signs of rooting",
        "Rovian Defender found ${if (found.isNotEmpty()) "a superuser tool (${found.first()})" else "a test build of Android"}. A rooted phone lets apps bypass Android's protections.",
        "If you didn't root this phone yourself, back up your data and reset it.")

    /** The intent that opens a check's Settings screen. */
    fun intentFor(check: DeviceCheck): Intent? = check.settings?.let { Intent(it).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }

    private val ROOT_PATHS = listOf("/system/bin/su", "/system/xbin/su", "/sbin/su", "/system/app/Superuser.apk", "/data/adb/magisk", "/system/bin/magisk")
    const val ACTION_SYSTEM_UPDATE = "android.settings.SYSTEM_UPDATE_SETTINGS"
}
