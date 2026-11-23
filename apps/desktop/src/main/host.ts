// Host Nude services: this computer runs Nude Accounts itself, so your Nude IDs live on your own machine.
//
// - The server listens only on this computer (127.0.0.1:8792) and keeps its data in Nude's own folder.
// - To reach it from phones and other computers without a domain or opening ports, Nude starts a Cloudflare
//   quick tunnel (cloudflared), which gives a public https://….trycloudflare.com address. That address changes
//   each time the tunnel restarts. With an address of your own (your domain, Tailscale Funnel, ngrok…), choose
//   "My own address" and Nude uses it instead of starting a tunnel.
// - cloudflared is downloaded once from Cloudflare's GitHub releases, pinned to one version, and checked against
//   the SHA-256 below before it is ever run.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { openDb } from '../../../../services/accounts/src/db';
import { createAccountsServer, type Options } from '../../../../services/accounts/src/server';

export const HOST_PORT = 8792;
export const LOCAL_URL = `http://127.0.0.1:${HOST_PORT}`;
export const CLOUDFLARED_VERSION = '2026.10.7';

/** Release file and SHA-256 for each platform this version is published for. */
const CLOUDFLARED: Record<string, { file: string; sha256: string }> = {
  'win32-x64': { file: 'cloudflared-windows-amd64.exe', sha256: '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343' },
  'darwin-x64': { file: 'cloudflared-darwin-amd64.tgz', sha256: '02f3edfd87684dd5b705607688e4eb4b323f6e777b81e7b3a85af556aa356848' },
  'darwin-arm64': { file: 'cloudflared-darwin-arm64.tgz', sha256: '3586ccf397e98e5f437e60e7c307ca6ac463e110580503af8bb8e6f9ebf831bd' },
  'linux-x64': { file: 'cloudflared-linux-amd64', sha256: '1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872' },
  'linux-arm64': { file: 'cloudflared-linux-arm64', sha256: '3df43aedc9ff291d1735b5cb576cb97e0b157488796db2e32b28aecabb445775' },
};

export type HostAddress = 'quick' | 'own';
export interface HostStatus {
  state: 'off' | 'starting' | 'downloading' | 'online' | 'local-only' | 'error';
  /** The address phones and other computers use. */
  publicUrl: string | null;
  localUrl: string;
  message: string;
}

/**
 * Finds the quick tunnel's address in cloudflared's output. Quick tunnel names are words joined by dashes
 * (bright-lake-pine-4521); api.trycloudflare.com, which appears in cloudflared's error messages, is not one.
 */
export function tunnelUrlIn(text: string): string | null {
  const m = /https:\/\/((?!api\.)[a-z0-9]+(?:-[a-z0-9]+)+)\.trycloudflare\.com(?![\w./-])/i.exec(text);
  return m ? `https://${m[1].toLowerCase()}.trycloudflare.com` : null;
}

/** Why the tunnel stopped, in plain words, from cloudflared's last output. */
export function tunnelProblem(text: string): string {
  if (/failed to request quick Tunnel|no such host|dial tcp/i.test(text)) return 'Cloudflare couldn\'t give this computer a public address. Check the internet connection (a firewall or VPN may be blocking Cloudflare).';
  if (/429|Too Many Requests/i.test(text)) return 'Cloudflare is limiting new addresses right now.';
  return 'The public address went away.';
}

/** An address of your own: https only (http is allowed for this computer's network, for testing). */
export function isOwnAddress(u: string): boolean {
  return /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/?$/.test(u.trim()) || /^http:\/\/(10|192\.168|172\.(1[6-9]|2\d|3[01]))\.[0-9.]+(:\d+)?\/?$/.test(u.trim());
}

export class NudeHost extends EventEmitter {
  private server: Server | null = null;
  private options: Options | null = null;
  private tunnel: ChildProcess | null = null;
  private retry: NodeJS.Timeout | null = null;
  private failures = 0;
  private wanted = false;
  status: HostStatus = { state: 'off', publicUrl: null, localUrl: LOCAL_URL, message: 'Off' };

  constructor(private dir: string, private download: (url: string) => Promise<Buffer>) { super(); mkdirSync(dir, { recursive: true }); }

  get running() { return this.server !== null; }

  private set(s: Partial<HostStatus>) {
    this.status = { ...this.status, ...s };
    if (this.options && this.status.publicUrl) this.options.issuer = this.status.publicUrl.replace(/\/$/, '');
    this.emit('status', this.status);
  }

  /** Starts (or restarts) hosting with the chosen address. */
  async start(address: HostAddress, ownUrl: string) {
    this.wanted = true;
    this.failures = 0;
    this.stopTunnel();
    try { await this.startServer(); } catch (e) {
      this.set({ state: 'error', publicUrl: null, message: (e as Error).message });
      return;
    }
    if (address === 'own') {
      const u = ownUrl.trim().replace(/\/$/, '');
      if (!isOwnAddress(u)) { this.set({ state: 'local-only', publicUrl: null, message: 'Running on this computer only. Enter your address (https://…) to let your phone in.' }); return; }
      this.set({ state: 'online', publicUrl: u, message: `Online at ${u}` });
      return;
    }
    await this.startTunnel();
  }

