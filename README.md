# Nude

**Nude Web Browser**, **Nude Search**, **Nebula** and **Rovian Defender** — the browser ecosystem for Nude OS.

| Part | Where | What it is |
|---|---|---|
| Nude for Windows / Linux / macOS | [`apps/desktop`](apps/desktop) | Chromium-based browser (Electron 43): tabs, split view, private windows, reader view, bookmarks, history, downloads, permissions, Nebula panel, Rovian Defender |
| Nude for Android | [`apps/android`](apps/android) | Kotlin + Jetpack Compose browser on Android System WebView, with Rovian Defender and Nebula |
| Rovian Defender engine | [`packages/security-engine`](packages/security-engine) | Phishing, look-alike domain, scam-message, download and tracker analysis (shared by browser, AI and servers) |
| Nude Search | [`services/search`](services/search) | NudeBot crawler, SQLite full-text index, ranking engine, search API, results website, labelled fallback providers |
| Nebula gateway | [`services/ai-gateway`](services/ai-gateway) | Holds model-provider keys, builds injection-resistant prompts, streams answers |
| Threat intelligence | [`services/threat-intel`](services/threat-intel) | Ingests threat feeds, serves block lists and URL checks to browsers |
| Nude for iPhone, iPad | [`apps/ios`](apps/ios) | SwiftUI + WKWebView browser with Rovian Defender and Nebula |
| Website | [`apps/website`](apps/website) | The Nude landing page with download links (`python3 apps/website/build.py`) |

## The Nude experience

- **Accounts and "Hello, name".** On first run Nude opens a welcome page where you create a local Nude account (or continue without one). The home page then greets you with *Hello, {your first name}* on the moving peach gradient. Accounts are stored on the device; passwords are kept only as salted hashes (scrypt on desktop, PBKDF2-SHA256 on Android and iOS) with a lockout after 5 wrong attempts. Syncing across devices isn't built yet.
- **Nebula** is the AI assistant (formerly "Nude AI"). It reads a page only when you share it, cites what it used, can show product cards and highlight text on the page (with a neon frame so you see what it changed), and never overrides Rovian Defender.
- **Rovian Defender** is Nude Security: pre-navigation checks with the red *"This Website is Not Protected."* page, download checks, tracker and ad blocking. A blocked ad is replaced by the blue *"This Advert Has Been Blocked."* card; the *MALWARE* wording is shown only when the ad's host is actually flagged.
- **Modes**: Everyday, Shopping, Research, Study and Focus (chip at the top left). Shopping mode gives Nebula *Smart Compare*, *Mix & Match* and *Price Pulse*.
- **Light and dark**: the sun/moon toggle in the toolbar, or follow the system.

## Download

Get the latest builds from **[Releases](https://github.com/thysbango-star/Nude/releases)**:

- **Windows:** `Nude-Setup-<version>-x64.exe` (installer) or `Nude-<version>-Windows-x64.zip` (portable).
  The installer isn't code-signed yet, so SmartScreen may say "Windows protected your PC" → **More info → Run anyway**.
- **macOS:** `Nude-<version>-macOS.dmg` (Apple silicon + Intel). Not notarised yet: right-click the app → **Open** the first time.
- **Android:** `Nude-Android.apk` — open it on your phone and allow installing from your browser/Files app when asked. Needs Android 10 or newer.
- **iPhone / iPad:** `Nude-iOS-unsigned.ipa` — an unsigned test build for sideloading tools; TestFlight/App Store needs an Apple Developer account.

Every push to `main` also builds both; you'll find them under **Actions → latest run → Artifacts**.

## Quick start (developers)

Requirements: Node.js 22.13+, and for Android: JDK 17 + Android SDK.

```bash
npm install                  # installs all workspaces
npm start                    # builds and launches the desktop browser
npm test                     # unit tests (security engine, browser logic)
npm run test:e2e             # launches the real browser and drives it (Linux CI: xvfb-run -a npm run test:e2e)
```

Run the services (each in its own terminal):

```bash
npm start -w services/search          # Nude Search  → http://127.0.0.1:8787
npm start -w services/ai-gateway      # Nebula      → http://127.0.0.1:8790
npm start -w services/threat-intel    # Threat intel → http://127.0.0.1:8791
npm run crawl -w services/search -- --seed https://en.wikipedia.org/wiki/South_Africa --max 300
```

Or all at once with Docker: `docker compose up --build` (see [docker-compose.yml](docker-compose.yml)).

The browser's defaults point at these local addresses; change them under **Settings → Nude services**.

Full setup, configuration and API keys: **[docs/SETUP.md](docs/SETUP.md)** · Architecture: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** · Android: **[docs/ANDROID.md](docs/ANDROID.md)** · Status: **[docs/ROADMAP.md](docs/ROADMAP.md)**

## Honest limits

- Nude Search's own index only contains what NudeBot has crawled. Until it's large, configure a fallback provider (Brave Search API or your own SearXNG); fallback results are always labelled.
- Nebula needs a model provider key on the gateway (Anthropic, or any OpenAI-compatible API including a local Ollama). Without one it runs in a clearly labelled development mode, and safety questions are still answered on-device by Rovian Defender.
- Rovian Defender lowers risk but can't catch everything. It never claims a site or file is guaranteed safe.
