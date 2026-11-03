import SwiftUI
import WebKit

/// Nude orange (logo) and Nebula lavender.
let nudeClay = Color(red: 0.929, green: 0.490, blue: 0.227)
let nudeViolet = Color(red: 0.651, green: 0.310, blue: 0.816)
let nudeCream = Color(red: 0.961, green: 0.953, blue: 0.937)
let rovianRed = Color(red: 0.784, green: 0.220, blue: 0.227)
let nebulaGradient = AngularGradient(colors: [Color(red: 0.48, green: 0.36, blue: 1), Color(red: 1, green: 0.31, blue: 0.85), Color(red: 1, green: 0.6, blue: 0.24), Color(red: 0.24, green: 0.88, blue: 1), Color(red: 0.48, green: 0.36, blue: 1)], center: .center)

/// The Nude logo: the orange NU/DE diamond with its fading beam.
struct NudeMark: View {
    var size: CGFloat = 32
    var body: some View {
        ZStack(alignment: .top) {
            LinearGradient(colors: [nudeClay.opacity(0), nudeClay.opacity(0.55)], startPoint: .top, endPoint: .bottom)
                .frame(width: size * 0.4, height: size * 0.6)
            Image("NudeMark").resizable().scaledToFit().frame(width: size, height: size)
        }.frame(width: size, height: size).accessibilityLabel("Nude")
    }
}

/// Nebula's orb: a slowly turning neon gradient.
struct NebulaOrb: View {
    var size: CGFloat = 30
    @State private var spin = false
    var body: some View {
        Circle().fill(nebulaGradient)
            .overlay(Image(systemName: "sparkle").font(.system(size: size * 0.45, weight: .semibold)).foregroundStyle(.white))
            .rotationEffect(.degrees(spin ? 360 : 0))
            .frame(width: size, height: size)
            .onAppear { withAnimation(.linear(duration: 6).repeatForever(autoreverses: false)) { spin = true } }
    }
}

/// "Rovian" + grey "Defender", as in the brand artwork.
struct RovianWordmark: View {
    var size: CGFloat = 15
    var body: some View {
        HStack(spacing: 6) {
            Image("RovianMark").resizable().scaledToFit().frame(width: size * 1.15, height: size * 1.3)
            (Text("Rovian").fontWeight(.bold) + Text("Defender").fontWeight(.semibold).foregroundColor(Color(red: 0.6, green: 0.63, blue: 0.67))).font(.system(size: size))
        }
    }
}

enum Sheet: String, Identifiable { case tabs, bookmarks, history, settings, security, ai; var id: String { rawValue } }

