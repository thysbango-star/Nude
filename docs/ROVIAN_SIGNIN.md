# Sign in with Rovian

## Rovian Connect (what the Continue with Rovian button uses)

Nude's welcome and account pages open Rovian Account's popup, `https://rovianaccounts.lovable.app/connect`, exactly as Rovian's snippet does: Rovian says `rovian:connect-hello`, Nude answers `rovian:site-info` (`name: "Nude Browser"`), and after you approve Rovian posts `rovian:identity` (`rovianId`, `username`, `name`, `avatarUrl`) or `rovian:denied`. No tokens exist in this flow.

- Messages are accepted only from that exact origin and only from the popup the page opened (`renderer/pages/rovian-connect.ts`).
- Nude's own pages may open only that one popup, and the main process accepts an identity only from a page that opened it in the last 15 minutes (`main/rovian-connect.ts`, `main/window.ts`).
- The identity is checked again in the main process: `rovianId` must be `name@rovian.cloud`, `username` must match it, the avatar must be HTTPS (it is downloaded once, small images only, and kept as the account picture).
- Popups from websites (sign-in windows like this one) open as small windows with the site's address in the title, so `window.opener` works there too.

The OAuth 2.1 + PKCE client below is still in the code (and tested) but no longer on the button.

Nude Browser signs people in with their Rovian Account using OAuth 2.1 Authorization Code + PKCE (S256) and OpenID Connect. Nude is a **public client**: there is no client secret, by design.

