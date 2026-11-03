import Foundation

struct Bookmark: Codable, Identifiable, Hashable { var id: String { url }; let url: String; var title: String; let created: Date }
struct HistoryEntry: Codable, Identifiable, Hashable { var id: String { url }; let url: String; var title: String; var lastVisit: Date; var visits: Int }
struct SecurityEvent: Codable, Identifiable, Hashable { var id: Date { time }; let time: Date; let type: String; let detail: String; let url: String? }

/// Persistent profile (UserDefaults + JSON). Private tabs never write history here.
@MainActor
final class Store: ObservableObject {
    private let d = UserDefaults.standard

    @Published var engine: SearchEngine { didSet { d.set(engine.rawValue, forKey: "engine") } }
    @Published var level: ProtectionLevel { didSet { d.set(level.rawValue, forKey: "level") } }
    @Published var theme: String { didSet { d.set(theme, forKey: "theme") } }
    @Published var aiGateway: String { didSet { d.set(aiGateway.trimmingCharacters(in: .whitespaces), forKey: "aiGateway") } }
    @Published var searchServer: String { didSet { d.set(searchServer.trimmingCharacters(in: .whitespaces), forKey: "searchServer") } }
    @Published var serviceToken: String { didSet { d.set(serviceToken, forKey: "serviceToken") } }
    @Published var desktopMode: Bool { didSet { d.set(desktopMode, forKey: "desktopMode") } }
    /// Nebula's mode (everyday, shopping, research, study, focus) and answer speed (auto, fast, thorough).
    @Published var mode: String { didSet { d.set(mode, forKey: "mode") } }
    @Published var nebulaSpeed: String { didSet { d.set(nebulaSpeed, forKey: "nebulaSpeed") } }
    @Published private(set) var bookmarks: [Bookmark] = []
    @Published private(set) var history: [HistoryEntry] = []
    @Published private(set) var events: [SecurityEvent] = []
    @Published var blockedSites: Int { didSet { d.set(blockedSites, forKey: "blockedSites") } }
    @Published var blockedDownloads: Int { didSet { d.set(blockedDownloads, forKey: "blockedDownloads") } }
    @Published var trusted: Set<String> { didSet { d.set(Array(trusted), forKey: "trusted"); Security.trusted = trusted } }

    init() {
        engine = SearchEngine(rawValue: d.string(forKey: "engine") ?? "") ?? .duckduckgo
        level = ProtectionLevel(rawValue: d.string(forKey: "level") ?? "") ?? .standard
        theme = d.string(forKey: "theme") ?? "system"
        aiGateway = d.string(forKey: "aiGateway") ?? ""
        searchServer = d.string(forKey: "searchServer") ?? ""
        serviceToken = d.string(forKey: "serviceToken") ?? ""
        desktopMode = d.bool(forKey: "desktopMode")
        mode = d.string(forKey: "mode") ?? "everyday"
        nebulaSpeed = d.string(forKey: "nebulaSpeed") ?? "auto"
        blockedSites = d.integer(forKey: "blockedSites")
        blockedDownloads = d.integer(forKey: "blockedDownloads")
        trusted = Set(d.stringArray(forKey: "trusted") ?? [])
        bookmarks = load("bookmarks") ?? []
        history = load("history") ?? []
        events = load("events") ?? []
        Security.trusted = trusted
    }

    private func load<T: Decodable>(_ key: String) -> T? {
        guard let data = d.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
    private func save<T: Encodable>(_ key: String, _ value: T) {
        if let data = try? JSONEncoder().encode(value) { d.set(data, forKey: key) }
    }

    func isBookmarked(_ url: String) -> Bool { bookmarks.contains { $0.url == url } }
    @discardableResult func toggleBookmark(url: String, title: String) -> Bool {
        if let i = bookmarks.firstIndex(where: { $0.url == url }) { bookmarks.remove(at: i); save("bookmarks", bookmarks); return false }
        bookmarks.append(Bookmark(url: url, title: title.isEmpty ? url : title, created: Date()))
        save("bookmarks", bookmarks)
        return true
    }
    func removeBookmark(_ url: String) { bookmarks.removeAll { $0.url == url }; save("bookmarks", bookmarks) }

    func recordVisit(url: String, title: String) {
        guard url.hasPrefix("http") else { return }
        let prev = history.first { $0.url == url }
        history.removeAll { $0.url == url }
        history.insert(HistoryEntry(url: url, title: title.isEmpty ? (prev?.title ?? url) : title, lastVisit: Date(), visits: (prev?.visits ?? 0) + 1), at: 0)
        if history.count > 3000 { history.removeLast(history.count - 3000) }
        save("history", history)
    }
    func updateTitle(url: String, title: String) {
        guard let i = history.firstIndex(where: { $0.url == url }), history[i].title != title, !title.isEmpty else { return }
        history[i].title = title
        save("history", history)
    }
    func removeHistory(_ url: String) { history.removeAll { $0.url == url }; save("history", history) }
    func clearHistory() { history = []; save("history", history) }

    func logEvent(_ type: String, _ detail: String, url: String?) {
        events.insert(SecurityEvent(time: Date(), type: type, detail: detail, url: url), at: 0)
        if events.count > 200 { events.removeLast(events.count - 200) }
        save("events", events)
    }

    var savedTabs: [String] {
        get { d.stringArray(forKey: "tabs") ?? [] }
        set { d.set(newValue, forKey: "tabs") }
    }

    func suggestions(_ q: String, limit: Int = 6) -> [(title: String, url: String)] {
        let s = q.lowercased().trimmingCharacters(in: .whitespaces)
        guard !s.isEmpty else { return [] }
        let strip = { (u: String) in u.lowercased().replacingOccurrences(of: "^https?://(www\\.)?", with: "", options: .regularExpression) }
        let b = bookmarks.filter { strip($0.url).hasPrefix(s) || $0.title.lowercased().contains(s) }.map { ($0.title, $0.url) }
        let h = history.filter { strip($0.url).hasPrefix(s) || $0.title.lowercased().contains(s) }.sorted { $0.visits > $1.visits }.map { ($0.title, $0.url) }
        var seen = Set<String>()
        return (b + h).filter { seen.insert($0.1).inserted }.prefix(limit).map { (title: $0.0, url: $0.1) }
    }

    var nudeSearchBase: String { searchServer.isEmpty ? "http://127.0.0.1:8787" : searchServer }
}
