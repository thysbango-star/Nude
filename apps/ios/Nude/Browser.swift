import Combine
import SwiftUI
import UIKit
import WebKit

/// One browser tab backed by a WKWebView (WebKit — the engine Apple requires for iOS/iPadOS browsers).
@MainActor
final class Tab: NSObject, ObservableObject, Identifiable {
    let id = UUID()
    let isPrivate: Bool
    @Published var title = "New Tab"
    @Published var url = ""
    @Published var progress: Double = 1
    @Published var isLoading = false
    @Published var canGoBack = false
    @Published var canGoForward = false
    @Published var isHome = true
    @Published var blocked: SecurityVerdict?
    @Published var error: String?
    @Published var thumbnail: UIImage?
    var bypass = Set<String>()
    weak var model: BrowserModel?
    private(set) var webView: WKWebView?
    private var observers: [AnyCancellable] = []

    init(isPrivate: Bool, model: BrowserModel) {
        self.isPrivate = isPrivate
        self.model = model
    }

    /// Creates the WKWebView (or adopts the configuration WebKit gave us for a pop-up).
    @discardableResult
    func ensureWebView(configuration: WKWebViewConfiguration? = nil) -> WKWebView {
        if let w = webView { return w }
        let config = configuration ?? {
            let c = WKWebViewConfiguration()
            c.websiteDataStore = isPrivate ? (model?.privateDataStore ?? .nonPersistent()) : .default()
            c.allowsInlineMediaPlayback = true
            c.mediaTypesRequiringUserActionForPlayback = [.all]
            c.preferences.javaScriptCanOpenWindowsAutomatically = false
            c.preferences.isFraudulentWebsiteWarningEnabled = true // WebKit Safe Browsing, in addition to Nude Security
            c.defaultWebpagePreferences.allowsContentJavaScript = true
            return c
        }()
        if let rules = model?.ruleList, configuration == nil { config.userContentController.add(rules) }
        let w = WKWebView(frame: .zero, configuration: config)
        w.navigationDelegate = self
        w.uiDelegate = self
        w.allowsBackForwardNavigationGestures = true
        w.allowsLinkPreview = true
        w.isFindInteractionEnabled = true
        if #available(iOS 16.4, *) { w.isInspectable = false }
        observers = [
            w.publisher(for: \.title).sink { [weak self] t in guard let self, let t, !t.isEmpty else { return }; self.title = t; if !self.isPrivate { self.model?.store.updateTitle(url: self.url, title: t) } },
            w.publisher(for: \.url).sink { [weak self] u in if let u { self?.url = u.absoluteString } },
            w.publisher(for: \.estimatedProgress).sink { [weak self] p in self?.progress = p },
            w.publisher(for: \.isLoading).sink { [weak self] l in self?.isLoading = l },
            w.publisher(for: \.canGoBack).sink { [weak self] b in self?.canGoBack = b },
            w.publisher(for: \.canGoForward).sink { [weak self] b in self?.canGoForward = b },
        ]
        webView = w
        return w
    }

    func applyRules(_ rules: WKContentRuleList?) {
        guard let w = webView else { return }
        w.configuration.userContentController.removeAllContentRuleLists()
        if let rules { w.configuration.userContentController.add(rules) }
    }

    func load(_ url: String) {
        error = nil
        guard model?.allowNavigation(self, url) ?? true else { return }
        guard let u = URL(string: url) else { return }
        isHome = false
        self.url = url
        ensureWebView().load(URLRequest(url: u))
    }

    func goHome() {
        isHome = true
        title = "New Tab"
        url = ""
        blocked = nil
        error = nil
        webView?.stopLoading()
    }

    func reload() {
        if webView == nil, !url.isEmpty { load(url) } else { error = nil; webView?.reload() }
    }

    func snapshot() {
        guard let w = webView, !isHome else { return }
        w.takeSnapshot(with: nil) { [weak self] img, _ in self?.thumbnail = img }
    }

    func close() {
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
        observers = []
        webView = nil
    }

    /// Page text, read in an isolated JavaScript world (the page can't tamper with it). Only used when the user shares the page with Nude AI.
    func pageText() async -> (title: String, text: String) {
        guard let w = webView else { return ("", "") }
        return await withCheckedContinuation { cont in
            w.evaluateJavaScript("JSON.stringify({t: document.title, b: (document.body && document.body.innerText || '').slice(0, 60000)})", in: nil, in: .defaultClient) { result in
                if case .success(let v) = result, let s = v as? String, let data = s.data(using: .utf8),
                   let obj = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
                    cont.resume(returning: (obj["t"] ?? "", obj["b"] ?? ""))
                } else { cont.resume(returning: ("", "")) }
            }
        }
    }
}

// MARK: - Navigation, pop-ups and downloads

