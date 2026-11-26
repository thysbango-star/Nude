// "Continue with Meditate": OAuth 2.1 Authorization Code + PKCE (S256) against Meditate, the Nude sign-in site
// (Lovable Cloud's managed OAuth server, OIDC).
//
// Nude is a public client (no secret, by design), registered with the single redirect URI nude://auth/callback.
// Everything sensitive happens here in the main process: the code_verifier, state and nonce live only in this
// object's memory, the token exchange is made from here (never from a web page), the ID token is verified here
// (signature against the JWKS, iss, aud, exp, nonce), and then every token is dropped. Only the verified identity
// leaves this file. Nothing here is logged.
import { createHash, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto';

interface JsonWebKey { kty?: string; kid?: string; use?: string; alg?: string; n?: string; e?: string; crv?: string; x?: string; y?: string; [k: string]: unknown }

export const MEDITATE = {
  scope: 'openid email profile',
  /** The one redirect URI registered for Nude Browser, on every platform. */
  redirectUri: 'nude://auth/callback',
  identityDomain: 'nude',
} as const;

/** Where Meditate is: its issuer (…/auth/v1) and Nude Browser's client ID there. */
export interface MeditateConfig { issuer: string; clientId: string }

export function validIssuer(u: string) { return /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._~/-]*[^/]$/.test(u) || /^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(u); }
export function validClientId(c: string) { return /^[A-Za-z0-9._:-]{1,120}$/.test(c); }

/** The verified identity we keep. No tokens. */
export interface MeditateIdentity {
  sub: string;
  name: string;
  email: string;
  emailVerified: boolean;
  /** Your Nude ID's name part: Meditate's username, otherwise the first part of your email. */
  username: string;
  picture: string | null;
  authTime: number | null;
}
/** A failure with a message that's safe and friendly to show. */
export class MeditateAuthError extends Error {
  /** The message plus a short reference code that helps diagnose a failed sign-in (never secret). */
  get withReference() { return `${this.userMessage} (Reference: ${this.code})`; }
  constructor(readonly userMessage: string, readonly code: string) { super(code); }
}

interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string; userinfo_endpoint?: string }
interface Pending { verifier: string; nonce: string; created: number; purpose: MeditatePurpose; webContentsId: number | null }

const PENDING_TTL = 10 * 60_000;
const CLOCK_SKEW = 60; // seconds
export type MeditatePurpose = 'signin';

const b64url = (b: Buffer) => b.toString('base64url');
/** 32 random bytes → a 43-character verifier from the unreserved set (RFC 7636 §4.1). */
export function makeVerifier() { return b64url(randomBytes(32)); }
export function challengeFor(verifier: string) { return b64url(createHash('sha256').update(verifier, 'ascii').digest()); }



