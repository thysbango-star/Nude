package os.rovian.defender.files

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import os.rovian.core.Security
import os.rovian.defender.core.Assessment
import java.security.MessageDigest

data class FileReport(
    val name: String, val size: Long?, val mime: String?, val realType: String?, val sha256: String?,
    val assessment: Assessment, val findings: List<String>, val advice: String,
)

/**
 * Scans a file you pick or share: what it really is (from its first bytes, not its name), its SHA-256 checked
 * against Rovian threat intelligence, and the same download rules Nude uses. It can only see files you give it.
 */
object FileScanner {
    /** SHA-256 → category, from Rovian threat intelligence. */
    val knownBadHashes = mutableMapOf<String, String>()

    fun sniff(head: ByteArray): String? {
        fun starts(vararg b: Int) = head.size >= b.size && b.indices.all { head[it] == b[it].toByte() }
        val text = String(head, Charsets.ISO_8859_1)
        return when {
            starts(0x4D, 0x5A) -> "Windows program"
            starts(0x7F, 0x45, 0x4C, 0x46) -> "Linux program"
            starts(0x50, 0x4B, 0x03, 0x04) -> when {
                text.contains("AndroidManifest.xml") || text.contains("classes.dex") -> "Android app (APK)"
                text.contains("vbaProject.bin") -> "Office document with macros"
                text.contains("word/") || text.contains("xl/") || text.contains("ppt/") -> "Office document"
                else -> "ZIP archive"
            }
            starts(0x64, 0x65, 0x78, 0x0A) -> "Android program code (DEX)"
            starts(0x25, 0x50, 0x44, 0x46) -> if (text.contains("/JavaScript") || text.contains("/JS") || text.contains("/Launch")) "PDF with scripts" else "PDF document"
            starts(0x89, 0x50, 0x4E, 0x47) -> "PNG image"
            starts(0xFF, 0xD8, 0xFF) -> "JPEG image"
            starts(0x47, 0x49, 0x46, 0x38) -> "GIF image"
            starts(0x52, 0x61, 0x72, 0x21) -> "RAR archive"
            starts(0x37, 0x7A, 0xBC, 0xAF) -> "7-Zip archive"
            starts(0xD0, 0xCF, 0x11, 0xE0) -> "Older Office document (can contain macros)"
            starts(0x23, 0x21) -> "Script"
            starts(0xCA, 0xFE, 0xBA, 0xBE) -> "Java or macOS program"
            text.trimStart().startsWith("<script", ignoreCase = true) || text.contains("<script", ignoreCase = true) && text.trimStart().startsWith("<") -> "Web page with scripts"
            else -> null
        }
    }

    private val looksLikeDocument = setOf("pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "jpg", "jpeg", "png", "gif", "txt", "mp3", "mp4", "mov", "csv")
    private val executable = setOf("Windows program", "Linux program", "Android app (APK)", "Android program code (DEX)", "Script", "Java or macOS program")

    /** The rules, pure for testing. */
    fun assess(name: String, mime: String?, head: ByteArray, sha256: String?): FileReport {
        val real = sniff(head)
        val ext = name.substringAfterLast('.', "").lowercase()
        val findings = mutableListOf<String>()
        var a = Assessment.UNKNOWN
        fun raise(x: Assessment) { if (x.severity.rank > a.severity.rank || a == Assessment.UNKNOWN && x == Assessment.SAFE_INDICATORS) a = x }

        sha256?.let { h -> knownBadHashes[h]?.let { findings += "Rovian threat intelligence lists this exact file as $it."; raise(Assessment.DANGEROUS) } }
        if (real in executable && ext in looksLikeDocument) { findings += "It's named like a .$ext file, but it's really a $real. That's a common trick to get you to run it."; raise(Assessment.DANGEROUS) }
        val dl = Security.analyzeDownload(name, mime, "content://local", null, Security.Level.ENHANCED)
        dl.notes.forEach { if (it !in findings) findings += it }
        when (dl.action) { Security.Action.BLOCK -> raise(Assessment.DANGEROUS); Security.Action.WARN -> raise(Assessment.SUSPICIOUS); else -> {} }
        when (real) {
            "Office document with macros", "Older Office document (can contain macros)" -> { findings += "It can contain macros. Don't enable editing or macros unless you trust who sent it."; raise(Assessment.SUSPICIOUS) }
            "PDF with scripts" -> { findings += "The PDF contains scripts or launch actions, which ordinary documents rarely need."; raise(Assessment.SUSPICIOUS) }
            "Android app (APK)" -> if (a != Assessment.DANGEROUS) { findings += "It's an Android app. Only install apps from a source you trust."; raise(Assessment.SUSPICIOUS) }
            "Windows program", "Linux program", "Script" -> if (a != Assessment.DANGEROUS) { findings += "It's a program that runs code. Only open it if you trust where it came from."; raise(Assessment.SUSPICIOUS) }
        }
        if (findings.isEmpty() && real != null) { findings += "Its contents match its type ($real), and it isn't on any threat list Rovian Defender has."; raise(Assessment.SAFE_INDICATORS) }
        if (findings.isEmpty()) findings += "Rovian Defender couldn't tell what kind of file this is, and it isn't on any threat list it has."
        val advice = when (a) {
            Assessment.DANGEROUS -> "Delete it and don't open it."
            Assessment.SUSPICIOUS -> "Only open it if you trust who sent it."
            Assessment.SAFE_INDICATORS -> "No warning signs found. That doesn't guarantee it's harmless, so stay careful with files from people you don't know."
            Assessment.UNKNOWN -> "No warning signs found, but Rovian Defender couldn't check it fully."
        }
        return FileReport(name, null, mime, real, sha256, a, findings, advice)
    }

    /** Reads the file you chose (first 8 KB to identify it, the whole file for its SHA-256, up to 512 MB). */
    fun scan(ctx: Context, uri: Uri): FileReport {
        var name = uri.lastPathSegment ?: "file"
        var size: Long? = null
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) { c.getString(0)?.let { name = it }; if (!c.isNull(1)) size = c.getLong(1) }
        }
        val mime = ctx.contentResolver.getType(uri)
        val md = MessageDigest.getInstance("SHA-256")
        var head = ByteArray(0)
        var total = 0L
        var hashed = true
        ctx.contentResolver.openInputStream(uri)?.use { s ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = s.read(buf)
                if (n < 0) break
                if (head.size < 8192) head += buf.copyOf(minOf(n, 8192 - head.size))
                md.update(buf, 0, n)
                total += n
                if (total > 512L * 1024 * 1024) { hashed = false; break }
            }
        }
        val sha = if (hashed) md.digest().joinToString("") { "%02x".format(it) } else null
        return assess(name, mime, head, sha).copy(size = size ?: total)
    }
}
