// Nebula on this computer, for free: the desktop app runs its own copy of the Nebula gateway against Ollama.
// No API key, nothing leaves the computer. Phones on the same Wi-Fi can use it when the user turns sharing on.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname, networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGateway } from '../../../../services/ai-gateway/src/server';
import { ollamaProvider } from '../../../../services/ai-gateway/src/providers';
import type { Settings } from '../shared/types';

/** Models that work well with Nebula, best first. All of these can read images. */
export const RECOMMENDED = [
  { name: 'gemma3:4b', size: '3.3 GB', note: 'Best for most laptops (8 GB of RAM or more)' },
  { name: 'gemma3:12b', size: '8.1 GB', note: 'Smarter, needs 16 GB of RAM or a graphics card' },
  { name: 'gemma3:1b', size: '0.8 GB', note: 'Fastest, for older computers (text only)' },
];

/** Port phones use when sharing is on, so the address stays the same. */
export const SHARE_PORT = 8792;

export interface OllamaStatus {
  running: boolean;
  models: string[];
  model: string | null;
  pulling: { model: string; percent: number; status: string } | null;
  /** url uses the IP address (Android); localUrl the computer's .local name (iPhone/iPad prefer it). */
  share: { url: string; localUrl: string; token: string } | null;
  error?: string;
}

export class LocalNebula {
  private server: Server | null = null;
  private key = '';
  private url = '';
  /** Protects this computer's Nebula from other apps and other people on the network. Kept, so phones stay paired. */
  readonly token: string;
  private pulling: OllamaStatus['pulling'] = null;
  private pullAbort: AbortController | null = null;

  constructor(private dir: string, private onChange: () => void) {
    const file = join(dir, 'nebula-local-token');
    let t = '';
    try { t = readFileSync(file, 'utf8').trim(); } catch { /* first run */ }
    if (!/^[\w-]{20,}$/.test(t)) {
      t = randomBytes(18).toString('base64url');
      try { writeFileSync(file, t, { mode: 0o600 }); } catch { /* read-only profile: a new code each run */ }
    }
    this.token = t;
  }

  /** A new access code: phones using the old one stop working. */
  resetToken() {
    const t = randomBytes(18).toString('base64url');
    (this as { token: string }).token = t;
    try { writeFileSync(join(this.dir, 'nebula-local-token'), t, { mode: 0o600 }); } catch { /* ignore */ }
    this.stop();
  }

  async models(base: string): Promise<string[] | null> {
    try {
      const r = await fetch(`${base.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(1500) });
      if (!r.ok) return null;
      const j = await r.json() as { models?: { name: string }[] };
      return (j.models ?? []).map((m) => m.name);
    } catch {
      return null;
    }
  }

  pickModel(installed: string[], wanted: string): string | null {
    if (wanted && installed.includes(wanted)) return wanted;
    for (const r of RECOMMENDED) if (installed.includes(r.name)) return r.name;
    return installed.find((m) => !/embed/i.test(m)) ?? null;
  }

  /** The address and token the browser should use, or null when Ollama isn't usable. */
  async endpoint(s: Settings): Promise<{ url: string; token: string; model: string } | null> {
    const installed = await this.models(s.ollamaUrl);
    if (!installed) { this.stop(); return null; }
    const model = this.pickModel(installed, s.ollamaModel);
    if (!model) { this.stop(); return null; }
    // A smaller model for quick chat when one is installed.
    const fast = installed.includes('gemma3:4b') && model === 'gemma3:12b' ? 'gemma3:4b' : model;
    const key = JSON.stringify([s.ollamaUrl, model, fast, s.nebulaShareOnNetwork]);
    if (this.server && key === this.key) return { url: this.url, token: this.token, model };
    this.stop();
    const server = createGateway({
      provider: ollamaProvider(model, s.ollamaUrl, fetch, fast),
      token: this.token, maxTokens: 1500, rateLimit: 120, maxSourceChars: 24_000, inlineImages: true,
    });
    const host = s.nebulaShareOnNetwork ? '0.0.0.0' : '127.0.0.1';
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', (e: NodeJS.ErrnoException) => {
        // The phone port is taken: fall back to any free port on this computer only.
        if (e.code === 'EADDRINUSE' && s.nebulaShareOnNetwork) server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
        else reject(e);
      });
      server.listen(s.nebulaShareOnNetwork ? SHARE_PORT : 0, host, () => resolve((server.address() as AddressInfo).port));
    }).catch(() => 0);
    if (!port) return null;
    this.server = server;
    this.key = key;
    this.url = `http://127.0.0.1:${port}`;
    return { url: this.url, token: this.token, model };
  }

  async status(s: Settings): Promise<OllamaStatus> {
    const installed = await this.models(s.ollamaUrl);
    const model = installed ? this.pickModel(installed, s.ollamaModel) : null;
    let share: OllamaStatus['share'] = null;
    if (s.nebulaShareOnNetwork && installed && model) {
      await this.endpoint(s);
      const port = this.server ? (this.server.address() as AddressInfo).port : 0;
      if (port === SHARE_PORT) share = { url: `http://${lanAddress() ?? 'this-computer'}:${SHARE_PORT}`, localUrl: `http://${hostname().toLowerCase().replace(/\.local$/, '')}.local:${SHARE_PORT}`, token: this.token };
    }
    return { running: Boolean(installed), models: installed ?? [], model, pulling: this.pulling, share };
  }

  /** Downloads a model through Ollama, reporting progress. */
  async pull(s: Settings, model: string) {
    if (this.pulling) return;
    if (!/^[\w.-]+(:[\w.-]+)?$/.test(model)) return;
    this.pulling = { model, percent: 0, status: 'Starting…' };
    this.pullAbort = new AbortController();
    this.onChange();
    try {
      const r = await fetch(`${s.ollamaUrl.replace(/\/+$/, '')}/api/pull`, { method: 'POST', body: JSON.stringify({ model, stream: true }), signal: this.pullAbort.signal });
      if (!r.ok || !r.body) throw new Error(`Ollama said ${r.status}`);
      const decoder = new TextDecoder();
      let buf = '';
      let last = 0;
      for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const j = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string };
          if (j.error) throw new Error(j.error);
          if (j.total && j.completed) this.pulling.percent = Math.round((j.completed / j.total) * 100);
          this.pulling.status = j.status ?? '';
          if (Date.now() - last > 400) { last = Date.now(); this.onChange(); }
        }
      }
      this.pulling = null;
      this.onChange();
    } catch (e) {
      this.pulling = { model, percent: 0, status: `Couldn't download: ${(e as Error).message}` };
      this.onChange();
      setTimeout(() => { this.pulling = null; this.onChange(); }, 6000);
    } finally {
      this.pullAbort = null;
    }
  }

  cancelPull() { this.pullAbort?.abort(); }

  stop() {
    this.server?.close();
    this.server = null;
    this.key = '';
  }
}

/** This computer's address on the local network (what a phone on the same Wi-Fi would use). */
function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a.address)) return a.address;
    }
  }
  return null;
}
