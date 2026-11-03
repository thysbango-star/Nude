import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { parseRobots, isAllowed } from '../src/robots';
import { extract, normalizeUrl, parseSitemap, detectLanguage } from '../src/extract';
import { openDb, stats, type Db } from '../src/db';
import { parseQuery, search, suggest } from '../src/rank';
import { Crawler } from '../src/crawler';
import { createSearchServer } from '../src/server';

test('robots.txt: groups, longest match, wildcards', () => {
  const r = parseRobots(`User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.pdf$\n\nUser-agent: OtherBot\nDisallow: /\nSitemap: https://x.test/sitemap.xml`, 'NudeBot');
  assert.equal(isAllowed(r, '/'), true);
  assert.equal(isAllowed(r, '/private/x'), false);
  assert.equal(isAllowed(r, '/private/ok/page'), true);
  assert.equal(isAllowed(r, '/doc.pdf'), false);
  assert.equal(isAllowed(r, '/doc.pdf?x=1'), true);
  assert.deepEqual(r.sitemaps, ['https://x.test/sitemap.xml']);
  const own = parseRobots('User-agent: NudeBot\nDisallow: /no-nude\nUser-agent: *\nDisallow: /', 'NudeBot');
  assert.equal(isAllowed(own, '/hello'), true);
  assert.equal(isAllowed(own, '/no-nude'), false);
});

test('extraction: metadata, links, noindex, language', () => {
  const html = `<html lang="en"><head><title>Braai Guide &amp; Tips</title><meta name="description" content="How to braai well">
    <link rel="canonical" href="/guide"><meta property="article:published_time" content="2026-10-01T10:00:00Z"></head>
    <body><nav>menu</nav><article><h1>Braai basics</h1><p>Light the coals and wait.</p><a href="/next?utm_source=x">Next</a><a rel="nofollow" href="/ad">Ad</a>
    <img src="/fire.jpg" alt="A braai fire"></article><script>evil()</script></body></html>`;
  const e = extract(html, 'https://braai.test/page');
  assert.equal(e.title, 'Braai Guide & Tips');
  assert.equal(e.description, 'How to braai well');
  assert.equal(e.canonical, 'https://braai.test/guide');
  assert.deepEqual(e.links, ['https://braai.test/next']);
  assert.equal(e.kind, 'article');
  assert.match(e.content, /Light the coals/);
  assert.doesNotMatch(e.content, /evil|menu/);
  assert.equal(e.images[0].alt, 'A braai fire');
  assert.equal(extract('<meta name="robots" content="noindex,nofollow"><p>x</p>', 'https://a.test/').noindex, true);
  assert.equal(detectLanguage('die hond en die kat is nie vir ons nie'), 'af');
  assert.equal(normalizeUrl('HTTPS://Example.com:443/a?b=2&a=1&utm_source=z#frag'), 'https://example.com/a?a=1&b=2');
  assert.deepEqual(parseSitemap('<urlset><url><loc>https://a.test/1</loc></url></urlset>').urls, ['https://a.test/1']);
});

test('query parsing is safe for FTS', () => {
  assert.equal(parseQuery('braai "boerewors roll" -vegan site:braai.test').site, 'braai.test');
  assert.equal(parseQuery('NEAR( OR AND *').fts.includes('('), false);
  assert.equal(parseQuery('-only').fts, '');
});

// ---------------------------------------------------------------- end-to-end: crawl a local site, then search it
const SITE: Record<string, string> = {
  '/robots.txt': 'User-agent: *\nDisallow: /secret\nSitemap: {{origin}}/sitemap.xml',
  '/sitemap.xml': '<urlset><url><loc>{{origin}}/from-sitemap</loc></url></urlset>',
  '/': '<html><head><title>Nude Test Home</title></head><body><a href="/braai">Braai</a><a href="/coffee">Coffee</a><a href="/secret">Secret</a><a href="/copy">Copy</a></body></html>',
  '/braai': '<html><head><title>The complete braai guide</title><meta name="description" content="Everything about braai fires"></head><body><article><h1>Braai</h1><p>A braai is a South African barbecue. Light the charcoal, wait for the coals, then cook boerewors and lamb chops over the fire.</p></article></body></html>',
  '/copy': '<html><head><title>The complete braai guide</title><meta name="description" content="Everything about braai fires"></head><body><article><h1>Braai</h1><p>A braai is a South African barbecue. Light the charcoal, wait for the coals, then cook boerewors and lamb chops over the fire.</p></article></body></html>',
  '/coffee': '<html><head><title>Rooibos and coffee</title></head><body><p>Rooibos tea is a red bush tea from the Cederberg. Coffee is also popular.</p></body></html>',
  '/secret': '<html><head><title>Secret braai</title></head><body><p>should never be indexed</p></body></html>',
  '/from-sitemap': '<html><head><title>Sitemap page about potjiekos</title></head><body><p>Potjiekos is a stew cooked in a three-legged pot.</p></body></html>',
};
let site: Server;
let origin = '';
let db: Db;
let api: Server;
let apiBase = '';

