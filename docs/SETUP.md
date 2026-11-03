# Nude — Setup, configuration and deployment

## 1. Desktop browser (`apps/desktop`)

| Command | What it does |
|---|---|
| `npm install` (repo root) | Installs all workspaces, including Electron 43.3.0 |
| `npm start` | Builds with esbuild and launches Nude |
| `npm run dev -w apps/desktop` | Rebuilds on change (restart Electron to pick up main-process changes) |
| `npm run typecheck -w apps/desktop` | TypeScript strict check |
| `npm test -w apps/desktop` | Unit tests (omnibox, suggestions, shortcuts, settings validation, downloads) |
| `npm run test:e2e -w apps/desktop` | Launches the real browser with Playwright and tests navigation, popups, bookmarks, phishing blocking, tracker blocking, download blocking, reader view, private windows, closed tabs. On Linux without a display: `xvfb-run -a npm run test:e2e -w apps/desktop` |
| `npm run package:win -w apps/desktop` | Windows NSIS installer + portable zip in `apps/desktop/release/` (run on Windows, or use CI) |
| `npm run package:linux -w apps/desktop` | AppImage + .deb |

Environment variables:

| Variable | Purpose |
|---|---|
| `NUDE_USER_DATA` | Use a different profile folder (testing, multiple profiles) |
| `NODE_ENV=production` | Minified build without source maps |

Profile data (JSON files in the OS user-data folder — e.g. `%APPDATA%\Nude` on Windows): `settings.json`, `bookmarks.json`, `history.json`, `downloads.json`, `permissions.json`, `security.json`, `session.json`. Writes are atomic; an unreadable file is kept as `*.corrupt-<time>` and reset.

### Nude services from the browser

**Settings → Nude services** holds the addresses of the Nude Search server, the Nude AI gateway and the threat-intelligence server, plus an optional access token. Defaults are `http://127.0.0.1:8787`, `:8790` and `:8791`. Use **Check now** to test them.

## 2. Android (`apps/android`)

Requirements: JDK 17, Android SDK (platform 35), Gradle 8.10+ (or Android Studio).

```bash
cd apps/android
gradle testDebugUnitTest     # unit tests (omnibox + Nude Security engine)
gradle assembleDebug         # app/build/outputs/apk/debug/app-debug.apk
gradle assembleRelease       # signed release APK (see signing below)
```

**Signing.** Release builds use the keystore from these environment variables (CI reads them from repository secrets):

| Secret / variable | Value |
|---|---|
| `NUDE_KEYSTORE_BASE64` | `base64 -w0 nude-release.jks` |
| `NUDE_KEYSTORE_PASSWORD` | keystore password |
| `NUDE_KEY_ALIAS` | key alias |
| `NUDE_KEY_PASSWORD` | key password |