/// Hosts a tab's WKWebView in SwiftUI.
struct WebViewHost: UIViewRepresentable {
    let tab: Tab
    func makeUIView(context: Context) -> WKWebView {
        let w = tab.ensureWebView()
        w.removeFromSuperview()
        return w
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

// MARK: - Main screen (adapts: bottom bar on iPhone, top toolbar + tab strip on iPad)

struct ContentView: View {
    @EnvironmentObject var model: BrowserModel
    @EnvironmentObject var store: Store
    @EnvironmentObject var accounts: Accounts
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var sheet: Sheet?
    @State private var aiPrompt: (String, Bool)?
    @State private var nebulaOpen = false
    @State private var editing = false
    @State private var address = ""
    @FocusState private var addressFocused: Bool

    private var wide: Bool { sizeClass == .regular }

    var body: some View {
        VStack(spacing: 0) {
            if wide {
                TabStrip(onNew: { model.newTab(); focusAddress() })
                toolbar.padding(.horizontal, 12).padding(.vertical, 8).background(.bar)
            }
            ZStack(alignment: .top) {
                if let tab = model.active { TabContentView(tab: tab, onSearch: focusAddress).id(tab.id) }
                if editing && !suggestions.isEmpty { suggestionList.padding(.horizontal, wide ? 80 : 10).padding(.top, 6) }
            }
            if !wide {
                toolbar.padding(.horizontal, 10).padding(.vertical, 8).background(.bar)
            }
        }
        .background(keyboardShortcuts)
        .sheet(item: $sheet) { s in
            switch s {
            case .tabs: TabsView()
            case .bookmarks: BookmarksView()
            case .history: HistoryView()
            case .settings: SettingsView()
            case .security: SecurityView()
            case .ai: EmptyView()
            }
        }
        .onChange(of: sheet) { s in
            // Nebula isn't a sheet: it floats over the page and grows out of its button.
            if s == .ai { sheet = nil; withAnimation(.spring(response: 0.42, dampingFraction: 0.82)) { nebulaOpen = true } }
        }
        .overlay {
            if nebulaOpen {
                ZStack(alignment: wide ? .topTrailing : .bottomTrailing) {
                    Color.black.opacity(0.25).ignoresSafeArea().onTapGesture { closeNebula() }.transition(.opacity)
                    NebulaPanel(onClose: closeNebula, initialPrompt: aiPrompt?.0, initialShare: aiPrompt?.1 ?? false)
                        .frame(maxWidth: wide ? 760 : .infinity, maxHeight: wide ? 720 : .infinity)
                        .transition(.scale(scale: 0.55, anchor: wide ? .topTrailing : .bottomTrailing).combined(with: .opacity))
                }
            }
        }
        .overlay(alignment: .top) { ToastView() }
        .overlay { if accounts.needsWelcome { WelcomeView().transition(.opacity) } }
        .animation(.easeInOut(duration: 0.3), value: accounts.needsWelcome)
        .alert(item: $model.pendingDownload) { d in
            Alert(title: Text("\(d.filename) may be dangerous"),
                  message: Text(d.notes.joined(separator: "\n\n") + "\n\nNo warning doesn't guarantee a file is safe. Only keep it if you trust where it came from."),
                  primaryButton: .cancel(Text("Don't download")) { d.decide(false) },
                  secondaryButton: .destructive(Text("Download anyway")) { d.decide(true) })
        }
        .alert(item: $model.dialog) { d in
            d.kind == .alert
                ? Alert(title: Text(d.host), message: Text(d.message), dismissButton: .default(Text("OK")) { d.done(true) })
                : Alert(title: Text(d.host), message: Text(d.message), primaryButton: .cancel { d.done(false) }, secondaryButton: .default(Text("OK")) { d.done(true) })
        }
        .onOpenURL { url in if url.scheme == "http" || url.scheme == "https" { model.newTab(url: url.absoluteString) } }
    }

    private func closeNebula() {
        withAnimation(.easeIn(duration: 0.16)) { nebulaOpen = false }
        aiPrompt = nil
    }

    private func focusAddress() {
        address = model.active.map { $0.isHome ? "" : $0.url } ?? ""
        editing = true
        addressFocused = true
    }

    private var suggestions: [(title: String, url: String)] { store.suggestions(address) }

    private var suggestionList: some View {
        VStack(spacing: 0) {
            if !address.isEmpty {
                suggestionRow("magnifyingglass", address, "Search \(store.engine.label)") { submit("?\(address)") }
            }
            ForEach(suggestions, id: \.url) { s in suggestionRow("clock", s.title, Omnibox.display(s.url)) { model.active?.load(s.url); endEditing() } }
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .shadow(color: .black.opacity(0.12), radius: 20, y: 8)
    }

    private func suggestionRow(_ icon: String, _ title: String, _ detail: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon).foregroundStyle(.secondary).frame(width: 20)
                VStack(alignment: .leading) {
                    Text(title).lineLimit(1)
                    Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
            }.padding(.horizontal, 16).padding(.vertical, 10).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

    private func submit(_ text: String) {
        model.navigate(text)
        endEditing()
    }

    private func endEditing() {
        editing = false
        addressFocused = false
    }

    // MARK: toolbar

    private var toolbar: some View {
        HStack(spacing: wide ? 10 : 6) {
            if wide { navButtons }
            addressBar
            if !editing {
                Button { sheet = .ai } label: { NebulaOrb(size: 30) }.accessibilityLabel("Nebula")
                if !wide {
                    Button { sheet = .tabs } label: { tabCount }.accessibilityLabel("Tabs")
                } else {
                    Button { sheet = .tabs } label: { Image(systemName: "square.on.square") }.accessibilityLabel("Tab overview")
                }
                menu
            } else {
                Button("Cancel") { endEditing() }
            }
        }
        .font(.system(size: 18))
    }

    @ViewBuilder private var navButtons: some View {
        let t = model.active
        Button { t?.webView?.goBack() } label: { Image(systemName: "chevron.backward") }.disabled(!(t?.canGoBack ?? false))
        Button { t?.webView?.goForward() } label: { Image(systemName: "chevron.forward") }.disabled(!(t?.canGoForward ?? false))
        Button { if t?.isLoading == true { t?.webView?.stopLoading() } else { t?.reload() } } label: { Image(systemName: t?.isLoading == true ? "xmark" : "arrow.clockwise") }
            .disabled(t?.isHome ?? true)
    }

    private var tabCount: some View {
        Text("\(model.tabs.count)").font(.system(size: 12, weight: .bold))
            .frame(width: 24, height: 24)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(lineWidth: 1.8))
    }

    private var addressBar: some View {
        let t = model.active
        return HStack(spacing: 8) {
            Image(systemName: siteIcon(t)).foregroundStyle(t?.blocked != nil ? Color.red : Color.secondary).font(.system(size: 14))
                .onTapGesture { sheet = .security }
            if editing {
                TextField("Search or enter address", text: $address)
                    .focused($addressFocused)
                    .keyboardType(.webSearch).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .submitLabel(.go).onSubmit { submit(address) }
                if !address.isEmpty { Button { address = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) } }
            } else {
                Text(addressText(t)).lineLimit(1).truncationMode(.middle).frame(maxWidth: .infinity, alignment: wide ? .leading : .center)
                    .foregroundStyle(t?.isHome ?? true ? .secondary : .primary)
                    .contentShape(Rectangle()).onTapGesture { focusAddress() }
                if let t, !t.isHome, !wide {
                    Button { if t.isLoading { t.webView?.stopLoading() } else { t.reload() } } label: { Image(systemName: t.isLoading ? "xmark" : "arrow.clockwise").font(.system(size: 14)) }
                }
            }
        }
        .font(.system(size: 16))
        .padding(.horizontal, 14).frame(height: 44)
        .background((t?.isPrivate ?? false) ? AnyShapeStyle(nudeViolet.opacity(0.18)) : AnyShapeStyle(Color(.secondarySystemBackground)), in: Capsule())
        .overlay(alignment: .bottom) {
            if let t, t.isLoading, t.progress < 1 {
                GeometryReader { g in Capsule().fill(Color.accentColor).frame(width: g.size.width * t.progress, height: 2) }.frame(height: 2).padding(.horizontal, 20)
            }
        }
    }

    private func addressText(_ t: Tab?) -> String {
        guard let t, !t.isHome else { return (t?.isPrivate ?? false) ? "Search privately" : "Search or enter address" }
        return Omnibox.display(t.url)
    }

    private func siteIcon(_ t: Tab?) -> String {
        guard let t else { return "magnifyingglass" }
        if t.blocked != nil { return "exclamationmark.shield.fill" }
        if t.isHome { return t.isPrivate ? "eyeglasses" : "magnifyingglass" }
        return t.url.hasPrefix("https://") ? "lock.fill" : "exclamationmark.triangle"
    }

    private var menu: some View {
        let t = model.active
        let web = t.map { !$0.isHome && $0.url.hasPrefix("http") } ?? false
        return Menu {
            if !wide {
                Button { t?.webView?.goBack() } label: { Label("Back", systemImage: "chevron.backward") }.disabled(!(t?.canGoBack ?? false))
                Button { t?.webView?.goForward() } label: { Label("Forward", systemImage: "chevron.forward") }.disabled(!(t?.canGoForward ?? false))
            }
            Button { model.newTab(); focusAddress() } label: { Label("New Tab", systemImage: "plus") }
            Button { model.newTab(isPrivate: true); focusAddress() } label: { Label("New Private Tab", systemImage: "eyeglasses") }
            Divider()
            if let t, web {
                Button { let added = store.toggleBookmark(url: t.url, title: t.title); model.toast = added ? "Bookmark added" : "Bookmark removed" } label: {
                    Label(store.isBookmarked(t.url) ? "Remove Bookmark" : "Add Bookmark", systemImage: store.isBookmarked(t.url) ? "star.slash" : "star")
                }
                ShareLink(item: URL(string: t.url)!) { Label("Share", systemImage: "square.and.arrow.up") }
                Button { t.webView?.findInteraction?.presentFindNavigator(showingReplace: false) } label: { Label("Find on Page", systemImage: "text.magnifyingglass") }
                Button { aiPrompt = ("Summarise this page in five points", true); sheet = .ai } label: { Label("Summarise with Nebula", systemImage: "sparkles") }
                Button {
                    store.desktopMode.toggle()
                    t.reload()
                } label: { Label(store.desktopMode ? "Request Mobile Website" : "Request Desktop Website", systemImage: store.desktopMode ? "iphone" : "desktopcomputer") }
                Divider()
            }
            Button { sheet = .bookmarks } label: { Label("Bookmarks", systemImage: "book") }
            Button { sheet = .history } label: { Label("History", systemImage: "clock") }
            Button { sheet = .security } label: { Label("Rovian Defender", systemImage: "shield.lefthalf.filled") }
            Button { sheet = .settings } label: { Label("Settings", systemImage: "gear") }
            Divider()
            if let a = accounts.current {
                Button { accounts.signOut() } label: { Label("Sign out \(a.firstName)", systemImage: "person.crop.circle.badge.xmark") }
            } else {
                Button { accounts.needsWelcome = true } label: { Label("Sign in to Nude", systemImage: "person.crop.circle") }
            }
        } label: { Image(systemName: "ellipsis.circle") }
    }

    /// Hardware-keyboard shortcuts (iPad, and iPhone with a keyboard).
    private var keyboardShortcuts: some View {
        ZStack {
        Group {
            Button("") { model.newTab(); focusAddress() }.keyboardShortcut("t", modifiers: .command)
            Button("") { model.newTab(isPrivate: true); focusAddress() }.keyboardShortcut("n", modifiers: [.command, .shift])
            Button("") { if let t = model.active { model.close(t) } }.keyboardShortcut("w", modifiers: .command)
            Button("") { focusAddress() }.keyboardShortcut("l", modifiers: .command)
            Button("") { model.active?.reload() }.keyboardShortcut("r", modifiers: .command)
            Button("") { model.active?.webView?.goBack() }.keyboardShortcut("[", modifiers: .command)
            Button("") { model.active?.webView?.goForward() }.keyboardShortcut("]", modifiers: .command)
            Button("") { model.active?.webView?.findInteraction?.presentFindNavigator(showingReplace: false) }.keyboardShortcut("f", modifiers: .command)
        }
        Group {
            Button("") { if let t = model.active, t.url.hasPrefix("http") { store.toggleBookmark(url: t.url, title: t.title) } }.keyboardShortcut("d", modifiers: .command)
            Button("") { sheet = .history }.keyboardShortcut("y", modifiers: .command)
            Button("") { sheet = .ai }.keyboardShortcut("a", modifiers: [.command, .shift])
            Button("") { selectTab(offset: 1) }.keyboardShortcut("]", modifiers: [.command, .shift])
            Button("") { selectTab(offset: -1) }.keyboardShortcut("[", modifiers: [.command, .shift])
        }
        }
        .frame(width: 0, height: 0).opacity(0).accessibilityHidden(true)
    }

    private func selectTab(offset: Int) {
        guard let i = model.tabs.firstIndex(where: { $0.id == model.activeID }), !model.tabs.isEmpty else { return }
        model.activate(model.tabs[(i + offset + model.tabs.count) % model.tabs.count])
    }
}

/// iPad tab strip.
struct TabStrip: View {
    @EnvironmentObject var model: BrowserModel
    let onNew: () -> Void
    var body: some View {
        HStack(spacing: 4) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(model.tabs) { t in TabChip(tab: t, active: t.id == model.activeID) }
                }.padding(.horizontal, 10)
            }
            Button(action: onNew) { Image(systemName: "plus").padding(10) }.accessibilityLabel("New tab")
        }
        .frame(height: 42)
        .background(Color(.systemGroupedBackground))
    }
}