before(async () => {
  site = createServer((req, res) => {
    const body = SITE[(req.url ?? '/').split('?')[0]];
    if (!body) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': req.url?.endsWith('.txt') ? 'text/plain' : req.url?.endsWith('.xml') ? 'application/xml' : 'text/html' });
    res.end(body.replace(/\{\{origin\}\}/g, origin));
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()));
  origin = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
  db = openDb(':memory:');
  const crawler = new Crawler(db, { maxPages: 20, hostDelayMs: 0, concurrency: 2 });
  crawler.enqueue(`${origin}/`, 0, 1);
  const report = await crawler.run();
  assert.ok(report.indexed >= 3, JSON.stringify(report));
  api = createSearchServer({ db, provider: null });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', () => r()));
  apiBase = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
});
after(() => { site.close(); api.close(); });

test('crawler respects robots, finds sitemap pages, skips duplicates', () => {
  const urls = (db.prepare('SELECT url FROM pages').all() as { url: string }[]).map((r) => r.url);
  assert.ok(urls.includes(`${origin}/braai`));
  assert.ok(urls.includes(`${origin}/from-sitemap`), 'sitemap page indexed');
  assert.ok(!urls.includes(`${origin}/secret`), 'robots.txt disallow respected');
  assert.equal(urls.filter((u) => u.endsWith('/braai') || u.endsWith('/copy')).length, 1, 'duplicate content indexed once');
  assert.ok(stats(db).pages >= 4);
});

test('search ranks relevant pages with highlighted snippets', () => {
  const r = search(db, { q: 'braai charcoal' });
  assert.equal(r.results[0].title, 'The complete braai guide');
  assert.match(r.results[0].snippet, /<mark>/);
  assert.equal(search(db, { q: 'rooibos' }).results[0].url, `${origin}/coffee`);
  assert.equal(search(db, { q: 'zzzzqqq' }).total, 0);
  assert.equal(search(db, { q: '<script>alert(1)</script>' }).results.every((x) => !x.snippet.includes('<script>')), true);
});

test('search API: results, pagination, suggestions, health, HTML page', async () => {
  const j = await (await fetch(`${apiBase}/api/search?q=potjiekos`)).json() as { results: { url: string; source: string }[]; total: number };
  assert.equal(j.results[0].url, `${origin}/from-sitemap`);
  assert.equal(j.results[0].source, 'nude');
  await fetch(`${apiBase}/api/search?q=braai`);
  const [, sugg] = await (await fetch(`${apiBase}/api/suggest?q=bra`)).json() as [string, string[]];
  assert.ok(sugg.some((s) => s.startsWith('bra')), JSON.stringify(sugg));
  assert.equal((await (await fetch(`${apiBase}/health`)).json() as { ok: boolean }).ok, true);
  const html = await (await fetch(`${apiBase}/search?q=braai`)).text();
  assert.match(html, /The complete braai guide/);
  assert.match(html, /from Nude's index/);
  const unauth = await fetch(`${apiBase}/api/crawl`, { method: 'POST', body: '{}' });
  assert.equal(unauth.status, 401);
});

test('fallback provider is used and labelled when the index is thin', async () => {
  const fake = { name: 'TestProvider', search: async () => [{ url: 'https://partner.test/x', title: 'Partner result', description: 'd', snippet: 'd', host: 'partner.test', favicon: '', kind: 'page', score: 0, source: 'TestProvider' }] };
  const s = createSearchServer({ db, provider: fake, fallbackMin: 5 });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
  const j = await (await fetch(`${base}/api/search?q=rooibos`)).json() as { results: { source: string }[]; fallback: { used: boolean } };
  s.close();
  assert.equal(j.fallback.used, true);
  assert.equal(j.results[0].source, 'nude');
  assert.ok(j.results.some((r) => r.source === 'TestProvider'));
});
