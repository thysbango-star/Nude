// Continue with Meditate: PKCE S256, state and nonce checks, ID token verification, and no token retention.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { MeditateAuth, MEDITATE, MeditateAuthError, challengeFor, makeVerifier } from '../../src/main/meditate-auth';

const CFG = { issuer: 'https://meditate-test.supabase.co/auth/v1', clientId: 'nude-browser-test-client' };

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const ecJwk = { ...ec.publicKey.export({ format: 'jwk' }), kid: 'e1', use: 'sig', alg: 'ES256' };
function esToken(claims: Record<string, unknown>, kid = 'e1') {
  const head = b64({ alg: 'ES256', kid, typ: 'JWT' });
  const body = b64(claims);
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: ec.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${head}.${body}.${sig}`;
}
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function idToken(claims: Record<string, unknown>, opts: { alg?: string; kid?: string; key?: typeof privateKey } = {}) {
  const head = b64({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1', typ: 'JWT' });
  const body = b64(claims);
  const sig = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), opts.key ?? privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

const DISCO = {
  issuer: CFG.issuer,
  authorization_endpoint: `${CFG.issuer}/oauth/authorize`,
  token_endpoint: `${CFG.issuer}/oauth/token`,
  jwks_uri: `${CFG.issuer}/.well-known/jwks.json`,
  userinfo_endpoint: `${CFG.issuer}/oauth/userinfo`,
};

/** A fake Meditate. `issue` decides what the token endpoint returns for the verifier it received. */
function meditate(issue: (form: URLSearchParams, nonce: string) => { status?: number; body: unknown }, disco: Record<string, unknown> = DISCO) {
  const calls: { url: string; body?: string; headers?: Record<string, string> }[] = [];
  let nonce = '';
  let challenge = '';
  const fetchImpl = async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
    calls.push({ url, body: init?.body, headers: init?.headers });
    const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
    if (url.endsWith('/openid-configuration')) return reply(200, disco);
    if (url.endsWith('/jwks.json')) return reply(200, { keys: [jwk, ecJwk] });
    if (url === DISCO.token_endpoint) {
      const form = new URLSearchParams(init?.body);
      // The server checks PKCE: the verifier must hash to the challenge from the authorize request.
      if (createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') !== challenge) return reply(400, { error: 'invalid_grant' });
      const r = issue(form, nonce);
      return reply(r.status ?? 200, r.body);
    }
    if (url === DISCO.userinfo_endpoint) return reply(200, { sub: 'user-1', username: 'simon' });
    return reply(404, {});
  };
  const auth = new MeditateAuth(fetchImpl, () => CFG);
  const begin = async () => {
    const url = new URL(await auth.begin('signin', 7));
    nonce = url.searchParams.get('nonce')!;
    challenge = url.searchParams.get('code_challenge')!;
    return url;
  };
  return { auth, calls, begin };
}

const good = (nonce: string, extra: Record<string, unknown> = {}) => ({
  iss: CFG.issuer, aud: CFG.clientId, sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
  nonce, email: 'Simon@Example.com', email_verified: true, name: 'Simon Adamson', ...extra,
});
const cb = (q: Record<string, string>) => `${MEDITATE.redirectUri}?${new URLSearchParams(q)}`;
const rejects = async (p: Promise<unknown>, code: string | RegExp) => {
  await assert.rejects(p, (e: unknown) => e instanceof MeditateAuthError && (typeof code === 'string' ? e.code === code : code.test(e.code)));
};

test('verifier and S256 challenge follow RFC 7636', () => {
  const v = makeVerifier();
  assert.match(v, /^[A-Za-z0-9_-]{43,128}$/);
  // RFC 7636 appendix B test vector
  assert.equal(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('the authorization request carries every required parameter', async () => {
  const { begin } = meditate(() => ({ body: {} }));
  const u = await begin();
  assert.equal(`${u.origin}${u.pathname}`, DISCO.authorization_endpoint);
  const q = u.searchParams;
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('client_id'), CFG.clientId);
  assert.equal(q.get('redirect_uri'), MEDITATE.redirectUri);
  assert.equal(q.get('scope'), 'openid email profile');
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.ok(q.get('state')!.length >= 32 && q.get('nonce')!.length >= 32);
  assert.notEqual(q.get('state'), q.get('nonce'));
});

test('a good sign-in returns only the verified identity', async () => {
  const { auth, calls, begin } = meditate((form, nonce) => {
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.equal(form.get('client_id'), CFG.clientId);
    assert.equal(form.get('redirect_uri'), MEDITATE.redirectUri);
    assert.equal(form.get('client_secret'), null, 'public client: no secret');
    return { body: { id_token: idToken(good(nonce, { username: 'simon' })), access_token: 'AT', refresh_token: 'RT', token_type: 'bearer' } };
  });
  const u = await begin();
  const r = await auth.complete(cb({ code: 'abc', state: u.searchParams.get('state')! }));
  assert.deepEqual(r.identity, {
    sub: 'user-1', name: 'Simon Adamson', email: 'simon@example.com', emailVerified: true,
    username: 'simon', picture: null, authTime: null,
  });
  assert.equal(r.purpose, 'signin');
  assert.equal(r.webContentsId, 7);
  // Nothing token-like comes back to the caller.
  assert.doesNotMatch(JSON.stringify(r), /AT|RT|eyJ/);
  assert.equal(calls.find((c) => c.url === DISCO.token_endpoint)?.headers?.['content-type'], 'application/x-www-form-urlencoded');
});

test('username falls back to userinfo for the same user', async () => {
  const { auth, begin } = meditate((_f, nonce) => ({ body: { id_token: idToken(good(nonce)), access_token: 'AT' } }));
  const u = await begin();
  const r = await auth.complete(cb({ code: 'abc', state: u.searchParams.get('state')! }));
  assert.equal(r.identity.username, 'simon');
});

test('without a username, the Nude ID comes from the email', async () => {
  const { auth, begin } = meditate((_f, nonce) => ({ body: { id_token: idToken(good(nonce, { email: 'Thys.Bango@Example.com' })) } }));
  const u = await begin();
  const r = await auth.complete(cb({ code: 'abc', state: u.searchParams.get('state')! }));
  assert.equal(r.identity.username, 'thys.bango');
});

test('nothing starts until Meditate is set up', async () => {
  const auth = new MeditateAuth(async () => { throw new Error('no network expected'); }, () => ({ issuer: '', clientId: '' }));
  assert.equal(auth.configured, false);
  await assert.rejects(auth.begin('signin', null), (e: unknown) => e instanceof MeditateAuthError && e.code === 'not_configured');
});

test('state is mandatory, must match, and works only once', async () => {
  const { auth, begin } = meditate((_f, nonce) => ({ body: { id_token: idToken(good(nonce)) } }));
  const u = await begin();
  const state = u.searchParams.get('state')!;
  await rejects(auth.complete(cb({ code: 'abc' })), 'state_mismatch');
  await rejects(auth.complete(cb({ code: 'abc', state: 'forged' })), 'state_mismatch');
  await auth.complete(cb({ code: 'abc', state }));
  await rejects(auth.complete(cb({ code: 'abc', state })), 'state_mismatch');
});

test('a denied consent is reported kindly', async () => {
  const { auth, begin } = meditate(() => ({ body: {} }));
  const u = await begin();
  await assert.rejects(auth.complete(cb({ error: 'access_denied', state: u.searchParams.get('state')! })), (e: MeditateAuthError) => /chose not to share/.test(e.userMessage));
});

test('a callback without a code fails', async () => {
  const { auth, begin } = meditate(() => ({ body: {} }));
  const u = await begin();
  await rejects(auth.complete(cb({ state: u.searchParams.get('state')! })), 'missing_code');
});

for (const [name, make, code] of [
  ['wrong signature', (n: string) => idToken(good(n), { key: other.privateKey }), 'id_token_signature'],
  ['HS256 token', (n: string) => idToken(good(n), { alg: 'HS256' }), 'id_token_alg'],
  ['alg none', (n: string) => `${b64({ alg: 'none' })}.${b64(good(n))}.`, 'id_token_alg'],
  ['wrong issuer', (n: string) => idToken(good(n, { iss: 'https://evil.example/auth/v1' })), 'id_token_iss'],
  ['wrong audience', (n: string) => idToken(good(n, { aud: 'someone-else' })), 'id_token_aud'],
  ['expired', (n: string) => idToken(good(n, { exp: Math.floor(Date.now() / 1000) - 600 })), 'id_token_expired'],
  ['wrong nonce', () => idToken(good('replayed-nonce')), 'id_token_nonce'],
  ['missing nonce', (n: string) => idToken({ ...good(n), nonce: undefined }), 'id_token_nonce'],
  ['unknown key', (n: string) => idToken(good(n), { kid: 'nope' }), 'id_token_key'],
] as const) {
  test(`rejects an ID token with ${name}`, async () => {
    const { auth, begin } = meditate((_f, nonce) => ({ body: { id_token: make(nonce) } }));
    const u = await begin();
    await rejects(auth.complete(cb({ code: 'abc', state: u.searchParams.get('state')! })), code);
  });
}

test('a token endpoint error fails the sign-in', async () => {
  const { auth, begin } = meditate(() => ({ status: 400, body: { error: 'invalid_grant' } }));
  const u = await begin();
  await rejects(auth.complete(cb({ code: 'abc', state: u.searchParams.get('state')! })), 'token_400_invalid_grant');
});

test('accepts an ES256 ID token signed by a P-256 key in the JWKS', async () => {
  const { auth, begin } = meditate((_f, nonce) => ({ body: { id_token: esToken(good(nonce, { username: 'simon' })), access_token: 'a' } }));
  const u = await begin();
  const r = await auth.complete(cb({ code: 'abc', state: u.searchParams.get('state')! }));
  assert.equal(r.identity.username, 'simon');
});

test('rejects an ES256 header that points at an RSA key', async () => {
  const { auth, begin } = meditate((_f, nonce) => ({ body: { id_token: esToken(good(nonce), 'k1') } }));
  const u = await begin();
  await rejects(auth.complete(cb({ code: 'abc', state: u.searchParams.get('state')! })), 'id_token_key');
});

test('refuses a discovery document for another issuer', async () => {
  const { begin } = meditate(() => ({ body: {} }), { ...DISCO, issuer: 'https://evil.example' });
  await rejects(begin(), 'discovery_mismatch');
});

test('recognises only the exact redirect URI', () => {
  const { auth } = meditate(() => ({ body: {} }));
  assert.equal(MEDITATE.redirectUri, 'nude://auth/callback');
  assert.ok(auth.isCallback(`${MEDITATE.redirectUri}?code=1&state=2`));
  assert.ok(!auth.isCallback('nude://auth/other?code=1'));
  assert.ok(!auth.isCallback('nude://settings/callback'));
  assert.ok(!auth.isCallback('https://auth/callback?code=1'));
  assert.ok(!auth.isCallback('http://evil.example/nude/auth/callback'));
});
