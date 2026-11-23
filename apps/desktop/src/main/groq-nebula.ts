// Nebula on Groq: the same engine the Nebula app uses (Groq, openai/gpt-oss-120b), with your own Groq key.
// The key is kept only in the main process, encrypted with the operating system's key store, and is sent only
// to api.groq.com. Pages and the browser UI never see it; Settings shows only its last four characters.
import { safeStorage } from 'electron';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGateway } from '../../../../services/ai-gateway/src/server';
import { openAiCompatibleProvider } from '../../../../services/ai-gateway/src/providers';

export const GROQ_BASE = 'https://api.groq.com/openai/v1';
/** The models Nebula prefers, best first (from Nebula's brain.js). */
export const GROQ_MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
const FAST = ['openai/gpt-oss-20b', 'llama-3.1-8b-instant'];

/** Groq keys look like gsk_ followed by letters and digits. */
export const looksLikeGroqKey = (k: string) => /^gsk_[A-Za-z0-9]{20,100}$/.test(k.trim());

export class GroqNebula {
  private file: string;
  private key: string | null = null;
  private server: Server | null = null;
  private url = '';
  private readonly token = randomBytes(24).toString('base64url');
  private model = GROQ_MODELS[0];

  constructor(dir: string, private fetchImpl: typeof fetch = fetch) {
    this.file = join(dir, 'groq-key.bin');
    try { if (existsSync(this.file) && safeStorage.isEncryptionAvailable()) this.key = safeStorage.decryptString(readFileSync(this.file)); } catch { this.key = null; }
  }

  get hasKey() { return Boolean(this.key); }
  get hint() { return this.key ? `…${this.key.slice(-4)}` : null; }

  /** Checks the key with Groq (lists models) before keeping it. */
  async setKey(raw: string): Promise<{ ok: boolean; error?: string; model?: string }> {
    const k = raw.trim();
    if (!looksLikeGroqKey(k)) return { ok: false, error: 'That doesn\'t look like a Groq key (they start with gsk_). Get one free at console.groq.com → API Keys.' };
    let ids: string[];
    try {
      const r = await this.fetchImpl(`${GROQ_BASE}/models`, { headers: { authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(10_000) });
      if (r.status === 401) return { ok: false, error: 'Groq didn\'t accept that key. Check it at console.groq.com → API Keys.' };
      if (!r.ok) return { ok: false, error: `Groq answered ${r.status}. Try again in a moment.` };
      ids = ((await r.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? [];
    } catch {
      return { ok: false, error: 'Nude couldn\'t reach Groq. Check your connection.' };
    }
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'This computer can\'t store the key securely (no system key store).' };
    this.key = k;
    this.model = GROQ_MODELS.find((m) => ids.includes(m)) ?? ids.find((i) => i.includes('gpt-oss')) ?? GROQ_MODELS[0];
    writeFileSync(this.file, safeStorage.encryptString(k));
    this.stop();
    return { ok: true, model: this.model };
  }

  removeKey() { this.key = null; this.stop(); try { rmSync(this.file, { force: true }); } catch { /* ignore */ } }

  /** A Nebula gateway on this computer that answers with Groq. Null when there's no key. */
  async endpoint(): Promise<{ url: string; token: string; model: string } | null> {
    if (!this.key) return null;
    if (this.server) return { url: this.url, token: this.token, model: this.model };
    const fast = FAST.find((m) => m !== this.model) ?? this.model;
    const server = createGateway({
      provider: openAiCompatibleProvider(this.key, this.model, GROQ_BASE, this.fetchImpl, fast),
      token: this.token, maxTokens: 2000, rateLimit: 60, maxSourceChars: 24_000,
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    }).catch(() => 0);
    if (!port) return null;
    this.server = server;
    this.url = `http://127.0.0.1:${port}`;
    return { url: this.url, token: this.token, model: this.model };
  }

  stop() { this.server?.close(); this.server = null; }
}
