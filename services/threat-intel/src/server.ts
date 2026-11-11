// Nude threat-intelligence service.
// - Ingests trusted feeds on a schedule (URL lists, domain lists, CSV) into SQLite.
// - Serves /v1/lists (consumed by Nude browsers) and /v1/check?url= (single lookups).
// - Accepts user reports for human review (reports never block anything automatically).
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { analyzeUrl, emptyLists, registrableDomain, type ThreatCategory, type ThreatLists } from '../../../packages/security-engine/src/index';

export interface Feed { name: string; url: string; format: 'urls' | 'domains' | 'csv-url'; category: ThreatCategory; column?: number }

/** Public feeds. Check each feed's terms of use before enabling it in production. */
export const DEFAULT_FEEDS: Feed[] = [
  { name: 'URLhaus (abuse.ch) recent malware URLs', url: 'https://urlhaus.abuse.ch/downloads/text_recent/', format: 'urls', category: 'malware' },
  { name: 'OpenPhish community feed', url: 'https://openphish.com/feed.txt', format: 'urls', category: 'phishing' },
];

export function openDb(file: string) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS threats (key TEXT PRIMARY KEY, kind TEXT NOT NULL, category TEXT NOT NULL, source TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS allow (domain TEXT PRIMARY KEY, note TEXT);
    CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY, url TEXT NOT NULL, reason TEXT, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'new');
    CREATE TABLE IF NOT EXISTS feed_runs (name TEXT PRIMARY KEY, last_run INTEGER, last_count INTEGER, last_error TEXT);
  `);
  return db;
}

/** Domains that must never be blocked wholesale because they host many unrelated users' content. */
const SHARED_HOSTS = new Set(['github.com', 'githubusercontent.com', 'google.com', 'googleapis.com', 'microsoft.com', 'live.com', 'dropbox.com', 'amazonaws.com', 'cloudfront.net', 'blogspot.com', 'wordpress.com', 'weebly.com', 'wixsite.com', 'sharepoint.com', 'onedrive.live.com', 'docs.google.com', 'drive.google.com', 'discord.com', 'discordapp.com', 'telegram.org', 'pastebin.com', 'bit.ly']);

export function parseFeed(body: string, feed: Feed): { urls: string[]; domains: string[] } {
  const urls: string[] = [];
  const domains: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (feed.format === 'domains') {
      const d = line.split(/\s+/).pop()!.toLowerCase();
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) domains.push(d);
    } else {
      const value = feed.format === 'csv-url' ? line.split(',')[feed.column ?? 2]?.replace(/^"|"$/g, '') : line;
      try {
        const u = new URL(value ?? '');
        if (u.protocol === 'http:' || u.protocol === 'https:') { u.hash = ''; urls.push(u.href); }
      } catch { /* skip */ }
    }
  }
  return { urls, domains };
}

export async function ingest(db: DatabaseSync, feeds: Feed[], fetchImpl: typeof fetch = fetch) {
  const now = Date.now();
  const upsert = db.prepare(`INSERT INTO threats (key, kind, category, source, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET last_seen = excluded.last_seen`);
  const results: { feed: string; count: number; error?: string }[] = [];
  for (const feed of feeds) {
    try {
      const res = await fetchImpl(feed.url, { headers: { 'user-agent': 'NudeThreatIntel/0.1' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { urls, domains } = parseFeed(await res.text(), feed);
      db.exec('BEGIN');
      for (const u of urls) upsert.run(u, 'url', feed.category, feed.name, now, now);
      for (const d of domains) if (!SHARED_HOSTS.has(registrableDomain(d))) upsert.run(d, 'domain', feed.category, feed.name, now, now);
      db.exec('COMMIT');
      db.prepare('INSERT INTO feed_runs (name, last_run, last_count, last_error) VALUES (?, ?, ?, NULL) ON CONFLICT(name) DO UPDATE SET last_run = excluded.last_run, last_count = excluded.last_count, last_error = NULL').run(feed.name, now, urls.length + domains.length);
      results.push({ feed: feed.name, count: urls.length + domains.length });
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* not in a transaction */ }
      db.prepare('INSERT INTO feed_runs (name, last_run, last_count, last_error) VALUES (?, ?, 0, ?) ON CONFLICT(name) DO UPDATE SET last_run = excluded.last_run, last_error = excluded.last_error').run(feed.name, now, (err as Error).message);
      results.push({ feed: feed.name, count: 0, error: (err as Error).message });
    }
  }
  // Entries not seen in any feed for 30 days are expired.
  db.prepare('DELETE FROM threats WHERE last_seen < ?').run(now - 30 * 86400e3);
  return results;
}

export function loadLists(db: DatabaseSync): ThreatLists {
  const lists = emptyLists();
  for (const r of db.prepare('SELECT key, kind, category FROM threats').all() as { key: string; kind: string; category: ThreatCategory }[]) {
    if (r.kind === 'url') lists.urls.set(r.key, r.category);
    else lists.domains.set(r.key, r.category);
  }
  for (const r of db.prepare('SELECT domain FROM allow').all() as { domain: string }[]) lists.allow.add(r.domain);
  return lists;
}

export function createThreatServer(db: DatabaseSync, opts: { adminToken?: string; feeds?: Feed[]; fetchImpl?: typeof fetch } = {}) {
  let lists = loadLists(db);
  let listsJson = '';
  const rebuild = () => {
    lists = loadLists(db);
    listsJson = JSON.stringify({ generated: Date.now(), domains: Object.fromEntries(lists.domains), urls: Object.fromEntries(lists.urls) });
  };
  rebuild();
  const server = createServer(async (req, res) => {
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/health') return json(200, { ok: true, service: 'nude-threat-intel', domains: lists.domains.size, urls: lists.urls.size });
      if (url.pathname === '/v1/lists') return json(200, listsJson);
      if (url.pathname === '/v1/check') {
        const target = url.searchParams.get('url') ?? '';
        const v = analyzeUrl(target, lists, (url.searchParams.get('level') as 'standard') ?? 'enhanced');
        return json(200, { url: target, action: v.action, confidence: v.confidence, category: v.category ?? null, signals: v.signals.map((s) => s.message) });
      }
      if (url.pathname === '/v1/report' && req.method === 'POST') {
        let body = '';
        for await (const c of req) { body += c; if (body.length > 10_000) return json(413, { error: 'Too large' }); }
        const r = JSON.parse(body || '{}') as { url?: string; reason?: string };
        if (!r.url || !/^https?:\/\//.test(r.url)) return json(400, { error: 'url required' });
        db.prepare('INSERT INTO reports (url, reason, created) VALUES (?, ?, ?)').run(r.url.slice(0, 2000), (r.reason ?? '').slice(0, 1000), Date.now());
        return json(202, { received: true, note: 'Thanks. Reports are reviewed by people before anything is blocked.' });
      }
      if (url.pathname.startsWith('/v1/admin/')) {
        if (!opts.adminToken || req.headers.authorization !== `Bearer ${opts.adminToken}`) return json(401, { error: 'Unauthorized' });
        if (url.pathname === '/v1/admin/ingest' && req.method === 'POST') { const r = await ingest(db, opts.feeds ?? DEFAULT_FEEDS, opts.fetchImpl); rebuild(); return json(200, r); }
        if (url.pathname === '/v1/admin/reports') return json(200, db.prepare("SELECT * FROM reports WHERE status = 'new' ORDER BY created DESC LIMIT 200").all());
        if (url.pathname === '/v1/admin/feeds') return json(200, db.prepare('SELECT * FROM feed_runs').all());
      }
      json(404, { error: 'Not found' });
    } catch (err) {
      console.error(err);
      json(500, { error: 'Internal error' });
    }
  });
  return Object.assign(server, { rebuild });
}

if (require.main === module) {
  const db = openDb(process.env.NUDE_THREAT_DB ?? join(process.cwd(), 'data', 'threats.db'));
  const feeds: Feed[] = process.env.NUDE_FEEDS ? JSON.parse(process.env.NUDE_FEEDS) : DEFAULT_FEEDS;
  const server = createThreatServer(db, { adminToken: process.env.NUDE_ADMIN_TOKEN, feeds });
  const refresh = async () => { const r = await ingest(db, feeds); server.rebuild(); console.log('Feeds refreshed', r); };
  void refresh();
  setInterval(() => void refresh(), Number(process.env.NUDE_FEED_REFRESH_MINUTES ?? 60) * 60_000);
  const port = Number(process.env.PORT ?? 8791);
  server.listen(port, listenHost(), () => console.log(`Nude threat intelligence on http://${listenHost()}:${port}`));
}

/** Local runs stay on this computer; on a host such as Render (which sets RENDER) the service must listen on all interfaces. */
function listenHost(): string {
  return process.env.HOST ?? (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
}
