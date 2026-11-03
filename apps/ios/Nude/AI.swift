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
    static func stream(gateway: String, token: String, history: [ChatMessage], sources: [[String: String]], onDelta: @escaping @MainActor (String) -> Void) async throws {
        guard let url = URL(string: gateway.trimmingCharacters(in: CharacterSet(charactersIn: "/ ")) + "/v1/chat") else { throw URLError(.badURL) }
        var req = URLRequest(url: url, timeoutInterval: 120)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue("text/event-stream", forHTTPHeaderField: "accept")
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
        let messages = history.filter { !$0.isError && !$0.text.isEmpty }.suffix(20).map { ["role": $0.role, "content": $0.text] }
        req.httpBody = try JSONSerialization.data(withJSONObject: ["messages": messages, "sources": sources, "stream": true])
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

struct AIView: View {
    @EnvironmentObject var model: BrowserModel
    @EnvironmentObject var store: Store
    @EnvironmentObject var accounts: Accounts
    @Environment(\.dismiss) private var dismiss
    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var sharePage = false
    @State private var busy = false
    var initialPrompt: String? = nil
    var initialShare = false

    private let suggestions: [(String, Bool)] = [("Summarise this page in five points", true), ("Is this website safe?", false), ("Explain this page like I'm in Grade 8", true), ("Make study notes from this page", true)]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            if messages.isEmpty { empty }
                            ForEach(messages) { m in bubble(m).id(m.id) }
                        }.padding()
                    }
                    .onChange(of: messages) { _ in if let last = messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } } }
                }
                composer
            }
            .navigationTitle("Nebula")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .primaryAction) { Button { messages = [] } label: { Image(systemName: "square.and.pencil") }.accessibilityLabel("New conversation") }
            }
        }
        .onAppear { if let p = initialPrompt, messages.isEmpty { sharePage = initialShare; send(p) } }
    }

    private var empty: some View {
        VStack(spacing: 12) {
            NebulaOrb(size: 56)
            Text(accounts.current.map { "Hi \($0.firstName), I'm Nebula" } ?? "Hi, I'm Nebula").font(.title2.weight(.semibold))
            Text("Ask anything, or share this page with Nebula.").foregroundStyle(.secondary)
            ForEach(suggestions, id: \.0) { s in
                Button { sharePage = s.1; send(s.0) } label: { Text(s.0).frame(maxWidth: .infinity) }.buttonStyle(.bordered).buttonBorderShape(.capsule)
            }
        }.padding(.top, 40)
    }

    private func bubble(_ m: ChatMessage) -> some View {
        let mine = m.role == "user"
        return HStack {
            if mine { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 6) {
                if m.text.isEmpty && !mine && !m.isError { ProgressView() } else {
                    Text((try? AttributedString(markdown: m.text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(m.text))
                        .textSelection(.enabled)
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
            .padding(12)
            .background(mine ? AnyShapeStyle(Color.accentColor) : m.isError ? AnyShapeStyle(Color.red.opacity(0.15)) : AnyShapeStyle(.regularMaterial), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .foregroundStyle(mine ? Color.white : Color.primary)
            if !mine { Spacer(minLength: 40) }
        }
    }

    private var composer: some View {
        VStack(spacing: 8) {
            Toggle(isOn: $sharePage) { Label("Share this page", systemImage: "doc.text") }
                .toggleStyle(.button).buttonBorderShape(.capsule).font(.footnote)
                .disabled(!(model.active.map { !$0.isHome && $0.url.hasPrefix("http") } ?? false))
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(alignment: .bottom) {
                TextField("Ask anything…", text: $input, axis: .vertical).lineLimit(1...5)
                    .padding(10).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .onSubmit { send(input) }
                Button { send(input) } label: { Image(systemName: "arrow.up.circle.fill").font(.system(size: 32)) }
                    .disabled(busy || input.trimmingCharacters(in: .whitespaces).isEmpty)
                    .keyboardShortcut(.return, modifiers: .command)
            }
            Text("Nebula only sees what you share. It can make mistakes.").font(.caption2).foregroundStyle(.secondary)
        }.padding()
    }

    private func send(_ text: String) {
        let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !busy else { return }
        input = ""
        messages.append(ChatMessage(role: "user", text: q))
        busy = true
        let tab = model.active
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
                messages.append(local.map { ChatMessage(role: "assistant", text: $0, note: "Answered on your device by Rovian Defender.") }
                    ?? ChatMessage(role: "assistant", text: "Nebula isn't set up yet. Add your Nebula gateway address in Settings → Nude services. Safety questions like \"Is this website safe?\" or pasting a suspicious message work without it.", isError: true))
                return
            }
            messages.append(ChatMessage(role: "assistant", text: "", sources: used))
            let index = messages.count - 1
            do {
                try await NudeAI.stream(gateway: store.aiGateway, token: store.serviceToken, history: Array(messages.dropLast()), sources: sources) { delta in
                    if index < messages.count { messages[index].text += delta }
                }
            } catch {
                messages[index] = local.map { ChatMessage(role: "assistant", text: $0, note: "Answered on your device — Nebula isn't reachable.") }
                    ?? ChatMessage(role: "assistant", text: "Nebula isn't reachable (\(error.localizedDescription)).", isError: true)
            }
        }
    }
}
