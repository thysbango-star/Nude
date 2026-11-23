package os.rovian.passgate

import android.app.PendingIntent
import android.app.assist.AssistStructure
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.fragment.app.FragmentActivity
import java.util.UUID

/**
 * PassGate fills your saved logins into sign-in forms in the Nude browser on this phone: the same job the
 * single-use code does on Windows, done through Android's autofill instead of the camera.
 *
 * - Only the Nude browser, and only when it is signed with the same key as PassGate (so no other app can pose
 *   as Nude and ask for your passwords).
 * - Only logins saved for the site the page is on (the web domain Nude's WebView reports).
 * - Nothing with a password reaches Nude until you confirm with your fingerprint, face or PIN.
 */
class PassGateAutofill : AutofillService() {
    override fun onFillRequest(request: FillRequest, cancellation: CancellationSignal, callback: FillCallback) {
        val structure = request.fillContexts.lastOrNull()?.structure ?: return callback.onSuccess(null)
        val form = AutofillForm.read(structure)
        if (form == null || !trustedBrowser(this, structure.activityComponent.packageName)) return callback.onSuccess(null)
        val matches = Vault(applicationContext).logins.filter { it.matches(form.domain) }
        val builder = FillResponse.Builder()
        if (matches.isNotEmpty()) {
            val auth = Intent(this, AutofillUnlockActivity::class.java)
                .putExtra(EXTRA_DOMAIN, form.domain).putExtra(EXTRA_USER, form.username).putExtra(EXTRA_PASS, form.password)
            val sender = PendingIntent.getActivity(this, form.domain.hashCode(), auth, PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_MUTABLE).intentSender
            val label = if (matches.size == 1) "PassGate: ${matches[0].username.ifBlank { "login" }}" else "PassGate: ${matches.size} logins for ${form.domain}"
            builder.setAuthentication(form.ids, sender, line(label))
        }
        // Offer to save what you type here, so the next sign-in can come from PassGate.
        builder.setSaveInfo(SaveInfo.Builder(SaveInfo.SAVE_DATA_TYPE_USERNAME or SaveInfo.SAVE_DATA_TYPE_PASSWORD, form.ids).build())
        callback.onSuccess(builder.build())
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        val structure = request.fillContexts.lastOrNull()?.structure ?: return callback.onSuccess()
        val form = AutofillForm.read(structure)
        if (form == null || !trustedBrowser(this, structure.activityComponent.packageName)) return callback.onSuccess()
        val values = AutofillForm.values(structure)
        val password = form.password?.let { values[it] }.orEmpty()
        if (password.isEmpty()) return callback.onSuccess()
        val username = form.username?.let { values[it] }.orEmpty()
        val vault = Vault(applicationContext)
        val same = vault.logins.firstOrNull { it.matches(form.domain) && it.username == username }
        vault.saveLogin(same?.copy(password = password) ?: Login(UUID.randomUUID().toString(), form.domain, username, password, "", 0, 0))
        callback.onSuccess()
    }

    companion object {
        const val NUDE = "os.nude.browser"
        const val EXTRA_DOMAIN = "domain"
        const val EXTRA_USER = "user"
        const val EXTRA_PASS = "pass"

        /** The Nude browser, signed with PassGate's own key. */
        fun trustedBrowser(ctx: Context, pkg: String): Boolean =
            pkg == NUDE && ctx.packageManager.checkSignatures(ctx.packageName, NUDE) == PackageManager.SIGNATURE_MATCH

        fun line(text: String) = RemoteViews("os.rovian.passgate", android.R.layout.simple_list_item_1).apply {
            setTextViewText(android.R.id.text1, text)
        }
    }
}

/** The sign-in fields of a page and the site it's on. */
data class AutofillForm(val domain: String, val username: AutofillId?, val password: AutofillId?) {
    val ids: Array<AutofillId> get() = listOfNotNull(username, password).toTypedArray()

