package os.rovian.defender.core

import org.json.JSONObject

/** How much a finding matters. Only real evidence ever produces RISK. */
enum class Severity(val rank: Int, val label: String) {
    INFO(0, "Info"), LOW(1, "Low"), MEDIUM(2, "Medium"), HIGH(3, "High");
    companion object { fun of(s: String?) = entries.firstOrNull { it.name == s } ?: INFO }
}

enum class Category(val label: String) {
    THREAT("Threat"), WEB("Website"), APP("App"), FILE("File"), PRIVACY("Privacy"), DEVICE("Device"), PASSGATE("PassGate"), PC("Your PC");
    companion object { fun of(s: String?) = entries.firstOrNull { it.name == s } ?: DEVICE }
}

/**
 * One security event in the activity centre: when, what kind, how serious, about what, why, what to do, and
 * whether you've dealt with it.
 */
data class SecurityEvent(
    val id: String,
    val time: Long,
    val category: Category,
    val severity: Severity,
    val subject: String,
    val title: String,
    val explanation: String,
    val action: String,
    val resolved: Boolean = false,
    /** Same key = same underlying issue, so a re-scan updates instead of piling up duplicates. */
    val key: String = id,
) {
    fun toJson(): JSONObject = JSONObject().put("id", id).put("time", time).put("category", category.name).put("severity", severity.name)
        .put("subject", subject).put("title", title).put("explanation", explanation).put("action", action).put("resolved", resolved).put("key", key)

    companion object {
        fun fromJson(j: JSONObject) = SecurityEvent(
            j.getString("id"), j.getLong("time"), Category.of(j.optString("category")), Severity.of(j.optString("severity")),
            j.optString("subject"), j.optString("title"), j.optString("explanation"), j.optString("action"), j.optBoolean("resolved"), j.optString("key", j.getString("id")),
        )
    }
}

/** The four answers Rovian Defender gives about a link or file. Never "safe": no tool can promise that. */
enum class Assessment(val label: String, val severity: Severity) {
    DANGEROUS("Dangerous", Severity.HIGH),
    SUSPICIOUS("Suspicious", Severity.MEDIUM),
    SAFE_INDICATORS("Safe indicators found", Severity.INFO),
    UNKNOWN("Unknown", Severity.LOW),
}
