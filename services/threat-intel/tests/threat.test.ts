import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createThreatServer, ingest, openDb, parseFeed } from '../src/server';

test('feed parsing skips comments and invalid lines', () => {
  const r = parseFeed('# comment\nhttps://bad.test/x.exe\nnot a url\nhttp://evil.test/a#frag\n', { name: 't', url: '', format: 'urls', category: 'malware' });
  assert.deepEqual(r.urls, ['https://bad.test/x.exe', 'http://evil.test/a']);
  assert.deepEqual(parseFeed('0.0.0.0 phish.test\nbad\n', { name: 'd', url: '', format: 'domains', category: 'phishing' }).domains, ['phish.test']);
});

test('ingest feeds, serve lists and checks; shared hosts are never blocked wholesale', async () => {
  const feedSrv = createServer((req, res) => {
    if (req.url === '/urls') res.end('https://malware.test/payload.exe\n');
    else if (req.url === '/domains') res.end('phish-bank.test\ngithub.com\n');
    else { res.writeHead(500); res.end(); }
  });
  await new Promise<void>((r) => feedSrv.listen(0, '127.0.0.1', () => r()));
  const f = `http://127.0.0.1:${(feedSrv.address() as { port: number }).port}`;
  const db = openDb(':memory:');
  const results = await ingest(db, [
    { name: 'u', url: `${f}/urls`, format: 'urls', category: 'malware' },
    { name: 'd', url: `${f}/domains`, format: 'domains', category: 'phishing' },
    { name: 'broken', url: `${f}/broken`, format: 'urls', category: 'malware' },
  ]);
  assert.equal(results.find((r) => r.feed === 'broken')?.error, 'HTTP 500');
  const srv = createThreatServer(db, { adminToken: 'a' });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  const lists = await (await fetch(`${base}/v1/lists`)).json() as { domains: Record<string, string>; urls: Record<string, string> };
  assert.equal(lists.domains['phish-bank.test'], 'phishing');
  assert.equal(lists.domains['github.com'], undefined);
  assert.equal(lists.urls['https://malware.test/payload.exe'], 'malware');
  const check = await (await fetch(`${base}/v1/check?url=${encodeURIComponent('https://login.phish-bank.test/')}`)).json() as { action: string; confidence: string };
  assert.equal(check.action, 'block');
  assert.equal(check.confidence, 'confirmed');
  const rep = await fetch(`${base}/v1/report`, { method: 'POST', body: JSON.stringify({ url: 'https://odd.test/', reason: 'looks fake' }) });
  assert.equal(rep.status, 202);
  assert.equal((await fetch(`${base}/v1/admin/reports`)).status, 401);
  srv.close(); feedSrv.close();
});
