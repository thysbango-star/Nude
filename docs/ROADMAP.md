# Nude — Roadmap

Status key: ✅ done · 🚧 in progress · ⏳ planned

## Desktop (Electron / Chromium)

| Phase | Scope | Status |
|---|---|---|
| 1 — Browser foundation | Windows, tabs (background, reorder, recently closed, mute), navigation, omnibox with suggestions, private windows, session restore, bookmarks, history, downloads, settings, site permissions, find in page, zoom, full screen, keyboard shortcuts, context menus, error pages | ✅ |
| 2 — Nude Search | `services/search`: crawler (robots.txt, sitemaps, dedupe, incremental re-crawl), SQLite FTS5 index, ranking, API, results website, AI answers, labelled fallback (Brave/SearXNG) | ✅ first version |
| 3 — Nude AI | `services/ai-gateway` (Anthropic / OpenAI-compatible), side panel with streaming, citations, explicit sharing of page / selection / tabs / files, prompt-injection defences, on-device safety answers. Not yet: AI performing actions on pages | ✅ first version |
| 4 — Nude Security | `packages/security-engine`, `services/threat-intel`, pre-navigation checks, warning page, download checks, tracker blocking, 3 protection levels, HTTPS-only (Maximum), dashboard | ✅ first version |
| 5 — Nude OS integration & polish | Done: system theme + accent colour, notifications, split view, tab overview, reader view, default-browser registration. To do: password manager & passkeys, biometrics, sync, tab groups, translation, SQLite profile storage | 🚧 |
| 6 — Testing & release | Done: unit + real-browser end-to-end tests in CI, Windows installer and Android APK on every push/tag. To do: code signing, auto-update, accessibility audit, external security review | 🚧 |

## Android (APK)

See [ANDROID.md](ANDROID.md). Built: tabs, private tabs, address bar with suggestions, home page, bookmarks, history, downloads with security checks, Nude Security (warning page, tracker blocking, protection levels, dashboard), Nude AI sheet, settings, default-browser support. Engine: Android System WebView for v0.1 (GeckoView remains an option).

## Honest limits

* Nude Search will not have a web-scale index on day one. Results come from Nude's own index as it grows, with clearly labelled fallback providers until coverage is sufficient.
* Nude Security reduces risk; it cannot guarantee a site or file is safe, and the UI never claims it can.