struct TabChip: View {
    @EnvironmentObject var model: BrowserModel
    @ObservedObject var tab: Tab
    let active: Bool
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: tab.isPrivate ? "eyeglasses" : tab.blocked != nil ? "exclamationmark.shield" : "globe").font(.system(size: 12)).foregroundStyle(.secondary)
            Text(tab.isHome ? "New Tab" : tab.title).font(.system(size: 13)).lineLimit(1)
            Spacer(minLength: 0)
            Button { model.close(tab) } label: { Image(systemName: "xmark").font(.system(size: 10, weight: .bold)) }.buttonStyle(.plain).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 12).frame(width: 190, height: 32)
        .background(active ? AnyShapeStyle(Color(.systemBackground)) : AnyShapeStyle(Color.clear), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .shadow(color: .black.opacity(active ? 0.08 : 0), radius: 3, y: 1)
        .contentShape(Rectangle())
        .onTapGesture { model.activate(tab) }
        .contextMenu {
            Button("Close Tab", role: .destructive) { model.close(tab) }
            Button("Close Other Tabs") { model.tabs.filter { $0 !== tab }.forEach { model.close($0) } }
        }
    }
}

// MARK: - Tab content

struct TabContentView: View {
    @EnvironmentObject var model: BrowserModel
    @ObservedObject var tab: Tab
    let onSearch: () -> Void
    var body: some View {
        Group {
            if let v = tab.blocked { BlockedView(tab: tab, verdict: v) }
            else if tab.isHome { HomeView(tab: tab, onSearch: onSearch) }
            else {
                ZStack {
                    WebViewHost(tab: tab).ignoresSafeArea(.container, edges: .bottom)
                    if let e = tab.error { ErrorView(message: e) { tab.reload() } }
                }
            }
        }
    }
}

