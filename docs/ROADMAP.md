# Nude — Roadmap

Status key: ✅ done · 🚧 in progress · ⏳ planned

## Desktop (Electron / Chromium)

| Phase | Scope | Status |
|---|---|---|
| 1 — Browser foundation | Windows, tabs (background, reorder, recently closed, mute), navigation, omnibox with suggestions, private windows, session restore, bookmarks, history, downloads, settings, site permissions, find in page, zoom, full screen, keyboard shortcuts, context menus, error pages | ✅ |
| 2 — Nude Search | Search home & results UI, `services/search-api`, `services/crawler` (robots.txt, sitemaps, dedupe, incremental), indexer, ranking, configurable fallback providers | ⏳ |
| 3 — Nude AI | `services/ai-gateway`, side panel, streaming, citations, explicit context sharing (page, selection, tab group, files), confirmed actions, prompt-injection defences | ⏳ |
| 4 — Nude Security | `packages/security-engine`, `services/threat-intel`, pre-navigation checks, warning screen, download checks, tracker blocking, protection levels, dashboard | ⏳ |
| 5 — Nude OS integration & polish | System theme/accent, notifications, share sheet, password manager, biometrics, sync, tab groups, split screen, tab previews, reader mode, translation, PiP, SQLite storage | ⏳ |
| 6 — Testing & release | Security testing, performance, accessibility, signed builds, auto-update | ⏳ |

## Android (APK)

See [ANDROID.md](ANDROID.md). Phases A1–A6 mirror the desktop phases; A1 can start alongside desktop Phase 2.

## Honest limits

* Nude Search will not have a web-scale index on day one. Results come from Nude's own index as it grows, with clearly labelled fallback providers until coverage is sufficient.
* Nude Security reduces risk; it cannot guarantee a site or file is safe, and the UI never claims it can.
