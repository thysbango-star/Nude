import SwiftUI

struct ChatMessage: Identifiable, Equatable {
    let id = UUID()
    let role: String
    var text: String
    var sources: [String] = []
    var note: String? = nil
    var isError = false
}

/// Nebula (AI) client. Page text is sent only when the user turns on "Share this page"; model keys live in the gateway.
enum NudeAI {
    static func stream(gateway: String, token: String, history: [ChatMessage], sources: [[String: String]], mode: String = "everyday", speed: String = "auto", onDelta: @escaping @MainActor (String) -> Void) async throws {
        guard let url = URL(string: gateway.trimmingCharacters(in: CharacterSet(charactersIn: "/ ")) + "/v1/chat") else { throw URLError(.badURL) }
        var req = URLRequest(url: url, timeoutInterval: 120)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue("text/event-stream", forHTTPHeaderField: "accept")
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
        let messages = history.filter { !$0.isError && !$0.text.isEmpty }.suffix(20).map { ["role": $0.role, "content": $0.text] }
        var body: [String: Any] = ["messages": messages, "sources": sources, "stream": true, "mode": mode]
        if speed != "auto" { body["speed"] = speed }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (bytes, response) = try await URLSession.shared.bytes(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "NudeAI", code: (response as? HTTPURLResponse)?.statusCode ?? 0, userInfo: [NSLocalizedDescriptionKey: "gateway answered HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)"])
        }
        for try await line in bytes.lines {
            guard line.hasPrefix("data:"), let data = line.dropFirst(5).trimmingCharacters(in: .whitespaces).data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            if let d = obj["delta"] as? String { await onDelta(d) }
            if let e = obj["error"] as? String { throw NSError(domain: "NudeAI", code: 1, userInfo: [NSLocalizedDescriptionKey: e]) }
        }
    }

    /// On-device answers for safety questions (works with no gateway configured).
    static func localAnswer(_ question: String, currentURL: String?, level: ProtectionLevel) -> String? {
        let q = question.lowercased()
        if q.range(of: "(is|are) (this|the) (site|website|page) (safe|legit|real|a scam)|safe to (use|visit)", options: .regularExpression) != nil, let u = currentURL, u.hasPrefix("http") {
            let v = Security.analyze(u, level: level)
            if v.action == .allow {
                return "**\(v.host)** isn't on Rovian Defender's threat lists and shows no strong warning signs.\n\nThat isn't a guarantee it's safe — Rovian Defender can only check known threats and common tricks."
            }
            return "**\(v.host)** was flagged (\(v.confirmed ? "confirmed threat" : "suspected — not confirmed")).\n\n" + v.signals.map { "• \($0.message)" }.joined(separator: "\n")
        }
        if question.count > 120, q.range(of: "scam|phish|fraud|legit|genuine", options: .regularExpression) != nil {
            let m = Security.analyzeMessage(question)
            return "**\(m.assessment).**\n\n" + (m.indicators.isEmpty ? "" : "What I noticed:\n" + m.indicators.map { "• \($0)" }.joined(separator: "\n") + "\n\n") + m.summary
        }
        return nil
    }
}

enum NebulaSection: String, CaseIterable, Identifiable { case ask = "Ask", spaces = "Spaces", modes = "Modes"; var id: String { rawValue } }

/// Keeps the conversation while Nebula is closed and reopened.
@MainActor final class NebulaMemory: ObservableObject {
    static let shared = NebulaMemory()
    @Published var messages: [ChatMessage] = []
}

private let nebulaQuick: [String: [(String, String, Bool)]] = [
    "shopping": [("Smart Compare", "Compare the main products on this page: price, quality signals, ratings and value. Recommend the best pick and why.", true),
                 ("Mix & Match", "Give me outfit or combination ideas using the item I'm looking at and other items on this page.", true),
                 ("Price Pulse", "Find the cheapest option on this page. Is anything on sale? Point out the best value.", true)],
    "research": [("Key facts", "List the key facts and claims on this page, with which parts are supported by evidence.", true),
                 ("Fact-check", "Which claims on this page might be misleading or need verification?", true)],
    "study": [("Study guide", "Create a study guide from this page: key ideas, definitions and a short summary.", true),
              ("Quiz me", "Make 5 quiz questions (with answers at the end) from this page.", true)],
    "focus": [("TL;DR", "TL;DR of this page in 2 sentences.", true)],
    "everyday": [("Summarise", "Summarise this page in five points.", true), ("Explain simply", "Explain this page like I'm in Grade 8.", true), ("Is this safe?", "Is this website safe?", false)],
]
private let nebulaModes: [(String, String, String)] = [
    ("everyday", "Everyday", "Summaries, explanations and quick answers."), ("shopping", "Shopping", "Smart Compare, Mix & Match and Price Pulse."),
    ("research", "Research", "Key facts, sources and fact-checks."), ("study", "Study", "Study guides, notes and quizzes."), ("focus", "Focus", "Short answers about the page you're on."),
]

