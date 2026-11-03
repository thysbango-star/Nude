import Foundation

/// Address-bar logic. Mirrors the desktop (TypeScript) and Android (Kotlin) versions.
enum SearchEngine: String, CaseIterable, Identifiable, Codable {
    case duckduckgo, google, bing, brave, ecosia, startpage, nude
    var id: String { rawValue }
    var label: String {
        switch self {
        case .duckduckgo: return "DuckDuckGo"
        case .google: return "Google"
        case .bing: return "Bing"
        case .brave: return "Brave Search"
        case .ecosia: return "Ecosia"
        case .startpage: return "Startpage"
        case .nude: return "Nude Search"
        }
    }
    var template: String {
        switch self {
        case .duckduckgo: return "https://duckduckgo.com/?q={q}"
        case .google: return "https://www.google.com/search?q={q}"
        case .bing: return "https://www.bing.com/search?q={q}"
        case .brave: return "https://search.brave.com/search?q={q}"
        case .ecosia: return "https://www.ecosia.org/search?q={q}"
        case .startpage: return "https://www.startpage.com/do/search?q={q}"
        case .nude: return "{base}/search?q={q}"
        }
    }
}

enum OmniboxResult: Equatable {
    case navigate(String)
    case search(url: String, query: String)
    case blocked(String)
}

enum Omnibox {
    private static let tlds: Set<String> = Set(("ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg er es et eu fi fj fk fm fo fr ga gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sk sl sm sn so sr ss st su sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw " +
        "com net org edu gov mil int info biz name pro mobi app dev page xyz online site tech store shop blog cloud link live news art design media agency studio digital email software solutions systems network services club life world today space website fun top icu vip love one wiki africa joburg capetown durban local localhost test internal lan home onion").split(separator: " ").map(String.init))

    static func searchURL(_ engine: SearchEngine, _ query: String, nudeBase: String = "http://127.0.0.1:8787") -> String {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&+=?#")
        let q = query.trimmingCharacters(in: .whitespaces).addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
        let base = nudeBase.hasSuffix("/") ? String(nudeBase.dropLast()) : nudeBase
        return engine.template.replacingOccurrences(of: "{base}", with: base).replacingOccurrences(of: "{q}", with: q)
    }

    private static func isIPv4(_ h: String) -> Bool {
        let p = h.split(separator: ".", omittingEmptySubsequences: false)
        return p.count == 4 && p.allSatisfy { s in s.count <= 3 && !s.isEmpty && s.allSatisfy(\.isNumber) && (Int(s) ?? 999) <= 255 }
    }

    static func looksLikeHost(_ text: String) -> Bool {
        if text.contains(where: { $0.isWhitespace }) { return false }
        let hostEnd = text.firstIndex(where: { ":/?#".contains($0) }) ?? text.endIndex
        let host = text[..<hostEnd].lowercased()
        let hasPortOrPath = hostEnd != text.endIndex
        if host == "localhost" || isIPv4(host) { return true }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        if labels.count < 2 || labels.contains(where: { $0.isEmpty || $0.count > 63 || $0.hasPrefix("-") || $0.hasSuffix("-") }) { return false }
        let tld = labels.last!
        if tlds.contains(tld) || tld.hasPrefix("xn--") { return true }
        return hasPortOrPath && tld.count >= 2 && tld.allSatisfy { $0.isLetter }
    }

    private static func isLocal(_ text: String) -> Bool {
        let host = String(text.split(whereSeparator: { ":/?#".contains($0) }).first ?? "").lowercased()
        return host == "localhost" || isIPv4(host) || host.hasSuffix(".local") || host.hasSuffix(".lan") || host.hasSuffix(".test")
    }

    static func resolve(_ raw: String, engine: SearchEngine, nudeBase: String = "http://127.0.0.1:8787") -> OmniboxResult? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        if text.hasPrefix("?") {
            let q = String(text.dropFirst()).trimmingCharacters(in: .whitespaces)
            return q.isEmpty ? nil : .search(url: searchURL(engine, q, nudeBase: nudeBase), query: q)
        }
        if let colon = text.firstIndex(of: ":") {
            let scheme = text[..<colon].lowercased()
            if scheme.allSatisfy({ $0.isLetter || $0.isNumber || "+.-".contains($0) }) && scheme.first?.isLetter == true {
                if ["javascript", "data", "vbscript", "blob", "file"].contains(scheme) {
                    return .blocked("\(scheme): addresses can't be opened from the address bar.")
                }
                if (scheme == "http" || scheme == "https") && !text.contains(" ") {
                    if let u = URL(string: text), let h = u.host, !h.isEmpty { return .navigate(text) }
                    return .search(url: searchURL(engine, text, nudeBase: nudeBase), query: text)
                }
            }
        }
        if looksLikeHost(text) { return .navigate((isLocal(text) ? "http://" : "https://") + text) }
        return .search(url: searchURL(engine, text, nudeBase: nudeBase), query: text)
    }

    static func display(_ url: String) -> String {
        guard !url.isEmpty, url != "about:blank", let u = URLComponents(string: url) else { return "" }
        if u.scheme == "https" {
            let host = (u.host ?? "").replacingOccurrences(of: "^www\\.", with: "", options: .regularExpression)
            let path = u.percentEncodedPath == "/" ? "" : u.percentEncodedPath
            return host + path + (u.percentEncodedQuery.map { "?\($0)" } ?? "")
        }
        return url
    }

    static func host(_ url: String) -> String {
        (URL(string: url)?.host ?? url).replacingOccurrences(of: "^www\\.", with: "", options: .regularExpression)
    }
}
