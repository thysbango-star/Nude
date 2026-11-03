import Foundation

/// Nude Security for iOS/iPadOS: a Swift port of packages/security-engine. Runs entirely on the device.
enum ProtectionLevel: String, CaseIterable, Identifiable, Codable {
    case standard, enhanced, maximum
    var id: String { rawValue }
    var name: String { ["standard": "Standard Protection", "enhanced": "Enhanced Protection", "maximum": "Maximum Protection"][rawValue]! }
    var summary: String {
        switch self {
        case .standard: return "Blocks known dangerous sites and downloads, plus advertising and fingerprinting trackers."
        case .enhanced: return "Also blocks suspicious sites, analytics trackers and third-party cookies."
        case .maximum: return "Strictest: HTTPS-only, social trackers blocked, risky downloads stopped."
        }
    }
    var tradeoff: String {
        switch self {
        case .standard: return "Best compatibility. All checks run on your device."
        case .enhanced: return "Catches more threats; a few sites may break."
        case .maximum: return "Most private and secure; more sites will break or need your approval."
        }
    }
}

enum SecurityAction: String { case allow, warn, block }

struct SecuritySignal: Hashable { let code: String; let severity: Int; let message: String }

struct SecurityVerdict: Equatable {
    let url: String
    let host: String
    let action: SecurityAction
    let confirmed: Bool
    let category: String?
    let score: Int
    let signals: [SecuritySignal]
    var intendedSite: String? = nil
}

struct DownloadVerdict { let action: SecurityAction; let risk: String; let notes: [String] }
struct MessageVerdict { let assessment: String; let indicators: [String]; let summary: String }

enum Security {
    static let categoryInfo: [String: (title: String, explanation: String, advice: String)] = [
        "phishing": ("Possible phishing site", "This site may try to trick you into entering passwords, banking details or personal information.", "Don't enter any information. If you need the real service, type its address yourself."),
        "malware": ("Dangerous site", "This site is known to distribute harmful software.", "Go back. Don't download anything from this site."),
        "scam": ("Known scam site", "This site has been reported for scams such as fake shops or fake prizes.", "Go back. Don't pay or share personal details here."),
        "typosquatting": ("Look-alike website", "This address imitates a well-known site but belongs to someone else.", "Check the address carefully. Use the link to the real site instead."),
        "suspicious": ("Suspicious site", "Several warning signs suggest this site may not be what it claims.", "Only continue if you know and trust this site."),
    ]

    static let brands: [(String, [String])] = [
        ("paypal", ["paypal.com"]), ("google", ["google.com", "gmail.com", "youtube.com"]), ("microsoft", ["microsoft.com", "live.com", "outlook.com", "office.com"]),
        ("apple", ["apple.com", "icloud.com"]), ("amazon", ["amazon.com", "amazon.co.za"]), ("facebook", ["facebook.com", "fb.com"]), ("instagram", ["instagram.com"]),
        ("whatsapp", ["whatsapp.com"]), ("netflix", ["netflix.com"]), ("linkedin", ["linkedin.com"]), ("coinbase", ["coinbase.com"]), ("binance", ["binance.com"]),
        ("metamask", ["metamask.io"]), ("fnb", ["fnb.co.za"]), ("absa", ["absa.co.za"]), ("capitec", ["capitecbank.co.za"]), ("capitecbank", ["capitecbank.co.za"]),
        ("standardbank", ["standardbank.co.za"]), ("nedbank", ["nedbank.co.za"]), ("sars", ["sars.gov.za"]), ("takealot", ["takealot.com"]), ("vodacom", ["vodacom.co.za"]), ("dhl", ["dhl.com"]),
    ]
    static let multiSuffixes: Set<String> = ["co.za", "org.za", "gov.za", "ac.za", "net.za", "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au",
        "co.nz", "co.jp", "co.in", "com.br", "com.mx", "com.ng", "co.ke", "github.io", "vercel.app", "netlify.app", "pages.dev", "web.app", "firebaseapp.com", "blogspot.com", "herokuapp.com"]
    static let keywords = ["login", "signin", "verify", "secure", "account", "update", "confirm", "banking", "wallet", "unlock", "suspended", "password", "billing", "support", "auth", "seed", "airdrop", "claim"]
    static let riskyTlds: Set<String> = ["zip", "mov", "top", "xyz", "click", "country", "gq", "tk", "ml", "ga", "cf", "work", "support", "rest", "fit", "loan", "cam", "icu", "buzz"]