/// The neon frame from the motion reference: a turning conic gradient stroke.
struct NeonFrame: View {
    var radius: CGFloat
    var visible: Bool
    @State private var angle: Double = 0
    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .strokeBorder(AngularGradient(colors: [.yellow, Color(red: 1, green: 0.17, blue: 0.84), Color(red: 0.48, green: 0.24, blue: 1), Color(red: 0.12, green: 0.48, blue: 1), Color(red: 0.13, green: 0.89, blue: 1), .yellow], center: .center, angle: .degrees(angle)), lineWidth: 3)
            .opacity(visible ? 1 : 0)
            .animation(.easeInOut(duration: 0.35), value: visible)
            .onAppear { withAnimation(.linear(duration: 2.4).repeatForever(autoreverses: false)) { angle = 360 } }
            .allowsHitTesting(false)
    }
}

/// Nebula as a floating matte panel over the page. It grows out of its button and closes instantly.
struct NebulaPanel: View {
    @EnvironmentObject var model: BrowserModel
    @EnvironmentObject var store: Store
    @EnvironmentObject var accounts: Accounts
    @ObservedObject private var memory = NebulaMemory.shared
    @Environment(\.colorScheme) private var scheme
    let onClose: () -> Void
    var initialPrompt: String? = nil
    var initialShare = false
    @State private var input = ""
    @State private var sharePage = false
    @State private var busy = false
    @State private var flare = true
    @State private var section: NebulaSection = .ask
    @FocusState private var focused: Bool

    private var messages: [ChatMessage] { memory.messages }
    private var web: Bool { model.active.map { !$0.isHome && $0.url.hasPrefix("http") } ?? false }

