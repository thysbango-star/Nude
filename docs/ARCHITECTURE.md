# Nude — Architecture

Nude is a browser ecosystem for Nude OS: **Nude Web Browser**, **Nude Search**, **Nude AI** and **Nude Security**.

## Starting point

The repository `thysbango-star/Nude` was empty when work began (no commits), so there was no existing Nude OS code to reuse or preserve. Everything here is greenfield. If Nude OS code lives elsewhere, the shells below are designed to be dropped into it.

## Platform shells

The browser ships as two native shells over the same services:

| Shell | Path | Rendering engine | UI | Status |
|---|---|---|---|---|
| Desktop (Nude OS on Linux, plus Windows/macOS) | `apps/desktop` | Chromium, via Electron 43 `WebContentsView` | TypeScript, no UI framework | **Phase 1 built** |
| Android (APK) | `apps/android` | GeckoView (recommended) or Android System WebView | Kotlin + Jetpack Compose | Planned — see [ANDROID.md](ANDROID.md) |

Every tab is a real engine instance. Nothing is rendered from screenshots or mock HTML.

## Module map

```
apps/
  desktop/                 Desktop browser (Electron)
    src/main/              Main process: windows, tabs, sessions, downloads,
                           permissions, storage, nude:// protocol, shortcuts
    src/preload/           Isolated bridges: chrome.ts (browser UI), internal.ts (nude:// pages)
    src/renderer/chrome/   Browser UI: tab strip, toolbar, omnibox, prompts, find bar
    src/renderer/pages/    Internal pages: newtab, history, bookmarks, downloads, settings
    src/shared/            Pure logic (omnibox, suggestions, shortcuts) — unit tested
  android/                 (Phase A) Kotlin/Compose shell
packages/
  spec/                    Cross-platform test vectors (JSON) both shells must pass
  security-engine/         (Phase 4) URL/download analysis, typosquatting, reputation
services/
  search-api/              (Phase 2) Query, autocomplete, filters, pagination, fallback providers
  crawler/                 (Phase 2) robots.txt-respecting crawler + indexer
  ai-gateway/              (Phase 3) Model-provider orchestration; holds all API keys
  threat-intel/            (Phase 4) Threat database + feed ingestion
  sync/                    (Phase 5) Accounts and cross-device sync
```

Modules talk over explicit interfaces: IPC inside the desktop app, HTTPS/JSON between apps and services. No client ever holds a provider API key.

## Desktop process model

```
BrowserWindow (frameless, Nude chrome UI loaded from file://, preload: chrome.js)
 ├─ WebContentsView  tab 1   (sandboxed, contextIsolation, no Node, preload: internal.js)
 ├─ WebContentsView  tab 2
 └─ …
```

* The **main process** owns all state (tabs, profile, downloads, permissions) and pushes a single `WindowState` snapshot to the chrome UI whenever it changes. The UI is a pure view that sends commands back.
* **Tabs** are `WebContentsView`s with rounded corners, positioned in the content rect the UI reports. Only the active tab is visible. Restored and background tabs load lazily when first shown.
* **Popups and `target=_blank`** become tabs via `setWindowOpenHandler({createWindow})`, which keeps `window.opener` working for sign-in flows.
* **Overlays** (omnibox suggestions, menus) cannot draw above a native view, so the UI takes a snapshot of the page, shows it as a backdrop, and the view is hidden while the overlay is open.
* **Profiles/sessions:** normal windows use the persistent `persist:nude` partition. Each private window gets its own in-memory partition, wiped when the window closes; nothing from it reaches history, session restore or the persistent downloads list.

## Security model (desktop)

* All web content: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`.
* Two preload bridges with the smallest possible surface. The internal-page bridge only exposes its API when the page origin is `nude:`; the main process independently re-checks the sender frame URL on every internal IPC call, and checks that chrome-UI calls come from a known window's own UI.
* Web pages cannot navigate to or open `nude://` pages; only the user (omnibox, UI) can.
* `javascript:` URLs are refused from the omnibox.
* Internal pages are served by a custom protocol handler with path-traversal protection and a strict Content-Security-Policy. The chrome UI has its own strict CSP.
* Website permissions (camera, microphone, location, notifications, …) are **ask by default**, scoped per origin, and revocable from Settings. Private windows never persist permission decisions.
* Certificate errors are not bypassed; the navigation fails and the user sees an explanation.
* Phase 4 adds the Nude Security pipeline as a pre-navigation and pre-download hook in the same places.

## Storage

Phase 1 uses JSON stores in the user-data directory with atomic writes (write temp file → rename) and a backup of any corrupt file. History is capped. A move to SQLite is planned for Phase 5 once history volume and sync require it.

## AI and webpage content (Phase 3, design constraint)

Webpage text is untrusted. The AI gateway receives page content only when the user explicitly attaches it, marks it as data rather than instructions, and any AI-proposed action that submits, purchases or sends requires a confirmation the page cannot forge (rendered in browser chrome, not in the page). The AI cannot change Nude Security decisions.