    /// Tracker domains (registrable domains) → category.
    static let trackers: [String: String] = [
        "doubleclick.net": "advertising", "googlesyndication.com": "advertising", "googleadservices.com": "advertising", "adnxs.com": "advertising",
        "criteo.com": "advertising", "criteo.net": "advertising", "taboola.com": "advertising", "outbrain.com": "advertising", "rubiconproject.com": "advertising",
        "pubmatic.com": "advertising", "openx.net": "advertising", "adsrvr.org": "advertising", "amazon-adsystem.com": "advertising", "moatads.com": "advertising",
        "media.net": "advertising", "google-analytics.com": "analytics", "googletagmanager.com": "analytics", "hotjar.com": "analytics", "mixpanel.com": "analytics",
        "segment.io": "analytics", "amplitude.com": "analytics", "clarity.ms": "analytics", "scorecardresearch.com": "analytics",
        "connect.facebook.net": "social", "ads-twitter.com": "social", "analytics.tiktok.com": "social", "ads.linkedin.com": "social",
        "fingerprintjs.com": "fingerprinting", "coinhive.com": "cryptomining",
    ]

    static var knownBad: [String: String] = [:]
    static var trusted: Set<String> = []

    static func registrableDomain(_ host: String) -> String {
        var h = host.lowercased()
        if h.hasSuffix(".") { h.removeLast() }
        let labels = h.split(separator: ".").map(String.init)
        if labels.count <= 2 { return labels.joined(separator: ".") }
        for n in stride(from: min(3, labels.count - 1), through: 2, by: -1) {
            if multiSuffixes.contains(labels.suffix(n).joined(separator: ".")) { return labels.suffix(n + 1).joined(separator: ".") }
        }
        return labels.suffix(2).joined(separator: ".")
    }

    static func skeleton(_ s: String) -> String {
        var r = s.lowercased()
        for (a, b) in [("rn", "m"), ("vv", "w"), ("0", "o"), ("1", "l"), ("3", "e"), ("4", "a"), ("5", "s"), ("7", "t"), ("-", "")] { r = r.replacingOccurrences(of: a, with: b) }
        return r
    }

