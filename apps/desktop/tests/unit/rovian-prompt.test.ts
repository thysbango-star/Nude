// The Sign in with Rovian prompt: which page offers Nude acts on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROVIAN_AUTHORIZE, chooseOffer, siteLabel } from '../../src/main/rovian-prompt';
import { encodeQr } from '../../src/shared/qr';

const auth = `${ROVIAN_AUTHORIZE}?response_type=code&client_id=abc&redirect_uri=https%3A%2F%2Fshop.example%2Fcb&state=s&code_challenge=c&code_challenge_method=S256`;

test('accepts a same-site meta or link start URL', () => {
  assert.deepEqual(chooseOffer('https://www.shop.example/login', [{ kind: 'meta', url: 'https://auth.shop.example/rovian' }]), { kind: 'meta', url: 'https://auth.shop.example/rovian' });
  assert.deepEqual(chooseOffer('https://shop.example/', [{ kind: 'link', url: 'https://shop.example/auth/rovian' }]), { kind: 'link', url: 'https://shop.example/auth/rovian' });
});

test('refuses a start URL on another site or downgraded to http', () => {
  assert.equal(chooseOffer('https://shop.example/', [{ kind: 'meta', url: 'https://evil.example/rovian' }]), null);
  assert.equal(chooseOffer('https://shop.example/', [{ kind: 'meta', url: 'http://shop.example/rovian' }]), null);
  assert.equal(chooseOffer('https://shop.example/', [{ kind: 'meta', url: 'javascript:alert(1)' }]), null);
});

test('accepts only the real Rovian authorize endpoint', () => {
  assert.deepEqual(chooseOffer('https://shop.example/', [{ kind: 'authorize', url: auth }]), { kind: 'authorize', url: auth });
  assert.equal(chooseOffer('https://shop.example/', [{ kind: 'authorize', url: auth.replace('supabase.co', 'supabase.co.evil.example') }]), null);
  assert.equal(chooseOffer('https://shop.example/', [{ kind: 'authorize', url: `${ROVIAN_AUTHORIZE}?state=x` }]), null);
});

test('a labelled button, and nothing on Rovian itself or on non-web pages', () => {
  assert.deepEqual(chooseOffer('https://shop.example/', [{ kind: 'button' }]), { kind: 'button' });
  assert.equal(chooseOffer(`${ROVIAN_AUTHORIZE}?x=1`, [{ kind: 'button' }]), null);
  assert.equal(chooseOffer('nude://newtab/', [{ kind: 'button' }]), null);
  assert.equal(chooseOffer('http://public.example/', [{ kind: 'button' }]), null);
  assert.deepEqual(chooseOffer('http://localhost:3000/', [{ kind: 'button' }]), { kind: 'button' });
  assert.equal(chooseOffer('https://shop.example/', 'nope'), null);
});

test('the site name comes from the address, not the page', () => {
  assert.equal(siteLabel('https://www.shop.example/login?x'), 'shop.example');
});

test('QR codes have the right size and finder patterns', () => {
  const m = encodeQr('NUDE1:{"v":1}', 'M');
  assert.equal(m.length, 21);
  const finder = (x: number, y: number) => [0, 1, 2, 3, 4, 5, 6].every((i) => m[y][x + i] && m[y + 6][x + i] && m[y + i][x] && m[y + i][x + 6]);
  assert.ok(finder(0, 0) && finder(14, 0) && finder(0, 14));
  assert.equal(encodeQr('x'.repeat(300), 'M').length, 4 * 13 + 17); // version 13 holds 331 bytes at M
});
