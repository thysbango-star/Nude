# Nude for Android (APK) — Plan

Nude Web Browser on Android is a native Kotlin app at `apps/android`. It shares Nude's backend services and behaviour specs with the desktop browser, but not its UI code: Electron does not run on Android.

## 1. Rendering engine decision

| | **GeckoView** (recommended) | **Android System WebView** |
|---|---|---|
| What it is | Mozilla's full browser engine as a library (powers Firefox for Android) | The Chromium-based WebView shipped and updated with Android |
| Browser-grade control | Sessions per tab, private sessions, downloads, permission delegates, prompts, media, full-screen, PiP hooks | Built for embedding content in apps; tabs, history and many browser behaviours must be reimplemented |
| Tracker blocking | Built-in Enhanced Tracking Protection + content-blocking APIs | Must be done by intercepting requests (`shouldInterceptRequest`), limited |
| Private browsing | First-class private sessions | Shared cookie store per app process; true isolation is hard |
| Updates | Shipped inside the APK (you control the engine version and must ship security updates) | Updated by Google Play independently |
| APK size | Larger (~roughly tens of MB extra per ABI; use ABI splits / App Bundle) | Small |
| Licence | MPL 2.0 (compatible with a proprietary app; modified MPL files stay MPL) | Part of the OS |

**Recommendation:** GeckoView. It is the only option that gives a real browser engine on Android without maintaining a Chromium fork. The cost is APK size and owning engine security updates, so the release process must track GeckoView releases closely.

A Chromium fork (like Samsung Internet or Edge do) gives the closest parity with desktop but needs a dedicated team and build farm; it's not recommended at this stage.

Keep the engine behind an interface (`EngineSession`, `EngineView`) so WebView could be swapped in for a "lite" build if needed.

## 2. App architecture

```
apps/android/
  app/                       Application module, DI, navigation, theming (Nude design system)
  core/engine/               Engine abstraction + GeckoView implementation
  core/data/                 Room database: tabs, history, bookmarks, downloads, permissions, settings
  core/omnibox/              Input → URL/search resolution, suggestions (ported from desktop shared logic)
  core/security/             Phase 4: URL checks, typosquatting, download checks, threat-intel client
  feature/browser/           Tab view, toolbar, bottom bar, tab switcher, tab groups
  feature/newtab/            Nude home: search, shortcuts, recently visited
  feature/history|bookmarks|downloads|settings/
  feature/search/            Nude Search results UI (Phase 2)
  feature/ai/                Nude AI sheet (Phase 3), talks to services/ai-gateway
```

* Kotlin, Jetpack Compose, coroutines/Flow, Room, DataStore, Hilt.
* MVVM with unidirectional state, mirroring the desktop design where the engine/main layer owns state and the UI renders snapshots.
* Mobile layout: bottom address bar (reachability), swipe between tabs, grid tab switcher, rounded/glass surfaces from the Nude design tokens.

## 3. What is shared with desktop

| Shared | How |
|---|---|
| Nude Search, crawler, AI gateway, threat intel, sync | Same HTTPS/JSON services in `services/` |
| Omnibox, suggestion ranking, security heuristics | Same behaviour, verified by JSON test vectors in `packages/spec/` that both the TypeScript and Kotlin test suites run |
| Design system | Colour, radius, motion tokens exported from one source to CSS and Compose |
| Sync data model | Bookmarks, history, open tabs, settings — one schema |

## 4. Android-specific integration

* **Default browser:** `RoleManager.ROLE_BROWSER`, plus `VIEW` intent filters for `http`/`https`.
* **Downloads:** Android `DownloadManager` / MediaStore so files appear in the system Downloads.
* **Passwords & passkeys:** Android Autofill framework and Credential Manager.
* **Biometrics:** BiometricPrompt to unlock private tabs and saved passwords.
* **Share sheet**, **notifications** (download complete, Nude Security alerts), **Picture-in-picture** for video.
* **Nude OS on Android:** if Nude OS is an Android-based OS, the app reads system theme/accent via standard Android theming (Material You dynamic colour) and any Nude OS system APIs once they exist.

## 5. Security

* GeckoView content processes are isolated; Nude never loads remote code into the app process.
* No API keys in the APK; all AI/search provider keys stay in `services/`.
* Network security config: no cleartext except user-requested HTTP pages; HTTPS-first.
* Release builds: R8/minification, signed with a key held in CI secrets (never in the repo), Play App Signing if published on Play.

## 6. Building the APK

Requirements: JDK 17+, Android SDK (command-line tools), Gradle wrapper (committed with the module).

```bash
cd apps/android
./gradlew assembleDebug                 # app/build/outputs/apk/debug/app-debug.apk
./gradlew test connectedAndroidTest     # unit + device tests
./gradlew bundleRelease                 # .aab for Google Play
./gradlew assembleRelease               # signed APK for direct install / Nude OS store
```

Release signing reads `NUDE_KEYSTORE_PATH`, `NUDE_KEYSTORE_PASSWORD`, `NUDE_KEY_ALIAS`, `NUDE_KEY_PASSWORD` from the environment. Use ABI splits (`arm64-v8a`, `armeabi-v7a`, `x86_64`) to keep each APK small.

CI (GitHub Actions): lint → unit tests → spec vectors → emulator tests → build per-ABI APKs → attach to a GitHub Release.

## 7. Phases

| Phase | Scope |
|---|---|
| **A1 — Foundation** | Project scaffold, GeckoView integration, tabs, navigation, omnibox, new tab page, private tabs, history, bookmarks, downloads, settings, session restore, default-browser role |
| **A2 — Nude Search** | Search home + results UI on the Phase 2 search API |
| **A3 — Nude AI** | AI bottom sheet; explicit "share this page/selection" consent; confirmation for actions |
| **A4 — Nude Security** | Pre-navigation checks, warning screen, download checks, tracker blocking levels |
| **A5 — Integration & polish** | Sync with desktop, passkeys, biometrics, PiP, animations |
| **A6 — Release** | Security review, performance on low-end devices, accessibility (TalkBack), signed APK/AAB |

A1 can start in parallel with desktop Phase 2, since the shared services are not needed for the foundation.

## 8. Open decisions for the Nude team

1. Engine: GeckoView (recommended) or System WebView?
2. Distribution: Google Play, a Nude OS app store, direct APK download, or all three?
3. Is Nude OS itself Android-based? If so, which Android version is the base — this sets `minSdk` and which system APIs Nude can use.
