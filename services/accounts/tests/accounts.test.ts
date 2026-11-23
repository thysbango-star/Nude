import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import type { Server } from 'node:http';
import { openDb } from '../src/db';
import { createAccountsServer } from '../src/server';
import { usernameProblem, passwordProblem } from '../src/auth';

let server: Server;
let base = '';
const ADMIN = 'admin-test-token';

before(async () => {
  const db = openDb(':memory:');
  server = createAccountsServer({ db, issuer: 'http://issuer.test', adminToken: ADMIN, persistent: true });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

async function call(method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) {
  const r = await fetch(base + path, {
    method, redirect: 'manual',
    headers: { ...(body !== undefined && !(body instanceof Uint8Array) && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    body: body === undefined ? undefined : body instanceof Uint8Array || typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: r.status, json, text, headers: r.headers };
}

const laptop = { name: 'Simon\'s laptop', platform: 'Windows', app: 'browser' };
let token = '';

test('Nude ID rules', () => {
  assert.equal(usernameProblem('tsbungo'), null);
  assert.ok(usernameProblem('ab'));
  assert.ok(usernameProblem('Tsbungo'));
  assert.ok(usernameProblem('1abc'));
  assert.ok(usernameProblem('admin'));
  assert.ok(usernameProblem('a..b'));
  assert.ok(passwordProblem('short', 'x'));
  assert.ok(passwordProblem('tsbungo-is-me-123', 'tsbungo'));
  assert.equal(passwordProblem('correct horse battery', 'tsbungo'), null);
});

test('create a Nude ID and sign in', async () => {
  const a = await call('POST', '/v1/accounts', { username: 'tsbungo', name: 'Simon Adamson', password: 'correct horse battery', device: laptop });
  assert.equal(a.status, 201);
  assert.equal(a.json.account.nudeId, 'tsbungo@nude');
  assert.match(a.json.token, /^nds_/);
  token = a.json.token;

  assert.equal((await call('POST', '/v1/accounts', { username: 'tsbungo', name: 'X', password: 'another long password' })).status, 409);
  assert.equal((await call('GET', '/v1/username/tsbungo')).json.available, false);
  assert.equal((await call('GET', '/v1/username/somebody')).json.available, true);

  const s = await call('POST', '/v1/sessions', { username: 'tsbungo@nude', password: 'correct horse battery', device: { name: 'Phone', app: 'companion' } });
  assert.equal(s.status, 200);
  const me = await call('GET', '/v1/me', undefined, s.json.token);
  assert.equal(me.json.account.username, 'tsbungo');
  assert.equal(me.json.device.app, 'companion');
});

test('wrong passwords are refused, then rate limited', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/v1/sessions', { username: 'tsbungo', password: 'wrong password!!' })).status, 401);
  const r = await call('POST', '/v1/sessions', { username: 'tsbungo', password: 'correct horse battery' });
  assert.equal(r.status, 429, 'even the right password waits once the limit is hit');
  const ev = await call('GET', '/v1/me/events', undefined, token);
  assert.ok(ev.json.events.some((e: any) => e.kind === 'signin-failed'));
});

test('profile picture: images only', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const r = await call('PUT', '/v1/me/avatar', png, token, { 'content-type': 'image/png' });
  assert.equal(r.status, 200);
  assert.match(r.json.account.avatar, /\/v1\/avatar\//);
  const id = r.json.account.id;
  const img = await fetch(`${base}/v1/avatar/${id}`);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await call('PUT', '/v1/me/avatar', '<svg onload=alert(1)>', token)).status, 400);
});

test('devices: list and sign out another one', async () => {
  const other = await call('POST', '/v1/accounts', { username: 'devtest', name: 'Dev', password: 'a long enough pass', device: laptop });
  const second = await call('POST', '/v1/sessions', { username: 'devtest', password: 'a long enough pass', device: { name: 'Tablet', app: 'browser' } });
  const list = await call('GET', '/v1/me/sessions', undefined, other.json.token);
  assert.equal(list.json.sessions.length, 2);
  const tablet = list.json.sessions.find((s: any) => s.name === 'Tablet');
  assert.equal((await call('DELETE', `/v1/me/sessions/${tablet.id}`, undefined, other.json.token)).status, 200);
  assert.equal((await call('GET', '/v1/me', undefined, second.json.token)).status, 401);
});

test('changing the password signs out the other devices', async () => {
  const a = await call('POST', '/v1/accounts', { username: 'pwtest', name: 'Pw', password: 'first long password', device: laptop });
  const b = await call('POST', '/v1/sessions', { username: 'pwtest', password: 'first long password', device: { name: 'Phone' } });
  assert.equal((await call('POST', '/v1/me/password', { current: 'nope nope nope', next: 'second long password' }, a.json.token)).status, 401);
  const r = await call('POST', '/v1/me/password', { current: 'first long password', next: 'second long password' }, a.json.token);
  assert.equal(r.json.signedOut, 1);
  assert.equal((await call('GET', '/v1/me', undefined, b.json.token)).status, 401);
  assert.equal((await call('GET', '/v1/me', undefined, a.json.token)).status, 200);
});

test('phone sign-in by QR needs the computer to approve', async () => {
  const link = await call('POST', '/v1/links', {}, token);
  assert.equal(link.status, 201);
  assert.equal((await call('POST', '/v1/links/claim', { id: link.json.id, secret: 'wrong' })).status, 410);
  const claim = await call('POST', '/v1/links/claim', { id: link.json.id, secret: link.json.secret, device: { name: 'Galaxy S25', platform: 'Android', app: 'companion' } });
  assert.equal(claim.status, 200);
  // The code can't be used twice.
  assert.equal((await call('POST', '/v1/links/claim', { id: link.json.id, secret: link.json.secret })).status, 410);
  assert.equal((await call('POST', '/v1/links/poll', { id: link.json.id, claim: claim.json.claim })).json.state, 'waiting');
  const seen = await call('GET', `/v1/links/${link.json.id}`, undefined, token);
  assert.equal(seen.json.state, 'claimed');
  assert.equal(seen.json.device.name, 'Galaxy S25');
  await call('POST', `/v1/links/${link.json.id}/approve`, {}, token);
  const done = await call('POST', '/v1/links/poll', { id: link.json.id, claim: claim.json.claim });
  assert.equal(done.json.state, 'approved');
  assert.equal(done.json.account.nudeId, 'tsbungo@nude');
  assert.equal((await call('GET', '/v1/me', undefined, done.json.token)).json.device.app, 'companion');
  // The token is handed over once.
  assert.notEqual((await call('POST', '/v1/links/poll', { id: link.json.id, claim: claim.json.claim })).json.token, done.json.token);
});

test('sync: same data on every device, deletions travel too', async () => {
  const phone = (await call('POST', '/v1/sessions', { username: 'devtest', password: 'a long enough pass', device: { name: 'Phone', app: 'nebula' } })).json.token;
  const pc = (await call('POST', '/v1/sessions', { username: 'devtest', password: 'a long enough pass', device: { name: 'PC', app: 'browser' } })).json.token;
  await call('PUT', '/v1/sync/nebula-chats/c1', { value: { title: 'Kaizer Chiefs score', messages: [{ role: 'user', text: 'Score?' }] } }, phone);
  const got = await call('GET', '/v1/sync/nebula-chats?since=0', undefined, pc);
  assert.equal(got.json.items[0].value.title, 'Kaizer Chiefs score');
  const since = got.json.now;
  await call('DELETE', '/v1/sync/nebula-chats/c1', undefined, pc);
  const later = await call('GET', `/v1/sync/nebula-chats?since=${since - 1}`, undefined, phone);
  assert.equal(later.json.items[0].value, null);
  // Another user can't see it.
  assert.equal((await call('GET', '/v1/sync/nebula-chats?since=0', undefined, token)).json.items.length, 0);
});

test('Sign in with Nude: code flow with PKCE and a signed ID token', async () => {
  const redirect = 'https://shop.example/callback';
  assert.equal((await call('POST', '/v1/admin/clients', { name: 'Shop', redirects: [redirect] })).status, 401);
  const c = await call('POST', '/v1/admin/clients', { name: 'Shop', redirects: [redirect] }, ADMIN);
  const clientId = c.json.client_id;

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, scope: 'openid profile', state: 'st4te', nonce: 'n0nce', code_challenge: challenge, code_challenge_method: 'S256' });

  // A redirect URI that isn't registered is never redirected to.
  const evil = new URLSearchParams(q); evil.set('redirect_uri', 'https://evil.example/cb');
  const bad = await call('GET', `/authorize?${evil}`);
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get('location'), null);
  // Without PKCE the site gets an error back.
  const noPkce = new URLSearchParams(q); noPkce.delete('code_challenge');
  assert.match((await call('GET', `/authorize?${noPkce}`)).headers.get('location') ?? '', /error=invalid_request/);

  const pageRes = await call('GET', `/authorize?${q}`);
  assert.equal(pageRes.status, 200);
  assert.equal(pageRes.headers.get('x-frame-options'), 'DENY');
  const form = /name="form" value="([^"]+)"/.exec(pageRes.text)![1];
  // Two tries: wrong password stays on the page, right one goes back to the site.
  const wrong = await call('POST', '/authorize', new URLSearchParams({ form, action: 'signin', username: 'devtest', password: 'bad bad bad bad' }).toString(), undefined, { 'content-type': 'application/x-www-form-urlencoded' });
  assert.match(wrong.text, /don(&#39;|')t match/);
  const ok = await call('POST', '/authorize', new URLSearchParams({ form, action: 'signin', username: 'devtest', password: 'a long enough pass' }).toString(), undefined, { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(ok.status, 302);
  assert.match(ok.headers.get('set-cookie') ?? '', /HttpOnly/);
  const back = new URL(ok.headers.get('location')!);
  assert.equal(back.origin + back.pathname, redirect);
  assert.equal(back.searchParams.get('state'), 'st4te');
  const code = back.searchParams.get('code')!;

  const form2 = (o: Record<string, string>) => call('POST', '/token', new URLSearchParams(o).toString(), undefined, { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal((await form2({ grant_type: 'authorization_code', code: 'nope', client_id: clientId, redirect_uri: redirect, code_verifier: verifier })).status, 400);
  const tok = await form2({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirect, code_verifier: verifier });
  assert.equal(tok.status, 200);
  // A code works once.
  assert.equal((await form2({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirect, code_verifier: verifier })).json.error, 'invalid_grant');

  const [h, b, s] = tok.json.id_token.split('.');
  const jwks = (await call('GET', '/jwks')).json.keys[0];
  const ok2 = verify('sha256', Buffer.from(`${h}.${b}`), { key: createPublicKey({ key: jwks, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  assert.ok(ok2, 'ID token signature checks out against /jwks');
  const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
  assert.equal(claims.iss, 'http://issuer.test');
  assert.equal(claims.aud, clientId);
  assert.equal(claims.nonce, 'n0nce');
  assert.equal(claims.nude_id, 'devtest@nude');

  const ui = await call('GET', '/userinfo', undefined, tok.json.access_token);
  assert.equal(ui.json.preferred_username, 'devtest');
  assert.equal((await call('GET', '/.well-known/openid-configuration')).json.code_challenge_methods_supported[0], 'S256');
});

test('a wrong PKCE verifier gets no tokens', async () => {
  const redirect = 'https://two.example/cb';
  const clientId = (await call('POST', '/v1/admin/clients', { name: 'Two', redirects: [redirect] }, ADMIN)).json.client_id;
  const challenge = createHash('sha256').update('right-verifier-right-verifier-right-verifier').digest('base64url');
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, scope: 'openid', state: 's', code_challenge: challenge, code_challenge_method: 'S256' });
  const form = /name="form" value="([^"]+)"/.exec((await call('GET', `/authorize?${q}`)).text)![1];
  const ok = await call('POST', '/authorize', new URLSearchParams({ form, action: 'signin', username: 'devtest', password: 'a long enough pass' }).toString(), undefined, { 'content-type': 'application/x-www-form-urlencoded' });
  const code = new URL(ok.headers.get('location')!).searchParams.get('code')!;
  const r = await call('POST', '/token', new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirect, code_verifier: 'wrong-verifier-wrong-verifier-wrong-verifier' }).toString(), undefined, { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(r.json.error, 'invalid_grant');
});