type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class MeditateAuth {
  private pending = new Map<string, Pending>();
  private disco: { value: Discovery; at: number } | null = null;
  private jwks: { keys: JsonWebKey[]; at: number } | null = null;

  constructor(private fetchImpl: Fetch, private config: () => MeditateConfig, private now: () => number = Date.now) {}

  /** The configured issuer and client, or an error saying Meditate isn't set up. */
  private cfg(): MeditateConfig {
    const c = this.config();
    const issuer = c.issuer.trim().replace(/\/$/, '');
    if (!validIssuer(issuer) || !validClientId(c.clientId.trim())) {
      throw new MeditateAuthError('Meditate sign-in isn\'t set up yet. Add Meditate\'s address and Nude Browser\'s client ID in Settings → Sign-in.', 'not_configured');
    }
    return { issuer, clientId: c.clientId.trim() };
  }

  get configured() { try { this.cfg(); return true; } catch { return false; } }

  /** True for the exact redirect URI (scheme, host, port and path), with or without a query. */
  isCallback(url: string) {
    try {
      const u = new URL(url);
      return u.protocol === 'nude:' && u.host === 'auth' && u.pathname === '/callback';
    } catch { return false; }
  }

  async discovery(): Promise<Discovery> {
    if (this.disco && this.now() - this.disco.at < 3_600_000) return this.disco.value;
    const { issuer } = this.cfg(); // "not set up" must not look like a network problem
    let d: Discovery;
    try {
      const r = await this.fetchImpl(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(String(r.status));
      d = await r.json() as Discovery;
    } catch {
      throw new MeditateAuthError('Nude couldn\'t reach Meditate. Check your internet connection and try again.', 'discovery_unreachable');
    }
    // The document must describe this issuer, over HTTPS (OIDC Discovery §4.3).
    const https = (u: unknown) => typeof u === 'string' && u.startsWith('https://');
    if (d.issuer !== this.cfg().issuer || !https(d.authorization_endpoint) || !https(d.token_endpoint) || !https(d.jwks_uri)) {
      throw new MeditateAuthError('Meditate sent unexpected sign-in settings, so Nude stopped for your safety.', 'discovery_mismatch');
    }
    this.disco = { value: d, at: this.now() };
    return d;
  }

  /** Which tab started the sign-in a callback belongs to, without consuming it. */
  ownerOf(callbackUrl: string): number | null {
    try {
      const state = new URL(callbackUrl).searchParams.get('state');
      return state ? this.pending.get(state)?.webContentsId ?? null : null;
    } catch { return null; }
  }

  /** True while a sign-in is waiting for Meditate's answer. */
  get waiting() { this.sweep(); return this.pending.size > 0; }

  /** Step 1–2: a fresh verifier, S256 challenge, state and nonce; returns the authorization URL. */
  async begin(purpose: MeditatePurpose, webContentsId: number | null): Promise<string> {
    const d = await this.discovery();
    this.sweep();
    const verifier = makeVerifier();
    const state = b64url(randomBytes(24));
    const nonce = b64url(randomBytes(24));
    this.pending.set(state, { verifier, nonce, created: this.now(), purpose, webContentsId });
    const u = new URL(d.authorization_endpoint);
    u.search = new URLSearchParams({
      response_type: 'code', client_id: this.cfg().clientId, redirect_uri: MEDITATE.redirectUri, scope: MEDITATE.scope,
      state, nonce, code_challenge: challengeFor(verifier), code_challenge_method: 'S256',
    }).toString();
    return u.toString();
  }

  /** Steps 4–7. Returns the verified identity, or throws MeditateAuthError. The state is single-use either way. */
  async complete(callbackUrl: string): Promise<{ identity: MeditateIdentity; purpose: MeditatePurpose; webContentsId: number | null }> {
    const q = new URL(callbackUrl).searchParams;
    const state = q.get('state');
    const p = state ? this.pending.get(state) : undefined;
    if (state) this.pending.delete(state);
    if (!state || !p || this.now() - p.created > PENDING_TTL) {
      throw new MeditateAuthError('This sign-in link has expired or didn\'t come from this browser. Please start again.', 'state_mismatch');
    }
    const error = q.get('error');
    if (error) {
      throw new MeditateAuthError(error === 'access_denied' ? 'You chose not to share your Meditate with Nude. Nothing was changed.'
        : 'Meditate couldn\'t complete the sign-in. Please try again.', `authorize_${error.replace(/[^\w]/g, '').slice(0, 40)}`);
    }
    const code = q.get('code');
    if (!code) throw new MeditateAuthError('Meditate didn\'t send a sign-in code. Please try again.', 'missing_code');

    const d = await this.discovery();
    let tokens: { id_token?: unknown; access_token?: unknown; error?: unknown };
    try {
      const r = await this.fetchImpl(d.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: MEDITATE.redirectUri, client_id: this.cfg().clientId, code_verifier: p.verifier }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
      tokens = await r.json().catch(() => ({})) as typeof tokens;
      if (!r.ok) throw new MeditateAuthError('Meditate didn\'t accept the sign-in. Please start again.', `token_${r.status}${typeof tokens.error === 'string' ? `_${tokens.error.replace(/[^\w]/g, '').slice(0, 40)}` : ''}`);
    } catch (e) {
      if (e instanceof MeditateAuthError) throw e;
      throw new MeditateAuthError('Nude couldn\'t finish signing you in with Meditate. Check your connection and try again.', 'token_unreachable');
    }
    if (typeof tokens.id_token !== 'string') throw new MeditateAuthError('Meditate didn\'t send an identity token.', 'missing_id_token');
    const claims = await this.verifyIdToken(tokens.id_token, p.nonce);
    // Username: from the verified ID token, otherwise from Meditate's userinfo (same subject only).
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
    const name = (str(claims.name) || str(meta.full_name) || str(meta.name) || username || email.split('@')[0] || 'Nude user').slice(0, 80);
    const local = (username ?? email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40) || `user${String(claims.sub).replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`;
    return {
      purpose: p.purpose,
      webContentsId: p.webContentsId,
      identity: {
        sub: String(claims.sub), name, email, emailVerified: claims.email_verified === true, username: local,
        picture: /^https:\/\//.test(str(claims.picture)) ? str(claims.picture).slice(0, 2000) : (/^https:\/\//.test(str(meta.avatar_url)) ? str(meta.avatar_url).slice(0, 2000) : null),
        authTime: typeof claims.auth_time === 'number' ? claims.auth_time : null,
      },
    };
  }

  /**
   * Step 6: the signature against Meditate's JWKS (RS256; ES256 too, since Supabase's asymmetric keys can be either),
   * then iss, aud, exp and nonce. The algorithm must match the key type; "none" and HMAC are always rejected.
   * Any failure fails the sign-in.
   */
  async verifyIdToken(idToken: string, nonce: string): Promise<Record<string, unknown>> {
    const fail = (code: string): never => { throw new MeditateAuthError('Nude couldn\'t verify your Meditate sign-in, so it didn\'t sign you in. Please try again.', code); };
    const parts = idToken.split('.');
    if (parts.length !== 3) fail('id_token_format');
    let header: { alg?: string; kid?: string; typ?: string };
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch { return fail('id_token_format'); }
    if (header.alg !== 'RS256' && header.alg !== 'ES256') fail('id_token_alg');
    const alg = header.alg as 'RS256' | 'ES256';
    const key = await this.signingKey(header.kid, alg);
    if (!key) fail('id_token_key');
    let ok = false;
    try {
      const pub = createPublicKey({ key: key as import('node:crypto').JsonWebKeyInput['key'], format: 'jwk' });
      const data = Buffer.from(`${parts[0]}.${parts[1]}`);
      const sig = Buffer.from(parts[2], 'base64url');
      ok = alg === 'RS256' ? verifySignature('RSA-SHA256', data, pub, sig)
        : sig.length === 64 && verifySignature('sha256', data, { key: pub, dsaEncoding: 'ieee-p1363' }, sig);
    } catch { ok = false; }
    if (!ok) fail('id_token_signature');
    const now = Math.floor(this.now() / 1000);
    if (claims.iss !== this.cfg().issuer) fail('id_token_iss');
    const aud = claims.aud;
    if (!(aud === this.cfg().clientId || (Array.isArray(aud) && aud.includes(this.cfg().clientId)))) fail('id_token_aud');
    if (Array.isArray(aud) && aud.length > 1 && claims.azp !== this.cfg().clientId) fail('id_token_azp');
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW < now) fail('id_token_expired');
    if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW > now) fail('id_token_iat');
    if (typeof claims.nonce !== 'string' || claims.nonce !== nonce) fail('id_token_nonce');
    if (typeof claims.sub !== 'string' || !claims.sub) fail('id_token_sub');
    return claims;
  }

  private async signingKey(kid: string | undefined, alg: 'RS256' | 'ES256'): Promise<JsonWebKey | null> {
    const fits = (k: JsonWebKey) => (alg === 'RS256' ? k.kty === 'RSA' : k.kty === 'EC' && k.crv === 'P-256')
      && (k.alg === undefined || k.alg === alg) && (k.use === undefined || k.use === 'sig');
    const find = (keys: JsonWebKey[]) => keys.find((k) => fits(k) && (!kid || k.kid === kid)) ?? null;
    if (this.jwks && this.now() - this.jwks.at < 3_600_000) {
      const k = find(this.jwks.keys);
      if (k) return k;
    }
    // Unknown key id: Meditate may have rotated keys, so fetch the set again.
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
    const local = u.endsWith(`@${MEDITATE.identityDomain}`) ? u.slice(0, -(MEDITATE.identityDomain.length + 1)) : u;
    if (/^[a-z0-9._-]{1,64}$/.test(local)) return local;
  }
  return null;
}
