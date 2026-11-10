package os.rovian.defender.web

import os.rovian.core.Security
import os.rovian.defender.core.Assessment
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

data class Indicator(val text: String, val bad: Boolean)

data class LinkReport(
    val input: String,
    val url: String,
    val host: String,
    val assessment: Assessment,
    val headline: String,
    val indicators: List<Indicator>,
    val advice: String,
    val redirects: List<String> = emptyList(),
    val checkedOnline: Boolean = false,
)

/**
 * The link scanner: paste or share a link. Rovian Defender checks the address itself (look-alike domains, brand
 * names on other sites, hidden destinations, risky endings), its threat lists, and optionally where the link really
 * leads (following redirects without opening the page). It never says a site is safe: at best, "safe indicators found".
 */
object LinkScanner {
    private val urlInText = Regex("""https?://[^\s<>"')]+|(?<![@\w])(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:/[^\s<>"')]*)?""", RegexOption.IGNORE_CASE)

    /** Pulls the first link out of shared text (a message often has words around it). */
    fun extract(text: String): String? = urlInText.find(text.trim())?.value?.trimEnd('.', ',', ';', ':', '!', '?')?.let { if (it.startsWith("http", true)) it else "https://$it" }

    fun scan(input: String, level: Security.Level = Security.Level.ENHANCED, redirects: List<String> = emptyList(), checkedOnline: Boolean = false): LinkReport? {
        val url = extract(input) ?: return null
        val chain = listOf(url) + redirects
        val verdicts = chain.map { Security.analyze(it, level) }
        val worst = verdicts.maxByOrNull { (if (it.confirmed) 1000 else 0) + it.score } ?: return null
        val first = verdicts.first()
        val indicators = mutableListOf<Indicator>()
        verdicts.forEachIndexed { i, v ->
            v.signals.forEach { s -> indicators += Indicator(if (i == 0) s.message else "After a redirect to ${v.host}: ${s.message}", true) }
        }
        val crossSite = redirects.map { runCatching { URI(it).host?.lowercase() }.getOrNull() }.filterNotNull()
            .filter { Security.registrableDomain(it) != Security.registrableDomain(first.host) }.distinct()
        if (crossSite.isNotEmpty()) indicators += Indicator("The link sends you on to a different site: ${crossSite.joinToString(", ")}.", crossSite.any { h -> verdicts.any { it.host == h && it.action != Security.Action.ALLOW } })
        val good = mutableListOf<Indicator>()
        if (url.startsWith("https://", true)) good += Indicator("The connection is encrypted (HTTPS).", false)
        if (first.signals.none { it.code == "typosquatting" || it.code == "brand-in-subdomain" }) good += Indicator("The address doesn't imitate a well-known brand Rovian Defender knows.", false)
        if (!first.confirmed) good += Indicator(if (Security.knownBad.isEmpty()) "Not on Rovian Defender's built-in checks. Download threat lists in Settings for wider coverage." else "Not on Rovian Defender's threat lists (${Security.knownBad.size} known sites).", false)

        val assessment = when {
            worst.confirmed || worst.action == Security.Action.BLOCK -> Assessment.DANGEROUS
            worst.action == Security.Action.WARN || indicators.any { it.bad } && worst.score >= 20 -> Assessment.SUSPICIOUS
            indicators.none { it.bad } && url.startsWith("https://", true) -> Assessment.SAFE_INDICATORS
            else -> Assessment.UNKNOWN
        }
        val info = worst.category?.let { Security.categoryInfo[it] }
        val headline = when (assessment) {
            Assessment.DANGEROUS -> info?.first ?: "Dangerous link"
            Assessment.SUSPICIOUS -> info?.first ?: "Suspicious link"
            Assessment.SAFE_INDICATORS -> "Safe indicators found"
            Assessment.UNKNOWN -> "Not enough to judge"
        }
        val advice = when (assessment) {
            Assessment.DANGEROUS -> info?.third ?: "Don't open it."
            Assessment.SUSPICIOUS -> info?.third ?: "Only open it if you trust who sent it, and never enter passwords or card details."
            Assessment.SAFE_INDICATORS -> "No warning signs found. That isn't a guarantee: still don't enter passwords on a page you reached from a message."
            Assessment.UNKNOWN -> "Rovian Defender found no clear warning signs, but couldn't confirm anything good either. Be careful."
        }
        val note = worst.intendedSite?.let { listOf(Indicator("You may have meant $it", false)) } ?: emptyList()
        return LinkReport(input, url, first.host, assessment, headline, indicators.filter { it.bad } + note + good, advice, redirects, checkedOnline)
    }

    /**
     * Follows up to 6 redirects with HEAD requests, without loading the page or running anything on it. Blocking:
     * call off the main thread. Only when you ask for it: it does contact the link's server.
     */
    fun followRedirects(url: String): List<String> {
        val out = mutableListOf<String>()
        var current = url
        repeat(6) {
            val c = (URL(current).openConnection() as? HttpURLConnection) ?: return out
            c.instanceFollowRedirects = false
            c.requestMethod = "HEAD"
            c.connectTimeout = 5000; c.readTimeout = 5000
            c.setRequestProperty("User-Agent", "RovianDefender/0.2 (link check)")
            val code = try { c.responseCode } catch (e: Exception) { c.disconnect(); return out }
            val loc = c.getHeaderField("Location")
            c.disconnect()
            if (code !in 300..399 || loc.isNullOrBlank()) return out
            val next = runCatching { URL(URL(current), loc).toString() }.getOrNull() ?: return out
            if (!next.startsWith("http")) return out
            out += next
            current = next
        }
        return out
    }
}
