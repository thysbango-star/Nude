# Sign in with Rovian

Nude Browser signs people in with their Rovian Account using OAuth 2.1 Authorization Code + PKCE (S256) and OpenID Connect. Nude is a **public client**: there is no client secret, by design.

| Setting | Value |
|---|---|
| Issuer | `https://oaupnrdlgxavdvefhbnp.supabase.co/auth/v1` |
| Client ID | `84d370e0-9203-4a58-b516-d05ded71bac3` |
| Scopes | `openid email profile` |
| Redirect URI | `http://127.0.0.1:47811/nude-browser/callback` (**must be on Rovian's allow-list**) |

Endpoints are read from `<issuer>/.well-known/openid-configuration` at sign-in time (Supabase publishes `/oauth/authorize` and `/oauth/token`). The document is rejected unless its `issuer` matches exactly and every endpoint is HTTPS.

## Why a loopback redirect URI

Nude is an installed app, not a website, so it has no web origin. Native apps use a loopback redirect (RFC 8252). Nude never needs a server on that port: when Rovian redirects the tab to `http://127.0.0.1:47811/nude-browser/callback?...`, Nude's request filter catches the navigation **before any request is made** and handles it in the app process. If the allow-list only accepts HTTPS, the redirect can be any HTTPS URL on a domain we control; only `ROVIAN.redirectUri` in `apps/desktop/src/main/rovian-auth.ts` changes.

## The flow (desktop: `apps/desktop/src/main/rovian-auth.ts`)

1. **Continue with Rovian** (welcome or account page) → the main process makes a 43-character `code_verifier` (32 random bytes), its S256 `code_challenge`, a random `state` and a random `nonce`. They live only in the main process's memory, for at most 10 minutes.
2. The same tab opens Rovian's `authorize` page with `response_type=code`, `client_id`, `redirect_uri`, `scope`, `state`, `nonce`, `code_challenge`, `code_challenge_method=S256`. The address bar stays visible and Rovian Defender checks the page like any other.
3. The user signs in to Rovian if needed and approves or denies on Rovian's consent screen.
4. The callback is intercepted. `state` must match a pending sign-in and is **single-use**. `error` (e.g. `access_denied`) shows a friendly message. A callback without both `code` and a valid `state` is refused.
5. The **token exchange happens in the app process**, never in a web page: `POST <token_endpoint>` (form-encoded) with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`.
6. The ID token is verified there: **RS256 only** (HS256 and `none` are rejected), signature against the JWKS key with the matching `kid` (re-fetched once if the key rotated), `iss` = issuer, `aud` = client ID (and `azp` when there are several audiences), `exp` not passed (60 s clock skew), `iat` not in the future, `nonce` = the one from step 1, `sub` present. **Any failure fails the sign-in.**
7. Nude keeps only the verified identity: `sub`, name, email (+ verified flag), `username` and the Rovian ID `username@rovian.cloud`. The username comes from the ID token (`username` / `preferred_username` / `user_metadata.username`), or else from Rovian's `userinfo` for the same `sub`. Every token is dropped right after; tokens, the verifier and the ID token are never written to disk, browser storage or logs.

The identity becomes a Nude account (`accounts.json`) linked by Rovian `sub`. An existing local account is joined to it only if Rovian has verified the same email. Several Rovian accounts can sit side by side (Account → Add another Rovian account) and you can switch between them; Remove forgets one on this device only.

## Tests

`apps/desktop/tests/unit/rovian-auth.test.ts` runs the whole flow against a fake Rovian with a real RSA key: the RFC 7636 test vector, request parameters, PKCE checked by the fake server, single-use state, denied consent, missing code, and rejection of bad signature, HS256, `alg: none`, wrong issuer, wrong audience, expiry, wrong or missing nonce and unknown key, plus issuer mismatch in discovery.

## Still needed from Rovian

- Add `http://127.0.0.1:47811/nude-browser/callback` to the Nude Browser client's redirect URIs.
- Confirm the ID token is signed with **RS256** (Supabase may also use ES256; Nude rejects anything but RS256, as specified).
- If Rovian puts the username in a different claim, tell us its name.