extension Tab: WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences,
                 decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        preferences.preferredContentMode = (model?.store.desktopMode ?? false) ? .desktop : .mobile
        guard let url = action.request.url, let scheme = url.scheme?.lowercased() else { return decisionHandler(.cancel, preferences) }
        if action.shouldPerformDownload { return decisionHandler(.download, preferences) }
        if !["http", "https", "about", "blob", "data"].contains(scheme) {
            if ["tel", "mailto", "sms", "facetime", "maps", "itms-apps", "itms-appss"].contains(scheme) || UIApplication.shared.canOpenURL(url) {
                UIApplication.shared.open(url)
            }
            return decisionHandler(.cancel, preferences)
        }
        let mainFrame = action.targetFrame?.isMainFrame ?? true
        if mainFrame, scheme == "http" || scheme == "https" {
            if model?.allowNavigation(self, url.absoluteString) == false { return decisionHandler(.cancel, preferences) }
        }
        decisionHandler(.allow, preferences)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        decisionHandler(!response.canShowMIMEType || disposition.lowercased().hasPrefix("attachment") ? .download : .allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        error = nil
        isHome = false
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if !isPrivate, let u = webView.url?.absoluteString { model?.store.recordVisit(url: u, title: webView.title ?? "") }
        model?.saveTabs()
    }

    private func handle(_ err: Error) {
        let ns = err as NSError
        if ns.code == NSURLErrorCancelled || (ns.domain == "WebKitErrorDomain" && ns.code == 102) { return }
        if ns.domain == NSURLErrorDomain && [NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateHasUnknownRoot, NSURLErrorServerCertificateNotYetValid, NSURLErrorSecureConnectionFailed].contains(ns.code) {
            error = "Your connection isn't private. Nude stopped the connection because the site's security certificate isn't valid."
        } else if ns.domain == NSURLErrorDomain && [NSURLErrorNotConnectedToInternet, NSURLErrorCannotFindHost, NSURLErrorTimedOut, NSURLErrorCannotConnectToHost, NSURLErrorNetworkConnectionLost].contains(ns.code) {
            error = "Can't reach this page. Check your internet connection or the address."
        } else {
            error = ns.localizedDescription
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { handle(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { handle(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { error = "This tab stopped working. Reload to try again." }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let model else { return nil }
        let child = model.newTab(isPrivate: isPrivate, after: self)
        child.isHome = false
        return child.ensureWebView(configuration: configuration)
    }

    func webViewDidClose(_ webView: WKWebView) { model?.close(self) }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        model?.dialog = PageDialog(host: frame.request.url?.host ?? "This page", message: message, kind: .alert) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        model?.dialog = PageDialog(host: frame.request.url?.host ?? "This page", message: message, kind: .confirm) { ok in completionHandler(ok) }
    }

    // Downloads: Nude Security checks every file before it's saved.
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        guard let model else { return completionHandler(nil) }
        let src = url.hasPrefix("http") ? Security.analyze(url, level: model.store.level) : nil
        let source = response.url?.absoluteString ?? url
        let verdict = Security.analyzeDownload(filename: suggestedFilename, url: source, source: src, level: model.store.level)
        let destination = model.downloadDestination(for: suggestedFilename)
        switch verdict.action {
        case .block:
            model.store.blockedDownloads += 1
            model.store.logEvent("download-blocked", "\(suggestedFilename): \(verdict.notes.first ?? "risky file")", url: source)
            model.toast = "Nude Security blocked a dangerous download: \(suggestedFilename)"
            completionHandler(nil)
        case .warn:
            model.pendingDownload = PendingDownload(filename: suggestedFilename, notes: verdict.notes) { keep in completionHandler(keep ? destination : nil) }
        case .allow:
            completionHandler(destination)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        model?.toast = "Download complete — find it in Files → Nude"
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        model?.toast = "Download failed: \(error.localizedDescription)"
    }
}

struct PendingDownload: Identifiable { let id = UUID(); let filename: String; let notes: [String]; let decide: (Bool) -> Void }
struct PageDialog: Identifiable {
    enum Kind { case alert, confirm }
    let id = UUID(); let host: String; let message: String; let kind: Kind; let done: (Bool) -> Void
}

/// All tabs, shared security state and UI-level prompts.
@MainActor
final class BrowserModel: ObservableObject {
    @Published var tabs: [Tab] = []
    @Published var activeID: UUID?
    @Published var toast: String?
    @Published var pendingDownload: PendingDownload?
    @Published var dialog: PageDialog?
    let store: Store
    private(set) var ruleList: WKContentRuleList?
    private(set) var privateDataStore: WKWebsiteDataStore?
    private var levelObserver: AnyCancellable?

    init(store: Store) {
        self.store = store
        let saved = store.savedTabs
        if saved.isEmpty { newTab() } else {
            for u in saved { let t = newTab(); t.url = u; t.title = Omnibox.host(u); t.isHome = false }
            activeID = tabs.last?.id
            active?.load(active!.url)
        }
        levelObserver = store.$level.removeDuplicates().sink { [weak self] level in self?.compileRules(level) }
    }

    var active: Tab? { tabs.first { $0.id == activeID } }

    @discardableResult
    func newTab(isPrivate: Bool = false, url: String? = nil, after: Tab? = nil, activate: Bool = true) -> Tab {
        if isPrivate && privateDataStore == nil { privateDataStore = .nonPersistent() }
        let t = Tab(isPrivate: isPrivate, model: self)
        if let after, let i = tabs.firstIndex(where: { $0 === after }) { tabs.insert(t, at: i + 1) } else { tabs.append(t) }
        if activate { activeID = t.id }
        if let url { t.load(url) }
        return t
    }

    func activate(_ t: Tab) {
        active?.snapshot()
        activeID = t.id
        if t.webView == nil, !t.isHome, t.url.hasPrefix("http"), t.blocked == nil { t.load(t.url) }
    }

    func close(_ t: Tab) {
        guard let i = tabs.firstIndex(where: { $0 === t }) else { return }
        t.close()
        tabs.remove(at: i)
        if t.isPrivate && !tabs.contains(where: { $0.isPrivate }) { privateDataStore = nil } // private data is gone with the store
        if tabs.isEmpty { newTab() }
        if activeID == t.id { activeID = tabs[min(i, tabs.count - 1)].id }
        saveTabs()
    }

    func saveTabs() { store.savedTabs = tabs.filter { !$0.isPrivate && $0.url.hasPrefix("http") }.map(\.url) }

    func navigate(_ input: String, newTab: Bool = false) {
        guard let r = Omnibox.resolve(input, engine: store.engine, nudeBase: store.nudeSearchBase) else { return }
        let url: String
        switch r {
        case .navigate(let u): url = u
        case .search(let u, _): url = u
        case .blocked(let reason): toast = reason; return
        }
        if newTab || active == nil { self.newTab(url: url) } else { active?.load(url) }
    }

    /// Nude Security pre-navigation check. Returns false (and shows the warning page) when the site is flagged.
    func allowNavigation(_ tab: Tab, _ url: String) -> Bool {
        if store.level == .maximum, url.hasPrefix("http://"), let host = URL(string: url)?.host, !Security.isPrivateIP(host) {
            let https = "https://" + url.dropFirst("http://".count)
            DispatchQueue.main.async { tab.load(String(https)) }
            return false
        }
        let v = Security.analyze(url, level: store.level)
        if v.action == .allow || tab.bypass.contains(v.host) { return true }
        tab.blocked = v
        tab.isHome = false
        tab.url = url
        tab.title = "Warning — Nude Security"
        store.blockedSites += 1
        store.logEvent(v.action == .block ? "site-blocked" : "site-warned", v.signals.first?.message ?? "Suspicious site", url: url)
        return false
    }

    func continueAnyway(_ tab: Tab) {
        guard let v = tab.blocked, !(v.confirmed && store.level == .maximum) else { return }
        tab.bypass.insert(v.host)
        store.logEvent("bypass", "You chose to visit this site despite a warning.", url: v.url)
        tab.blocked = nil
        tab.load(v.url)
    }

    func backToSafety(_ tab: Tab) {
        tab.blocked = nil
        if let w = tab.webView, let u = w.url?.absoluteString, u.hasPrefix("http") { tab.url = u; tab.title = w.title ?? u } else { tab.goHome() }
    }

    func compileRules(_ level: ProtectionLevel) {
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "nude-trackers-\(level.rawValue)", encodedContentRuleList: Security.contentBlockerJSON(level)) { [weak self] list, error in
            Task { @MainActor in
                guard let self else { return }
                if let error { self.toast = "Tracker blocking couldn't start: \(error.localizedDescription)" }
                self.ruleList = list
                self.tabs.forEach { $0.applyRules(list) }
            }
        }
    }

    func downloadDestination(for filename: String) -> URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)
        let safe = filename.replacingOccurrences(of: "[/\\\\:\\x00-\\x1f\\x{202a}-\\x{202e}\\x{2066}-\\x{2069}]", with: "_", options: .regularExpression)
        let ext = (safe as NSString).pathExtension
        let stem = (safe as NSString).deletingPathExtension
        var candidate = docs.appendingPathComponent(safe.isEmpty ? "download" : safe)
        var n = 1
        while FileManager.default.fileExists(atPath: candidate.path) {
            candidate = docs.appendingPathComponent(ext.isEmpty ? "\(stem) (\(n))" : "\(stem) (\(n)).\(ext)")
            n += 1
        }
        return candidate
    }
}
