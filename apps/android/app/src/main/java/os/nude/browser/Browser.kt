package os.nude.browser

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Environment
import android.os.Message
import android.view.View
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.net.http.SslError
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.ByteArrayInputStream

const val PRIVATE_PROFILE = "NudePrivate"

class Tab(val id: Int, val isPrivate: Boolean) {
    var webView: WebView? = null
    var title by mutableStateOf("New Tab")
    var url by mutableStateOf("")
    var progress by mutableIntStateOf(100)
    var canGoBack by mutableStateOf(false)
    var canGoForward by mutableStateOf(false)
    var favicon by mutableStateOf<Bitmap?>(null)
    var trackers by mutableIntStateOf(0)
    var blocked by mutableStateOf<Security.Verdict?>(null)
    var error by mutableStateOf<String?>(null)
    var isHome by mutableStateOf(true)
    @Volatile var pageHost: String? = null
    val bypass = mutableSetOf<String>()
}

data class PendingDownload(val url: String, val filename: String, val mime: String?, val userAgent: String, val verdict: Security.DownloadVerdict)
data class PendingPermission(val origin: String, val label: String, val onResult: (Boolean) -> Unit)

/** Owns all tabs and their WebViews. UI reads its Compose state. */
class Browser(private val activity: MainActivity, val store: Store) {
    val tabs = mutableStateListOf<Tab>()
    var activeId by mutableIntStateOf(-1)
    var pendingDownload by mutableStateOf<PendingDownload?>(null)
    var pendingPermission by mutableStateOf<PendingPermission?>(null)
    var customView by mutableStateOf<View?>(null)
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    var toast by mutableStateOf<String?>(null)
    private var nextId = 1
    var fileCallback: ValueCallback<Array<Uri>>? = null

    val active: Tab? get() = tabs.firstOrNull { it.id == activeId }

