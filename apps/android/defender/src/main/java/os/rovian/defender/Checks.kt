package os.rovian.defender

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.provider.Settings
import os.rovian.core.Security

/** One finding from App check: an app worth a look, and why. Never a verdict that an app is malware. */
data class AppFinding(val packageName: String, val label: String, val source: String, val reasons: List<String>, val severity: Int)

object AppAudit {
    /** Permissions that let an app read codes, watch the screen or take over the phone. */
    private val sensitive = mapOf(
        "android.permission.READ_SMS" to "can read your text messages (including one-time PINs)",
        "android.permission.RECEIVE_SMS" to "can read incoming text messages",
        "android.permission.SEND_SMS" to "can send text messages",
        "android.permission.READ_CALL_LOG" to "can read your call history",
        "android.permission.SYSTEM_ALERT_WINDOW" to "can draw over other apps (used to fake login screens)",
        "android.permission.REQUEST_INSTALL_PACKAGES" to "can install other apps",
        "android.permission.BIND_ACCESSIBILITY_SERVICE" to "can act as an accessibility service",
        "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE" to "can read your notifications",
        "android.permission.READ_CONTACTS" to "can read your contacts",
    )
    private val trustedStores = setOf("com.android.vending", "com.google.android.packageinstaller.store", "com.sec.android.app.samsungapps", "com.huawei.appmarket", "com.amazon.venezia")

    private fun installer(pm: PackageManager, pkg: String): String? = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) pm.getInstallSourceInfo(pkg).installingPackageName
        else @Suppress("DEPRECATION") pm.getInstallerPackageName(pkg)
    } catch (e: Exception) { null }

    /** Scans user-installed apps. Runs on a background thread. */
    fun scan(ctx: Context): List<AppFinding> {
        val pm = ctx.packageManager
        val accessibility = (Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: "")
            .split(':').mapNotNull { it.substringBefore('/').takeIf { p -> p.isNotBlank() } }.toSet()
        val listeners = (Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: "")
            .split(':').mapNotNull { it.substringBefore('/').takeIf { p -> p.isNotBlank() } }.toSet()
        val admins = (ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager).activeAdmins.orEmpty().map { it.packageName }.toSet()
        @Suppress("DEPRECATION")
        val packages: List<PackageInfo> = if (Build.VERSION.SDK_INT >= 33) pm.getInstalledPackages(PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong()))
            else pm.getInstalledPackages(PackageManager.GET_PERMISSIONS)
        return packages.asSequence()
            .filter { ((it.applicationInfo?.flags ?: 0) and ApplicationInfo.FLAG_SYSTEM) == 0 && it.packageName != ctx.packageName }
            .mapNotNull { p ->
                val inst = installer(pm, p.packageName)
                val fromStore = inst != null && inst in trustedStores
                val reasons = mutableListOf<String>()
                var sev = 0
                val granted = p.requestedPermissions.orEmpty().filterIndexed { i, _ -> ((p.requestedPermissionsFlags?.getOrNull(i) ?: 0) and PackageInfo.REQUESTED_PERMISSION_GRANTED) != 0 }
                granted.mapNotNull { sensitive[it] }.forEach { reasons += "It $it."; sev += if (fromStore) 5 else 15 }
                if (p.packageName in accessibility) { reasons += "It's switched on as an accessibility service, so it can see and tap what's on screen."; sev += if (fromStore) 15 else 40 }
                if (p.packageName in listeners) { reasons += "It can read every notification (including sign-in codes)."; sev += if (fromStore) 8 else 25 }
                if (p.packageName in admins) { reasons += "It's a device administrator, which makes it harder to remove."; sev += if (fromStore) 10 else 35 }
                if (!fromStore) { reasons.add(0, "Installed from outside an app store${inst?.let { " (by $it)" } ?: ""}."); sev += 10 }
                // Only report apps where something is actually worth checking.
                if (sev < 30 || reasons.size < 2 && fromStore) null
                else AppFinding(p.packageName, p.applicationInfo?.loadLabel(pm)?.toString() ?: p.packageName,
                    if (fromStore) "From ${storeName(inst)}" else "Not from an app store", reasons, minOf(100, sev))
            }
            .sortedByDescending { it.severity }
            .toList()
    }

    private fun storeName(pkg: String?) = when (pkg) {
        "com.android.vending" -> "Google Play"; "com.sec.android.app.samsungapps" -> "Galaxy Store"; "com.huawei.appmarket" -> "AppGallery"
        "com.amazon.venezia" -> "Amazon Appstore"; else -> "an app store"
    }
}

