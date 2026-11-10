package os.rovian.defender.apps

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import os.rovian.defender.core.Severity
import java.security.MessageDigest

/** What Android tells Rovian Defender about one installed app. No private app data: Android doesn't allow that. */
data class AppFacts(
    val packageName: String,
    val label: String,
    val installer: String?,
    val targetSdk: Int,
    val granted: Set<String>,
    val requested: Set<String>,
    val accessibility: Boolean,
    val notificationListener: Boolean,
    val deviceAdmin: Boolean,
    val debuggable: Boolean,
    val firstInstall: Long,
    val certSha256: String?,
)

data class AppReport(val facts: AppFacts, val severity: Severity, val reasons: List<String>, val fromStore: Boolean, val knownBad: String?) {
    val needsAttention get() = severity.rank >= Severity.MEDIUM.rank
}

/** Privacy-sensitive permission groups, for the privacy centre. */
enum class Sensitive(val label: String, val permissions: Set<String>) {
    CAMERA("Camera", setOf("android.permission.CAMERA")),
    MICROPHONE("Microphone", setOf("android.permission.RECORD_AUDIO")),
    LOCATION("Location", setOf("android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_BACKGROUND_LOCATION")),
    CONTACTS("Contacts", setOf("android.permission.READ_CONTACTS")),
    SMS("Text messages", setOf("android.permission.READ_SMS", "android.permission.RECEIVE_SMS")),
    CALLS("Call history", setOf("android.permission.READ_CALL_LOG")),
    FILES("Photos and files", setOf("android.permission.READ_MEDIA_IMAGES", "android.permission.READ_MEDIA_VIDEO", "android.permission.READ_EXTERNAL_STORAGE", "android.permission.MANAGE_EXTERNAL_STORAGE")),
}

/**
 * Looks at every user-installed app: where it came from, what it can do, and which risky combinations of access it
 * holds. Never calls an app malware unless a threat list says so; otherwise it explains what's worth a look.
 */
object AppAnalyzer {
    val trustedStores = mapOf(
        "com.android.vending" to "Google Play", "com.google.android.packageinstaller.store" to "Google Play",
        "com.sec.android.app.samsungapps" to "Galaxy Store", "com.huawei.appmarket" to "AppGallery",
        "com.amazon.venezia" to "Amazon Appstore", "com.heytap.market" to "App Market", "com.xiaomi.market" to "GetApps",
        "org.fdroid.fdroid" to "F-Droid",
    )

    /** Known-bad apps from Rovian threat intelligence: package name or signing-certificate SHA-256 → category. */
    val knownBadPackages = mutableMapOf<String, String>()
    val knownBadCerts = mutableMapOf<String, String>()

    fun collect(ctx: Context, onProgress: (done: Int, total: Int) -> Unit = { _, _ -> }): List<AppFacts> {
        val pm = ctx.packageManager
        val cr = ctx.contentResolver
        val access = (Settings.Secure.getString(cr, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: "").split(':').mapNotNull { it.substringBefore('/').takeIf { s -> s.isNotBlank() } }.toSet()
        val listeners = (Settings.Secure.getString(cr, "enabled_notification_listeners") ?: "").split(':').mapNotNull { it.substringBefore('/').takeIf { s -> s.isNotBlank() } }.toSet()
        val admins = (ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager).activeAdmins.orEmpty().map { it.packageName }.toSet()
        val flags = PackageManager.GET_PERMISSIONS or (if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else 0)
        @Suppress("DEPRECATION")
        val pkgs: List<PackageInfo> = if (Build.VERSION.SDK_INT >= 33) pm.getInstalledPackages(PackageManager.PackageInfoFlags.of(flags.toLong())) else pm.getInstalledPackages(flags)
        val user = pkgs.filter { ((it.applicationInfo?.flags ?: 0) and ApplicationInfo.FLAG_SYSTEM) == 0 && it.packageName != ctx.packageName }
        return user.mapIndexed { i, p ->
            onProgress(i + 1, user.size)
            val req = p.requestedPermissions.orEmpty().toSet()
            val granted = p.requestedPermissions.orEmpty().filterIndexed { j, _ -> ((p.requestedPermissionsFlags?.getOrNull(j) ?: 0) and PackageInfo.REQUESTED_PERMISSION_GRANTED) != 0 }.toSet()
            AppFacts(
                p.packageName, p.applicationInfo?.loadLabel(pm)?.toString() ?: p.packageName, installer(pm, p.packageName),
                p.applicationInfo?.targetSdkVersion ?: 0, granted, req,
                p.packageName in access, p.packageName in listeners, p.packageName in admins,
                ((p.applicationInfo?.flags ?: 0) and ApplicationInfo.FLAG_DEBUGGABLE) != 0, p.firstInstallTime, cert(p),
            )
        }
    }

    private fun installer(pm: PackageManager, pkg: String): String? = try {
        if (Build.VERSION.SDK_INT >= 30) pm.getInstallSourceInfo(pkg).installingPackageName else @Suppress("DEPRECATION") pm.getInstallerPackageName(pkg)
    } catch (e: Exception) { null }

    private fun cert(p: PackageInfo): String? = try {
        val sig = if (Build.VERSION.SDK_INT >= 28) p.signingInfo?.apkContentsSigners?.firstOrNull() else @Suppress("DEPRECATION") p.signatures?.firstOrNull()
        sig?.let { MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).joinToString("") { b -> "%02x".format(b) } }
    } catch (e: Exception) { null }