struct ErrorView: View {
    let message: String
    let retry: () -> Void
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "wifi.exclamationmark").font(.system(size: 44)).foregroundStyle(nudeClay)
            Text("This page couldn't load").font(.title2.weight(.semibold))
            Text(message).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("Try again", action: retry).buttonStyle(.borderedProminent).buttonBorderShape(.capsule)
        }.padding(32).frame(maxWidth: .infinity, maxHeight: .infinity).background(Color(.systemBackground))
    }
}

/// Cream backdrop with slowly drifting orange/peach light (the Nude home gradient).
struct PeachBackdrop: View {
    var dark: Bool
    var isPrivate: Bool
    @State private var drift = false
    var body: some View {
        let c: [Color] = isPrivate ? [Color(red: 0.48, green: 0.36, blue: 1), nudeViolet, Color(red: 0.24, green: 0.16, blue: 0.48)]
            : [Color(red: 1, green: 0.54, blue: 0.24), Color(red: 1, green: 0.69, blue: 0.48), Color(red: 0.9, green: 0.33, blue: 0.24)]
        GeometryReader { g in
            let w = g.size.width, h = g.size.height
            ZStack {
                (dark || isPrivate ? Color(red: 0.08, green: 0.07, blue: 0.1) : nudeCream)
                Circle().fill(RadialGradient(colors: [c[0].opacity(0.55), .clear], center: .center, startRadius: 0, endRadius: w * 0.6))
                    .frame(width: w * 1.2, height: w * 1.2).position(x: w * (drift ? 0.4 : 0.22), y: h * (drift ? 0.22 : 0.3))
                Circle().fill(RadialGradient(colors: [c[1].opacity(0.5), .clear], center: .center, startRadius: 0, endRadius: w * 0.55))
                    .frame(width: w * 1.1, height: w * 1.1).position(x: w * (drift ? 0.65 : 0.88), y: h * (drift ? 0.62 : 0.52))
                Circle().fill(RadialGradient(colors: [c[2].opacity(0.35), .clear], center: .center, startRadius: 0, endRadius: w * 0.5))
                    .frame(width: w, height: w).position(x: w * (drift ? 0.55 : 0.42), y: h * (drift ? 0.82 : 0.9))
            }
        }
        .ignoresSafeArea()
        .onAppear { withAnimation(.easeInOut(duration: 14).repeatForever(autoreverses: true)) { drift = true } }
    }
}

