// Passwords, tokens, Nude IDs and rate limits.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const N = 1 << 15, R = 8, P = 1, LEN = 32;

export const ID_DOMAIN = 'nude';
export const nudeId = (username: string) => `${username}@${ID_DOMAIN}`;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, LEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${h.toString('base64url')}`;
}

export async function checkPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64url');
  const got = await scrypt(pw, Buffer.from(salt, 'base64url'), want.length, { N: +n, r: +r, p: +p, maxmem: 128 * +n * +r * 2 });
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A hash that costs the same as a real check, so unknown usernames take as long as wrong passwords. */
let dummy: string | null = null;
export async function burnPasswordCheck(pw: string) {
  dummy ??= await hashPassword('nude-dummy-password');
  await checkPassword(pw, dummy);
}

export const newToken = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`;
export const newId = () => randomBytes(12).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url');

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const RESERVED = new Set(['admin', 'administrator', 'root', 'nude', 'nudebrowser', 'support', 'help', 'security', 'system', 'official', 'staff',
  'team', 'mod', 'moderator', 'api', 'www', 'mail', 'abuse', 'postmaster', 'noreply', 'no-reply', 'billing', 'account', 'accounts', 'login', 'signin', 'null', 'undefined']);

/** Nude IDs: 3–24 characters, lowercase letters, digits, dots and underscores, starting with a letter. */
export function usernameProblem(u: string): string | null {
  if (u.length < 3 || u.length > 24) return 'Your Nude ID needs 3 to 24 characters.';
  if (!/^[a-z][a-z0-9._]*$/.test(u)) return 'Use lowercase letters, numbers, dots and underscores, starting with a letter.';
  if (/[._]{2}|[._]$/.test(u)) return 'Dots and underscores can\'t be doubled or come last.';
  if (RESERVED.has(u) || RESERVED.has(u.replace(/[._]/g, ''))) return 'That Nude ID is reserved.';
  return null;
}

export function passwordProblem(pw: string, username: string): string | null {
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 200) return 'That password is too long.';
  if (pw.toLowerCase().includes(username.toLowerCase())) return 'Your password can\'t contain your Nude ID.';
  if (/^(.)\1+$/.test(pw) || /^(0123456789|1234567890|password\d*|qwertyuiop)$/i.test(pw)) return 'That password is too easy to guess.';
  return null;
}

/** Failed sign-ins: 5 per Nude ID or 30 per address in 15 minutes, then a 15 minute pause. */
export class Limiter {
  private hits = new Map<string, number[]>();
  constructor(private windowMs = 15 * 60_000) {}
  blocked(key: string, max: number, now = Date.now()) {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.hits.set(key, list);
    return list.length >= max;
  }
  hit(key: string, now = Date.now()) { this.hits.set(key, [...(this.hits.get(key) ?? []), now]); }
  clear(key: string) { this.hits.delete(key); }
}

/** Keeps the network part of an address only, for the security log. */
export function coarseIp(ip: string | undefined): string | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.split('.').slice(0, 3).join('.') + '.x';
  return ip.split(':').slice(0, 3).join(':') + ':…';
}
