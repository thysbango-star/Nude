// Nude Accounts: Nude IDs (name@nude) for the Nude browser, Nude Companion, PassGate, Nebula and
// any site that adds Sign in with Nude.
//
// Apps talk JSON with a device session token (Authorization: Bearer nds_…), kept by the app's own
// secure storage. Websites use OpenID Connect (/authorize, /token, /userinfo) with PKCE.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Db, Session, User } from './db';
import { openDb } from './db';
import {
  burnPasswordCheck, checkPassword, coarseIp, hashPassword, Limiter, newId, newToken, nudeId, passwordProblem, safeEqual, sha256, usernameProblem,
} from './auth';
import { discovery, jwt, redirectAllowed, s256, signingKey, type SigningKey } from './oidc';
import { authorizePage, homePage, messagePage } from './pages';

/**
 * issuer is the public address (it may change while running: the Nude desktop app's host mode sets it when its
 * tunnel comes up). trustProxy: the server sits behind a tunnel on this machine, so the visitor's address comes
 * from the tunnel's header rather than the socket.
 */
export interface Options { db: Db; issuer: string; adminToken?: string; persistent: boolean; now?: () => number; trustProxy?: boolean }

interface Device { name: string; platform: string; app: string }
const APPS = new Set(['browser', 'companion', 'passgate', 'nebula', 'web', 'other']);
const LINK_TTL = 2 * 60_000;
const CODE_TTL = 60_000;
const ACCESS_TTL = 3600_000;
const FORM_TTL = 10 * 60_000;
const SYNC_MAX = 256 * 1024;
const SYNC_TOTAL = 20 * 1024 * 1024;

class HttpError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }

