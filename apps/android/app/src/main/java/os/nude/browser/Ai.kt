package os.nude.browser

import android.webkit.WebView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.resume

data class ChatMessage(val role: String, val text: String, val sources: List<String> = emptyList(), val note: String? = null, val error: Boolean = false)

/**
 * Nebula (AI) client. Page text is sent only when the user turns on "Share this page".
 * API keys live in the Nebula gateway, never in the app.
 */
object NudeAi {
    suspend fun pageText(webView: WebView): Pair<String, String> = suspendCancellableCoroutine { cont ->
        webView.evaluateJavascript("(function(){return JSON.stringify({t:document.title,b:(document.body&&document.body.innerText||'').slice(0,60000)})})()") { raw ->
            val parsed = runCatching { JSONObject(JSONObject("{\"v\":$raw}").getString("v")) }.getOrNull()
            cont.resume((parsed?.optString("t") ?: "") to (parsed?.optString("b") ?: ""))
        }
    }

    /** Streams an answer. Calls [onDelta] on the IO thread; caller must hop to the UI thread. */
    suspend fun ask(
        gateway: String, token: String, history: List<ChatMessage>, sources: List<JSONObject>,
        mode: String = "everyday", speed: String = "auto", onDelta: (String) -> Unit,
    ): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val conn = URL("${gateway.trimEnd('/')}/v1/chat").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = 8000
            conn.readTimeout = 120000
            conn.doOutput = true
            conn.setRequestProperty("content-type", "application/json")
            conn.setRequestProperty("accept", "text/event-stream")
            if (token.isNotBlank()) conn.setRequestProperty("authorization", "Bearer $token")
            val messages = JSONArray()
            history.filter { !it.error }.takeLast(20).forEach { messages.put(JSONObject().put("role", it.role).put("content", it.text)) }
            val src = JSONArray()
            sources.forEach { src.put(it) }
            conn.outputStream.use { it.write(JSONObject().put("messages", messages).put("sources", src).put("stream", true).put("mode", mode)
                .apply { if (speed != "auto") put("speed", speed) }.toString().toByteArray()) }
            if (conn.responseCode !in 200..299) error("gateway answered HTTP ${conn.responseCode}")
            conn.inputStream.bufferedReader().useLines { lines ->
                for (line in lines) {
                    if (!line.startsWith("data:")) continue
                    val obj = runCatching { JSONObject(line.removePrefix("data:").trim()) }.getOrNull() ?: continue
                    obj.optString("delta").takeIf { it.isNotEmpty() }?.let(onDelta)
                    obj.optString("error").takeIf { it.isNotEmpty() }?.let { error(it) }
                }
            }
        }
    }

    /** On-device answers for safety questions when the gateway isn't reachable. */
    fun localAnswer(question: String, currentUrl: String?, level: Security.Level): String? {
        val q = question.lowercase()
        if (Regex("(is|are) (this|the) (site|website|page) (safe|legit|real|a scam)|safe to (use|visit)").containsMatchIn(q) && currentUrl?.startsWith("http") == true) {
            val v = Security.analyze(currentUrl, level)
            return if (v.action == Security.Action.ALLOW) {
                "**${v.host}** isn't on Rovian Defender's threat lists and shows no strong warning signs.\n\nThat isn't a guarantee it's safe — Rovian Defender can only check known threats and common tricks."
            } else {
                "**${v.host}** was flagged (${if (v.confirmed) "confirmed threat" else "suspected — not confirmed"}).\n\n" + v.signals.joinToString("\n") { "- ${it.message}" }
            }
        }
        if (question.length > 120 && Regex("scam|phish|fraud|legit|genuine").containsMatchIn(q)) {
            val m = Security.analyzeMessage(question)
            return "**${m.assessment}.**\n\n" + (if (m.indicators.isNotEmpty()) "What I noticed:\n" + m.indicators.joinToString("\n") { "- $it" } + "\n\n" else "") + m.summary
        }
        return null
    }
}
