// The loopback redirect receiver (RFC 8252 §7.3) for signing in with Rovian in the user's usual web browser.
// Listens on 127.0.0.1:47811 only (never the network), answers only the exact redirect path, and only while a
// sign-in is waiting. The page it returns says what happened and nothing else: no tokens, no codes.
import { createServer, type Server } from 'node:http';
import { ROVIAN, RovianAuthError } from './rovian-auth';

const redirect = new URL(ROVIAN.redirectUri);

export class RovianLoopback {
  private server: Server | null = null;

  constructor(private readonly onCallback: (url: string) => Promise<{ ok: boolean; message: string }>) {}

  get listening() { return this.server !== null; }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', ROVIAN.redirectUri);
      // Only the exact redirect, addressed to 127.0.0.1:47811 (a DNS-rebinding page can't fake the Host header).
      if (req.method !== 'GET' || url.pathname !== redirect.pathname || req.headers.host !== redirect.host) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      void this.onCallback(`${ROVIAN.redirectUri}${url.search}`).then(
        (r) => send(res, r.ok, r.message),
        () => send(res, false, 'Signing in with Rovian didn\'t work. Please go back to Nude and try again.'),
      );
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', (e: NodeJS.ErrnoException) => reject(e.code === 'EADDRINUSE'
        ? new RovianAuthError('Another app is using the connection Nude needs for Rovian sign-in. Close it, or sign in inside Nude instead.', 'loopback_in_use')
        : new RovianAuthError('Nude couldn\'t get ready for Rovian sign-in. Please try again.', 'loopback_failed')));
      server.listen(Number(redirect.port), redirect.hostname, () => resolve());
    });
    server.on('error', () => this.stop());
    this.server = server;
  }

  stop() {
    this.server?.close();
    this.server?.closeAllConnections?.();
    this.server = null;
  }
}

function send(res: import('node:http').ServerResponse, ok: boolean, message: string) {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  res.writeHead(ok ? 200 : 400, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
  });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${ok ? 'Signed in to Nude' : 'Rovian sign-in'}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f8f7f6;color:#1b1714;font:15px/1.5 "Poppins","Segoe UI",system-ui,sans-serif}
main{max-width:420px;padding:32px 24px;text-align:center}.dot{width:56px;height:56px;margin:0 auto 18px;border-radius:50%;display:grid;place-items:center;font-size:28px;color:#fff;background:${ok ? '#f57a3c' : '#a33a17'}}
h1{margin:0 0 8px;font-size:24px;font-weight:600;color:${ok ? '#f57a3c' : '#a33a17'}}p{margin:0;color:#6f6964}</style>
<main><div class="dot">${ok ? '&#10003;' : '!'}</div><h1>${ok ? 'You’re signed in' : 'Sign-in didn’t finish'}</h1><p>${esc(message)}</p><p style="margin-top:14px">You can close this tab and go back to Nude.</p></main>`);
}