export function createAccountsServer(o: Options) {
  const db = o.db;
  const now = o.now ?? Date.now;
  const key: SigningKey = signingKey(db);
  const fails = new Limiter();
  const links = new Map<string, { user: string; secret: string; expires: number; state: 'waiting' | 'claimed' | 'approved' | 'denied' | 'done'; claim?: string; device?: Device; token?: string }>();
  const forms = new Map<string, { params: AuthParams; expires: number }>();
  const secureCookie = () => o.issuer.startsWith('https://');
  const ipOf = (req: IncomingMessage) => visitorIp(req, o.trustProxy);

  // ---------------------------------------------------------------- helpers

  const account = (u: User) => ({
    id: u.id, username: u.username, nudeId: nudeId(u.username), name: u.name,
    avatar: u.avatar_at ? `${o.issuer}/v1/avatar/${u.id}?v=${u.avatar_at}` : null,
    created: u.created, passwordChanged: u.password_at,
  });

  const log = (user: string, kind: string, detail: string, device?: string | null, ip?: string | null) =>
    db.prepare('INSERT INTO events (user, t, kind, detail, device, ip) VALUES (?, ?, ?, ?, ?, ?)').run(user, now(), kind, detail.slice(0, 300), device ?? null, ip ?? null);

  const userById = (id: string) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
  const userByName = (u: string) => db.prepare('SELECT * FROM users WHERE username = ?').get(u) as User | undefined;

  function device(d: unknown): Device {
    const x = (d ?? {}) as Partial<Device>;
    const app = typeof x.app === 'string' && APPS.has(x.app) ? x.app : 'other';
    return { name: String(x.name ?? 'Unknown device').slice(0, 60), platform: String(x.platform ?? '').slice(0, 40), app };
  }

  function startSession(user: User, d: Device, ip: string | null): string {
    const token = newToken('nds');
    db.prepare('INSERT INTO sessions (id, user, token, name, platform, app, created, last_seen, last_ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), user.id, sha256(token), d.name, d.platform, d.app, now(), now(), ip);
    return token;
  }

  function authed(req: IncomingMessage): { user: User; session: Session } {
    const m = /^Bearer (nds_[A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization ?? '');
    if (!m) throw new HttpError(401, 'Sign in first.', 'signed_out');
    return bySessionToken(m[1], ipOf(req));
  }

  function bySessionToken(token: string, ip: string | null) {
    const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(sha256(token)) as Session | undefined;
    if (!session) throw new HttpError(401, 'This device was signed out.', 'signed_out');
    if (now() - session.last_seen > 60_000) db.prepare('UPDATE sessions SET last_seen = ?, last_ip = ? WHERE id = ?').run(now(), ip, session.id);
    return { user: userById(session.user)!, session };
  }

  async function signIn(username: string, password: string, ip: string | null): Promise<User> {
    const u = username.trim().toLowerCase().replace(/@nude$/, '');
    if (fails.blocked(`u:${u}`, 5) || fails.blocked(`ip:${ip}`, 30)) throw new HttpError(429, 'Too many tries. Wait 15 minutes and try again.', 'rate_limited');
    const user = userByName(u);
    const ok = user ? await checkPassword(password, user.password) : (await burnPasswordCheck(password), false);
    if (!user || !ok) {
      fails.hit(`u:${u}`); fails.hit(`ip:${ip}`);
      if (user) log(user.id, 'signin-failed', 'Wrong password', null, ip);
      throw new HttpError(401, 'That Nude ID and password don\'t match.', 'bad_credentials');
    }
    fails.clear(`u:${u}`);
    return user;
  }

  // ---------------------------------------------------------------- JSON API

  async function api(req: IncomingMessage, res: ServerResponse, p: string, url: URL) {
    const ip = ipOf(req);
    const m = req.method ?? 'GET';

    if (p === '/v1/status' && m === 'GET') return send(res, 200, { ok: true, persistent: o.persistent, issuer: o.issuer, idDomain: 'nude' });

    if (p.startsWith('/v1/username/') && m === 'GET') {
      const u = decodeURIComponent(p.slice(13)).toLowerCase();
      const problem = usernameProblem(u);
      return send(res, 200, { available: !problem && !userByName(u), problem: problem ?? (userByName(u) ? 'That Nude ID is taken.' : null) });
    }

    if (p === '/v1/accounts' && m === 'POST') {
      const b = await json(req);
      const username = String(b.username ?? '').trim().toLowerCase();
      const name = String(b.name ?? '').trim().slice(0, 60);
      const password = String(b.password ?? '');
      const problem = usernameProblem(username) ?? (!name ? 'Add your name.' : null) ?? passwordProblem(password, username);
      if (problem) throw new HttpError(400, problem, 'invalid');
      if (fails.blocked(`signup:${ip}`, 10)) throw new HttpError(429, 'Too many new accounts from this network. Try again later.', 'rate_limited');
      if (userByName(username)) throw new HttpError(409, 'That Nude ID is taken.', 'taken');
      fails.hit(`signup:${ip}`);
      const id = newId();
      db.prepare('INSERT INTO users (id, username, name, password, created, password_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, username, name, await hashPassword(password), now(), now());
      const user = userById(id)!;
      const d = device(b.device);
      const token = startSession(user, d, ip);
      log(id, 'created', `Nude ID ${nudeId(username)} created`, d.name, ip);
      return send(res, 201, { token, account: account(user) });
    }

    if (p === '/v1/sessions' && m === 'POST') {
      const b = await json(req);
      const user = await signIn(String(b.username ?? ''), String(b.password ?? ''), ip);
      const d = device(b.device);
      const token = startSession(user, d, ip);
      log(user.id, 'signin', `Signed in on ${d.name}`, d.name, ip);
      return send(res, 200, { token, account: account(user) });
    }

    // Phone sign-in by QR, step 2: the phone presents the code it scanned.
    if (p === '/v1/links/claim' && m === 'POST') {
      const b = await json(req);
      const l = links.get(String(b.id ?? ''));
      if (!l || l.expires < now() || l.state !== 'waiting' || !safeEqual(String(b.secret ?? ''), l.secret)) throw new HttpError(410, 'That code has expired. Show a new one in Nude.', 'expired');
      l.state = 'claimed'; l.claim = newToken('ndc'); l.device = device(b.device);
      return send(res, 200, { claim: l.claim, waitingFor: 'approval' });
    }
    // Step 4: the phone asks whether the computer approved.
    if (p === '/v1/links/poll' && m === 'POST') {
      const b = await json(req);
      const l = links.get(String(b.id ?? ''));
      if (!l || !l.claim || !safeEqual(String(b.claim ?? ''), l.claim)) throw new HttpError(410, 'That code has expired.', 'expired');
      if (l.state === 'denied') { links.delete(String(b.id)); return send(res, 200, { state: 'denied' }); }
      if (l.state === 'approved' && l.token) {
        const token = l.token; l.state = 'done'; l.token = undefined;
        return send(res, 200, { state: 'approved', token, account: account(userById(l.user)!) });
      }
      if (l.expires < now()) throw new HttpError(410, 'That code has expired.', 'expired');
      return send(res, 200, { state: 'waiting' });
    }

    if (p.startsWith('/v1/avatar/') && m === 'GET') {
      const row = db.prepare('SELECT avatar, avatar_type FROM users WHERE id = ?').get(p.slice(11)) as { avatar: Uint8Array | null; avatar_type: string } | undefined;
      if (!row?.avatar) throw new HttpError(404, 'No picture.');
      res.writeHead(200, { 'content-type': row.avatar_type, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" });
      return res.end(Buffer.from(row.avatar));
    }

    if (p === '/v1/admin/clients' && m === 'POST') {
      if (!o.adminToken || !safeEqual(req.headers.authorization ?? '', `Bearer ${o.adminToken}`)) throw new HttpError(401, 'Admin token required.');
      const b = await json(req);
      const redirects = (Array.isArray(b.redirects) ? b.redirects : []).map(String);
      if (!b.name || !redirects.length || !redirects.every(redirectAllowed)) throw new HttpError(400, 'Give a name and https redirect URIs.');
      const id = `nude_${newId()}`;
      db.prepare('INSERT INTO clients (id, name, redirects, created) VALUES (?, ?, ?, ?)').run(id, String(b.name).slice(0, 60), JSON.stringify(redirects), now());
      return send(res, 201, { client_id: id });
    }

    // ---- everything below needs a signed-in device
    const { user, session } = authed(req);

    if (p === '/v1/me' && m === 'GET') return send(res, 200, { account: account(user), device: { id: session.id, name: session.name, app: session.app }, persistent: o.persistent });
    if (p === '/v1/me' && m === 'PATCH') {
      const b = await json(req);
      const name = String(b.name ?? '').trim().slice(0, 60);
      if (!name) throw new HttpError(400, 'Add your name.');
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
      log(user.id, 'profile', 'Name changed', session.name, ip);
      return send(res, 200, { account: account(userById(user.id)!) });
    }
    if (p === '/v1/me' && m === 'DELETE') {
      const b = await json(req);
      if (!(await checkPassword(String(b.password ?? ''), user.password))) throw new HttpError(401, 'That password isn\'t right.', 'bad_credentials');
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      return send(res, 200, { deleted: true });
    }
    if (p === '/v1/me/avatar' && m === 'PUT') {
      const body = await raw(req, 512 * 1024);
      const type = imageType(body);
      if (!type) throw new HttpError(400, 'Use a JPEG, PNG or WebP picture.');
      db.prepare('UPDATE users SET avatar = ?, avatar_type = ?, avatar_at = ? WHERE id = ?').run(body, type, now(), user.id);
      log(user.id, 'profile', 'Profile picture changed', session.name, ip);
      return send(res, 200, { account: account(userById(user.id)!) });
    }
    if (p === '/v1/me/avatar' && m === 'DELETE') {
      db.prepare('UPDATE users SET avatar = NULL, avatar_type = NULL, avatar_at = NULL WHERE id = ?').run(user.id);
      return send(res, 200, { account: account(userById(user.id)!) });
    }
    if (p === '/v1/me/password' && m === 'POST') {
      const b = await json(req);
      if (!(await checkPassword(String(b.current ?? ''), user.password))) throw new HttpError(401, 'Your current password isn\'t right.', 'bad_credentials');
      const problem = passwordProblem(String(b.next ?? ''), user.username);
      if (problem) throw new HttpError(400, problem, 'invalid');
      db.prepare('UPDATE users SET password = ?, password_at = ? WHERE id = ?').run(await hashPassword(String(b.next)), now(), user.id);
      const out = db.prepare('DELETE FROM sessions WHERE user = ? AND id != ?').run(user.id, session.id);
      log(user.id, 'password', `Password changed; ${out.changes} other device${out.changes === 1 ? '' : 's'} signed out`, session.name, ip);
      return send(res, 200, { ok: true, signedOut: Number(out.changes) });
    }
    if (p === '/v1/session' && m === 'DELETE') {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
      log(user.id, 'signout', `Signed out on ${session.name}`, session.name, ip);
      return send(res, 200, { ok: true });
    }
    if (p === '/v1/me/sessions' && m === 'GET') {
      const rows = db.prepare('SELECT * FROM sessions WHERE user = ? ORDER BY last_seen DESC').all(user.id) as unknown as Session[];
      return send(res, 200, { sessions: rows.map((s) => ({ id: s.id, name: s.name, platform: s.platform, app: s.app, created: s.created, lastSeen: s.last_seen, ip: s.last_ip, current: s.id === session.id })) });
    }
    if (p.startsWith('/v1/me/sessions/') && m === 'DELETE') {
      const id = p.slice(16);
      const s = db.prepare('SELECT * FROM sessions WHERE id = ? AND user = ?').get(id, user.id) as Session | undefined;
      if (!s) throw new HttpError(404, 'That device isn\'t signed in.');
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      log(user.id, 'signout', `${s.name} signed out from ${session.name}`, session.name, ip);
      return send(res, 200, { ok: true });
    }
    if (p === '/v1/me/events' && m === 'GET') {
      const rows = db.prepare('SELECT t, kind, detail, device, ip FROM events WHERE user = ? ORDER BY t DESC LIMIT ?').all(user.id, Math.min(200, Number(url.searchParams.get('limit') ?? 50)));
      return send(res, 200, { events: rows });
    }
    if (p === '/v1/me/apps' && m === 'GET') {
      const rows = db.prepare('SELECT c.id, c.name, g.t FROM grants g JOIN clients c ON c.id = g.client WHERE g.user = ? ORDER BY g.t DESC').all(user.id);
      return send(res, 200, { apps: rows });
    }
    if (p.startsWith('/v1/me/apps/') && m === 'DELETE') {
      const client = p.slice(12);
      db.prepare('DELETE FROM grants WHERE user = ? AND client = ?').run(user.id, client);
      db.prepare('DELETE FROM access WHERE user = ? AND client = ?').run(user.id, client);
      log(user.id, 'app-removed', 'Removed access for a site', session.name, ip);
      return send(res, 200, { ok: true });
    }

    // Phone sign-in by QR, step 1 (on the signed-in computer) and step 3 (approve or deny).
    if (p === '/v1/links' && m === 'POST') {
      for (const [k, l] of links) if (l.expires < now() - LINK_TTL) links.delete(k);
      const id = newId(), secret = newToken('nls');
      links.set(id, { user: user.id, secret, expires: now() + LINK_TTL, state: 'waiting' });
      return send(res, 201, { id, secret, expires: now() + LINK_TTL, server: o.issuer });
    }
    const lm = /^\/v1\/links\/([A-Za-z0-9_-]+)(?:\/(approve|deny))?$/.exec(p);
    if (lm) {
      const l = links.get(lm[1]);
      if (!l || l.user !== user.id) throw new HttpError(404, 'That code has expired.', 'expired');
      if (m === 'GET') return send(res, 200, { state: l.expires < now() && l.state === 'waiting' ? 'expired' : l.state, device: l.device ?? null, expires: l.expires });
      if (m === 'POST' && l.state === 'claimed' && l.device) {
        if (lm[2] === 'approve') {
          l.token = startSession(user, l.device, null); l.state = 'approved';
          log(user.id, 'signin', `${l.device.name} signed in by scanning a code on ${session.name}`, session.name, ip);
        } else { l.state = 'denied'; log(user.id, 'signin-denied', `Refused a sign-in from ${l.device.name}`, session.name, ip); }
        return send(res, 200, { state: l.state });
      }
      throw new HttpError(409, 'Nothing to approve yet.');
    }

    // Sync spaces (Nebula conversations, settings…): last write wins per key; deletions kept as tombstones.
    const sm = /^\/v1\/sync\/([a-z0-9-]{1,32})(?:\/([A-Za-z0-9._:-]{1,120}))?$/.exec(p);
    if (sm) {
      const space = sm[1], k = sm[2];
      if (!k && m === 'GET') {
        const since = Number(url.searchParams.get('since') ?? 0);
        const rows = db.prepare('SELECT key, value, t FROM sync WHERE user = ? AND space = ? AND t > ? ORDER BY t LIMIT 500').all(user.id, space, since) as { key: string; value: string; t: number }[];
        return send(res, 200, { items: rows.map((r) => ({ key: r.key, t: r.t, value: r.value === '' ? null : JSON.parse(r.value) })), now: now(), more: rows.length === 500 });
      }
      if (k && m === 'PUT') {
        const body = await raw(req, SYNC_MAX);
        let value: unknown;
        try { value = JSON.parse(body.toString('utf8')).value; } catch { throw new HttpError(400, 'Send {"value": …} as JSON.'); }
        const text = JSON.stringify(value ?? null);
        const used = (db.prepare('SELECT COALESCE(SUM(LENGTH(value)), 0) AS n FROM sync WHERE user = ?').get(user.id) as { n: number }).n;
        if (used + text.length > SYNC_TOTAL) throw new HttpError(413, 'Your synced data is full (20 MB).');
        const t = Math.max(now(), ((db.prepare('SELECT MAX(t) AS t FROM sync WHERE user = ? AND space = ?').get(user.id, space) as { t: number | null }).t ?? 0) + 1);
        db.prepare('INSERT INTO sync (user, space, key, value, t) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user, space, key) DO UPDATE SET value = excluded.value, t = excluded.t').run(user.id, space, k, text, t);
        return send(res, 200, { t });
      }
      if (k && m === 'DELETE') {
        const t = now();
        db.prepare('INSERT INTO sync (user, space, key, value, t) VALUES (?, ?, ?, \'\', ?) ON CONFLICT(user, space, key) DO UPDATE SET value = \'\', t = excluded.t').run(user.id, space, k, t);
        return send(res, 200, { t });
      }
    }
    throw new HttpError(404, 'Not found.');
  }

  // ---------------------------------------------------------------- Sign in with Nude (OIDC)

  interface AuthParams { client: string; clientName: string; redirect: string; state: string; nonce?: string; challenge: string; scope: string }

  function authParams(q: URLSearchParams): AuthParams {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(q.get('client_id') ?? '') as { id: string; name: string; redirects: string } | undefined;
    const redirect = q.get('redirect_uri') ?? '';
    // Never redirect anywhere that isn't registered: show the error here instead.
    if (!client || !(JSON.parse(client.redirects) as string[]).includes(redirect)) throw new HttpError(400, 'This site isn\'t registered for Sign in with Nude.', 'page');
    const fail = (e: string) => { const u = new URL(redirect); u.searchParams.set('error', e); if (q.get('state')) u.searchParams.set('state', q.get('state')!); throw Object.assign(new HttpError(302, e), { location: u.href }); };
    if (q.get('response_type') !== 'code') fail('unsupported_response_type');
    if (!(q.get('scope') ?? '').split(' ').includes('openid')) fail('invalid_scope');
    if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(q.get('code_challenge') ?? '')) fail('invalid_request');
    if (!q.get('state')) fail('invalid_request');
    return { client: client.id, clientName: client.name, redirect, state: q.get('state')!, nonce: q.get('nonce') ?? undefined, challenge: q.get('code_challenge')!, scope: q.get('scope')! };
  }

  function cookieUser(req: IncomingMessage): User | null {
    const tok = /(?:^|;\s*)nude_sid=(nds_[A-Za-z0-9_-]+)/.exec(req.headers.cookie ?? '')?.[1];
    if (!tok) return null;
    try { return bySessionToken(tok, ipOf(req)).user; } catch { return null; }
  }

  function finish(res: ServerResponse, a: AuthParams, user: User) {
    const code = newToken('ndx');
    db.prepare('INSERT INTO codes (code, client, user, redirect, scope, nonce, challenge, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(sha256(code), a.client, user.id, a.redirect, a.scope, a.nonce ?? null, a.challenge, now() + CODE_TTL);
    db.prepare('INSERT INTO grants (user, client, t) VALUES (?, ?, ?) ON CONFLICT(user, client) DO UPDATE SET t = excluded.t').run(user.id, a.client, now());
    const u = new URL(a.redirect); u.searchParams.set('code', code); u.searchParams.set('state', a.state);
    res.writeHead(302, { location: u.href, 'cache-control': 'no-store' }); res.end();
  }

  function page(res: ServerResponse, status: number, html: string, formTarget?: string) {
    const formAction = formTarget ? `'self' ${new URL(formTarget).origin}` : "'self'";
    res.writeHead(status, {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`,
    });
    res.end(html);
  }

  async function authorize(req: IncomingMessage, res: ServerResponse) {
    if (req.method === 'GET') {
      const a = authParams(new URL(req.url ?? '/', 'http://x').searchParams);
      const form = newToken('ndf');
      forms.set(form, { params: a, expires: now() + FORM_TTL });
      const u = cookieUser(req);
      return page(res, 200, authorizePage({ client: a.clientName, form, signedIn: u ? { name: u.name, nudeId: nudeId(u.username), avatar: account(u).avatar ?? undefined } : undefined }), a.redirect);
    }
    const b = new URLSearchParams((await raw(req, 16 * 1024)).toString('utf8'));
    const f = forms.get(b.get('form') ?? '');
    if (!f || f.expires < now()) return page(res, 400, messagePage('This page expired', 'Go back to the site and choose Sign in with Nude again.'));
    const a = f.params;
    const action = b.get('action');
    if (action === 'deny') {
      forms.delete(b.get('form')!);
      const u = new URL(a.redirect); u.searchParams.set('error', 'access_denied'); u.searchParams.set('state', a.state);
      res.writeHead(302, { location: u.href }); return res.end();
    }
    if (action === 'allow') {
      const u = cookieUser(req);
      if (!u) return page(res, 200, authorizePage({ client: a.clientName, form: b.get('form')! }), a.redirect);
      forms.delete(b.get('form')!);
      return finish(res, a, u);
    }
    if (action === 'switch') return page(res, 200, authorizePage({ client: a.clientName, form: b.get('form')! }), a.redirect);
    // action === 'signin'
    const username = b.get('username') ?? '';
    try {
      const user = await signIn(username, b.get('password') ?? '', ipOf(req));
      const token = startSession(user, { name: 'Web browser', platform: String(req.headers['user-agent'] ?? '').slice(0, 40), app: 'web' }, ipOf(req));
      log(user.id, 'signin', `Signed in to ${a.clientName} with Sign in with Nude`, 'Web browser', ipOf(req));
      forms.delete(b.get('form')!);
      res.setHeader('set-cookie', `nude_sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secureCookie() ? '; Secure' : ''}`);
      return finish(res, a, user);
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      return page(res, 200, authorizePage({ client: a.clientName, form: b.get('form')!, username, error: e.message }), a.redirect);
    }
  }

  async function token(req: IncomingMessage, res: ServerResponse) {
    const b = new URLSearchParams((await raw(req, 16 * 1024)).toString('utf8'));
    const err = (status: number, error: string) => send(res, status, { error }, { 'cache-control': 'no-store' });
    if (b.get('grant_type') !== 'authorization_code') return err(400, 'unsupported_grant_type');
    const row = db.prepare('SELECT * FROM codes WHERE code = ?').get(sha256(b.get('code') ?? '')) as
      { code: string; client: string; user: string; redirect: string; scope: string; nonce: string | null; challenge: string; expires: number } | undefined;
    if (row) db.prepare('DELETE FROM codes WHERE code = ?').run(row.code); // single use, even when the rest fails
    if (!row || row.expires < now() || row.client !== b.get('client_id') || row.redirect !== b.get('redirect_uri')) return err(400, 'invalid_grant');
    if (!safeEqual(s256(b.get('code_verifier') ?? ''), row.challenge)) return err(400, 'invalid_grant');
    const user = userById(row.user);
    if (!user) return err(400, 'invalid_grant');
    const access = newToken('nda');
    db.prepare('INSERT INTO access (token, client, user, scope, expires) VALUES (?, ?, ?, ?, ?)').run(sha256(access), row.client, user.id, row.scope, now() + ACCESS_TTL);
    const t = Math.floor(now() / 1000);
    const a = account(user);
    const id_token = jwt(key, {
      iss: o.issuer, sub: user.id, aud: row.client, iat: t, exp: t + 600, ...(row.nonce ? { nonce: row.nonce } : {}),
      name: user.name, preferred_username: user.username, nude_id: a.nudeId, ...(a.avatar ? { picture: a.avatar } : {}),
    });
    return send(res, 200, { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, id_token, scope: row.scope }, { 'cache-control': 'no-store', pragma: 'no-cache' });
  }

  function userinfo(req: IncomingMessage, res: ServerResponse) {
    const tok = /^Bearer (nda_[A-Za-z0-9_-]+)$/.exec(req.headers.authorization ?? '')?.[1];
    const row = tok ? db.prepare('SELECT * FROM access WHERE token = ?').get(sha256(tok)) as { user: string; expires: number } | undefined : undefined;
    if (!row || row.expires < now()) return send(res, 401, { error: 'invalid_token' }, { 'www-authenticate': 'Bearer error="invalid_token"' });
    const user = userById(row.user)!;
    const a = account(user);
    return send(res, 200, { sub: user.id, name: user.name, preferred_username: user.username, nude_id: a.nudeId, ...(a.avatar ? { picture: a.avatar } : {}) });
  }

  // ---------------------------------------------------------------- routing

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    try {
      if (p === '/' && req.method === 'GET') return page(res, 200, homePage(o.persistent));
      if (p === '/healthz') return send(res, 200, { ok: true });
      if (p === '/.well-known/openid-configuration') return send(res, 200, discovery(o.issuer), { 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' });
      if (p === '/jwks') return send(res, 200, { keys: [key.jwk] }, { 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' });
      if (p === '/authorize') return await authorize(req, res);
      if (p === '/token' && req.method === 'POST') return await token(req, res);
      if (p === '/userinfo') return userinfo(req, res);
      if (p.startsWith('/v1/')) return await api(req, res, p, url);
      send(res, 404, { error: 'Not found.' });
    } catch (e) {
      if (e instanceof HttpError) {
        const loc = (e as HttpError & { location?: string }).location;
        if (loc) { res.writeHead(302, { location: loc }); return res.end(); }
        if (e.code === 'page') return page(res, e.status, messagePage('Sign in with Nude', e.message));
        return send(res, e.status, { error: e.message, code: e.code });
      }
      console.error(e);
      send(res, 500, { error: 'Something went wrong on our side.' });
    }
  });
}

// ---------------------------------------------------------------- small HTTP helpers

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function raw(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'That\'s too big.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function json(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await raw(req, 64 * 1024);
  try { const v = JSON.parse(body.toString('utf8') || '{}'); return v && typeof v === 'object' ? v : {}; } catch { throw new HttpError(400, 'Send JSON.'); }
}

function visitorIp(req: IncomingMessage, trustProxy?: boolean): string | null {
  // Behind a proxy (a hosting platform, or a tunnel on this machine) the visitor's address is in a header;
  // only believed when the connection itself comes from that proxy.
  const local = /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress ?? '');
  const fwd = process.env.RENDER || (trustProxy && local)
    ? String(req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
  return coarseIp(fwd || req.socket.remoteAddress);
}

function imageType(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

function listenHost(): string {
  return process.env.HOST ?? (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 8792);
  const issuer = (process.env.NUDE_ACCOUNTS_URL ?? process.env.RENDER_EXTERNAL_URL ?? `http://127.0.0.1:${port}`).replace(/\/$/, '');
  const db = openDb(process.env.NUDE_ACCOUNTS_DB ?? join(process.cwd(), 'data', 'accounts.db'));
  const server = createAccountsServer({ db, issuer, adminToken: process.env.NUDE_ADMIN_TOKEN, persistent: process.env.NUDE_ACCOUNTS_STORAGE === 'permanent' || !process.env.RENDER });
  server.listen(port, listenHost(), () => console.log(`Nude Accounts on http://${listenHost()}:${port} (issuer ${issuer})`));
}