    var body: some View {
        VStack(spacing: 0) {
            header
            Group {
                switch section {
                case .ask: conversation
                case .spaces: spaces
                case .modes: modes
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .transition(.asymmetric(insertion: .opacity.combined(with: .offset(y: 14)), removal: .opacity))
            .id(section)
            composer
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 28, style: .continuous)) // matte frosted glass
        .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).stroke(Color.primary.opacity(0.07)))
        .overlay(NeonFrame(radius: 28, visible: busy || flare).padding(-3))
        .shadow(color: .black.opacity(0.25), radius: 30, y: 12)
        .padding(10)
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { flare = false }
            if let p = initialPrompt { sharePage = initialShare; send(p) }
        }
    }

    private var header: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                Button(action: onClose) { Image(systemName: "chevron.down").font(.body.weight(.semibold)).frame(width: 36, height: 36) }.accessibilityLabel("Close Nebula")
                NebulaOrb(size: 22)
                Text("Nebula").font(.title3.weight(.bold))
                Spacer()
                if !messages.isEmpty { Button { memory.messages = [] } label: { Image(systemName: "square.and.pencil") }.accessibilityLabel("New conversation") }
            }
            HStack(spacing: 8) {
                ForEach(NebulaSection.allCases) { s in
                    Button { withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) { section = s } } label: {
                        Text(s.rawValue).font(.subheadline.weight(section == s ? .semibold : .medium))
                            .padding(.horizontal, 14).padding(.vertical, 7)
                            .background(Color.primary.opacity(section == s ? 0.12 : 0.05), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }.buttonStyle(.plain)
                }
                Spacer()
            }
        }.padding(.horizontal, 14).padding(.top, 12).foregroundStyle(.primary)
    }

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if messages.isEmpty { hello }
                    ForEach(messages) { m in bubble(m).id(m.id).transition(.opacity.combined(with: .offset(y: 16))) }
                }.padding(16).animation(.spring(response: 0.35, dampingFraction: 0.85), value: messages.count)
            }
            .onChange(of: messages) { _ in if let last = messages.last { withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo(last.id, anchor: .bottom) } } }
        }
    }

    private var hello: some View {
        VStack(spacing: 12) {
            NebulaOrb(size: 52)
            Text(accounts.current.map { "Hi \($0.firstName), I'm Nebula" } ?? "Hi, I'm Nebula").font(.title2.weight(.bold))
            Text(web ? "Ask me anything, or pick an action and I'll read this page for you." : "Ask me anything. Open a page and I can read it when you ask.")
                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            FlowChips(items: (nebulaQuick[store.mode] ?? nebulaQuick["everyday"]!).filter { !$0.2 || web }) { q in sharePage = q.2; send(q.1) }
        }.frame(maxWidth: .infinity).padding(.top, 30)
    }

    private func bubble(_ m: ChatMessage) -> some View {
        let mine = m.role == "user"
        return HStack(alignment: .top, spacing: 10) {
            if mine { Spacer(minLength: 40) } else { NebulaOrb(size: 18).padding(.top, 2) }
            VStack(alignment: .leading, spacing: 6) {
                if m.text.isEmpty && !mine && !m.isError { TypingDots() } else {
                    Text((try? AttributedString(markdown: m.text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(m.text))
                        .textSelection(.enabled).foregroundStyle(mine ? AnyShapeStyle(Color(.systemBackground)) : m.isError ? AnyShapeStyle(Color.red) : AnyShapeStyle(Color.primary))
                }
                if !mine && !m.text.isEmpty && !m.isError {
                    Text(m.sources.isEmpty ? "No page content was shared." : "Used: \(m.sources.joined(separator: ", "))").font(.caption2).foregroundStyle(.secondary)
                    HStack(spacing: 14) {
                        Button { UIPasteboard.general.string = m.text } label: { Image(systemName: "doc.on.doc") }.accessibilityLabel("Copy")
                        ShareLink(item: m.text) { Image(systemName: "square.and.arrow.up") }
                    }.font(.caption).foregroundStyle(.secondary)
                }
                if let n = m.note { Text(n).font(.caption2).foregroundStyle(.secondary) }
            }
            .padding(mine ? 12 : 0)
            .background(mine ? AnyShapeStyle(Color.primary) : AnyShapeStyle(Color.clear), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            if !mine { Spacer(minLength: 20) }
        }
    }

    /// Spaces on iPhone and iPad: open tabs grouped by site; the current space is highlighted pink, as in the reference.
    private var spaces: some View {
        let groups = Dictionary(grouping: model.tabs) { t in t.isHome || !t.url.hasPrefix("http") ? "New tabs" : Omnibox.host(t.url).replacingOccurrences(of: "www.", with: "") }
        let names = groups.keys.sorted()
        return ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 12)], spacing: 12) {
                ForEach(Array(names.enumerated()), id: \.element) { i, name in
                    let tabs = groups[name] ?? []
                    let current = tabs.contains { $0.id == model.activeID }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(name).font(.subheadline.weight(.semibold)).opacity(0.8).padding(.horizontal, 12).padding(.vertical, 8)
                        ForEach(tabs) { t in
                            Button { model.activate(t); onClose() } label: {
                                HStack { Text(t.title.isEmpty ? t.url : t.title).lineLimit(1).fontWeight(t.id == model.activeID ? .bold : .medium); Spacer() }
                                    .padding(.horizontal, 12).padding(.vertical, 9).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, 6)
                    .foregroundStyle(current ? Color(red: 0.16, green: 0.08, blue: 0.09) : Color.primary)
                    .background(current ? AnyShapeStyle(Color(red: 0.89, green: 0.71, blue: 0.73)) : AnyShapeStyle(Color.primary.opacity(0.05)), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
                    .animation(.spring(response: 0.4, dampingFraction: 0.85).delay(Double(i) * 0.04), value: section)
                }
            }.padding(14)
        }
    }

    private var modes: some View {
        ScrollView {
            VStack(spacing: 10) {
                ForEach(nebulaModes, id: \.0) { m in
                    let on = store.mode == m.0
                    Button { withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { store.mode = m.0 }; model.toast = "\(m.1) mode on" } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(m.1).font(.headline)
                            Text(m.2).font(.subheadline).opacity(0.75)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(16)
                        .foregroundStyle(on ? Color(red: 0.16, green: 0.08, blue: 0.09) : Color.primary)
                        .background(on ? AnyShapeStyle(Color(red: 0.89, green: 0.71, blue: 0.73)) : AnyShapeStyle(Color.primary.opacity(0.05)), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }.buttonStyle(.plain)
                }
            }.padding(14)
        }
    }

    private var composer: some View {
        VStack(spacing: 6) {
            if sharePage, let t = model.active {
                HStack(spacing: 6) {
                    Text(t.title.isEmpty ? "This page" : String(t.title.prefix(30))).font(.caption.weight(.semibold))
                    Button { sharePage = false } label: { Image(systemName: "xmark").font(.caption2.weight(.bold)) }.accessibilityLabel("Stop sharing this page")
                }.padding(.horizontal, 10).padding(.vertical, 5).background(Color.primary.opacity(0.07), in: Capsule()).transition(.scale.combined(with: .opacity))
            }
            HStack(spacing: 6) {
                Button { withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { if web { sharePage.toggle() } else { model.toast = "Open a web page to share it with Nebula" } } } label: {
                    Image(systemName: sharePage ? "checkmark" : "plus").font(.title3.weight(.medium)).frame(width: 40, height: 40)
                }.accessibilityLabel("Share this page")
                TextField(sharePage ? "Ask about this page" : "Ask Nebula anything", text: $input, axis: .vertical).lineLimit(1...5).focused($focused)
                    .onSubmit { send(input) }
                Button {
                    store.nebulaSpeed = store.nebulaSpeed == "auto" ? "fast" : store.nebulaSpeed == "fast" ? "thorough" : "auto"
                    model.toast = ["auto": "Auto: fast for chat, deep when you share a page", "fast": "Fast answers", "thorough": "Deep answers: slower, more careful"][store.nebulaSpeed]
                } label: {
                    Text(["auto": "Auto", "fast": "Fast", "thorough": "Deep"][store.nebulaSpeed] ?? "Auto").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        .padding(.horizontal, 10).padding(.vertical, 6).background(Color.primary.opacity(0.07), in: Capsule())
                }.accessibilityLabel("Answer speed")
                Button { send(input) } label: {
                    Image(systemName: "arrow.up").font(.body.weight(.bold)).foregroundStyle(Color(.systemBackground))
                        .frame(width: 42, height: 42).background(Color.primary.opacity(canSend ? 1 : 0.25), in: Circle())
                        .scaleEffect(canSend ? 1 : 0.9).animation(.spring(response: 0.3, dampingFraction: 0.6), value: canSend)
                }.disabled(!canSend).keyboardShortcut(.return, modifiers: .command).accessibilityLabel("Send")
            }
            .padding(.leading, 6).padding(.trailing, 6).padding(.vertical, 6)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            Text("Nebula only sees what you share. It can make mistakes.").font(.caption2).foregroundStyle(.secondary)
        }.padding(12)
    }

    private var canSend: Bool { !busy && !input.trimmingCharacters(in: .whitespaces).isEmpty }

    private func send(_ text: String) {
        let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !busy else { return }
        input = ""
        withAnimation(.spring(response: 0.3, dampingFraction: 0.86)) { section = .ask }
        memory.messages.append(ChatMessage(role: "user", text: q))
        busy = true
        let tab = model.active
        let mode = store.mode, speed = store.nebulaSpeed
        Task { @MainActor in
            defer { busy = false }
            var sources: [[String: String]] = []
            var used: [String] = []
            if sharePage, let tab, tab.url.hasPrefix("http") {
                let page = await tab.pageText()
                sources.append(["id": "S1", "kind": "page", "title": page.title, "url": tab.url, "content": page.text])
                let v = Security.analyze(tab.url, level: store.level)
                sources.append(["id": "S2", "kind": "security", "title": "Rovian Defender site check", "url": tab.url,
                                "content": "action=\(v.action.rawValue); confirmed=\(v.confirmed); signals=\(v.signals.map(\.message).joined(separator: "; "))"])
                used.append(page.title.isEmpty ? Omnibox.host(tab.url) : page.title)
            }
            let local = NudeAI.localAnswer(q, currentURL: tab?.url, level: store.level)
            if store.aiGateway.isEmpty {
                memory.messages.append(local.map { ChatMessage(role: "assistant", text: $0, note: "Answered on your device by Rovian Defender.") }
                    ?? ChatMessage(role: "assistant", text: "Nebula isn't set up yet. Add your Nebula gateway address in Settings → Nude services (see docs/NEBULA_SETUP.md). Safety questions like \"Is this website safe?\" work without it.", isError: true))
                return
            }
            memory.messages.append(ChatMessage(role: "assistant", text: "", sources: used))
            let index = memory.messages.count - 1
            do {
                try await NudeAI.stream(gateway: store.aiGateway, token: store.serviceToken, history: Array(memory.messages.dropLast()), sources: sources, mode: mode, speed: speed) { delta in
                    if index < memory.messages.count { memory.messages[index].text += delta }
                }
            } catch {
                if index < memory.messages.count {
                    memory.messages[index] = local.map { ChatMessage(role: "assistant", text: $0, note: "Answered on your device — Nebula isn't reachable.") }
                        ?? ChatMessage(role: "assistant", text: "Nebula isn't reachable (\(error.localizedDescription)).", isError: true)
                }
            }
        }
    }
}

struct TypingDots: View {
    @State private var on = false
    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3) { i in
                Circle().frame(width: 7, height: 7).foregroundStyle(.secondary)
                    .offset(y: on ? -3 : 0).opacity(on ? 1 : 0.4)
                    .animation(.easeInOut(duration: 0.5).repeatForever().delay(Double(i) * 0.15), value: on)
            }
        }.onAppear { on = true }.padding(.vertical, 6)
    }
}

/// Wrapping row of quick-action chips.
struct FlowChips: View {
    let items: [(String, String, Bool)]
    let onTap: ((String, String, Bool)) -> Void
    var body: some View {
        VStack(spacing: 8) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, q in
                Button { onTap(q) } label: {
                    Text(q.0).font(.subheadline.weight(.medium)).padding(.horizontal, 16).padding(.vertical, 9)
                        .background(Color.primary.opacity(0.06), in: Capsule())
                }.buttonStyle(.plain)
            }
        }
    }
}
