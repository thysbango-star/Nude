# Getting Nebula working

Nebula (Nude's AI) has two parts:

1. **The browser** (Windows, macOS, Android, iPhone/iPad) shows Nebula and sends your question, plus only what you chose to share.
2. **A model**: either **Ollama** on your own computer (free, below), or **the Nebula gateway** (`services/ai-gateway`), a small server that holds a hosted AI provider's API key. That key never goes into the apps, so nobody can pull it out of a download.

Until Nebula has a model, it still answers safety questions ("Is this website safe?", pasted scam messages) on your device with Rovian Defender, and the panel shows **Set up Nebula**.

## The free way: Ollama on your computer (recommended)

Ollama runs the AI model on your own computer. It's free, needs no API key or account, and nothing you share with Nebula leaves your computer. The Nude desktop app talks to it directly, so there's no server to set up.

**What you need:** Windows 10/11 or a Mac, about 4 GB of free disk space, and 8 GB of RAM or more (16 GB is better).

1. **Install Ollama.** Go to <https://ollama.com/download>, download the installer for your computer and run it. On Windows it then sits in the system tray (the little llama icon by the clock). It starts by itself with your computer.
2. **Open Nude → Menu (•••) → Settings → Nebula.** "Where Nebula runs" is set to *Automatic*, which uses Ollama as soon as it's running. You should see **Ollama is running**.
3. **Download a model.** Press **Download** next to `gemma3:4b` (3.3 GB). The bar shows progress; it takes a few minutes on a fast connection. Pick by your computer:
   - `gemma3:4b`: best for most laptops (8 GB RAM or more). It can read images too.
   - `gemma3:12b`: smarter but slower (16 GB RAM, or a graphics card). Nude uses `gemma3:4b` for quick chat when both are installed.
   - `gemma3:1b`: for older computers (text only).
4. **Try it.** Click the Nebula orb, choose **Ask**, and type a question. The first answer takes a few extra seconds while the model loads into memory; after that it stays loaded for 30 minutes.
5. **Phones (optional).** Turn on **Let my phone use this computer's Nebula**. Windows asks whether Nude may use the network: allow it on **private networks**. Nude then shows an address and an access token. In Nude on your phone (same Wi-Fi), go to **Settings → Nude services** and enter them as *Nebula gateway* and *Access token*. Use the address marked Android or iPhone/iPad. The computer has to be on and awake for the phone to use it.

If you prefer the terminal, `ollama pull gemma3:4b` downloads the same model.

**Tips**
- Speed depends on your computer. A graphics card (NVIDIA, AMD or Apple silicon) makes answers much faster. On a laptop without one, expect a few words per second.
- Long pages are trimmed to about 24,000 characters for local models so they fit in the model's memory. Nude asks Ollama for a 16,000-token context.
- Local models are less accurate than the big hosted ones. Nebula still cites what it used, so you can check it.

**If something's wrong**

| What you see | Fix |
|---|---|
| "Ollama isn't running" | Open Ollama from the Start menu (or Applications on a Mac), then press **Check again**. |
| "isn't downloaded" | Download the model in Settings → Nebula, or run `ollama pull gemma3:4b`. |
| Very slow answers | Use `gemma3:4b` or `gemma3:1b`, close other heavy apps, or plug in your laptop. |
| Phone says "Nebula isn't reachable" | Check both are on the same Wi-Fi, the computer is awake, sharing is on, and Windows allowed Nude on private networks. |

## Hosted models (optional)

## 1. Get an API key

1. Go to <https://console.anthropic.com>, sign in, and add a payment method or credits under **Billing**.
2. Open **API keys** → **Create key**. Copy it (it starts with `sk-ant-`). Treat it like a password.

Any OpenAI-compatible provider also works (OpenAI, OpenRouter, or a local model through Ollama or LM Studio). See step 5.

## 2a. Quickest: run the gateway on your own computer

This is enough to use Nebula on the desktop browser on the same computer. Install Node.js 22 or newer, then in the project folder run:

**Windows (PowerShell)**
```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
npm start -w services/ai-gateway
```

**macOS / Linux**
```bash
ANTHROPIC_API_KEY=sk-ant-... npm start -w services/ai-gateway
```

It prints `Nebula gateway on http://127.0.0.1:8790 (provider: anthropic:claude-haiku-5-5+claude-sonnet-5-5)`. The desktop browser already points at `http://127.0.0.1:8790`, so open Nebula and ask something.

## 2b. For every device: run it on a server

Phones can't reach `127.0.0.1` on your computer, so for Android and iOS (and for friends) put the gateway on a server with HTTPS.

1. On any machine with Docker:
   ```bash
   cp .env.example .env
   # edit .env:
   #   ANTHROPIC_API_KEY=sk-ant-...
   #   NUDE_SERVICE_TOKEN=<a long random string, e.g. from: openssl rand -hex 24>
   docker compose up -d ai-gateway
   ```
2. Put it behind HTTPS. With [Caddy](https://caddyserver.com), a two-line `Caddyfile` does it and fetches the certificate itself:
   ```
   nebula.yourdomain.com {
     reverse_proxy localhost:8790
   }
   ```
3. Check it: `curl https://nebula.yourdomain.com/health` should return `{"ok":true,...,"assistant":"Nebula"}`.

Any host that runs a Docker container or Node 22 works the same way (a VPS, Fly.io, Railway, Render, a home server). Set the same environment variables there.

## 3. Point the apps at it

- **Desktop:** Menu → Settings → **Nude services** → *Nebula gateway* = `https://nebula.yourdomain.com`, *Access token* = your `NUDE_SERVICE_TOKEN`. Press **Check now**.
- **Android / iPhone / iPad:** Settings → **Nude services** → same two fields.

## 4. Speed and accuracy

Nebula uses two models:

| Setting | Model (default) | Used for |
|---|---|---|
| Fast | `claude-haiku-5-5` (`NUDE_AI_FAST_MODEL`) | Quick chat, tidying tabs into spaces |
| Deep | `claude-sonnet-5-5` (`NUDE_AI_MODEL`) | Pages, tabs, files and images you share |

**Auto** (the default) picks Fast for plain questions and Deep as soon as you share a page, tabs, a file or an image. You can switch it with the speed pill next to Nebula's send button, or in Settings → Nebula. Answers stream word by word, so the first words appear right away.

Accuracy rules Nebula follows: it only uses the sources you share, cites them as `[S1]`, `[S2]`, says when the page doesn't contain the answer, and treats page text as untrusted (instructions hidden in a page are ignored). It can't override Rovian Defender.

## Free options

Nebula doesn't need Anthropic. The gateway works with any OpenAI-compatible provider, and several have free tiers (limits checked November 2026; they change, so check the provider's page):

| Provider | Model | Free limits | Notes |
|---|---|---|---|
| Google AI Studio (Gemini) | `gemini-3.6-flash` | Requests per minute and per day are capped (429 when you hit them) | No card needed. Handles images. Free-tier prompts may be used by Google to improve its products. |
| Groq | `openai/gpt-oss-120b` | 30 per minute, 1,000 per day | Very fast. Text only (no image questions). |
| OpenRouter | any model ending in `:free` | 20 per minute, 50 per day (1,000 per day after buying $10 of credit once) | Many models through one key. |
| Ollama on your own PC | e.g. `llama3.1` | Unlimited | Completely free and private, but needs a reasonably strong computer, and phones can only use it if that PC is reachable. |

**Gemini (free):** create a key at <https://aistudio.google.com/apikey>, then:
```powershell
$env:NUDE_AI_PROVIDER = "openai"
$env:OPENAI_API_KEY = "<your Gemini key>"
$env:OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
$env:NUDE_AI_MODEL = "gemini-3.6-flash"
npm start -w services/ai-gateway
```

**Groq (free):** create a key at <https://console.groq.com/keys>, then the same with `OPENAI_BASE_URL=https://api.groq.com/openai/v1` and `NUDE_AI_MODEL=openai/gpt-oss-120b`.

The same variables go in `.env` for the Docker setup. Free tiers are fine for you and a few testers; for a public release you'd move to a paid tier (or let people bring their own key).

## 5. Other providers

```bash
# OpenAI
NUDE_AI_PROVIDER=openai OPENAI_API_KEY=sk-... NUDE_AI_MODEL=gpt-4o NUDE_AI_FAST_MODEL=gpt-4o-mini npm start -w services/ai-gateway
# A local model with Ollama (no key; runs on your machine)
NUDE_AI_PROVIDER=openai OPENAI_BASE_URL=http://127.0.0.1:11434/v1 NUDE_AI_MODEL=llama3.1 npm start -w services/ai-gateway
```

Image questions (Media → pick an image → ask) need a vision-capable model. Claude models handle them.

## 6. Limits and safety

- `NUDE_SERVICE_TOKEN`: when set, only apps with the token can use your gateway (and your API credit).
- `NUDE_AI_RATE_LIMIT`: requests per minute per address (default 30).
- `NUDE_AI_MAX_TOKENS`: longest answer (default 1500).
- Set a monthly spend limit in the Anthropic console as a backstop.

## Troubleshooting

| What you see | Fix |
|---|---|
| "Set up Nebula" / "Nebula isn't reachable" | The gateway isn't running, or the address in Settings is wrong. Open `<address>/health` in a browser. |
| "development mode with no model configured" | The gateway started without `ANTHROPIC_API_KEY` (or `OPENAI_*`). Set it and restart. |
| `401 Unauthorized` | The access token in the app doesn't match `NUDE_SERVICE_TOKEN`. |
| `Anthropic API error 401` | The API key is wrong or was revoked. |
| `Anthropic API error 400 … credit` | Add credits under Billing in the Anthropic console. |
| Works on desktop, not on the phone | The phone can't reach `127.0.0.1`. Use a server with HTTPS (step 2b). |
