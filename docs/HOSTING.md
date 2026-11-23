# Hosting Nude services on your own computer

Nude Accounts (your Nude IDs, devices, phone sign-in and Nebula chat sync) runs inside the Nude desktop app.
No hosting company, no domain.

## Turn it on
Nude → Settings → **Host Nude services** → *Host Nude Accounts on this computer*.
(On a fresh install the welcome screen offers the same thing.)

- The server listens only on this computer: `http://127.0.0.1:8792`.
- Its data lives in Nude's own folder (`<user data>/host/accounts.db`) and survives restarts and updates.
- It runs while this computer is on and Nude is open.

## How your phone and other computers reach it
**Cloudflare tunnel (default, free, no account).** Nude downloads Cloudflare's `cloudflared`
(version 2026.10.7, checked against its SHA-256 before it ever runs) and gets a public address like
`https://bright-lake-pine-4521.trycloudflare.com`. Nothing is opened on your router.
That address **changes when Nude restarts**: phones then need the new address (scan the code again from
Account → Connect your phone, or type it under Settings → Nude Accounts server).

**My own address.** For an address that never changes, point any of these at `http://127.0.0.1:8792` and enter
the https address in Settings:
- a domain you own (Cloudflare named tunnel or a reverse proxy),
- Tailscale Funnel (`tailscale funnel 8792`, free, gives `https://<pc>.<tailnet>.ts.net`),
- ngrok's free static domain (`ngrok http --url=<name>.ngrok-free.app 8792`).

## Phones
- Nude Companion: scan the code from Nude on the hosting computer; the code carries the address.
- Nude for Android: Settings → Nude Accounts server → paste the address, then sign in.

## Running it without the desktop app
`docker compose up -d accounts` runs the same server with a permanent volume (see `docker-compose.yml`).
