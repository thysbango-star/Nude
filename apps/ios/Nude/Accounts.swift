import Foundation
import CommonCrypto
import Security

/// A Nude account kept on this device. The password is stored only as a salted PBKDF2-SHA256 hash.
struct Account: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var email: String
    var firstName: String { name.split(separator: " ").first.map(String.init) ?? name }
    var initials: String { name.split(separator: " ").prefix(2).compactMap { $0.first.map { String($0).uppercased() } }.joined() }
}

private struct AccountRecord: Codable {
    var account: Account
    var salt: Data
    var hash: Data
    var failures: Int = 0
    var lockedUntil: Date?
}

@MainActor
final class Accounts: ObservableObject {
    private let d = UserDefaults.standard
    @Published private(set) var current: Account?
    /// True until the person creates an account, signs in or chooses to continue without one.
    @Published var needsWelcome: Bool

    init() {
        let id = d.string(forKey: "account.current")
        let recs = Accounts.load(d)
        let signedIn = recs.first { $0.account.id == id }?.account
        current = signedIn
        needsWelcome = signedIn == nil && !d.bool(forKey: "account.welcomed")
    }

    var known: [Account] { Accounts.load(d).map(\.account) }

    /// Returns an error message, or nil on success.
    func signUp(name: String, email: String, password: String) -> String? {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let e = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if n.isEmpty { return "Please enter your name." }
        if e.range(of: #"^[^@\s]+@[^@\s]+\.[^@\s]+$"#, options: .regularExpression) == nil { return "Please enter a valid email address." }
        if password.count < 8 { return "Use at least 8 characters for your password." }
        var recs = Accounts.load(d)
        if recs.contains(where: { $0.account.email == e }) { return "There's already an account for that email on this device. Sign in instead." }
        var salt = Data(count: 16)
        _ = salt.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 16, $0.baseAddress!) }
        let account = Account(id: UUID().uuidString, name: String(n.prefix(80)), email: e)
        recs.append(AccountRecord(account: account, salt: salt, hash: Accounts.hash(password, salt: salt)))
        save(recs)
        setCurrent(account)
        return nil
    }

    func signIn(email: String, password: String) -> String? {
        let e = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        var recs = Accounts.load(d)
        guard let i = recs.firstIndex(where: { $0.account.email == e }) else { return "Email or password is incorrect." }
        if let until = recs[i].lockedUntil, until > Date() { return "Too many attempts. Try again in a minute." }
        guard Accounts.constantTimeEqual(Accounts.hash(password, salt: recs[i].salt), recs[i].hash) else {
            recs[i].failures += 1
            if recs[i].failures >= 5 { recs[i].failures = 0; recs[i].lockedUntil = Date().addingTimeInterval(60) }
            save(recs)
            return "Email or password is incorrect."
        }
        recs[i].failures = 0
        recs[i].lockedUntil = nil
        save(recs)
        setCurrent(recs[i].account)
        return nil
    }

    func continueAsGuest() { d.set(true, forKey: "account.welcomed"); needsWelcome = false }
    func signOut() { d.removeObject(forKey: "account.current"); current = nil }

    private func setCurrent(_ a: Account) {
        d.set(a.id, forKey: "account.current")
        d.set(true, forKey: "account.welcomed")
        current = a
        needsWelcome = false
    }

    private func save(_ recs: [AccountRecord]) { d.set(try? JSONEncoder().encode(recs), forKey: "account.records") }
    private static func load(_ d: UserDefaults) -> [AccountRecord] {
        guard let data = d.data(forKey: "account.records") else { return [] }
        return (try? JSONDecoder().decode([AccountRecord].self, from: data)) ?? []
    }

    static func hash(_ password: String, salt: Data) -> Data {
        var out = Data(count: 32)
        let pw = Array(password.utf8).map { Int8(bitPattern: $0) }
        _ = out.withUnsafeMutableBytes { o in
            salt.withUnsafeBytes { s in
                CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pw, pw.count,
                                     s.bindMemory(to: UInt8.self).baseAddress, salt.count,
                                     CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 120_000,
                                     o.bindMemory(to: UInt8.self).baseAddress, 32)
            }
        }
        return out
    }

    static func constantTimeEqual(_ a: Data, _ b: Data) -> Bool {
        guard a.count == b.count else { return false }
        var diff: UInt8 = 0
        for (x, y) in zip(a, b) { diff |= x ^ y }
        return diff == 0
    }
}
