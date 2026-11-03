package os.nude.browser

import java.net.URI
import java.net.URLEncoder

/** Address-bar logic. Mirrors apps/desktop/src/shared/omnibox.ts so both platforms behave the same. */
object Omnibox {
    enum class Engine(val label: String, val template: String) {
        DUCKDUCKGO("DuckDuckGo", "https://duckduckgo.com/?q={q}"),
        GOOGLE("Google", "https://www.google.com/search?q={q}"),
        BING("Bing", "https://www.bing.com/search?q={q}"),
        BRAVE("Brave Search", "https://search.brave.com/search?q={q}"),
        ECOSIA("Ecosia", "https://www.ecosia.org/search?q={q}"),
        STARTPAGE("Startpage", "https://www.startpage.com/do/search?q={q}"),
        NUDE("Nude Search", "{base}/search?q={q}"),
    }

    sealed class Result {
        data class Navigate(val url: String) : Result()
        data class Search(val url: String, val query: String) : Result()
        data class Blocked(val reason: String) : Result()
    }

    private val TLDS = (
        "ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg er es et eu fi fj fk fm fo fr ga gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sk sl sm sn so sr ss st su sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw " +
        "com net org edu gov mil int info biz name pro mobi app dev page xyz online site tech store shop blog cloud link live news art design media agency studio digital email software solutions systems network services club life world today space website fun top icu vip love one wiki africa joburg capetown durban local localhost test internal lan home onion"
    ).split(" ").toSet()

    fun searchUrl(engine: Engine, query: String, nudeBase: String = "http://127.0.0.1:8787"): String =
        engine.template.replace("{base}", nudeBase.trimEnd('/')).replace("{q}", URLEncoder.encode(query.trim(), "UTF-8"))

    private fun isIPv4(h: String) = h.split(".").let { p -> p.size == 4 && p.all { it.matches(Regex("\\d{1,3}")) && it.toInt() <= 255 } }

    fun looksLikeHost(text: String): Boolean {
        if (text.any { it.isWhitespace() }) return false
        val m = Regex("^([^/:?#]+)(:\\d{1,5})?([/?#].*)?$").find(text) ?: return false
        val host = m.groupValues[1].lowercase()
        val hasPortOrPath = m.groupValues[2].isNotEmpty() || m.groupValues[3].isNotEmpty()
        if (host == "localhost" || isIPv4(host)) return true
        val labels = host.split(".")
        if (labels.size < 2 || labels.any { it.isEmpty() || it.length > 63 || it.startsWith("-") || it.endsWith("-") }) return false
        val tld = labels.last()
        if (tld in TLDS || tld.startsWith("xn--")) return true
        return hasPortOrPath && tld.matches(Regex("[a-z]{2,63}"))
    }

    private fun isLocal(text: String): Boolean {
        val host = text.split(':', '/', '?', '#').first().lowercase()
        return host == "localhost" || isIPv4(host) || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".test")
    }

    fun resolve(raw: String, engine: Engine, nudeBase: String = "http://127.0.0.1:8787"): Result? {
        val text = raw.trim()
        if (text.isEmpty()) return null
        if (text.startsWith("?")) {
            val q = text.drop(1).trim()
            return if (q.isEmpty()) null else Result.Search(searchUrl(engine, q, nudeBase), q)
        }
        val scheme = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*):").find(text)?.groupValues?.get(1)?.lowercase()
        if (scheme != null) {
            if (scheme in setOf("javascript", "data", "vbscript", "blob", "file", "content", "intent")) {
                return Result.Blocked("$scheme: addresses can't be opened from the address bar.")
            }
            if ((scheme == "http" || scheme == "https") && !text.contains(' ')) {
                return try {
                    val u = URI(text)
                    if (u.host.isNullOrEmpty()) Result.Search(searchUrl(engine, text, nudeBase), text) else Result.Navigate(text)
                } catch (e: Exception) {
                    Result.Search(searchUrl(engine, text, nudeBase), text)
                }
            }
        }
        if (looksLikeHost(text)) return Result.Navigate((if (isLocal(text)) "http://" else "https://") + text)
        return Result.Search(searchUrl(engine, text, nudeBase), text)
    }

    /** Short form for display: "example.com/path" for HTTPS, full URL otherwise. */
    fun display(url: String): String {
        if (url.isEmpty() || url == "about:blank") return ""
        return try {
            val u = URI(url)
            if (u.scheme == "https") {
                val path = if (u.rawPath.isNullOrEmpty() || u.rawPath == "/") "" else u.rawPath
                (u.host ?: "").removePrefix("www.") + path + (u.rawQuery?.let { "?$it" } ?: "")
            } else url
        } catch (e: Exception) { url }
    }

    fun host(url: String): String = try { URI(url).host?.removePrefix("www.") ?: url } catch (e: Exception) { url }
}