    companion object {
        fun read(s: AssistStructure): AutofillForm? {
            var domain: String? = null
            var user: AutofillId? = null
            var pass: AutofillId? = null
            fun walk(n: AssistStructure.ViewNode) {
                n.webDomain?.takeIf { it.isNotBlank() }?.let { if (domain == null) domain = it }
                val id = n.autofillId
                if (id != null && n.autofillType == View.AUTOFILL_TYPE_TEXT) when (kind(n)) {
                    "password" -> if (pass == null) pass = id
                    "username" -> if (user == null) user = id
                }
                for (i in 0 until n.childCount) walk(n.getChildAt(i))
            }
            for (i in 0 until s.windowNodeCount) walk(s.getWindowNodeAt(i).rootViewNode)
            val d = domain?.let { Logins.clean(it) }?.takeIf { it.contains('.') } ?: return null
            return if (pass == null) null else AutofillForm(d, user, pass)
        }

        /** "password", "username" or null, from autofill hints, the HTML input, then the input type. */
        fun kind(n: AssistStructure.ViewNode): String? {
            val hints = n.autofillHints?.map { it.lowercase() }.orEmpty()
            if (hints.any { "password" in it }) return "password"
            if (hints.any { "username" in it || "email" in it }) return "username"
            val attrs = n.htmlInfo?.attributes?.associate { (it.first ?: "").lowercase() to (it.second ?: "").lowercase() }.orEmpty()
            val type = attrs["type"]
            val auto = attrs["autocomplete"].orEmpty()
            if (type == "password" || "password" in auto) return "password"
            if (type == "email" || "username" in auto || "email" in auto) return "username"
            if (type == "text" && Regex("user|login|email|account").containsMatchIn(attrs["name"].orEmpty() + attrs["id"].orEmpty())) return "username"
            val variation = n.inputType and InputType.TYPE_MASK_VARIATION
            if (n.inputType and InputType.TYPE_MASK_CLASS == InputType.TYPE_CLASS_TEXT) {
                if (variation == InputType.TYPE_TEXT_VARIATION_PASSWORD || variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD) return "password"
                if (variation == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS || variation == InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS) return "username"
            }
            return null
        }

        fun values(s: AssistStructure): Map<AutofillId, String> {
            val out = mutableMapOf<AutofillId, String>()
            fun walk(n: AssistStructure.ViewNode) {
                val v = n.autofillValue
                if (n.autofillId != null && v != null && v.isText) out[n.autofillId!!] = v.textValue.toString()
                for (i in 0 until n.childCount) walk(n.getChildAt(i))
            }
            for (i in 0 until s.windowNodeCount) walk(s.getWindowNodeAt(i).rootViewNode)
            return out
        }
    }
}

/**
 * Shown by Android when you tap "PassGate: …" above a sign-in form. Asks for your fingerprint, face or PIN, then
 * hands Nude only the logins saved for that site. Cancelling hands over nothing.
 */
class AutofillUnlockActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val domain = intent.getStringExtra(PassGateAutofill.EXTRA_DOMAIN)
        val pass = idExtra(PassGateAutofill.EXTRA_PASS)
        if (domain == null || pass == null) { finish(); return }
        val user = idExtra(PassGateAutofill.EXTRA_USER)
        val allowed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
            else BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL
        if (BiometricManager.from(this).canAuthenticate(allowed) != BiometricManager.BIOMETRIC_SUCCESS) { finish(); return }
        BiometricPrompt(this, mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val vault = Vault(applicationContext)
                val matches = vault.logins.filter { it.matches(domain) }
                val response = FillResponse.Builder()
                matches.forEach { l ->
                    val ds = Dataset.Builder(PassGateAutofill.line("${l.username.ifBlank { "(no username)" }} · ${l.site}"))
                    user?.let { ds.setValue(it, AutofillValue.forText(l.username)) }
                    ds.setValue(pass, AutofillValue.forText(l.password))
                    response.addDataset(ds.build())
                }
                if (matches.isNotEmpty()) vault.log("login-filled", "Offered ${matches.size} login${if (matches.size == 1) "" else "s"} for $domain to Nude on this phone")
                setResult(RESULT_OK, Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, if (matches.isEmpty()) null else response.build()))
                finish()
            }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) { setResult(RESULT_CANCELED); finish() }
        }).authenticate(BiometricPrompt.PromptInfo.Builder().setTitle("Fill your login").setSubtitle("For $domain in Nude").setAllowedAuthenticators(allowed).build())
    }

    private fun idExtra(name: String): AutofillId? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(name, AutofillId::class.java) else @Suppress("DEPRECATION") intent.getParcelableExtra(name)
}
