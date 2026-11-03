import XCTest
@testable import Nude

final class OmniboxTests: XCTestCase {
    private func r(_ s: String) -> OmniboxResult? { Omnibox.resolve(s, engine: .duckduckgo) }

    func testHostsBecomeHttps() {
        XCTAssertEqual(r("example.com"), .navigate("https://example.com"))
        XCTAssertEqual(r("news24.co.za/sport"), .navigate("https://news24.co.za/sport"))
        XCTAssertEqual(r("localhost:3000"), .navigate("http://localhost:3000"))
    }

    func testTextIsSearched() {
        if case .search = r("best braai recipes") {} else { XCTFail() }
        if case .search = r("hello") {} else { XCTFail() }
        if case .search = r("?example.com") {} else { XCTFail() }
        XCTAssertEqual(Omnibox.searchURL(.duckduckgo, "a&b"), "https://duckduckgo.com/?q=a%26b")
    }

    func testDangerousSchemesBlocked() {
        if case .blocked = r("javascript:alert(1)") {} else { XCTFail() }
        if case .blocked = r("file:///etc/passwd") {} else { XCTFail() }
    }

    func testDisplay() {
        XCTAssertEqual(Omnibox.display("https://www.example.com/a"), "example.com/a")
        XCTAssertEqual(Omnibox.display("http://example.com/"), "http://example.com/")
    }
}

final class SecurityTests: XCTestCase {
    func testLegitimateSitesAllowed() {
        for u in ["https://www.paypal.com/signin", "https://online.fnb.co.za/login", "https://accounts.google.com/", "https://www.google.de/"] {
            XCTAssertEqual(Security.analyze(u, level: .standard).action, .allow, u)
        }
    }

    func testTyposquats() {
        XCTAssertEqual(Security.detectTyposquat("paypa1.com")?.brand, "paypal")
        XCTAssertEqual(Security.detectTyposquat("standardbnak.co.za")?.brand, "standardbank")
        let v = Security.analyze("https://paypa1-login.com/verify", level: .standard)
        XCTAssertNotEqual(v.action, .allow)
        XCTAssertEqual(v.intendedSite, "https://paypal.com/")
    }

    func testBrandInSubdomainBlocked() {
        XCTAssertEqual(Security.analyze("https://paypal.com.account-verify.top/login", level: .standard).action, .block)
    }

    func testDownloads() {
        XCTAssertEqual(Security.analyzeDownload(filename: "invoice.pdf.exe", url: "https://x.com/a", source: nil, level: .standard).action, .block)
        XCTAssertEqual(Security.analyzeDownload(filename: "report.pdf", url: "https://x.com/a", source: nil, level: .standard).action, .allow)
    }

    func testScamMessage() {
        let m = Security.analyzeMessage("Dear customer, your account will be deleted within 24 hours. Verify your account at https://paypa1-secure.com/login and enter the OTP.")
        XCTAssertEqual(m.assessment, "Likely a scam")
    }

    func testContentBlockerRulesAreValidJSON() throws {
        for level in ProtectionLevel.allCases {
            let data = Data(Security.contentBlockerJSON(level).utf8)
            let rules = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [[String: Any]])
            XCTAssertFalse(rules.isEmpty)
        }
    }
}