    static func levenshtein(_ a: String, _ b: String) -> Int {
        let a = Array(a), b = Array(b)
        if a.isEmpty { return b.count }
        if b.isEmpty { return a.count }
        var prev = Array(0...b.count)
        for i in 1...a.count {
            var cur = [i] + Array(repeating: 0, count: b.count)
            for j in 1...b.count { cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1)) }
            prev = cur
        }
        return prev[b.count]
    }

    struct Typo { let brand: String; let official: String; let reason: String; let combo: Bool }

    static func detectTyposquat(_ host: String) -> Typo? {
        let reg = registrableDomain(host)
        let label = String(reg.split(separator: ".").first ?? "")
        if label.count < 3 { return nil }
        if brands.contains(where: { $0.1.contains(where: { reg == $0 || reg.hasSuffix(".\($0)") }) }) { return nil }
        if brands.contains(where: { $0.0 == label }) { return nil }
        let parts = label.split(separator: "-").map(String.init).filter { !$0.isEmpty }
        let candidates = parts.count > 1 ? [label.replacingOccurrences(of: "-", with: "")] + parts : [label]
        for (brand, domains) in brands {
            let official = domains[0]
            for part in candidates {
                if part == brand {
                    if parts.count > 1 { return Typo(brand: brand, official: official, reason: "combines \"\(brand)\" with other words on a domain \(brand) doesn't own", combo: true) }
                    continue
                }
                if part.count >= 4 && skeleton(part) == skeleton(brand) { return Typo(brand: brand, official: official, reason: "uses look-alike characters to imitate \(official)", combo: false) }
                if brand.count >= 6 && part.count >= 5 {
                    let d = levenshtein(part, brand)
                    if d == 1 || (d == 2 && brand.count >= 9) { return Typo(brand: brand, official: official, reason: "is spelled almost like \(official)", combo: false) }
                }
            }
        }
        return nil
    }

    static func isPrivateIP(_ h: String) -> Bool {
        h == "localhost" || h.range(of: "^(10\\.|127\\.|192\\.168\\.|169\\.254\\.|172\\.(1[6-9]|2\\d|3[01])\\.)", options: .regularExpression) != nil
    }

    static func analyze(_ url: String, level: ProtectionLevel) -> SecurityVerdict {
        guard let u = URL(string: url), let scheme = u.scheme?.lowercased(), let host = u.host?.lowercased(), scheme == "http" || scheme == "https" else {
            return SecurityVerdict(url: url, host: URL(string: url)?.host ?? "", action: .allow, confirmed: false, category: nil, score: 0, signals: [])
        }
        let reg = registrableDomain(host)
        if let c = knownBad[host] ?? knownBad[reg] {
            return SecurityVerdict(url: url, host: host, action: .block, confirmed: true, category: c, score: 100,
                                   signals: [SecuritySignal(code: "threat-list", severity: 100, message: "This site is on Nude Security's list of known \(c) sites.")])
        }
        if trusted.contains(reg) || trusted.contains(host) { return SecurityVerdict(url: url, host: host, action: .allow, confirmed: false, category: nil, score: 0, signals: []) }

        var signals: [SecuritySignal] = []
        var category: String?
        let typo = detectTyposquat(host)
        if let t = typo {
            signals.append(SecuritySignal(code: "typosquatting", severity: t.combo ? 35 : 65, message: "The address \(t.reason)."))
            category = "typosquatting"
        }
        var sub = String(host.dropLast(reg.count))
        if sub.hasSuffix(".") { sub.removeLast() }
        if !sub.isEmpty {
            let pieces = sub.split(whereSeparator: { $0 == "." || $0 == "-" }).map(String.init)
            for (brand, domains) in brands where brand.count >= 4 && !domains.contains(reg) {
                if pieces.contains(brand) || domains.contains(where: { sub.contains($0) }) {
                    signals.append(SecuritySignal(code: "brand-in-subdomain", severity: 50, message: "The address puts \"\(brand)\" in front of a different website (\(reg)) to look official."))
                    if category == nil { category = "phishing" }
                    break
                }
            }
        }
        if u.user != nil {
            signals.append(SecuritySignal(code: "credentials-in-url", severity: 45, message: "The address hides its real destination behind an \"@\" sign."))
            if category == nil { category = "phishing" }
        }
        if host.range(of: "^\\d+\\.\\d+\\.\\d+\\.\\d+$", options: .regularExpression) != nil && !isPrivateIP(host) {
            signals.append(SecuritySignal(code: "ip-host", severity: 25, message: "The site uses a raw IP address instead of a name."))
        }
        if host.contains("xn--") { signals.append(SecuritySignal(code: "punycode", severity: 25, message: "The address uses international characters that can imitate other sites.")) }
        let tld = String(reg.split(separator: ".").last ?? "")
        if riskyTlds.contains(tld) { signals.append(SecuritySignal(code: "risky-tld", severity: 12, message: "\".\(tld)\" addresses are often used by scam sites.")) }
        let path = (host + u.path).lowercased()
        let hits = keywords.filter { path.contains($0) }
        if !hits.isEmpty && (typo != nil || signals.contains(where: { ["brand-in-subdomain", "risky-tld", "ip-host"].contains($0.code) })) {
            signals.append(SecuritySignal(code: "phishing-keywords", severity: 15 + min(15, hits.count * 5),
                                          message: "The address contains words like \"\(hits.prefix(3).joined(separator: "\", \""))\" that scam sites use to look official."))
        }
        if host.split(separator: ".").count - reg.split(separator: ".").count >= 4 {
            signals.append(SecuritySignal(code: "deep-subdomains", severity: 12, message: "The address has an unusually long chain of sub-domains."))
        }
        if scheme == "http" && !isPrivateIP(host) {
            signals.append(SecuritySignal(code: "not-https", severity: level == .maximum ? 20 : 3, message: "The connection is not encrypted."))
        }
        let score = min(99, signals.reduce(0) { $0 + $1.severity })
        let (warn, block): (Int, Int) = level == .standard ? (60, 90) : level == .enhanced ? (40, 70) : (30, 55)
        let action: SecurityAction = score >= block ? .block : score >= warn ? .warn : .allow
        if action != .allow && category == nil { category = "suspicious" }
        return SecurityVerdict(url: url, host: host, action: action, confirmed: false, category: action == .allow ? nil : category, score: score, signals: signals,
                               intendedSite: typo.map { "https://\($0.official)/" })
    }

    static func blockedTrackerCategories(_ level: ProtectionLevel) -> Set<String> {
        switch level {
        case .standard: return ["advertising", "fingerprinting", "cryptomining"]
        case .enhanced: return ["advertising", "analytics", "fingerprinting", "cryptomining"]
        case .maximum: return ["advertising", "analytics", "social", "fingerprinting", "cryptomining"]
        }
    }

    /// WebKit content-blocker rules (third-party loads only) for the chosen level.
    static func contentBlockerJSON(_ level: ProtectionLevel) -> String {
        let cats = blockedTrackerCategories(level)
        var rules: [[String: Any]] = trackers.filter { cats.contains($0.value) }.keys.sorted().map { domain in
            let escaped = domain.replacingOccurrences(of: ".", with: "\\.")
            return ["trigger": ["url-filter": "^https?://([^/]+\\.)?\(escaped)[/:?]", "load-type": ["third-party"]], "action": ["type": "block"]]
        }
        if level != .standard { rules.append(["trigger": ["url-filter": ".*", "load-type": ["third-party"]], "action": ["type": "block-cookies"]]) }
        // HTTPS-only (Maximum) is enforced in the navigation policy: WebKit rule regexes can't express exceptions for local hosts.
        let data = (try? JSONSerialization.data(withJSONObject: rules)) ?? Data("[]".utf8)
        return String(data: data, encoding: .utf8) ?? "[]"
    }

    private static let executable: Set<String> = ["exe", "msi", "bat", "cmd", "com", "scr", "pif", "ps1", "vbs", "js", "jar", "apk", "dmg", "pkg", "sh", "run", "bin", "dll", "iso", "img", "hta", "lnk", "reg", "msix", "appx", "ipa", "mobileconfig"]
    private static let decoys: Set<String> = ["pdf", "doc", "docx", "jpg", "jpeg", "png", "txt", "xls", "xlsx", "mp4", "mp3", "zip"]

    static func analyzeDownload(filename: String, url: String, source: SecurityVerdict?, level: ProtectionLevel) -> DownloadVerdict {
        var notes: [(Int, String)] = []
        let parts = filename.lowercased().split(separator: ".").map(String.init)
        let ext = parts.count > 1 ? parts.last! : ""
        if filename.range(of: "[\u{202A}-\u{202E}\u{2066}-\u{2069}]", options: .regularExpression) != nil { notes.append((80, "The file name uses hidden characters to disguise its real type.")) }
        if ext == "mobileconfig" { notes.append((60, "This is a configuration profile. Installing it can change your device's security settings.")) }
        else if executable.contains(ext) {
            notes.append((35, "This is a program (.\(ext)) that can make changes to a computer when opened."))
            if parts.count >= 3 && decoys.contains(parts[parts.count - 2]) { notes.append((50, "The name \"\(filename)\" pretends to be a .\(parts[parts.count - 2]) file but is actually a program.")) }
        }
        if url.hasPrefix("http:") { notes.append((executable.contains(ext) ? 25 : 8, "The file was sent over an unencrypted connection and could have been altered.")) }
        if let s = source, s.action != .allow { notes.append((s.confirmed ? 100 : 30, "The site offering this file has been flagged by Nude Security.")) }
        let score = min(100, notes.reduce(0) { $0 + $1.0 })
        let risk = score >= 80 ? "dangerous" : score >= 50 ? "high" : score >= 25 ? "medium" : "low"
        let blockAt = level == .maximum ? 50 : level == .enhanced ? 75 : 85
        let warnAt = level == .standard ? 50 : 30
        return DownloadVerdict(action: score >= blockAt ? .block : score >= warnAt ? .warn : .allow, risk: risk, notes: notes.map(\.1))
    }

    private static let messageRules: [(Int, String, String)] = [
        (15, "\\b(urgent|immediately|within (24|48) hours|final (notice|warning)|act now|expires? (today|soon))\\b", "Creates urgency to pressure you into acting before thinking."),
        (20, "account (will be|has been) (deleted|closed|suspended|locked|disabled)|legal action|arrest", "Threatens a consequence (account deletion, suspension, legal action)."),
        (25, "verify your (account|identity|details)|confirm your (password|details)|update your (payment|billing|banking)", "Asks you to verify, log in or update details via the message."),
        (30, "\\b(otp|one[- ]time (pin|password|code)|verification code|cvv|card number)\\b", "Mentions one-time PINs or card numbers — legitimate services never ask for these by message."),
        (20, "gift ?cards?|crypto|bitcoin|usdt|wire transfer|western union|e-?wallet", "Requests unusual payment methods."),
        (20, "you('ve| have)? won|winner|lottery|prize|inheritance", "Promises a prize or windfall."),
        (10, "(parcel|package|delivery).{0,20}(on hold|held|pending)|customs fee", "Claims a parcel is held and needs a fee."),
        (8, "^\\s*dear (customer|user|client|member|valued customer)", "Uses a generic greeting instead of your name."),
        (25, "anydesk|teamviewer|remote access", "Asks you to install remote-access software."),
    ]

    static func analyzeMessage(_ text: String) -> MessageVerdict {
        var found: [(Int, String)] = []
        for (w, pattern, msg) in messageRules where text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil { found.append((w, msg)) }
        if let re = try? NSRegularExpression(pattern: "https?://[^\\s<>\"')]+") {
            for m in re.matches(in: text, range: NSRange(text.startIndex..., in: text)).prefix(20) {
                guard let r = Range(m.range, in: text) else { continue }
                let link = String(text[r]).trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?"))
                let v = analyze(link, level: .enhanced)
                if v.action != .allow { found.append((v.confirmed ? 60 : 30, "Contains a link to \(v.host), which Nude Security flags: \(v.signals.first?.message ?? "suspicious address")")) }
            }
        }
        let score = min(100, found.reduce(0) { $0 + $1.0 })
        let assessment = score >= 50 ? "Likely a scam" : score >= 25 ? "Suspicious" : "No strong scam signs found"
        let summary = score >= 50 ? "Don't click its links, reply, or share any details. Contact the company using its official website or app instead."
            : score >= 25 ? "Verify it through the company's official website or phone number before acting on it."
            : "That doesn't prove the message is genuine. If it asks for money or details, verify it independently."
        return MessageVerdict(assessment: assessment, indicators: found.map(\.1), summary: summary)
    }
}
