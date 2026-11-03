package os.nude.browser

import java.net.URI

/**
 * Nude Security for Android: a Kotlin port of packages/security-engine (URL, download and tracker checks).
 * Runs entirely on the device.
 */
object Security {
    enum class Level { STANDARD, ENHANCED, MAXIMUM }
    enum class Action { ALLOW, WARN, BLOCK }

    data class Signal(val code: String, val severity: Int, val message: String)
    data class Verdict(
        val url: String, val host: String, val action: Action, val confirmed: Boolean,
        val category: String?, val score: Int, val signals: List<Signal>, val intendedSite: String? = null,
    )

    val categoryInfo = mapOf(
        "phishing" to Triple("Possible phishing site", "This site may try to trick you into entering passwords, banking details or personal information.", "Don't enter any information. If you need the real service, type its address yourself."),
        "malware" to Triple("Dangerous site", "This site is known to distribute harmful software.", "Go back. Don't download anything from this site."),
        "scam" to Triple("Known scam site", "This site has been reported for scams such as fake shops or fake prizes.", "Go back. Don't pay or share personal details here."),
        "typosquatting" to Triple("Look-alike website", "This address imitates a well-known site but belongs to someone else.", "Check the address carefully. Use the link to the real site instead."),
        "suspicious" to Triple("Suspicious site", "Several warning signs suggest this site may not be what it claims.", "Only continue if you know and trust this site."),
    )

    private val brands = listOf(
        "paypal" to listOf("paypal.com"), "google" to listOf("google.com", "gmail.com", "youtube.com"),
        "microsoft" to listOf("microsoft.com", "live.com", "outlook.com", "office.com"), "apple" to listOf("apple.com", "icloud.com"),
        "amazon" to listOf("amazon.com", "amazon.co.za"), "facebook" to listOf("facebook.com", "fb.com"), "instagram" to listOf("instagram.com"),
        "whatsapp" to listOf("whatsapp.com"), "netflix" to listOf("netflix.com"), "linkedin" to listOf("linkedin.com"),
        "coinbase" to listOf("coinbase.com"), "binance" to listOf("binance.com"), "metamask" to listOf("metamask.io"),
        "fnb" to listOf("fnb.co.za"), "absa" to listOf("absa.co.za"), "capitec" to listOf("capitecbank.co.za"), "capitecbank" to listOf("capitecbank.co.za"),
        "standardbank" to listOf("standardbank.co.za"), "nedbank" to listOf("nedbank.co.za"), "sars" to listOf("sars.gov.za"),
        "takealot" to listOf("takealot.com"), "vodacom" to listOf("vodacom.co.za"), "dhl" to listOf("dhl.com"),
    )
    private val multiSuffixes = setOf("co.za", "org.za", "gov.za", "ac.za", "net.za", "co.uk", "org.uk", "ac.uk", "gov.uk",
        "com.au", "net.au", "org.au", "co.nz", "co.jp", "co.in", "com.br", "com.mx", "com.ng", "co.ke", "github.io", "vercel.app",
        "netlify.app", "pages.dev", "web.app", "firebaseapp.com", "blogspot.com", "herokuapp.com")
    private val keywords = listOf("login", "signin", "verify", "secure", "account", "update", "confirm", "banking", "wallet",
        "unlock", "suspended", "password", "billing", "support", "auth", "seed", "airdrop", "claim")
    private val riskyTlds = setOf("zip", "mov", "top", "xyz", "click", "country", "gq", "tk", "ml", "ga", "cf", "work", "support", "rest", "fit", "loan", "cam", "icu", "buzz")

    val trackers: Map<String, String> = mapOf(
        "doubleclick.net" to "advertising", "googlesyndication.com" to "advertising", "googleadservices.com" to "advertising",
        "adnxs.com" to "advertising", "criteo.com" to "advertising", "criteo.net" to "advertising", "taboola.com" to "advertising",
        "outbrain.com" to "advertising", "rubiconproject.com" to "advertising", "pubmatic.com" to "advertising", "openx.net" to "advertising",
        "adsrvr.org" to "advertising", "amazon-adsystem.com" to "advertising", "moatads.com" to "advertising", "media.net" to "advertising",
        "google-analytics.com" to "analytics", "googletagmanager.com" to "analytics", "hotjar.com" to "analytics", "mixpanel.com" to "analytics",
        "segment.io" to "analytics", "amplitude.com" to "analytics", "clarity.ms" to "analytics", "scorecardresearch.com" to "analytics",
        "connect.facebook.net" to "social", "ads-twitter.com" to "social", "analytics.tiktok.com" to "social", "ads.linkedin.com" to "social",
        "fingerprintjs.com" to "fingerprinting", "coinhive.com" to "cryptomining",
    )

