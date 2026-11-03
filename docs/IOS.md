# Nude for iPhone, iPad and Mac

## iPhone & iPad (`apps/ios`)

SwiftUI app on **WebKit** (`WKWebView`). Apple requires all iOS/iPadOS browsers to use WebKit, so this is the same engine Safari, Chrome and Edge use on iPhone.

What's included: tabs and private tabs (separate, in-memory website data), address bar with search and suggestions, home page, bookmarks, history, find on page, desktop-site mode, downloads (saved to **Files → Nude → Downloads**) with Nude Security checks, the Nude Security warning page, tracker blocking with WebKit content rules (3 protection levels, HTTPS-only at Maximum), security dashboard, link checker, and the Nude AI sheet (page sharing is opt-in; on-device safety answers when no gateway is configured).

iPad: tab strip and address bar along the top, form-sheet panels, and hardware-keyboard shortcuts — ⌘T new tab, ⌘⇧N private tab, ⌘W close, ⌘L address bar, ⌘R reload, ⌘[ / ⌘] back/forward, ⌘F find, ⌘D bookmark, ⌘Y history, ⌘⇧A Nude AI, ⌘⇧[ / ⌘⇧] switch tabs.

### Build

Requirements: a Mac with Xcode 16+, and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```bash
cd apps/ios
brew install xcodegen
xcodegen generate          # creates Nude.xcodeproj from project.yml
open Nude.xcodeproj        # pick your team under Signing & Capabilities, then Run on a device or simulator
xcodebuild test -project Nude.xcodeproj -scheme Nude -destination 'platform=iOS Simulator,name=iPhone 16'
```

### Installing on a device

Apple doesn't allow installing app files directly the way Android does. Options:

| Option | Cost | Notes |
|---|---|---|
| Sideload the `Nude-iOS-unsigned.ipa` from Releases with [Sideloadly](https://sideloadly.io) or [AltStore](https://altstore.io) | Free Apple ID | Re-sign every 7 days; max 3 sideloaded apps |
| Run from Xcode on your own device | Free Apple ID | Same 7-day limit |
| **TestFlight** | Apple Developer Program, $99/year | Up to 10,000 testers, builds last 90 days |
| **App Store** | Apple Developer Program | Requires App Review; to be offered as a *default browser* app, request Apple's `com.apple.developer.web-browser` entitlement |

To automate TestFlight uploads from CI, add an App Store Connect API key and signing certificate as repository secrets and extend the `ios` job with `xcodebuild archive` + `-exportArchive` (or fastlane).

## Mac

The Mac version is the desktop Chromium app (`apps/desktop`), the same as Windows. CI builds a universal `.dmg` (Apple silicon + Intel). It's ad-hoc signed but not notarised yet, so on first launch right-click Nude → **Open**. If macOS says the app is "damaged", run `xattr -cr /Applications/Nude.app`. For a warning-free install, sign with a Developer ID certificate and notarise (set `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` secrets and switch the job to electron-builder's `dmg` target).