    private const val SMS_READ = "android.permission.READ_SMS"
    private const val SMS_RECEIVE = "android.permission.RECEIVE_SMS"
    private const val OVERLAY = "android.permission.SYSTEM_ALERT_WINDOW"
    private const val INSTALL = "android.permission.REQUEST_INSTALL_PACKAGES"
    private const val CALL_LOG = "android.permission.READ_CALL_LOG"
    private const val CONTACTS = "android.permission.READ_CONTACTS"
    private const val INTERNET = "android.permission.INTERNET"

    /** The rules. Pure, so they're unit-tested. */
    fun assess(f: AppFacts): AppReport {
        val store = f.installer?.let { trustedStores[it] }
        val fromStore = store != null
        val reasons = mutableListOf<String>()
        var sev = Severity.INFO
        fun bump(s: Severity) { if (s.rank > sev.rank) sev = s }

        val bad = knownBadPackages[f.packageName] ?: f.certSha256?.let { knownBadCerts[it] }
        if (bad != null) { reasons += "Rovian threat intelligence lists this app as $bad."; bump(Severity.HIGH) }

        if (!fromStore) reasons += "Installed from outside an app store${f.installer?.let { " (by $it)" } ?: ""}."
        val readsSms = SMS_READ in f.granted || SMS_RECEIVE in f.granted
        if (readsSms && INTERNET in f.requested) {
            reasons += "It can read your text messages, including one-time PINs, and send data online."
            bump(if (fromStore) Severity.LOW else Severity.HIGH)
        }
        if (f.accessibility) {
            reasons += "It's switched on as an accessibility service, so it can see your screen and tap for you."
            bump(if (fromStore) Severity.LOW else Severity.HIGH)
            if (OVERLAY in f.granted) { reasons += "It can also draw over other apps, a combination banking trojans use to fake login screens."; bump(if (fromStore) Severity.MEDIUM else Severity.HIGH) }
        }
        if (f.deviceAdmin) {
            reasons += "It's a device administrator, which can lock the phone and makes it harder to remove."
            bump(if (fromStore) Severity.LOW else Severity.HIGH)
        }
        if (f.notificationListener) {
            reasons += "It can read every notification, including sign-in codes."
            bump(if (fromStore) Severity.LOW else Severity.MEDIUM)
        }
        if (INSTALL in f.requested && !fromStore) { reasons += "It can ask to install other apps."; bump(Severity.MEDIUM) }
        if (!fromStore && (CALL_LOG in f.granted || CONTACTS in f.granted) && INTERNET in f.requested) { reasons += "It can read your contacts or call history and send them online."; bump(Severity.MEDIUM) }
        if (f.targetSdk in 1..22) { reasons += "It's built for Android 5 or older, so it gets all its permissions without asking."; bump(Severity.MEDIUM) }
        else if (f.targetSdk in 23..28 && !fromStore) { reasons += "It's built for an old Android version (API ${f.targetSdk}) and skips newer privacy protections."; bump(Severity.LOW) }
        if (f.debuggable) { reasons += "It's a developer (debuggable) build, which other tools can inspect and change."; bump(Severity.MEDIUM) }
        if (!fromStore && sev == Severity.INFO) bump(Severity.LOW)
        return AppReport(f, sev, reasons, fromStore, bad)
    }

    fun storeName(f: AppFacts) = f.installer?.let { trustedStores[it] }

    /** Which sensitive groups an app currently holds. */
    fun sensitive(f: AppFacts) = Sensitive.entries.filter { g -> g.permissions.any { it in f.granted } }
}
