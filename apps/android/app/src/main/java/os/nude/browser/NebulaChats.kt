package os.nude.browser

import android.content.Context
import androidx.compose.runtime.mutableStateListOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import os.rovian.core.nudeid.NudeId
import java.io.File
import java.util.UUID

/** One saved conversation, in the shared format of docs/NEBULA_SYNC.md. */
data class SavedChat(val id: String, val title: String, val updated: Long, val source: String, val messages: List<ChatMessage>) {
    fun toJson(): JSONObject = JSONObject().put("id", id).put("title", title).put("updated", updated).put("source", source)
        .put("messages", JSONArray().apply { messages.forEach { put(JSONObject().put("role", it.role).put("text", it.text).put("t", it.t)) } })

    companion object {
        private val ID = Regex("^[A-Za-z0-9._:-]{1,120}$")

        /** Reads a chat from this phone or another device. Anything outside the format is dropped: it's data, never instructions. */
        fun from(raw: Any?, fallbackId: String? = null): SavedChat? {
            val j = raw as? JSONObject ?: return null
            val id = j.optString("id").takeIf { ID.matches(it) } ?: fallbackId?.takeIf { ID.matches(it) } ?: return null
            val arr = j.optJSONArray("messages") ?: return null
            val msgs = (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
                .filter { (it.optString("role") == "user" || it.optString("role") == "assistant") && it.has("text") }
                .takeLast(200).map { ChatMessage(it.optString("role"), it.optString("text").take(40_000), t = it.optLong("t")) }
            if (msgs.isEmpty()) return null
            val title = j.optString("title").trim().ifBlank { msgs.firstOrNull { it.role == "user" }?.text ?: "Conversation" }
            return SavedChat(id, title.replace(Regex("\\s+"), " ").trim().take(80),
                j.optLong("updated").takeIf { it > 0 } ?: msgs.last().t, j.optString("source", "unknown").take(30), msgs)
        }
    }
}

/**
 * Nebula conversations on this phone, synced through your Nude ID (sync space "nebula-chats") with Nude on your
 * computer and the Nebula app. Last write wins per chat, by `updated`. Private tabs never save.
 */
class NebulaChats(ctx: Context, private val nudeId: NudeId) {
    private val file = File(ctx.filesDir, "nebula-chats.json")
    private val lock = Mutex()
    private var since = 0L
    private var pushedAt = 0L
    private val deleted = mutableMapOf<String, Long>()
    /** Newest first. Compose re-renders when it changes. */
    val chats = mutableStateListOf<SavedChat>()

    init {
        runCatching {
            val j = JSONObject(file.readText())
            val arr = j.optJSONArray("chats") ?: JSONArray()
            chats += (0 until arr.length()).mapNotNull { SavedChat.from(arr.optJSONObject(it)) }.sortedByDescending { it.updated }
            since = j.optLong("since"); pushedAt = j.optLong("pushedAt")
        }
    }

    private fun persist() {
        val arr = JSONArray().apply { chats.forEach { put(it.toJson()) } }
        runCatching { file.writeText(JSONObject().put("chats", arr).put("since", since).put("pushedAt", pushedAt).toString()) }
    }

    fun get(id: String?) = chats.firstOrNull { it.id == id }

    /** Saves a conversation (new when id is null) and sends it to your other devices. Returns its id. */
    suspend fun save(id: String?, messages: List<ChatMessage>): String? {
        val chat = SavedChat.from(SavedChat(id ?: UUID.randomUUID().toString(), get(id)?.title ?: "", System.currentTimeMillis(), "nude-android",
            messages.filter { !it.error && it.text.isNotBlank() }).toJson()) ?: return id
        chats.removeAll { it.id == chat.id }
        chats.add(0, chat)
        while (chats.size > 300) chats.removeAt(chats.lastIndex)
        persist()
        if (nudeId.signedIn) withContext(Dispatchers.IO) { runCatching { nudeId.syncPut(SPACE, chat.id, chat.toJson()) } }
        return chat.id
    }

    suspend fun remove(id: String) {
        chats.removeAll { it.id == id }
        deleted[id] = System.currentTimeMillis()
        persist()
        if (nudeId.signedIn) withContext(Dispatchers.IO) { runCatching { nudeId.syncDelete(SPACE, id) } }
    }

    /** Pulls chats made on your other devices, then sends up any made here before you signed in. */
    suspend fun sync() = lock.withLock {
        if (!nudeId.signedIn) return@withLock
        val pulled = withContext(Dispatchers.IO) {
            runCatching {
                val all = mutableListOf<Triple<String, Long, Any?>>()
                var from = since
                repeat(10) {
                    val page = nudeId.syncPage(SPACE, from)
                    all += page.items
                    from = page.items.lastOrNull()?.second ?: page.now
                    if (!page.more) return@runCatching all to from
                }
                all to from
            }.getOrNull()
        } ?: return@withLock
        for ((key, _, value) in pulled.first) {
            if (value == null || value == JSONObject.NULL) { chats.removeAll { it.id == key }; continue }
            val c = SavedChat.from(value, key) ?: continue
            val mine = get(c.id)
            if (mine == null || mine.updated <= c.updated) { chats.removeAll { it.id == c.id }; chats.add(c) }
        }
        chats.sortByDescending { it.updated }
        since = pulled.second
        val local = chats.filter { it.source == "nude-android" && it.updated > pushedAt }
        withContext(Dispatchers.IO) { local.forEach { c -> runCatching { nudeId.syncPut(SPACE, c.id, c.toJson()) } } }
        pushedAt = System.currentTimeMillis()
        persist()
    }

    companion object { const val SPACE = "nebula-chats" }
}
