// Phone link: PassGate and Rovian Defender on your phone get their information from Nude on this PC, over your
// own Wi-Fi. Pairing is a QR code Nude shows; it carries a fresh 256-bit key that never crosses the network.
//
//   QR:       NUDE1:{"v":1,"a":"passgate"|"defender","h":[LAN addresses],"p":port,"i":offerId,"k":key,"n":pc name}
//   Pair:     POST /v1/pair  {i, d: device name, t: time ms, s: HMAC(macKey, "pair\n"+i+"\n"+d+"\n"+t)}
//   Read:     GET  /v1/device/<id>/<identity|report>  x-nude-time, x-nude-sig = HMAC(macKey, "GET\n"+path+"\n"+time)
//   Replies:  {"iv","ct"}: AES-256-GCM with encKey, additional data "nude-link-v1|"+path
//   Keys:     encKey = HMAC-SHA256(key, "nude-link enc"), macKey = HMAC-SHA256(key, "nude-link mac")
//
// The server only answers addresses on private networks, only while a code is showing or a phone is linked, and only
// to signed requests. Replies are encrypted, so others on the Wi-Fi can't read them. Nothing here contains a
// password, a token or a key for anything else.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from './store';

export type LinkApp = 'passgate' | 'defender';
export const LINK_PORTS = [47830, 47831, 47832, 47833, 47834];
const OFFER_TTL = 5 * 60_000;
const CLOCK_WINDOW = 5 * 60_000;

export interface LinkedDevice { id: string; app: LinkApp; name: string; key: string; created: number; lastSeen: number; lastAddress: string }
export interface PublicDevice { id: string; app: LinkApp; name: string; created: number; lastSeen: number }
interface Offer { id: string; app: LinkApp; key: Buffer; created: number }

const b64u = (b: Buffer) => b.toString('base64url');
export function linkKeys(key: Buffer) {
  return {
    enc: createHmac('sha256', key).update('nude-link enc').digest(),
    mac: createHmac('sha256', key).update('nude-link mac').digest(),
  };
}
export function sign(macKey: Buffer, msg: string) { return b64u(createHmac('sha256', macKey).update(msg, 'utf8').digest()); }
export function seal(encKey: Buffer, path: string, body: unknown, iv = randomBytes(12)) {
  const c = createCipheriv('aes-256-gcm', encKey, iv);
  c.setAAD(Buffer.from(`nude-link-v1|${path}`, 'utf8'));
  const ct = Buffer.concat([c.update(JSON.stringify(body), 'utf8'), c.final(), c.getAuthTag()]);
  return { iv: b64u(iv), ct: b64u(ct) };
}
export function open(encKey: Buffer, path: string, env: { iv: string; ct: string }): unknown {
  const raw = Buffer.from(env.ct, 'base64url');
  const d = createDecipheriv('aes-256-gcm', encKey, Buffer.from(env.iv, 'base64url'));
  d.setAAD(Buffer.from(`nude-link-v1|${path}`, 'utf8'));
  d.setAuthTag(raw.subarray(raw.length - 16));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString('utf8'));
}
function sameSig(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Only phones on the same private network (or this PC) may connect. */
export function isLanAddress(addr: string | undefined) {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/, '');
  if (a === '127.0.0.1' || a === '::1') return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(a);
  if (m) {
    const [x, y] = [Number(m[1]), Number(m[2])];
    return x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254) || (x === 100 && y >= 64 && y <= 127);
  }
  return /^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a);
}

/** This PC's addresses on its local networks, best first (Wi-Fi/Ethernet before virtual adapters). */
export function lanAddresses(): string[] {
  // For development on machines without a LAN (e.g. CI): NUDE_LINK_HOST=192.168.1.10
  if (process.env.NUDE_LINK_HOST && isLanAddress(process.env.NUDE_LINK_HOST)) return [process.env.NUDE_LINK_HOST];
  const out: { addr: string; score: number }[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal || !isLanAddress(i.address) || i.address.startsWith('169.254.')) continue;
      const virtual = /vEthernet|VirtualBox|VMware|docker|br-|veth|WSL|Hyper-V|utun|tailscale|zt/i.test(name);
      out.push({ addr: i.address, score: (virtual ? 0 : 10) + (i.address.startsWith('192.168.') ? 2 : 0) });
    }
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.addr).slice(0, 4);
}