struct HomeView: View {
    @EnvironmentObject var model: BrowserModel
    @EnvironmentObject var store: Store
    @EnvironmentObject var accounts: Accounts
    @Environment(\.colorScheme) private var scheme
    @ObservedObject var tab: Tab
    let onSearch: () -> Void
    private let defaults: [(String, String)] = [("Wikipedia", "https://www.wikipedia.org/"), ("GitHub", "https://github.com/"), ("News24", "https://www.news24.com/"), ("YouTube", "https://m.youtube.com/")]

    private var shortcuts: [(String, String)] {
        var seen = Set<String>()
        return (store.bookmarks.prefix(8).map { ($0.title, $0.url) } + defaults).filter { seen.insert($0.1).inserted }.prefix(8).map { $0 }
    }
    private var darkLook: Bool { scheme == .dark || tab.isPrivate }
    private var ink: Color { darkLook ? Color(red: 0.96, green: 0.94, blue: 0.97) : Color(red: 0.09, green: 0.08, blue: 0.1) }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                Spacer(minLength: 50)
                NudeMark(size: 68)
                Group {
                    if tab.isPrivate { Text("Private browsing") }
                    else if let a = accounts.current { Text("Hello, ") + Text(a.firstName).foregroundColor(nudeClay) }
                    else { Text("Hello there") }
                }
                .font(.system(size: 40, weight: .heavy)).foregroundStyle(ink).multilineTextAlignment(.center)
                if !tab.isPrivate && accounts.current == nil {
                    Button("Sign in to Nude") { accounts.needsWelcome = true }.font(.subheadline.weight(.semibold)).foregroundStyle(nudeClay)
                }
                Text(tab.isPrivate ? "Nothing from this tab is kept" : "What would you like to explore today?").foregroundStyle(ink.opacity(0.62))
                Button(action: onSearch) {
                    HStack(spacing: 12) {
                        Image(systemName: "magnifyingglass").foregroundStyle(nudeClay)
                        Text("Search \(store.engine.label) or type an address").lineLimit(1).foregroundStyle(ink.opacity(0.6))
                        Spacer()
                        Image(systemName: "arrow.right").font(.body.weight(.semibold)).foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(LinearGradient(colors: [nudeClay, Color(red: 0.9, green: 0.33, blue: 0.24)], startPoint: .leading, endPoint: .trailing), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .padding(.leading, 20).padding(.trailing, 6).frame(height: 56).frame(maxWidth: 620)
                    .background(.ultraThinMaterial, in: Capsule())
                    .overlay(Capsule().stroke(nudeClay.opacity(0.25)))
                }.buttonStyle(.plain)
                if tab.isPrivate {
                    Text("Nude won't save your history, cookies or site data from private tabs after you close them. Downloads and bookmarks are kept. Your internet provider and the sites you visit can still see your activity.")
                        .font(.footnote).foregroundStyle(ink.opacity(0.62)).multilineTextAlignment(.center).frame(maxWidth: 520)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 76))], spacing: 16) {
                        ForEach(shortcuts, id: \.1) { s in
                            Button { tab.load(s.1) } label: {
                                VStack(spacing: 6) {
                                    Text(String(Omnibox.host(s.1).prefix(1)).uppercased()).font(.title3.weight(.bold)).foregroundStyle(nudeClay)
                                        .frame(width: 54, height: 54).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                                    Text(s.0).font(.caption).lineLimit(1).foregroundStyle(ink)
                                }
                            }.buttonStyle(.plain)
                        }
                    }.frame(maxWidth: 620)
                    if !store.history.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Jump back in").font(.headline).foregroundStyle(ink.opacity(0.62))
                            ForEach(store.history.prefix(5)) { h in
                                Button { tab.load(h.url) } label: {
                                    HStack { Image(systemName: "clock").foregroundStyle(ink.opacity(0.5)); VStack(alignment: .leading) { Text(h.title).lineLimit(1).foregroundStyle(ink); Text(Omnibox.host(h.url)).font(.caption).foregroundStyle(ink.opacity(0.55)) }; Spacer() }
                                        .padding(.vertical, 6).contentShape(Rectangle())
                                }.buttonStyle(.plain)
                            }
                        }.frame(maxWidth: 620)
                    }
                }
                HStack(spacing: 4) {
                    RovianWordmark(size: 12)
                    Text("has blocked \(store.blockedSites) dangerous sites and \(store.blockedDownloads) downloads").font(.caption).foregroundStyle(ink.opacity(0.6))
                }.padding(.top, 8)
            }.padding(.horizontal, 22).frame(maxWidth: .infinity)
        }
        .background(PeachBackdrop(dark: scheme == .dark, isPrivate: tab.isPrivate))
    }
}

/// First run and "Sign in": a local Nude account (stored on this device, password hashed).
struct WelcomeView: View {
    @EnvironmentObject var accounts: Accounts
    @State private var signIn = false
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var slide = false
    private let words = ["A NEW GENERATION", "PRIVATE BY DESIGN", "MEET NEBULA", "ROVIAN DEFENDER", "MADE FOR YOU"]

