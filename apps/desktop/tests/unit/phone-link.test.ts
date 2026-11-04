// Phone link: pairing by QR code, signed requests, encrypted replies, and the same bytes the Android apps produce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PhoneLink, isLanAddress, linkKeys, open, seal, sign } from '../../src/main/phone-link';

// Shared with apps/android/core PhoneLinkTest: the same key, IV and messages must give the same bytes.
test('known-answer vectors (match the Kotlin implementation)', () => {
  const key = Buffer.from([...Array(32).keys()]);
  const { enc, mac } = linkKeys(key);
  assert.equal(enc.toString('base64url'), 'uciKU85TEzNyINaJoMVS01WmuAbiWC83Ye8eU6hn33w');
  assert.equal(mac.toString('base64url'), 'Slr4KAzcAJxC36o-2oO1vkD3RoGCW8vuU8IBKji6h4A');
  const env = seal(enc, '/v1/device/abc/report', { a: 1, s: 'héllo' }, Buffer.from([...Array(12).keys()]));
  assert.deepEqual(env, { iv: 'AAECAwQFBgcICQoL', ct: 'SlHH-FzKCWTjI_iyv7ddxWKNHW4Zxu3z6cHjYyXyi8NbrEQf' });
  assert.deepEqual(open(enc, '/v1/device/abc/report', env), { a: 1, s: 'héllo' });
  assert.throws(() => open(enc, '/v1/device/abc/identity', env)); // bound to its path
  assert.equal(sign(mac, 'GET\n/v1/device/abc/report\n1700000000000'), 'O1VSAn0Z18jwUdbT9xfylebpfUXtC8X0Ywqx38eIscU');
  assert.equal(sign(mac, 'pair\nOFFER\nPixel 8\n1700000000000'), 'T_ww6WxGuv9A3ituxnm_HTX4iEXS8uaFCNCTph3tyVg');
});

test('only private-network addresses may connect', () => {
  for (const a of ['192.168.1.5', '10.0.0.2', '172.20.1.1', '::ffff:192.168.0.9', '127.0.0.1', 'fe80::1', 'fd12::3', '100.101.1.1']) assert.ok(isLanAddress(a), a);
  for (const a of ['8.8.8.8', '172.32.0.1', '203.0.113.5', '2001:db8::1', undefined]) assert.ok(!isLanAddress(a as string), String(a));
});

async function phone(link: PhoneLink, app: 'passgate' | 'defender') {
  const o = await link.offer(app);
  assert.ok(o.text.startsWith('NUDE1:'));
  const q = JSON.parse(o.text.slice(6)) as { v: number; a: string; p: number; i: string; k: string; n: string };
  assert.equal(q.a, app);
  const { enc, mac } = linkKeys(Buffer.from(q.k, 'base64url'));
  const base = `http://127.0.0.1:${q.p}`;
  const pair = async (sigOverride?: string) => {
    const t = Date.now();
    return fetch(`${base}/v1/pair`, { method: 'POST', body: JSON.stringify({ i: q.i, d: 'Pixel 8', t, s: sigOverride ?? sign(mac, `pair\n${q.i}\nPixel 8\n${t}`) }) });
  };
  const get = (deviceId: string, what: string, badSig = false) => {
    const path = `/v1/device/${deviceId}/${what}`;
    const t = Date.now();
    return fetch(`${base}${path}`, { headers: { 'x-nude-time': String(t), 'x-nude-sig': badSig ? 'x' : sign(mac, `GET\n${path}\n${t}`) } })
      .then(async (r) => ({ status: r.status, body: r.ok ? open(enc, path, await r.json() as { iv: string; ct: string }) : await r.json() }));
  };
  return { q, enc, pair, get };
}

test('pairing, reading and unlinking', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nude-link-'));
  const link = new PhoneLink(dir, {
    identity: () => ({ account: { name: 'Simon', rovianId: 'simon@rovian.cloud' } }),
    report: () => ({ level: 'enhanced', stats: { blockedSites: 3 } }),
  });
  try {
    const p = await phone(link, 'passgate');
    assert.equal((await p.pair('wrong')).status, 401, 'a bad signature is refused');
    const r = await p.pair();
    assert.equal(r.status, 200);
    const paired = open(p.enc, '/v1/pair', await r.json() as { iv: string; ct: string }) as { deviceId: string; app: string };
    assert.equal(paired.app, 'passgate');
    assert.equal((await p.pair()).status, 410, 'a code works only once');
    assert.equal(link.devices().length, 1);
    assert.equal(link.devices()[0].name, 'Pixel 8');

    const id = await p.get(paired.deviceId, 'identity');
    assert.equal(id.status, 200);
    assert.deepEqual(id.body, { account: { name: 'Simon', rovianId: 'simon@rovian.cloud' } });
    assert.equal((await p.get(paired.deviceId, 'report')).status, 403, 'PassGate can\'t read the Defender report');
    assert.equal((await p.get(paired.deviceId, 'identity', true)).status, 401, 'unsigned reads are refused');
    assert.equal((await p.get('nonexistent-device-1', 'identity')).status, 401);

    const d = await phone(link, 'defender');
    const dr = await d.pair();
    const dev = open(d.enc, '/v1/pair', await dr.json() as { iv: string; ct: string }) as { deviceId: string };
    const rep = await d.get(dev.deviceId, 'report');
    assert.deepEqual(rep.body, { level: 'enhanced', stats: { blockedSites: 3 } });

    link.remove(paired.deviceId);
    assert.equal((await p.get(paired.deviceId, 'identity')).status, 401, 'an unlinked phone is refused');
  } finally {
    link.stop();
  }
});
