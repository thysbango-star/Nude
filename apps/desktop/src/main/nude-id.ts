// Talks to Nude Accounts for this computer. Each signed-in Nude ID has a device session token, kept only in the
// main process and encrypted with the operating system's key store (safeStorage). Pages never see a token.
import { safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { hostname, platform } from 'node:os';
import { join } from 'node:path';

export interface NudeAccount { id: string; username: string; nudeId: string; name: string; avatar: string | null; created: number; passwordChanged: number }
export interface NudeSession { id: string; name: string; platform: string; app: string; created: number; lastSeen: number; ip: string | null; current: boolean }
export interface NudeEvent { t: number; kind: string; detail: string; device: string | null; ip: string | null }

export class NudeIdError extends Error {
  constructor(message: string, public code = 'error', public status = 0) { super(message); }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export function deviceInfo() {
  const os = platform() === 'win32' ? 'Windows' : platform() === 'darwin' ? 'macOS' : 'Linux';
  return { name: `Nude on ${hostname().replace(/\.local$/, '').slice(0, 40) || os}`, platform: os, app: 'browser' };
}

export class NudeId {
  private tokens: Record<string, string> = {};
  private file: string;

  constructor(dir: string, private server: () => string, private fetchImpl: Fetch) {
    this.file = join(dir, 'nude-id.bin');
    try {
      if (existsSync(this.file) && safeStorage.isEncryptionAvailable()) this.tokens = JSON.parse(safeStorage.decryptString(readFileSync(this.file)));
    } catch { this.tokens = {}; }
  }

  private save() {
    if (!safeStorage.isEncryptionAvailable()) return; // without the OS key store, stay signed in for this run only
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(this.tokens)));
    renameSync(tmp, this.file);
  }

  has(accountId: string) { return Boolean(this.tokens[accountId]); }
  forget(accountId: string) { delete this.tokens[accountId]; this.save(); }
  get base() { return this.server().replace(/\/$/, ''); }

  private async call<T>(method: string, path: string, body?: unknown, accountId?: string, raw?: { data: Uint8Array; type: string }): Promise<T> {
    if (!/^https?:\/\//.test(this.base)) throw new NudeIdError('No Nude Accounts server is set. Turn on Settings → Host Nude services on this computer, or enter your server\'s address under Nude services.', 'no_server');
    const headers: Record<string, string> = {};
    if (accountId) {
      const t = this.tokens[accountId];
      if (!t) throw new NudeIdError('This Nude ID is signed out on this computer. Sign in again.', 'signed_out', 401);
      headers.authorization = `Bearer ${t}`;
    }
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (raw) headers['content-type'] = raw.type;
    let r: Response;
    try {
      r = await this.fetchImpl(this.base + path, { method, headers, body: raw ? Buffer.from(raw.data) : body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new NudeIdError(`Nude couldn't reach Nude Accounts (${new URL(this.base).host}). Check your connection and try again.`, 'offline');
    }
    const j = await r.json().catch(() => ({})) as T & { error?: string; code?: string };
    if (!r.ok) {
      if (r.status === 401 && accountId && j.code === 'signed_out') this.forget(accountId);
      throw new NudeIdError(j.error ?? serverProblem(r.status, new URL(this.base).host), j.code ?? 'error', r.status);
    }
    return j;
  }

  status() { return this.call<{ ok: boolean; persistent: boolean; issuer: string }>('GET', '/v1/status'); }
  available(username: string) { return this.call<{ available: boolean; problem: string | null }>('GET', `/v1/username/${encodeURIComponent(username)}`); }

  async signUp(username: string, name: string, password: string): Promise<NudeAccount> {
    const r = await this.call<{ token: string; account: NudeAccount }>('POST', '/v1/accounts', { username, name, password, device: deviceInfo() });
    this.tokens[r.account.id] = r.token; this.save();
    return r.account;
  }

  async signIn(username: string, password: string): Promise<NudeAccount> {
    const r = await this.call<{ token: string; account: NudeAccount }>('POST', '/v1/sessions', { username, password, device: deviceInfo() });
    this.tokens[r.account.id] = r.token; this.save();
    return r.account;
  }

  async signOut(accountId: string) {
    try { await this.call('DELETE', '/v1/session', undefined, accountId); } catch { /* signed out here either way */ }
    this.forget(accountId);
  }

  me(id: string) { return this.call<{ account: NudeAccount; persistent: boolean }>('GET', '/v1/me', undefined, id); }
  rename(id: string, name: string) { return this.call<{ account: NudeAccount }>('PATCH', '/v1/me', { name }, id); }
  setAvatar(id: string, data: Uint8Array) { return this.call<{ account: NudeAccount }>('PUT', '/v1/me/avatar', undefined, id, { data, type: 'image/jpeg' }); }
  removeAvatar(id: string) { return this.call<{ account: NudeAccount }>('DELETE', '/v1/me/avatar', undefined, id); }
  changePassword(id: string, current: string, next: string) { return this.call<{ signedOut: number }>('POST', '/v1/me/password', { current, next }, id); }
  async deleteAccount(id: string, password: string) { await this.call('DELETE', '/v1/me', { password }, id); this.forget(id); }
  sessions(id: string) { return this.call<{ sessions: NudeSession[] }>('GET', '/v1/me/sessions', undefined, id); }
  revoke(id: string, session: string) { return this.call('DELETE', `/v1/me/sessions/${encodeURIComponent(session)}`, undefined, id); }
  events(id: string) { return this.call<{ events: NudeEvent[] }>('GET', '/v1/me/events?limit=100', undefined, id); }
  apps(id: string) { return this.call<{ apps: { id: string; name: string; t: number }[] }>('GET', '/v1/me/apps', undefined, id); }
  removeApp(id: string, client: string) { return this.call('DELETE', `/v1/me/apps/${encodeURIComponent(client)}`, undefined, id); }

  /** Phone sign-in: a single-use code for Nude Companion; this computer must approve the phone. */
  startLink(id: string) { return this.call<{ id: string; secret: string; expires: number; server: string }>('POST', '/v1/links', {}, id); }
  linkState(id: string, link: string) { return this.call<{ state: string; device: { name: string; platform: string; app: string } | null; expires: number }>('GET', `/v1/links/${encodeURIComponent(link)}`, undefined, id); }
  decideLink(id: string, link: string, approve: boolean) { return this.call<{ state: string }>('POST', `/v1/links/${encodeURIComponent(link)}/${approve ? 'approve' : 'deny'}`, {}, id); }

  /** Sync (Nebula conversations and settings). */
  syncGet(id: string, space: string, since: number) { return this.call<{ items: { key: string; t: number; value: unknown }[]; now: number; more: boolean }>('GET', `/v1/sync/${space}?since=${since}`, undefined, id); }
  syncPut(id: string, space: string, key: string, value: unknown) { return this.call<{ t: number }>('PUT', `/v1/sync/${space}/${encodeURIComponent(key)}`, { value }, id); }
  syncDelete(id: string, space: string, key: string) { return this.call<{ t: number }>('DELETE', `/v1/sync/${space}/${encodeURIComponent(key)}`, undefined, id); }
}

/** What to tell you when the reply isn't from Nude Accounts itself (no JSON error of its own). */
export function serverProblem(status: number, host: string): string {
  if (status === 404) return `There's no Nude Accounts server at ${host}. Check the address in Settings → Nude Accounts server, or check that the Nude Accounts service is running on your server.`;
  if (status === 502 || status === 503 || status === 504) return `Nude Accounts at ${host} is starting up or unavailable. Try again in a minute.`;
  return `Nude Accounts at ${host} answered ${status}. Try again in a moment.`;
}