| Setting | Value |
|---|---|
| Issuer | `https://oaupnrdlgxavdvefhbnp.supabase.co/auth/v1` |
| Client ID | `84d370e0-9203-4a58-b516-d05ded71bac3` |
| Scopes | `openid email profile` |
| Redirect URI | `http://127.0.0.1:47811/nude-browser/callback` (**must be on Rovian's allow-list**) |

Endpoints are read from `<issuer>/.well-known/openid-configuration` at sign-in time (Supabase publishes `/oauth/authorize` and `/oauth/token`). The document is rejected unless its `issuer` matches exactly and every endpoint is HTTPS.

## Why a loopback redirect URI

Nude is an installed app, not a website, so it has no web origin. Native apps use a loopback redirect (RFC 8252).

- **Default: your usual web browser.** *Continue with Rovian* opens Rovian's pages in your normal browser (RFC 8252 §8.12 recommends an external user-agent): you may already be signed in to Rovian there, and every "verify you're human" check works as it normally does. While the sign-in waits, Nude listens on `127.0.0.1:47811` (loopback only, never the network) for the exact redirect path and Host, then shows a small "You're signed in" page and brings Nude to the front (`rovian-loopback.ts`).
- **Fallback: inside Nude.** *Sign in inside Nude instead* uses the same tab; Nude's request filter catches the redirect **before any request is made**.

Both use the same redirect URI. If the allow-list only accepts HTTPS, only `ROVIAN.redirectUri` in `apps/desktop/src/main/rovian-auth.ts` changes.

## The flow (desktop: `apps/desktop/src/main/rovian-auth.ts`)

1. **Continue with Rovian** (welcome or account page) → the main process makes a 43-character `code_verifier` (32 random bytes), its S256 `code_challenge`, a random `state` and a random `nonce`. They live only in the main process's memory, for at most 10 minutes.
2. Your browser (or the same tab) opens Rovian's `authorize` page with `response_type=code`, `client_id`, `redirect_uri`, `scope`, `state`, `nonce`, `code_challenge`, `code_challenge_method=S256`. The address bar stays visible and Rovian Defender checks the page like any other.
3. The user signs in to Rovian if needed and approves or denies on Rovian's consent screen.
4. The callback is received (loopback) or intercepted (tab). `state` must match a pending sign-in and is **single-use**. `error` (e.g. `access_denied`) shows a friendly message. A callback without both `code` and a valid `state` is refused.
5. The **token exchange happens in the app process**, never in a web page: `POST <token_endpoint>` (form-encoded) with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`.
6. The ID token is verified there: **RS256** (or ES256, since Supabase's asymmetric keys can be either; the algorithm must match the JWKS key type, and HS256 and `none` are always rejected), signature against the JWKS key with the matching `kid` (re-fetched once if the key rotated), `iss` = issuer, `aud` = client ID (and `azp` when there are several audiences), `exp` not passed (60 s clock skew), `iat` not in the future, `nonce` = the one from step 1, `sub` present. **Any failure fails the sign-in.**
7. Nude keeps only the verified identity: `sub`, name, email (+ verified flag), `username` and the Rovian ID `username@rovian.cloud`. The username comes from the ID token (`username` / `preferred_username` / `user_metadata.username`), or else from Rovian's `userinfo` for the same `sub`. Every token is dropped right after; tokens, the verifier and the ID token are never written to disk, browser storage or logs.

The identity becomes a Nude account (`accounts.json`) linked by Rovian `sub`. An existing local account is joined to it only if Rovian has verified the same email. Several Rovian accounts can sit side by side (Account → Add another Rovian account) and you can switch between them; Remove forgets one on this device only.

## Tests

`apps/desktop/tests/unit/rovian-auth.test.ts` runs the whole flow against a fake Rovian with a real RSA key: the RFC 7636 test vector, request parameters, PKCE checked by the fake server, single-use state, denied consent, missing code, and rejection of bad signature, HS256, `alg: none`, wrong issuer, wrong audience, expiry, wrong or missing nonce and unknown key, plus issuer mismatch in discovery.

## Still needed from Rovian

- Add `http://127.0.0.1:47811/nude-browser/callback` to the Nude Browser client's redirect URIs.
- Confirm the ID token's signing algorithm (RS256 or ES256 are both handled).
- If a sign-in fails, Nude shows a short *Reference* code (for example `token_400_invalid_grant` or `id_token_alg`); it names the step that failed and never contains secrets.
- If Rovian puts the username in a different claim, tell us its name.

## Sign in with Rovian on websites (the Nude prompt)

When a page offers Rovian sign-in, Nude shows its own prompt at the top right of the page, like Google's One Tap: *Sign in to example.com with Rovian*, with your Rovian identity and **Continue as …**. Nude doesn't sign in for the site and never sees its tokens: Continue starts **the site's own** Rovian sign-in, exactly as if you had clicked its button. The site name comes from the address bar, never from the page. *Don't ask on this site* turns it off for that site.

A site gets the prompt in any of these ways (strongest first):

```html
<!-- 1. Point Nude at your own start-sign-in URL (same site only) -->
<meta name="rovian-signin" content="/auth/rovian">
<!-- or -->
<link rel="rovian-signin" href="/auth/rovian">

<!-- 2. A link straight to Rovian Account's authorize endpoint -->
<a href="https://oaupnrdlgxavdvefhbnp.supabase.co/auth/v1/oauth/authorize?client_id=…&redirect_uri=…&…">Sign in with Rovian</a>

<!-- 3. A visible button or link labelled "Sign in with Rovian" / "Continue with Rovian" (Nude clicks it for you) -->
```

The page is checked in an isolated world (the page can't tamper with the check), and every URL is re-validated in the main process (`rovian-prompt.ts`): start URLs must be on the same site and not downgrade to HTTP; authorize links must be the real endpoint with a `client_id` and `redirect_uri`. Rovian Defender still checks wherever the sign-in goes.

## Phone link (PassGate and Rovian Defender)

`nude://phone` (menu → *Connect your phone*, or Account → Your phone) shows a QR code for **PassGate** (sign in) or **Rovian Defender** (protection report). See `apps/desktop/src/main/phone-link.ts` for the protocol: the code carries a fresh 256-bit key; requests are HMAC-signed and replies AES-256-GCM-encrypted with keys derived from it; the PC only answers private-network addresses, only while a code is showing or a phone is linked. PassGate reads your verified identity and Nude's sign-in activity; Rovian Defender reads protection counts and recent events (site names only). Neither ever gets passwords, tokens or browsing history. Linked phones are listed on that page and can be unlinked there.