Create a keystore once and keep it safe (losing it means users can't update):

```bash
keytool -genkeypair -v -keystore nude-release.jks -alias nude -keyalg RSA -keysize 4096 -validity 10000
```

Then add the four values under **GitHub → Settings → Secrets and variables → Actions**. Without them, CI signs with a temporary debug key: the APK installs fine, but each build has a different key, so you'll need to uninstall before installing a newer one.

## 3. Nude Search (`services/search`)

```bash
npm start -w services/search                       # http://127.0.0.1:8787
npm run crawl -w services/search -- --seed https://example.com --max 500 --depth 3 --same-host
npm test -w services/search
```

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `8787` / `127.0.0.1` | Listen address (use `0.0.0.0` in containers) |
| `NUDE_SEARCH_DB` | `./data/nude-search.db` | SQLite index file |
| `NUDE_ADMIN_TOKEN` | — | Required for `POST /api/crawl` |
| `BRAVE_SEARCH_API_KEY` | — | Fallback: [Brave Search API](https://brave.com/search/api/) |
| `SEARXNG_URL` | — | Fallback: your own SearXNG instance (enable JSON output) |
| `NUDE_FALLBACK` | — | `off` disables fallback entirely |
| `NUDE_FALLBACK_MIN` | `5` | Use fallback when Nude's index has fewer results than this |
| `NUDE_AI_GATEWAY_URL` | — | Enables AI answers on the results page |
| `NUDE_SERVICE_TOKEN` | — | Token sent to the AI gateway |
| `NUDE_RECRAWL_MINUTES` | `0` | Re-crawl due pages on this interval (0 = off) |
| `NUDE_ADS_FILE` | — | JSON file of keyword-matched ads. Ads are always labelled "Ad" and never affect organic ranking |

API:

| Endpoint | Description |
|---|---|
| `GET /api/search?q=&type=web\|news\|images\|videos\|shopping&page=&per_page=&safe=strict\|moderate\|off&time=day\|week\|month\|year&lang=&prefer=host1,host2` | Structured results with `source` on every result (`nude` or the fallback provider's name) |
| `GET /api/suggest?q=` | OpenSearch suggestions `[query, [suggestions]]` |
| `GET /api/trending` | Popular recent queries (only queries searched 3+ times) |
| `GET /api/answer?q=` | Server-sent-events AI answer over the top results, with sources |
| `POST /api/crawl` (Bearer admin token) | `{ "seeds": ["https://…"], "maxPages": 500, "maxDepth": 3, "sameHost": true }` |
| `GET /api/stats`, `GET /health`, `GET /opensearch.xml` | Index size, health, browser search-engine registration |
| `GET /`, `GET /search?q=` | The Nude Search website |

How it works: NudeBot (`User-Agent: NudeBot/0.1`) reads `robots.txt` (RFC 9309, incl. crawl-delay and sitemaps), honours `noindex`/`nofollow` and canonical URLs, strips tracking parameters, skips duplicate content by hash, and re-crawls pages more often when they change. Pages go into an SQLite FTS5 index. Ranking blends BM25 relevance (title > description > headings > body) with title/host matches, inbound links, page quality, freshness and spam penalties, and limits each site to two results per page. Personalisation only uses hosts the client sends in `prefer` — nothing is stored per user; only aggregate query counts are kept for suggestions and trending.

## 4. Nude AI gateway (`services/ai-gateway`)

```bash
ANTHROPIC_API_KEY=sk-ant-… npm start -w services/ai-gateway     # http://127.0.0.1:8790
npm test -w services/ai-gateway
```

| Variable | Default | Purpose |
|---|---|---|
| `NUDE_AI_PROVIDER` | auto | `anthropic`, `openai` (any OpenAI-compatible API) or `mock` |
| `ANTHROPIC_API_KEY` | — | Anthropic API key ([console.anthropic.com](https://console.anthropic.com)) |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | — / OpenAI | For OpenAI, OpenRouter, Azure OpenAI, or local Ollama (`http://localhost:11434/v1`, no key) |
| `NUDE_AI_MODEL` | `claude-sonnet-5-5` / `gpt-4o-mini` | Model name for the provider |
| `NUDE_SERVICE_TOKEN` | — | If set, clients must send `Authorization: Bearer <token>` (set the same token in the browser's Settings) |
| `NUDE_AI_MAX_TOKENS` | `1500` | Max answer length |
| `NUDE_AI_RATE_LIMIT` | `30` | Requests per minute per IP |

`POST /v1/chat` `{ messages: [{role, content}], sources: [{id, kind, title, url, content}] }` → `text/event-stream` of `{delta}` … `{done:true}` or `{error}`.

Privacy and safety: the browser sends page text, selections, tabs or files **only when the user turns on sharing** for that request. Shared content is wrapped as untrusted data; delimiter look-alikes are stripped so a page can't break out of its block; the system prompt forbids following instructions inside sources and forbids helping bypass Nude Security. The assistant can't submit forms or buy anything — it tells the user what to do.

## 5. Threat intelligence (`services/threat-intel`)

```bash
NUDE_ADMIN_TOKEN=change-me npm start -w services/threat-intel    # http://127.0.0.1:8791
```

| Variable | Default | Purpose |
|---|---|---|
| `NUDE_THREAT_DB` | `./data/threats.db` | SQLite database |
| `NUDE_FEEDS` | URLhaus + OpenPhish | JSON array of `{ name, url, format: "urls"\|"domains"\|"csv-url", category }` |
| `NUDE_FEED_REFRESH_MINUTES` | `60` | Refresh interval |
| `NUDE_ADMIN_TOKEN` | — | For `/v1/admin/*` |

Endpoints: `GET /v1/lists` (what browsers download), `GET /v1/check?url=`, `POST /v1/report` (stored for human review, never auto-blocks), `POST /v1/admin/ingest`, `GET /v1/admin/reports`, `GET /v1/admin/feeds`. Shared hosting domains (github.com, docs.google.com, …) are never blocked wholesale. Check each feed's terms before commercial use.

## 6. Deploying the services

`docker compose up --build -d` runs all three with persistent volumes. Put them behind HTTPS (Caddy, nginx or a cloud load balancer), set `NUDE_SERVICE_TOKEN` and `NUDE_ADMIN_TOKEN`, and point the browsers at the public HTTPS addresses in **Settings → Nude services**. Keep provider API keys only in the gateway's environment or a secret manager — never in the browser or app.

## 7. Releases

CI (`.github/workflows/build.yml`) runs on every push: typecheck, unit tests, real-browser end-to-end tests, service tests, the Windows installer and the Android APK. Pushing a tag like `v0.1.0` also publishes a GitHub Release with the Windows installer, the portable zip and the APK attached.

```bash
git tag v0.1.1 && git push origin v0.1.1
```

Code signing (recommended before public distribution): a Windows Authenticode certificate (set `CSC_LINK` / `CSC_KEY_PASSWORD` secrets for electron-builder) removes the SmartScreen warning; the Android keystore secrets above keep APK updates working.