    /** User-maintained and downloaded lists. */
    val knownBad = mutableMapOf<String, String>()
    val trusted = mutableSetOf<String>()

    fun registrableDomain(host: String): String {
        val labels = host.lowercase().trimEnd('.').split(".")
        if (labels.size <= 2) return labels.joinToString(".")
        for (n in minOf(3, labels.size - 1) downTo 2) {
            if (labels.takeLast(n).joinToString(".") in multiSuffixes) return labels.takeLast(n + 1).joinToString(".")
        }
        return labels.takeLast(2).joinToString(".")
    }

    fun skeleton(s: String) = s.lowercase().replace("rn", "m").replace("vv", "w").replace("0", "o").replace("1", "l")
        .replace("3", "e").replace("4", "a").replace("5", "s").replace("7", "t").replace("-", "")

    fun levenshtein(a: String, b: String): Int {
        var prev = IntArray(b.length + 1) { it }
        for (i in 1..a.length) {
            val cur = IntArray(b.length + 1)
            cur[0] = i
            for (j in 1..b.length) cur[j] = minOf(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + if (a[i - 1] == b[j - 1]) 0 else 1)
            prev = cur
        }
        return prev[b.length]
    }

    data class Typo(val brand: String, val official: String, val reason: String, val combo: Boolean)

    fun detectTyposquat(host: String): Typo? {
        val reg = registrableDomain(host)
        val label = reg.substringBefore('.')
        if (label.length < 3) return null
        if (brands.any { (_, d) -> d.any { reg == it || reg.endsWith(".$it") } }) return null
        if (brands.any { it.first == label }) return null
        val parts = label.split('-').filter { it.isNotEmpty() }
        val candidates = if (parts.size > 1) listOf(label.replace("-", "")) + parts else listOf(label)
        for ((brand, domains) in brands) {
            val official = domains.first()
            for (part in candidates) {
                if (part == brand) {
                    if (parts.size > 1) return Typo(brand, official, "combines \"$brand\" with other words on a domain $brand doesn't own", true)
                    continue
                }
                if (part.length >= 4 && skeleton(part) == skeleton(brand)) return Typo(brand, official, "uses look-alike characters to imitate $official", false)
                if (brand.length >= 6 && part.length >= 5) {
                    val d = levenshtein(part, brand)
                    if (d == 1 || (d == 2 && brand.length >= 9)) return Typo(brand, official, "is spelled almost like $official", false)
                }
            }
        }
        return null
    }

    private fun thresholds(level: Level) = when (level) {
        Level.STANDARD -> 60 to 90
        Level.ENHANCED -> 40 to 70
        Level.MAXIMUM -> 30 to 55
    }

    private fun isPrivateIp(h: String) = Regex("^(10\\.|127\\.|192\\.168\\.|169\\.254\\.|172\\.(1[6-9]|2\\d|3[01])\\.)").containsMatchIn(h) || h == "localhost"

