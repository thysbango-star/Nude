// "Sign in with Rovian": OAuth 2.1 Authorization Code + PKCE (S256) against Rovian Account (OIDC).
//
// Nude is a public client (no secret, by design). Everything sensitive happens here in the app's main process:
// the code_verifier, state and nonce live only in this object's memory, the token exchange is made from here
// (never from a web page), the ID token is verified here, and then every token is dropped. Only the verified
// identity claims leave this file. Nothing here is logged.
import { createHash, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto';

interface JsonWebKey { kty?: string; kid?: string; use?: string; alg?: string; n?: string; e?: string; [k: string]: unknown }

export const ROVIAN = {
  issuer: 'https://oaupnrdlgxavdvefhbnp.supabase.co/auth/v1',
  clientId: '84d370e0-9203-4a58-b516-d05ded71bac3',
  scope: 'openid email profile',
  /** Loopback redirect (RFC 8252): Nude intercepts it inside the browser, so the request never leaves the device. */
  redirectUri: 'http://127.0.0.1:47811/nude-browser/callback',
  identityDomain: 'rovian.cloud',
} as const;

/** The verified identity we keep. No tokens. */
export interface RovianIdentity {
  sub: string;
  name: string;
  email: string;
  emailVerified: boolean;
  username: string | null;
  /** username@rovian.cloud when Rovian provides a username. */
  rovianId: string | null;
  picture: string | null;
  authTime: number | null;
}

export type RovianPurpose = 'signin' | 'link';

/** A failure with a message that's safe and friendly to show. */
export class RovianAuthError extends Error {
  constructor(readonly userMessage: string, readonly code: string) { super(code); }
}

interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string; userinfo_endpoint?: string }
interface Pending { verifier: string; nonce: string; created: number; purpose: RovianPurpose; webContentsId: number | null }

const b64url = (b: Buffer) => b.toString('base64url');
/** 32 random bytes → a 43-character verifier from the unreserved set (RFC 7636 §4.1). */
export function makeVerifier() { return b64url(randomBytes(32)); }
export function challengeFor(verifier: string) { return b64url(createHash('sha256').update(verifier, 'ascii').digest()); }