export interface LinkData {
  identity(device: PublicDevice): unknown;
  report(device: PublicDevice): unknown;
}

export class PhoneLink {
  private server: Server | null = null;
  private port = 0;
  private offers = new Map<string, Offer>();
  private failures = new Map<string, { count: number; until: number }>();
  private store: JsonStore<{ devices: LinkedDevice[] }>;
  onChange: () => void = () => {};

  constructor(dir: string, private readonly data: LinkData, private readonly encrypt?: { seal(s: string): string; open(s: string): string }) {
    this.store = new JsonStore<{ devices: LinkedDevice[] }>(join(dir, 'phone-link.json'), () => ({ devices: [] }), 300);
    if (this.store.get().devices.length) void this.start().catch(() => {});
  }

  devices(): PublicDevice[] {
    return this.store.get().devices.map(({ id, app, name, created, lastSeen }) => ({ id, app, name, created, lastSeen }));
  }

  get listening() { return this.server !== null; }
  get address() { return { hosts: lanAddresses(), port: this.port }; }

  /** A fresh pairing code for one app. Starts listening if needed. */
  async offer(app: LinkApp): Promise<{ text: string; expires: number; hosts: string[]; port: number }> {
    await this.start();
    for (const [id, o] of this.offers) if (o.app === app || Date.now() - o.created > OFFER_TTL) this.offers.delete(id);
    const o: Offer = { id: b64u(randomBytes(16)), app, key: randomBytes(32), created: Date.now() };
    this.offers.set(o.id, o);
    const hosts = lanAddresses();
    const pc = (hostname() || 'This PC').slice(0, 40);
    // Once every code has expired, stop listening unless a phone is linked.
    setTimeout(() => {
      for (const [id, x] of this.offers) if (Date.now() - x.created > OFFER_TTL) this.offers.delete(id);
      if (!this.offers.size && !this.store.get().devices.length) this.stop();
    }, OFFER_TTL + 5_000).unref();
    const text = `NUDE1:${JSON.stringify({ v: 1, a: app, h: hosts, p: this.port, i: o.id, k: b64u(o.key), n: pc })}`;
    return { text, expires: o.created + OFFER_TTL, hosts, port: this.port };
  }

  /** Stop showing a code: forget unused offers, and stop listening if no phone is linked. */
  endOffers() {
    this.offers.clear();
    if (!this.store.get().devices.length) this.stop();
  }

  remove(id: string) {
    this.store.set((d) => ({ devices: d.devices.filter((x) => x.id !== id) }));
    if (!this.store.get().devices.length && !this.offers.size) this.stop();
    this.onChange();
  }

  async start() {
    if (this.server) return;
    for (const port of LINK_PORTS) {
      const s = createServer((req, res) => void this.handle(req, res).catch(() => reply(res, 500, { error: 'server' })));
      s.requestTimeout = 10_000;
      s.headersTimeout = 8_000;
      const ok = await new Promise<boolean>((resolve) => {
        s.once('error', () => resolve(false));
        s.listen(port, '0.0.0.0', () => resolve(true));
      });
      if (ok) { this.server = s; this.port = port; return; }
    }
    throw new Error('Nude couldn\'t open a connection for your phone. Another app may be using it.');
  }

  stop() {
    this.server?.close();
    this.server?.closeAllConnections?.();
    this.server = null;
  }

  flush() { this.store.flush(); }

  private keyOf(d: LinkedDevice) { return Buffer.from(this.encrypt ? this.encrypt.open(d.key) : d.key, 'base64url'); }