    fun analyze(url: String, level: Level): Verdict {
        val u = try { URI(url) } catch (e: Exception) { null }
        val host = u?.host?.lowercase() ?: return Verdict(url, "", Action.ALLOW, false, null, 0, emptyList())
        if (u.scheme != "http" && u.scheme != "https") return Verdict(url, host, Action.ALLOW, false, null, 0, emptyList())
        val reg = registrableDomain(host)
        (knownBad[host] ?: knownBad[reg])?.let {
            return Verdict(url, host, Action.BLOCK, true, it, 100, listOf(Signal("threat-list", 100, "This site is on Nude Security's list of known $it sites.")))
        }
        if (reg in trusted || host in trusted) return Verdict(url, host, Action.ALLOW, false, null, 0, emptyList())

        val signals = mutableListOf<Signal>()
        var category: String? = null
        val typo = detectTyposquat(host)
        if (typo != null) {
            signals += Signal("typosquatting", if (typo.combo) 35 else 65, "The address ${typo.reason}.")
            category = "typosquatting"
        }
        val sub = host.removeSuffix(reg).trimEnd('.')
        if (sub.isNotEmpty()) {
            for ((brand, domains) in brands) {
                if (brand.length < 4 || domains.any { reg == it }) continue
                if (sub.split('.', '-').contains(brand) || domains.any { sub.contains(it) }) {
                    signals += Signal("brand-in-subdomain", 50, "The address puts \"$brand\" in front of a different website ($reg) to look official.")
                    if (category == null) category = "phishing"
                    break
                }
            }
        }
        if (url.substringAfter("://").substringBefore('/').contains('@')) {
            signals += Signal("credentials-in-url", 45, "The address hides its real destination behind an \"@\" sign.")
            if (category == null) category = "phishing"
        }
        if (host.matches(Regex("\\d+\\.\\d+\\.\\d+\\.\\d+")) && !isPrivateIp(host)) signals += Signal("ip-host", 25, "The site uses a raw IP address instead of a name.")
        if (host.contains("xn--")) signals += Signal("punycode", 25, "The address uses international characters that can imitate other sites.")
        val tld = reg.substringAfterLast('.')
        if (tld in riskyTlds) signals += Signal("risky-tld", 12, "\".$tld\" addresses are often used by scam sites.")
        val path = (host + (u.rawPath ?: "")).lowercase()
        val hits = keywords.filter { path.contains(it) }
        if (hits.isNotEmpty() && (typo != null || signals.any { it.code in setOf("brand-in-subdomain", "risky-tld", "ip-host") })) {
            signals += Signal("phishing-keywords", 15 + minOf(15, hits.size * 5), "The address contains words like \"${hits.take(3).joinToString("\", \"")}\" that scam sites use to look official.")
        }
        if (host.split('.').size - reg.split('.').size >= 4) signals += Signal("deep-subdomains", 12, "The address has an unusually long chain of sub-domains.")
        if (u.scheme == "http" && !isPrivateIp(host)) signals += Signal("not-https", if (level == Level.MAXIMUM) 20 else 3, "The connection is not encrypted.")

        val score = minOf(99, signals.sumOf { it.severity })
        val (warn, block) = thresholds(level)
        val action = if (score >= block) Action.BLOCK else if (score >= warn) Action.WARN else Action.ALLOW
        if (action != Action.ALLOW && category == null) category = "suspicious"
        return Verdict(url, host, action, false, if (action == Action.ALLOW) null else category, score, signals,
            typo?.let { "https://${it.official}/" })
    }

    fun trackerCategory(host: String): String? {
        val labels = host.lowercase().split(".")
        for (i in 0 until labels.size - 1) trackers[labels.drop(i).joinToString(".")]?.let { return it }
        return null
    }

    fun shouldBlockTracker(requestHost: String, pageHost: String?, level: Level): Boolean {
        val cat = trackerCategory(requestHost) ?: return false
        if (pageHost != null && registrableDomain(pageHost) == registrableDomain(requestHost)) return false
        return when (level) {
            Level.STANDARD -> cat in setOf("advertising", "fingerprinting", "cryptomining")
            Level.ENHANCED -> cat != "social"
            Level.MAXIMUM -> true
        }
    }

    private val executable = setOf("exe", "msi", "bat", "cmd", "com", "scr", "pif", "ps1", "vbs", "js", "jar", "apk", "xapk", "apks", "dmg", "pkg", "sh", "run", "bin", "dll", "iso", "img", "hta", "lnk", "reg", "msix", "appx")
    private val decoys = setOf("pdf", "doc", "docx", "jpg", "jpeg", "png", "txt", "xls", "xlsx", "mp4", "mp3", "zip")

    data class DownloadVerdict(val action: Action, val risk: String, val notes: List<String>)

    fun analyzeDownload(filename: String, mime: String?, url: String, sourceVerdict: Verdict?, level: Level): DownloadVerdict {
        val notes = mutableListOf<Pair<Int, String>>()
        val parts = filename.lowercase().split('.')
        val ext = if (parts.size > 1) parts.last() else ""
        if (Regex("[‪-‮⁦-⁩]").containsMatchIn(filename)) notes += 80 to "The file name uses hidden characters to disguise its real type."
        if (ext in executable) {
            notes += 35 to (if (ext == "apk" || ext == "xapk" || ext == "apks") "This is an Android app. Apps from outside the Play Store can access your data." else "This is a program (.$ext) that can make changes to a device when opened.")
            if (parts.size >= 3 && parts[parts.size - 2] in decoys) notes += 50 to "The name \"$filename\" pretends to be a .${parts[parts.size - 2]} file but is actually a program."
        }
        if (url.startsWith("http:")) notes += (if (ext in executable) 25 else 8) to "The file was sent over an unencrypted connection and could have been altered."
        if (sourceVerdict != null && sourceVerdict.action != Action.ALLOW) notes += (if (sourceVerdict.confirmed) 100 else 30) to "The site offering this file has been flagged by Nude Security."
        val score = minOf(100, notes.sumOf { it.first })
        val risk = when { score >= 80 -> "dangerous"; score >= 50 -> "high"; score >= 25 -> "medium"; else -> "low" }
        val blockAt = when (level) { Level.MAXIMUM -> 50; Level.ENHANCED -> 75; Level.STANDARD -> 85 }
        val warnAt = if (level == Level.STANDARD) 50 else 30
        val action = if (score >= blockAt) Action.BLOCK else if (score >= warnAt) Action.WARN else Action.ALLOW
        return DownloadVerdict(action, risk, notes.map { it.second })
    }

    data class MessageVerdict(val assessment: String, val indicators: List<String>, val summary: String)

    private val messageRules = listOf(
        15 to Regex("\\b(urgent|immediately|within (24|48) hours|final (notice|warning)|act now|expires? (today|soon))\\b", RegexOption.IGNORE_CASE) to "Creates urgency to pressure you into acting before thinking.",
        20 to Regex("account (will be|has been) (deleted|closed|suspended|locked|disabled)|legal action|arrest", RegexOption.IGNORE_CASE) to "Threatens a consequence (account deletion, suspension, legal action).",
        25 to Regex("verify your (account|identity|details)|confirm your (password|details)|update your (payment|billing|banking)", RegexOption.IGNORE_CASE) to "Asks you to verify, log in or update details via the message.",
        30 to Regex("\\b(otp|one[- ]time (pin|password|code)|verification code|cvv|card number)\\b", RegexOption.IGNORE_CASE) to "Mentions one-time PINs or card numbers — legitimate services never ask for these by message.",
        20 to Regex("gift ?cards?|crypto|bitcoin|usdt|wire transfer|western union|e-?wallet", RegexOption.IGNORE_CASE) to "Requests unusual payment methods.",
        20 to Regex("you('ve| have)? won|winner|lottery|prize|inheritance", RegexOption.IGNORE_CASE) to "Promises a prize or windfall.",
        10 to Regex("(parcel|package|delivery).{0,20}(on hold|held|pending)|customs fee", RegexOption.IGNORE_CASE) to "Claims a parcel is held and needs a fee.",
        8 to Regex("^\\s*dear (customer|user|client|member|valued customer)", setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE)) to "Uses a generic greeting instead of your name.",
        25 to Regex("anydesk|teamviewer|remote access", RegexOption.IGNORE_CASE) to "Asks you to install remote-access software.",
    )

    fun analyzeMessage(text: String): MessageVerdict {
        val found = mutableListOf<Pair<Int, String>>()
        for ((rule, msg) in messageRules) if (rule.second.containsMatchIn(text)) found += rule.first to msg
        Regex("https?://[^\\s<>\"')]+").findAll(text).take(20).forEach { m ->
            val v = analyze(m.value.trimEnd('.', ',', ';', ':', '!', '?'), Level.ENHANCED)
            if (v.action != Action.ALLOW) found += (if (v.confirmed) 60 else 30) to "Contains a link to ${v.host}, which Nude Security flags: ${v.signals.firstOrNull()?.message ?: "suspicious address"}"
        }
        val score = minOf(100, found.sumOf { it.first })
        val assessment = when { score >= 50 -> "Likely a scam"; score >= 25 -> "Suspicious"; else -> "No strong scam signs found" }
        val summary = when {
            score >= 50 -> "Don't click its links, reply, or share any details. Contact the company using its official website or app instead."
            score >= 25 -> "Verify it through the company's official website or phone number before acting on it."
            else -> "That doesn't prove the message is genuine. If it asks for money or details, verify it independently."
        }
        return MessageVerdict(assessment, found.map { it.second }, summary)
    }
}