const PENDING_TTL = 10 * 60_000; // matches Rovian's 10-minute authorization codes
const CLOCK_SKEW = 60; // seconds

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class RovianAuth {
  private pending = new Map<string, Pending>();
  private disco: { value: Discovery; at: number } | null = null;
  private jwks: { keys: JsonWebKey[]; at: number } | null = null;

  constructor(private fetchImpl: Fetch, private now: () => number = Date.now) {}

  /** True for the exact redirect URI (scheme, host, port and path), with or without a query. */
  isCallback(url: string) {
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname}` === ROVIAN.redirectUri;
    } catch { return false; }
  }

  async discovery(): Promise<Discovery> {
    if (this.disco && this.now() - this.disco.at < 3_600_000) return this.disco.value;
    let d: Discovery;
    try {
      const r = await this.fetchImpl(`${ROVIAN.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(String(r.status));
      d = await r.json() as Discovery;
    } catch {
      throw new RovianAuthError('Nude couldn\'t reach Rovian Account. Check your internet connection and try again.', 'discovery_unreachable');
    }
    // The document must describe this issuer, over HTTPS (OIDC Discovery §4.3).
    const https = (u: unknown) => typeof u === 'string' && u.startsWith('https://');
    if (d.issuer !== ROVIAN.issuer || !https(d.authorization_endpoint) || !https(d.token_endpoint) || !https(d.jwks_uri)) {
      throw new RovianAuthError('Rovian Account sent unexpected sign-in settings, so Nude stopped for your safety.', 'discovery_mismatch');
    }
    this.disco = { value: d, at: this.now() };
    return d;
  }

  /** Step 1–2: a fresh verifier, S256 challenge, state and nonce; returns the authorization URL. */
  async begin(purpose: RovianPurpose, webContentsId: number | null): Promise<string> {
    const d = await this.discovery();
    this.sweep();
    const verifier = makeVerifier();
    const state = b64url(randomBytes(24));
    const nonce = b64url(randomBytes(24));
    this.pending.set(state, { verifier, nonce, created: this.now(), purpose, webContentsId });
    const u = new URL(d.authorization_endpoint);
    u.search = new URLSearchParams({
      response_type: 'code', client_id: ROVIAN.clientId, redirect_uri: ROVIAN.redirectUri, scope: ROVIAN.scope,
      state, nonce, code_challenge: challengeFor(verifier), code_challenge_method: 'S256',
    }).toString();
    return u.toString();
  }

  /** Steps 4–7. Returns the verified identity, or throws RovianAuthError. The state is single-use either way. */
  async complete(callbackUrl: string): Promise<{ identity: RovianIdentity; purpose: RovianPurpose; webContentsId: number | null }> {
    const q = new URL(callbackUrl).searchParams;
    const state = q.get('state');
    const p = state ? this.pending.get(state) : undefined;
    if (state) this.pending.delete(state);
    if (!state || !p || this.now() - p.created > PENDING_TTL) {
      throw new RovianAuthError('This sign-in link has expired or didn\'t come from this browser. Please start again.', 'state_mismatch');
    }
    const error = q.get('error');
    if (error) {
      throw new RovianAuthError(error === 'access_denied' ? 'You chose not to share your Rovian Account with Nude. Nothing was changed.'
        : 'Rovian Account couldn\'t complete the sign-in. Please try again.', `authorize_${error.replace(/[^\w]/g, '').slice(0, 40)}`);
    }
    const code = q.get('code');
    if (!code) throw new RovianAuthError('Rovian Account didn\'t send a sign-in code. Please try again.', 'missing_code');

    const d = await this.discovery();
    let tokens: { id_token?: unknown; access_token?: unknown };
    try {
      const r = await this.fetchImpl(d.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: ROVIAN.redirectUri, client_id: ROVIAN.clientId, code_verifier: p.verifier }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
      tokens = await r.json() as typeof tokens;
      if (!r.ok) throw new RovianAuthError('Rovian Account didn\'t accept the sign-in. Please start again.', `token_${r.status}`);
    } catch (e) {
      if (e instanceof RovianAuthError) throw e;
      throw new RovianAuthError('Nude couldn\'t finish signing you in with Rovian. Check your connection and try again.', 'token_unreachable');
    }
    if (typeof tokens.id_token !== 'string') throw new RovianAuthError('Rovian Account didn\'t send an identity token.', 'missing_id_token');
    const claims = await this.verifyIdToken(tokens.id_token, p.nonce);
    // Username: from the verified ID token, otherwise from Rovian's userinfo (same subject only).
    let username = pickUsername(claims);
    if (!username && d.userinfo_endpoint?.startsWith('https://') && typeof tokens.access_token === 'string') {
      try {
        const r = await this.fetchImpl(d.userinfo_endpoint, { headers: { authorization: `Bearer ${tokens.access_token}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
        const info = r.ok ? await r.json() as Record<string, unknown> : null;
        if (info && info.sub === claims.sub) username = pickUsername(info);
      } catch { /* the username is optional */ }
    }
    tokens = {}; // drop the tokens: Nude keeps the identity, not the tokens
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const email = str(claims.email).toLowerCase();
    const meta = (claims.user_metadata && typeof claims.user_metadata === 'object' ? claims.user_metadata : {}) as Record<string, unknown>;
    const name = (str(claims.name) || str(meta.full_name) || str(meta.name) || username || email.split('@')[0] || 'Rovian user').slice(0, 80);
    return {
      purpose: p.purpose,
      webContentsId: p.webContentsId,
      identity: {
        sub: String(claims.sub), name, email, emailVerified: claims.email_verified === true,
        username, rovianId: username ? `${username}@${ROVIAN.identityDomain}` : null,
        picture: /^https:\/\//.test(str(claims.picture)) ? str(claims.picture).slice(0, 2000) : null,
        authTime: typeof claims.auth_time === 'number' ? claims.auth_time : null,
      },
    };
  }

  /** Step 6: RS256 signature against Rovian's JWKS, then iss, aud, exp and nonce. Any failure fails the sign-in. */
  async verifyIdToken(idToken: string, nonce: string): Promise<Record<string, unknown>> {
    const fail = (code: string): never => { throw new RovianAuthError('Nude couldn\'t verify your Rovian sign-in, so it didn\'t sign you in. Please try again.', code); };
    const parts = idToken.split('.');
    if (parts.length !== 3) fail('id_token_format');
    let header: { alg?: string; kid?: string; typ?: string };
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch { return fail('id_token_format'); }
    if (header.alg !== 'RS256') fail('id_token_alg');
    const key = await this.signingKey(header.kid);
    if (!key) fail('id_token_key');
    let ok = false;
    try {
      ok = verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: key as import('node:crypto').JsonWebKeyInput['key'], format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
    } catch { ok = false; }
    if (!ok) fail('id_token_signature');
    const now = Math.floor(this.now() / 1000);
    if (claims.iss !== ROVIAN.issuer) fail('id_token_iss');
    const aud = claims.aud;
    if (!(aud === ROVIAN.clientId || (Array.isArray(aud) && aud.includes(ROVIAN.clientId)))) fail('id_token_aud');
    if (Array.isArray(aud) && aud.length > 1 && claims.azp !== ROVIAN.clientId) fail('id_token_azp');
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW < now) fail('id_token_expired');
    if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW > now) fail('id_token_iat');
    if (typeof claims.nonce !== 'string' || claims.nonce !== nonce) fail('id_token_nonce');
    if (typeof claims.sub !== 'string' || !claims.sub) fail('id_token_sub');
    return claims;
  }

  private async signingKey(kid: string | undefined): Promise<JsonWebKey | null> {
    const find = (keys: JsonWebKey[]) => keys.find((k) => k.kty === 'RSA' && (k.use === undefined || k.use === 'sig') && (!kid || k.kid === kid)) ?? null;
    if (this.jwks && this.now() - this.jwks.at < 3_600_000) {
      const k = find(this.jwks.keys);
      if (k) return k;
    }
    // Unknown key id: Rovian may have rotated keys, so fetch the set again.
    try {
      const d = await this.discovery();
      const r = await this.fetchImpl(d.jwks_uri, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return null;
      const j = await r.json() as { keys?: JsonWebKey[] };
      this.jwks = { keys: Array.isArray(j.keys) ? j.keys : [], at: this.now() };
      return find(this.jwks.keys);
    } catch { return null; }
  }

  /** Forget a sign-in the user abandoned (e.g. closed the tab). */
  cancelFor(webContentsId: number) {
    for (const [s, p] of this.pending) if (p.webContentsId === webContentsId) this.pending.delete(s);
  }

  private sweep() {
    for (const [s, p] of this.pending) if (this.now() - p.created > PENDING_TTL) this.pending.delete(s);
    // Never let abandoned attempts pile up.
    while (this.pending.size > 20) this.pending.delete(this.pending.keys().next().value as string);
  }
}

function pickUsername(c: Record<string, unknown>): string | null {
  const meta = (c.user_metadata && typeof c.user_metadata === 'object' ? c.user_metadata : {}) as Record<string, unknown>;
  for (const v of [c.username, c.preferred_username, meta.username, meta.user_name]) {
    if (typeof v !== 'string') continue;
    const u = v.trim().toLowerCase();
    const local = u.endsWith(`@${ROVIAN.identityDomain}`) ? u.slice(0, -(ROVIAN.identityDomain.length + 1)) : u;
    if (/^[a-z0-9._-]{1,64}$/.test(local)) return local;
  }
  return null;
}