    var body: some View {
        ZStack {
            Color(red: 0.05, green: 0.04, blue: 0.06).ignoresSafeArea()
            // Kinetic outlined type sliding across, from the Nude motion design.
            VStack(spacing: 0) {
                ForEach(Array(words.enumerated()), id: \.offset) { i, w in
                    Text("\(w) · \(w) · \(w)").font(.system(size: 64, weight: .black)).lineLimit(1).fixedSize()
                        .foregroundStyle(.white.opacity(0.05))
                        .offset(x: CGFloat(i % 2 == 0 ? -1 : 1) * (slide ? 500 : -500))
                        .frame(maxHeight: .infinity)
                }
            }.ignoresSafeArea().allowsHitTesting(false)
            RadialGradient(colors: [nudeViolet.opacity(0.45), .clear], center: UnitPoint(x: 0.3, y: 0.8), startRadius: 0, endRadius: 420).ignoresSafeArea()
            RadialGradient(colors: [nudeClay.opacity(0.35), .clear], center: UnitPoint(x: 0.8, y: 0.15), startRadius: 0, endRadius: 360).ignoresSafeArea()
            ScrollView {
                VStack(spacing: 12) {
                    NudeMark(size: 64)
                    Text(signIn ? "Welcome back" : "Welcome to Nude").font(.system(size: 28, weight: .heavy)).foregroundStyle(.white)
                    Text(signIn ? "Sign in to pick up where you left off." : "Create your Nude account so your browser knows you.").font(.subheadline).foregroundStyle(.white.opacity(0.7)).multilineTextAlignment(.center)
                    if !signIn { field("Your name", text: $name).textContentType(.name) }
                    field("Email", text: $email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("", text: $password, prompt: Text(signIn ? "Password" : "Password (at least 8 characters)").foregroundColor(.white.opacity(0.45)))
                        .textContentType(signIn ? .password : .newPassword).modifier(WelcomeFieldStyle())
                    if let error { Text(error).font(.footnote).foregroundStyle(Color(red: 1, green: 0.54, blue: 0.5)) }
                    Button {
                        error = signIn ? accounts.signIn(email: email, password: password) : accounts.signUp(name: name, email: email, password: password)
                    } label: {
                        Text(signIn ? "Sign in" : "Create account").fontWeight(.bold).foregroundStyle(.white).frame(maxWidth: .infinity).frame(height: 52)
                            .background(LinearGradient(colors: [nudeClay, Color(red: 0.9, green: 0.33, blue: 0.24)], startPoint: .leading, endPoint: .trailing), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    Button(signIn ? "New here? Create an account" : "Already have an account? Sign in") { signIn.toggle(); error = nil }.foregroundStyle(.white.opacity(0.85))
                    Button("Continue without an account") { accounts.continueAsGuest() }.foregroundStyle(.white.opacity(0.6))
                    Text("Your account is stored securely on this device — your password is never saved in plain text.").font(.caption2).foregroundStyle(.white.opacity(0.45)).multilineTextAlignment(.center)
                }
                .padding(24)
                .background(Color(red: 0.11, green: 0.09, blue: 0.13).opacity(0.86), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).stroke(.white.opacity(0.08)))
                .frame(maxWidth: 440).padding(22).frame(maxWidth: .infinity)
                .padding(.top, 60)
            }
        }
        .onAppear {
            signIn = !accounts.known.isEmpty
            email = accounts.known.first?.email ?? ""
            withAnimation(.linear(duration: 22).repeatForever(autoreverses: true)) { slide = true }
        }
    }

    private func field(_ placeholder: String, text: Binding<String>) -> some View {
        TextField("", text: text, prompt: Text(placeholder).foregroundColor(.white.opacity(0.45))).modifier(WelcomeFieldStyle())
    }
}

struct WelcomeFieldStyle: ViewModifier {
    func body(content: Content) -> some View {
        content.foregroundStyle(.white).padding(.horizontal, 14).frame(height: 48)
            .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(.white.opacity(0.14)))
    }
}

/// Rovian Defender's warning page (red shield design).
struct BlockedView: View {
    @EnvironmentObject var model: BrowserModel
    @EnvironmentObject var store: Store
    @ObservedObject var tab: Tab
    let verdict: SecurityVerdict
    @State private var confirming = false
    @State private var why = false
    private let ink = Color(red: 0.04, green: 0.04, blue: 0.06)
    private let grey = Color(red: 0.33, green: 0.31, blue: 0.36)