  private limited(ip: string) {
    const f = this.failures.get(ip);
    return Boolean(f && f.until > Date.now());
  }
  private fail(ip: string) {
    const f = this.failures.get(ip) ?? { count: 0, until: 0 };
    f.count++;
    if (f.count >= 8) f.until = Date.now() + Math.min(10 * 60_000, 15_000 * (f.count - 7));
    this.failures.set(ip, f);
    if (this.failures.size > 500) this.failures.delete(this.failures.keys().next().value!);
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    if (!isLanAddress(ip)) return reply(res, 403, { error: 'network' });
    if (this.limited(ip)) return reply(res, 429, { error: 'slow_down' });
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;

    if (req.method === 'GET' && path === '/v1/hello') return reply(res, 200, { nude: true, v: 1 });

    if (req.method === 'POST' && path === '/v1/pair') {
      const body = await readJson(req);
      const i = typeof body?.i === 'string' ? body.i : '';
      const d = typeof body?.d === 'string' ? body.d.slice(0, 60) : '';
      const t = typeof body?.t === 'number' ? body.t : 0;
      const s = typeof body?.s === 'string' ? body.s : '';
      const o = this.offers.get(i);
      if (!o || Date.now() - o.created > OFFER_TTL) { this.fail(ip); return reply(res, 410, { error: 'expired' }); }
      const { enc, mac } = linkKeys(o.key);
      if (Math.abs(Date.now() - t) > CLOCK_WINDOW || !sameSig(s, sign(mac, `pair\n${i}\n${d}\n${t}`))) { this.fail(ip); return reply(res, 401, { error: 'signature' }); }
      this.offers.delete(i);
      const keyText = b64u(o.key);
      const device: LinkedDevice = {
        id: b64u(randomBytes(16)), app: o.app, name: d.replace(/[\u0000-\u001f]/g, '') || 'Phone', key: this.encrypt ? this.encrypt.seal(keyText) : keyText,
        created: Date.now(), lastSeen: Date.now(), lastAddress: ip,
      };
      this.store.set((x) => ({ devices: [...x.devices, device].slice(-20) }));
      this.onChange();
      return reply(res, 200, seal(enc, path, { deviceId: device.id, app: device.app, pc: (hostname() || 'This PC').slice(0, 40) }));
    }

    const m = /^\/v1\/device\/([\w-]{10,40})\/(identity|report|unlink)$/.exec(path);
    if (!m) return reply(res, 404, { error: 'not_found' });
    const dev = this.store.get().devices.find((x) => x.id === m[1]);
    if (!dev) { this.fail(ip); return reply(res, 401, { error: 'unlinked' }); }
    let key: Buffer;
    try { key = this.keyOf(dev); } catch { return reply(res, 401, { error: 'unlinked' }); }
    const { enc, mac } = linkKeys(key);
    const t = Number(req.headers['x-nude-time']);
    const sig = String(req.headers['x-nude-sig'] ?? '');
    if (!Number.isFinite(t) || Math.abs(Date.now() - t) > CLOCK_WINDOW || !sameSig(sig, sign(mac, `${req.method}\n${path}\n${t}`))) {
      this.fail(ip);
      return reply(res, 401, { error: 'signature' });
    }
    const pub = this.devices().find((x) => x.id === dev.id)!;
    this.store.set((x) => ({ devices: x.devices.map((y) => (y.id === dev.id ? { ...y, lastSeen: Date.now(), lastAddress: ip } : y)) }));
    if (m[2] === 'unlink' && req.method === 'POST') {
      this.remove(dev.id);
      return reply(res, 200, seal(enc, path, { ok: true }));
    }
    if (req.method !== 'GET') return reply(res, 405, { error: 'method' });
    if (m[2] === 'identity' && dev.app !== 'passgate') return reply(res, 403, { error: 'app' });
    if (m[2] === 'report' && dev.app !== 'defender') return reply(res, 403, { error: 'app' });
    const payload = m[2] === 'identity' ? this.data.identity(pub) : this.data.report(pub);
    this.onChange();
    return reply(res, 200, seal(enc, path, payload));
  }
}

function reply(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 4096) return null;
    chunks.push(c as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; } catch { return null; }
}
