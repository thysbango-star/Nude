package os.nude.browser

import android.Manifest
import android.app.SearchManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.PermissionRequest
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {
    lateinit var browser: Browser
        private set
    private var permissionCallback: ((Boolean) -> Unit)? = null

    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        permissionCallback?.invoke(result.values.all { it })
        permissionCallback = null
    }
    private val fileLauncher = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        browser.fileCallback?.onReceiveValue(uris.toTypedArray())
        browser.fileCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val store = (application as NudeApplication).store
        browser = Browser(this, store)
        val saved = store.savedTabs()
        if (saved.isNotEmpty()) {
            saved.forEachIndexed { i, url ->
                val t = browser.newTab(activate = i == saved.lastIndex)
                t.url = url
                t.title = Omnibox.host(url)
                t.isHome = false
            }
            browser.active?.let { browser.load(it, it.url) }
        } else browser.newTab()
        handleIntent(intent)
        setContent { NudeTheme(store) { BrowserScreen(browser) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        when (intent?.action) {
            Intent.ACTION_VIEW -> intent.dataString?.takeIf { it.startsWith("http") }?.let { browser.newTab(it) }
            Intent.ACTION_WEB_SEARCH -> intent.getStringExtra(SearchManager.QUERY)?.let { browser.navigate("?$it", newTab = true) }
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)?.let { text ->
                val url = Regex("https?://\\S+").find(text)?.value
                if (url != null) browser.newTab(url) else browser.navigate("?$text", newTab = true)
            }
        }
    }

    override fun onPause() {
        super.onPause()
        browser.saveTabs()
    }

    /** Maps WebView resources to Android runtime permissions and asks for them if needed. */
    fun requestAndroidPermissions(resources: List<String>, cb: (Boolean) -> Unit) {
        val perms = resources.flatMap {
            when (it) {
                PermissionRequest.RESOURCE_VIDEO_CAPTURE -> listOf(Manifest.permission.CAMERA)
                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> listOf(Manifest.permission.RECORD_AUDIO)
                "location" -> listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                else -> emptyList()
            }
        }
        val missing = perms.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) { cb(true); return }
        permissionCallback = cb
        permissionLauncher.launch(missing.toTypedArray())
    }

    fun pickFiles(mimeTypes: List<String>, @Suppress("UNUSED_PARAMETER") multiple: Boolean) {
        val types = mimeTypes.map { if (it.startsWith(".")) "*/*" else it }.distinct().toTypedArray()
        runCatching { fileLauncher.launch(types) }.onFailure {
            browser.fileCallback?.onReceiveValue(null)
            browser.fileCallback = null
        }
    }

    fun share(url: String, title: String) {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url).putExtra(Intent.EXTRA_SUBJECT, title)
        startActivity(Intent.createChooser(send, "Share"))
    }

    fun openDownloads() {
        runCatching { startActivity(Intent(android.app.DownloadManager.ACTION_VIEW_DOWNLOADS)) }
    }

    fun openDefaultBrowserSettings() {
        runCatching { startActivity(Intent(android.provider.Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)) }
            .onFailure { runCatching { startActivity(Intent(android.provider.Settings.ACTION_SETTINGS)) } }
    }

    @Suppress("unused")
    fun openUri(uri: Uri) = runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
}