    var body: some View {
        let info = Security.categoryInfo[verdict.category ?? "suspicious"] ?? Security.categoryInfo["suspicious"]!
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Image("RovianBlock").resizable().scaledToFit().frame(width: 200).offset(x: -60).padding(.top, 20)
                    .shadow(color: rovianRed.opacity(0.18), radius: 40)
                (Text("This Website is ") + Text("Not Protected").foregroundColor(rovianRed) + Text("."))
                    .font(.system(size: 38, weight: .black)).foregroundStyle(ink)
                Text("Proceeding could cost you your information.").font(.title3.weight(.bold)).foregroundStyle(ink)
                Text("\(info.title) — \(verdict.confirmed ? "on a known-threat list." : "suspected from warning signs, not confirmed.")").font(.subheadline).foregroundStyle(grey)
                Button { model.backToSafety(tab) } label: {
                    Label("Back to safety", systemImage: "chevron.left").fontWeight(.bold).frame(maxWidth: .infinity).frame(height: 50)
                        .foregroundStyle(.white).background(ink, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                if let site = verdict.intendedSite {
                    Button { tab.blocked = nil; tab.load(site) } label: {
                        Text("Go to \(Omnibox.host(site)) instead").fontWeight(.semibold).frame(maxWidth: .infinity).frame(height: 50)
                            .foregroundStyle(ink).background(Color(red: 0.95, green: 0.95, blue: 0.96), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                }
                if !(verdict.confirmed && store.level == .maximum) {
                    if !confirming {
                        Button { withAnimation { confirming = true } } label: {
                            (Text("Continue to \(verdict.host) ") + Text("UNSAFE").foregroundColor(rovianRed).fontWeight(.bold)).font(.title3).foregroundStyle(ink)
                        }.buttonStyle(.plain).padding(.vertical, 6)
                    } else {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("This site may steal your passwords, payment details or other information, or harm your device.").font(.subheadline).foregroundStyle(ink)
                            HStack {
                                Button("I understand — continue", role: .destructive) { model.continueAnyway(tab) }.buttonStyle(.borderedProminent).tint(rovianRed)
                                Button("Cancel") { withAnimation { confirming = false } }.foregroundStyle(ink)
                            }
                        }.padding().background(rovianRed.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(rovianRed.opacity(0.3)))
                    }
                } else {
                    Text("This site is a confirmed threat, and Maximum Protection doesn't allow continuing.").font(.footnote).foregroundStyle(grey)
                }
                DisclosureGroup(isExpanded: $why) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(info.explanation)
                        ForEach(verdict.signals, id: \.self) { s in Text("• \(s.message)") }
                        Text("What to do: \(info.advice)").foregroundStyle(ink)
                    }.font(.subheadline).foregroundStyle(grey).padding(.top, 6)
                } label: { Text("Why Rovian Defender stopped this site").font(.subheadline.weight(.semibold)).foregroundStyle(ink) }
                .tint(ink)
                RovianWordmark(size: 15).padding(.top, 16)
            }.padding(24).frame(maxWidth: 640)
        }
        .frame(maxWidth: .infinity)
        .background(Color.white.ignoresSafeArea())
        .environment(\.colorScheme, .light)
    }
}

struct ToastView: View {
    @EnvironmentObject var model: BrowserModel
    var body: some View {
        if let t = model.toast {
            Text(t).font(.subheadline.weight(.medium)).padding(.horizontal, 16).padding(.vertical, 10)
                .background(.thickMaterial, in: Capsule()).shadow(radius: 8).padding(.top, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
                .task(id: t) { try? await Task.sleep(nanoseconds: 2_600_000_000); withAnimation { model.toast = nil } }
        }
    }
}

// MARK: - Sheets

struct TabsView: View {
    @EnvironmentObject var model: BrowserModel
    @Environment(\.dismiss) private var dismiss
    @State private var shown = false
    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 14)], spacing: 14) {
                    // Cards rise in one after another; closing one lets the rest glide into place.
                    ForEach(Array(model.tabs.enumerated()), id: \.element.id) { i, t in
                        TabCard(tab: t, active: t.id == model.activeID) { model.activate(t); dismiss() }
                            .opacity(shown ? 1 : 0).offset(y: shown ? 0 : 18).scaleEffect(shown ? 1 : 0.96)
                            .animation(.spring(response: 0.42, dampingFraction: 0.84).delay(Double(min(i, 12)) * 0.03), value: shown)
                            .transition(.scale(scale: 0.9).combined(with: .opacity))
                    }
                }.padding().animation(.spring(response: 0.35, dampingFraction: 0.85), value: model.tabs.count)
            }
            .onAppear { shown = true }
            .navigationTitle("\(model.tabs.count) Tabs").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItemGroup(placement: .bottomBar) {
                    Button { model.newTab(isPrivate: true); dismiss() } label: { Label("Private", systemImage: "eyeglasses") }
                    Spacer()
                    Button { model.newTab(); dismiss() } label: { Label("New Tab", systemImage: "plus") }
                }
            }
        }
        .onAppear { model.active?.snapshot() }
    }
}

struct TabCard: View {
    @EnvironmentObject var model: BrowserModel
    @ObservedObject var tab: Tab
    let active: Bool
    let open: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack {
                Rectangle().fill(tab.isPrivate ? AnyShapeStyle(nudeViolet.opacity(0.2)) : AnyShapeStyle(Color(.secondarySystemBackground)))
                if let img = tab.thumbnail { Image(uiImage: img).resizable().scaledToFill() } else { Image(systemName: tab.isPrivate ? "eyeglasses" : "globe").font(.largeTitle).foregroundStyle(.secondary) }
            }.frame(height: 150).clipped()
            HStack {
                Text(tab.isHome ? "New Tab" : tab.title).font(.caption.weight(.medium)).lineLimit(1)
                Spacer()
                Button { model.close(tab) } label: { Image(systemName: "xmark.circle.fill") }.foregroundStyle(.secondary)
            }.padding(10)
        }
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(active ? Color.accentColor : Color.secondary.opacity(0.2), lineWidth: active ? 2.5 : 1))
        .onTapGesture(perform: open)
    }
}