/** A file the user picked or shared: its name, type and what its first bytes really are. */
data class FileReport(val name: String, val size: Long?, val verdict: Security.DownloadVerdict, val realType: String?, val notes: List<String>)

object FileCheck {
    /** File signatures. Rovian Defender looks at what a file is, not just what it's called. */
    fun sniff(head: ByteArray): String? {
        fun starts(vararg b: Int) = head.size >= b.size && b.indices.all { head[it] == b[it].toByte() }
        return when {
            starts(0x4D, 0x5A) -> "Windows program"
            starts(0x7F, 0x45, 0x4C, 0x46) -> "Linux program"
            starts(0x50, 0x4B, 0x03, 0x04) -> if (String(head, Charsets.ISO_8859_1).contains("AndroidManifest.xml") || String(head, Charsets.ISO_8859_1).contains("classes.dex")) "Android app (APK)" else "ZIP archive"
            starts(0x64, 0x65, 0x78, 0x0A) -> "Android program code (DEX)"
            starts(0x25, 0x50, 0x44, 0x46) -> "PDF document"
            starts(0x89, 0x50, 0x4E, 0x47) -> "PNG image"
            starts(0xFF, 0xD8, 0xFF) -> "JPEG image"
            starts(0x52, 0x61, 0x72, 0x21) -> "RAR archive"
            starts(0x37, 0x7A, 0xBC, 0xAF) -> "7-Zip archive"
            starts(0xD0, 0xCF, 0x11, 0xE0) -> "Older Office document (can contain macros)"
            starts(0x23, 0x21) -> "Script"
            else -> null
        }
    }

    private val looksLikeDoc = setOf("pdf", "doc", "docx", "xls", "xlsx", "jpg", "jpeg", "png", "txt", "mp3", "mp4")

    fun inspect(ctx: Context, uri: Uri, level: Security.Level): FileReport {
        var name = uri.lastPathSegment ?: "file"
        var size: Long? = null
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                c.getString(0)?.let { name = it }
                if (!c.isNull(1)) size = c.getLong(1)
            }
        }
        val head = ctx.contentResolver.openInputStream(uri)?.use { s -> ByteArray(4096).let { b -> val n = s.read(b); if (n > 0) b.copyOf(n) else ByteArray(0) } } ?: ByteArray(0)
        val mime = ctx.contentResolver.getType(uri)
        val v = Security.analyzeDownload(name, mime, "content://local", null, level)
        val real = sniff(head)
        val notes = v.notes.toMutableList()
        val ext = name.substringAfterLast('.', "").lowercase()
        var verdict = v
        if (real != null && (real.contains("program") || real.contains("APK") || real == "Script") && ext in looksLikeDoc) {
            notes += "It's named like a .$ext file, but it's really a $real. That's a common trick."
            verdict = Security.DownloadVerdict(Security.Action.BLOCK, "dangerous", notes)
        } else if (real == "Older Office document (can contain macros)") {
            notes += "Old-style Office files can run macros. Don't turn on macros or \"enable editing\" unless you trust the sender."
            verdict = v.copy(notes = notes, risk = if (v.risk == "low") "medium" else v.risk, action = if (v.action == Security.Action.ALLOW) Security.Action.WARN else v.action)
        } else verdict = v.copy(notes = notes)
        return FileReport(name, size, verdict, real, verdict.notes)
    }
}