    val privateProfilesSupported: Boolean = WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)

    fun newTab(url: String? = null, isPrivate: Boolean = false, activate: Boolean = true, index: Int? = null): Tab {
        val tab = Tab(nextId++, isPrivate)
        if (index != null && index in 0..tabs.size) tabs.add(index, tab) else tabs.add(tab)
        if (activate) activeId = tab.id
        if (url != null) load(tab, url)
        return tab
    }

    fun closeTab(tab: Tab) {
        val i = tabs.indexOf(tab)
        tabs.remove(tab)
        tab.webView?.let { it.stopLoading(); it.destroy() }
        tab.webView = null
        if (tab.isPrivate && tabs.none { it.isPrivate }) clearPrivateData()
        if (tabs.isEmpty()) newTab()
        if (activeId == tab.id) activeId = tabs[minOf(i, tabs.size - 1).coerceAtLeast(0)].id
        saveTabs()
    }

    private fun clearPrivateData() {
        if (privateProfilesSupported) {
            runCatching { ProfileStore.getInstance().deleteProfile(PRIVATE_PROFILE) }
        }
    }

    fun saveTabs() = store.saveTabs(tabs.filter { !it.isPrivate && it.url.startsWith("http") }.map { it.url })

    /** Navigate from the address bar or a link the user chose. Runs Rovian Defender first. */
    fun navigate(input: String, tab: Tab? = active, newTab: Boolean = false) {
        val r = Omnibox.resolve(input, store.engine, store.searchServer.ifBlank { "http://127.0.0.1:8787" }) ?: return
        val url = when (r) {
            is Omnibox.Result.Navigate -> r.url
            is Omnibox.Result.Search -> r.url
            is Omnibox.Result.Blocked -> { toast = r.reason; return }
        }
        if (newTab || tab == null) newTab(url) else load(tab, url)
    }

    fun load(tab: Tab, url: String) {
        tab.error = null
        if (!checkAndMaybeBlock(tab, url)) return
        tab.isHome = false
        tab.url = url
        ensureWebView(tab).loadUrl(url)
    }

    fun goHome(tab: Tab) {
        tab.isHome = true
        tab.title = "New Tab"
        tab.url = ""
        tab.blocked = null
        tab.error = null
    }

    /** Returns true if navigation may proceed. */
    fun checkAndMaybeBlock(tab: Tab, url: String): Boolean {
        val v = Security.analyze(url, store.level)
        if (v.action == Security.Action.ALLOW || v.host in tab.bypass) return true
        tab.blocked = v
        tab.isHome = false
        tab.url = url
        tab.title = "Warning — Rovian Defender"
        store.blockedSites = store.blockedSites + 1
        store.logEvent(if (v.action == Security.Action.BLOCK) "site-blocked" else "site-warned", v.signals.firstOrNull()?.message ?: "Suspicious site", url)
        return false
    }

    fun continueAnyway(tab: Tab) {
        val v = tab.blocked ?: return
        if (v.confirmed && store.level == Security.Level.MAXIMUM) return
        tab.bypass += v.host
        store.logEvent("bypass", "You chose to visit this site despite a warning.", v.url)
        tab.blocked = null
        load(tab, v.url)
    }

    fun backToSafety(tab: Tab) {
        tab.blocked = null
        val wv = tab.webView
        if (wv != null && wv.url != null && wv.url!!.startsWith("http")) {
            tab.url = wv.url!!
            tab.title = wv.title ?: tab.url
        } else goHome(tab)
    }

    @SuppressLint("SetJavaScriptEnabled")
    fun ensureWebView(tab: Tab): WebView {
        tab.webView?.let { return it }
        val wv = WebView(activity)
        if (tab.isPrivate && privateProfilesSupported) {
            runCatching {
                ProfileStore.getInstance().getOrCreateProfile(PRIVATE_PROFILE)
                WebViewCompat.setProfile(wv, PRIVATE_PROFILE)
            }
        }
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = true
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = false
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            builtInZoomControls = true
            displayZoomControls = false
            loadWithOverviewMode = true
            useWideViewPort = true
            safeBrowsingEnabled = true
            if (tab.isPrivate && !privateProfilesSupported) cacheMode = WebSettings.LOAD_NO_CACHE
            userAgentString = if (store.desktopMode) desktopUa(userAgentString) else userAgentString.replace("; wv", "")
        }
        if (!tab.isPrivate) CookieManager.getInstance().setAcceptThirdPartyCookies(wv, store.level == Security.Level.STANDARD)
        wv.webViewClient = NudeWebViewClient(tab)
        wv.webChromeClient = NudeChromeClient(tab)
        wv.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
            val source = tab.url.takeIf { it.startsWith("http") }?.let { Security.analyze(it, store.level) }
            val verdict = Security.analyzeDownload(name, mimeType, url, source, store.level)
            when (verdict.action) {
                Security.Action.BLOCK -> {
                    store.blockedDownloads = store.blockedDownloads + 1
                    store.logEvent("download-blocked", "$name: ${verdict.notes.firstOrNull() ?: "risky file"}", url)
                    toast = "Rovian Defender blocked a dangerous download: $name"
                }
                Security.Action.WARN -> pendingDownload = PendingDownload(url, name, mimeType, userAgent, verdict)
                Security.Action.ALLOW -> startDownload(url, name, mimeType, userAgent)
            }
        }
        tab.webView = wv
        return wv
    }

    private fun desktopUa(ua: String) = ua.replace(Regex("\\(Linux; Android [^)]*\\)"), "(X11; Linux x86_64)").replace(" Mobile", "").replace("; wv", "")

    fun startDownload(url: String, filename: String, mime: String?, userAgent: String) {
        try {
            val req = DownloadManager.Request(Uri.parse(url))
                .setMimeType(mime)
                .setTitle(filename)
                .setDescription("Downloaded with Nude")
                .addRequestHeader("User-Agent", userAgent)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
            CookieManager.getInstance().getCookie(url)?.let { req.addRequestHeader("Cookie", it) }
            (activity.getSystemService(android.content.Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
            toast = "Downloading $filename"
        } catch (e: Exception) {
            toast = "Couldn't download: ${e.message}"
        }
    }

    fun exitFullscreen() {
        customViewCallback?.onCustomViewHidden()
        customView = null
        customViewCallback = null
    }

    private fun openExternal(url: String): Boolean = try {
        val intent = if (url.startsWith("intent:")) Intent.parseUri(url, Intent.URI_INTENT_SCHEME).apply {
            addCategory(Intent.CATEGORY_BROWSABLE); component = null; selector = null
        } else Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)
        activity.startActivity(intent)
        true
    } catch (e: ActivityNotFoundException) {
        if (url.startsWith("intent:")) {
            runCatching { Intent.parseUri(url, Intent.URI_INTENT_SCHEME).getStringExtra("browser_fallback_url") }.getOrNull()
                ?.takeIf { it.startsWith("https://") }?.let { fallback -> active?.let { load(it, fallback) } }
        }
        true
    } catch (e: Exception) { true }

    inner class NudeWebViewClient(private val tab: Tab) : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            val scheme = request.url.scheme?.lowercase() ?: return true
            if (scheme != "http" && scheme != "https") {
                if (scheme in setOf("javascript", "file", "content", "data")) return true
                return openExternal(url)
            }
            if (!request.isForMainFrame) return false
            return !checkAndMaybeBlock(tab, url)
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            tab.url = url
            tab.pageHost = Uri.parse(url).host
            tab.trackers = 0
            tab.error = null
            tab.favicon = favicon
            tab.isHome = false
        }

        override fun onPageFinished(view: WebView, url: String) {
            tab.canGoBack = view.canGoBack()
            tab.canGoForward = view.canGoForward()
            if (!tab.isPrivate) {
                store.recordVisit(url, view.title ?: "")
                saveTabs()
            }
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
            tab.url = url
            tab.canGoBack = view.canGoBack()
            tab.canGoForward = view.canGoForward()
        }

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            if (request.isForMainFrame) return null
            val host = request.url.host ?: return null
            if (Security.shouldBlockTracker(host, tab.pageHost, store.level)) {
                activity.runOnUiThread {
                    tab.trackers += 1
                    store.blockedTrackers = store.blockedTrackers + 1
                }
                return WebResourceResponse("text/plain", "utf-8", 204, "Blocked by Nude", emptyMap(), ByteArrayInputStream(ByteArray(0)))
            }
            return null
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) tab.error = error.description?.toString() ?: "This page couldn't load."
        }

        @SuppressLint("WebViewClientOnReceivedSslError")
        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            // Never bypass certificate errors.
            handler.cancel()
            tab.error = "Your connection isn't private. Nude stopped the connection because the site's security certificate isn't valid."
        }

        override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
            tab.webView = null
            tab.error = "This tab stopped working. Reload to try again."
            return true
        }
    }

    inner class NudeChromeClient(private val tab: Tab) : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            tab.progress = newProgress
        }

        override fun onReceivedTitle(view: WebView, title: String?) {
            tab.title = title ?: tab.url
            if (!tab.isPrivate && title != null) store.updateTitle(view.url ?: "", title)
        }

        override fun onReceivedIcon(view: WebView, icon: Bitmap?) {
            tab.favicon = icon
        }

        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            if (!isUserGesture) return false // no pop-ups without a tap
            val child = newTab(isPrivate = tab.isPrivate, index = tabs.indexOf(tab) + 1)
            child.isHome = false
            val wv = ensureWebView(child)
            (resultMsg.obj as WebView.WebViewTransport).webView = wv
            resultMsg.sendToTarget()
            return true
        }

        override fun onCloseWindow(window: WebView) {
            tabs.firstOrNull { it.webView == window }?.let { closeTab(it) }
        }

        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            customView = view
            customViewCallback = callback
        }

        override fun onHideCustomView() = exitFullscreen()

        override fun onPermissionRequest(request: PermissionRequest) {
            val wanted = request.resources.filter { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE || it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }
            if (wanted.isEmpty()) { request.deny(); return }
            val label = wanted.joinToString(" and ") { if (it == PermissionRequest.RESOURCE_VIDEO_CAPTURE) "use your camera" else "use your microphone" }
            activity.runOnUiThread {
                pendingPermission = PendingPermission(request.origin.host ?: request.origin.toString(), label) { allow ->
                    if (allow) activity.requestAndroidPermissions(wanted) { granted -> if (granted) request.grant(wanted.toTypedArray()) else request.deny() }
                    else request.deny()
                }
            }
        }

        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
            pendingPermission = PendingPermission(Uri.parse(origin).host ?: origin, "know your location") { allow ->
                if (allow) activity.requestAndroidPermissions(listOf("location")) { granted -> callback.invoke(origin, granted, false) }
                else callback.invoke(origin, false, false)
            }
        }

        override fun onShowFileChooser(webView: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            activity.pickFiles(params.acceptTypes.filter { it.isNotBlank() }.ifEmpty { listOf("*/*") }, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
            return true
        }
    }
}