struct BookmarksView: View {
    @EnvironmentObject var model: BrowserModel
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                if store.bookmarks.isEmpty { Text("No bookmarks yet. Use ⋯ → Add Bookmark.").foregroundStyle(.secondary) }
                ForEach(store.bookmarks) { b in
                    Button { model.active?.load(b.url); dismiss() } label: { VStack(alignment: .leading) { Text(b.title).lineLimit(1); Text(Omnibox.host(b.url)).font(.caption).foregroundStyle(.secondary) } }
                }.onDelete { idx in idx.map { store.bookmarks[$0].url }.forEach(store.removeBookmark) }
            }
            .navigationTitle("Bookmarks").toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

struct HistoryView: View {
    @EnvironmentObject var model: BrowserModel
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    var body: some View {
        NavigationStack {
            List {
                let items = store.history.filter { query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) || $0.url.localizedCaseInsensitiveContains(query) }
                if items.isEmpty { Text(query.isEmpty ? "No history yet. Private tabs are never saved." : "No matches").foregroundStyle(.secondary) }
                ForEach(items) { h in
                    Button { model.active?.load(h.url); dismiss() } label: {
                        VStack(alignment: .leading) {
                            Text(h.title).lineLimit(1)
                            Text("\(Omnibox.host(h.url)) · \(h.lastVisit.formatted(.relative(presentation: .named)))").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }.onDelete { idx in idx.map { items[$0].url }.forEach(store.removeHistory) }
            }
            .searchable(text: $query)
            .navigationTitle("History")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .destructiveAction) { Button("Clear", role: .destructive) { store.clearHistory() } }
            }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                Section("Search engine") {
                    Picker("Search engine", selection: $store.engine) { ForEach(SearchEngine.allCases) { Text($0.label).tag($0) } }.pickerStyle(.inline).labelsHidden()
                }
                Section {
                    ForEach(ProtectionLevel.allCases) { l in
                        Button { store.level = l } label: {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(l.name).font(.headline).foregroundStyle(.primary)
                                    Text(l.summary).font(.subheadline).foregroundStyle(.secondary)
                                    Text("Trade-off: \(l.tradeoff)").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if store.level == l { Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.accentColor) }
                            }
                        }
                    }
                } header: { Text("Rovian Defender") } footer: { Text("Tracker blocking uses WebKit content rules. Safari-style fraudulent-website warnings stay on in every level.") }
                Section("Appearance") {
                    Picker("Theme", selection: $store.theme) { Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark") }.pickerStyle(.segmented)
                }
                Section {
                    TextField("Nebula gateway (https://…)", text: $store.aiGateway).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Nude Search server (https://…)", text: $store.searchServer).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Access token (optional)", text: $store.serviceToken)
                } header: { Text("Nude services") } footer: { Text("API keys stay on the server, never in the app.") }
                Section("About") {
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
                    LabeledContent("Engine", value: "WebKit")
                }
            }
            .navigationTitle("Settings").toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

struct SecurityView: View {
    @EnvironmentObject var model: BrowserModel
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var check = ""
    @State private var result: SecurityVerdict?
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label("Protection is on", systemImage: "checkmark.shield.fill").foregroundStyle(.green).font(.headline)
                    Text(store.level.name).font(.title3.weight(.semibold))
                    Text("\(store.blockedSites) dangerous sites · \(store.blockedDownloads) downloads blocked").font(.subheadline).foregroundStyle(.secondary)
                }
                if let t = model.active, t.url.hasPrefix("http") {
                    let v = Security.analyze(t.url, level: store.level)
                    Section("This page: \(Omnibox.host(t.url))") {
                        Label(t.url.hasPrefix("https") ? "Connection is encrypted" : "Connection is NOT encrypted — don't enter passwords or card details",
                              systemImage: t.url.hasPrefix("https") ? "lock.fill" : "lock.open")
                        if v.action == .allow { Text("No known threats. That isn't a guarantee — stay alert.").foregroundStyle(.secondary) }
                        ForEach(v.signals, id: \.self) { Text($0.message).foregroundStyle(.orange) }
                    }
                }
                Section("Check a link") {
                    HStack {
                        TextField("Paste a link", text: $check).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                        Button("Check") { result = Security.analyze(check.hasPrefix("http") ? check : "https://\(check)", level: .enhanced) }
                    }
                    if let r = result {
                        Text(r.action == .allow ? "No warning signs found (not a guarantee)." : r.confirmed ? "Known dangerous site." : "Suspicious: " + r.signals.map(\.message).joined(separator: " "))
                            .foregroundStyle(r.action == .allow ? .green : .red)
                    }
                }
                Section("Recent security events") {
                    if store.events.isEmpty { Text("All quiet — Rovian Defender hasn't had to step in yet.").foregroundStyle(.secondary) }
                    ForEach(store.events.prefix(50)) { e in
                        VStack(alignment: .leading) {
                            Text(e.type.replacingOccurrences(of: "-", with: " ").capitalized).font(.subheadline.weight(.semibold))
                            Text(e.detail).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("Rovian Defender").toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