  stop() {
    this.wanted = false;
    this.stopTunnel();
    this.server?.close();
    this.server = null;
    this.options = null;
    this.set({ state: 'off', publicUrl: null, message: 'Off' });
  }

  private async startServer() {
    if (this.server) return;
    const db = openDb(join(this.dir, 'accounts.db'));
    this.options = { db, issuer: LOCAL_URL, persistent: true, trustProxy: true };
    const server = createAccountsServer(this.options);
    await new Promise<void>((resolve, reject) => {
      server.once('error', (e: NodeJS.ErrnoException) => reject(new Error(e.code === 'EADDRINUSE'
        ? `Port ${HOST_PORT} is already in use on this computer. Close the other program using it (another Nude Accounts?) and try again.`
        : `Nude Accounts couldn't start: ${e.message}`)));
      server.listen(HOST_PORT, '127.0.0.1', () => resolve());
    });
    this.server = server;
  }

  private async cloudflared(): Promise<string> {
    const pick = CLOUDFLARED[`${process.platform}-${process.arch}`];
    if (!pick) throw new Error(`Cloudflare's tunnel isn't available for this computer (${process.platform} ${process.arch}). Choose "My own address" instead.`);
    const bin = join(this.dir, `cloudflared-${CLOUDFLARED_VERSION}${process.platform === 'win32' ? '.exe' : ''}`);
    if (existsSync(bin)) return bin;
    this.set({ state: 'downloading', message: 'Downloading Cloudflare\'s tunnel (about 40 MB, once)…' });
    let data: Buffer;
    try { data = await this.download(`https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${pick.file}`); } catch {
      throw new Error('Nude couldn\'t download Cloudflare\'s tunnel. Check your internet connection, then turn hosting off and on again.');
    }
    const hash = createHash('sha256').update(data).digest('hex');
    if (hash !== pick.sha256) throw new Error('The tunnel download didn\'t match the expected file, so Nude didn\'t run it. Try again later.');
    if (pick.file.endsWith('.tgz')) {
      const tgz = join(this.dir, pick.file);
      writeFileSync(tgz, data);
      await new Promise<void>((resolve, reject) => {
        const t = spawn('tar', ['-xzf', tgz, '-C', this.dir, 'cloudflared']);
        t.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('Couldn\'t unpack the tunnel.'))));
        t.on('error', reject);
      });
      rmSync(tgz, { force: true });
      renameSync(join(this.dir, 'cloudflared'), bin);
    } else {
      writeFileSync(`${bin}.part`, data);
      renameSync(`${bin}.part`, bin);
    }
    if (process.platform !== 'win32') chmodSync(bin, 0o755);
    return bin;
  }

  private async startTunnel() {
    let bin: string;
    try { bin = await this.cloudflared(); } catch (e) {
      this.set({ state: 'error', publicUrl: null, message: (e as Error).message });
      return;
    }
    if (!this.wanted) return;
    this.set({ state: 'starting', publicUrl: null, message: 'Getting a public address from Cloudflare…' });
    const p = spawn(bin, ['tunnel', '--no-autoupdate', '--url', LOCAL_URL], { windowsHide: true });
    this.tunnel = p;
    let seen = '';
    const timer = setTimeout(() => { if (!this.status.publicUrl && this.tunnel === p) p.kill(); }, 60_000);
    const onData = (b: Buffer) => {
      seen = (seen + b.toString()).slice(-8000);
      const url = tunnelUrlIn(seen);
      if (url && this.status.publicUrl !== url) {
        clearTimeout(timer);
        this.failures = 0;
        this.set({ state: 'online', publicUrl: url, message: `Online at ${url}` });
      }
    };
    p.stdout?.on('data', onData);
    p.stderr?.on('data', onData);
    p.on('error', (e) => this.set({ state: 'error', publicUrl: null, message: `The tunnel couldn't start: ${e.message}` }));
    p.on('exit', () => {
      clearTimeout(timer);
      if (this.tunnel !== p) return;
      this.tunnel = null;
      if (!this.wanted) return;
      // The tunnel dropped (network change, sleep): get a new address, backing off after repeated failures.
      this.failures++;
      const wait = Math.min(300_000, 5_000 * 2 ** Math.min(this.failures, 6));
      this.set({ state: 'error', publicUrl: null, message: `${tunnelProblem(seen)} Trying again in ${Math.round(wait / 1000)} s… Nude Accounts still works on this computer.` });
      this.retry = setTimeout(() => { void this.startTunnel(); }, wait);
    });
  }

  private stopTunnel() {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const t = this.tunnel;
    this.tunnel = null;
    t?.kill();
  }

  /** Accounts on this computer's server (for the status line). */
  accountCount(): number | null {
    try { return (this.options?.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number } | undefined)?.n ?? null; } catch { return null; }
  }
}

export function hostDir(userData: string) { return join(userData, 'host'); }
