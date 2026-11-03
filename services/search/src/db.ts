// Nude Search storage: SQLite (built into Node) with an FTS5 full-text index.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Extracted } from './extract';

export type Db = DatabaseSync;

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      canonical TEXT,
      host TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      headings TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      lang TEXT NOT NULL DEFAULT 'en',
      kind TEXT NOT NULL DEFAULT 'page',
      price TEXT,
      published INTEGER,
      fetched_at INTEGER NOT NULL,
      changed_at INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      quality REAL NOT NULL DEFAULT 0.5,
      spam REAL NOT NULL DEFAULT 0,
      adult INTEGER NOT NULL DEFAULT 0,
      inlinks INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS pages_hash ON pages(content_hash);
    CREATE INDEX IF NOT EXISTS pages_host ON pages(host);
    CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
      title, description, headings, content, url UNINDEXED,
      content='pages', content_rowid='id', tokenize='porter unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
      INSERT INTO pages_fts(rowid, title, description, headings, content, url) VALUES (new.id, new.title, new.description, new.headings, new.content, new.url);
    END;
    CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN
      INSERT INTO pages_fts(pages_fts, rowid, title, description, headings, content, url) VALUES ('delete', old.id, old.title, old.description, old.headings, old.content, old.url);
    END;
    CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE ON pages BEGIN
      INSERT INTO pages_fts(pages_fts, rowid, title, description, headings, content, url) VALUES ('delete', old.id, old.title, old.description, old.headings, old.content, old.url);
      INSERT INTO pages_fts(rowid, title, description, headings, content, url) VALUES (new.id, new.title, new.description, new.headings, new.content, new.url);
    END;
    CREATE TABLE IF NOT EXISTS images (page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE, src TEXT NOT NULL, alt TEXT NOT NULL, PRIMARY KEY (page_id, src));
    CREATE VIRTUAL TABLE IF NOT EXISTS images_fts USING fts5(alt, src UNINDEXED, page_id UNINDEXED, tokenize='porter unicode61');
    CREATE TABLE IF NOT EXISTS links (src TEXT NOT NULL, dst TEXT NOT NULL, PRIMARY KEY (src, dst));
    CREATE INDEX IF NOT EXISTS links_dst ON links(dst);
    CREATE TABLE IF NOT EXISTS queue (
      url TEXT PRIMARY KEY, host TEXT NOT NULL, depth INTEGER NOT NULL DEFAULT 0, priority REAL NOT NULL DEFAULT 0.5,
      next_fetch INTEGER NOT NULL DEFAULT 0, interval_s INTEGER NOT NULL DEFAULT 86400, attempts INTEGER NOT NULL DEFAULT 0, last_status INTEGER
    );
    CREATE INDEX IF NOT EXISTS queue_next ON queue(next_fetch, priority DESC);
    CREATE TABLE IF NOT EXISTS robots (host TEXT PRIMARY KEY, body TEXT, fetched_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS queries (q TEXT PRIMARY KEY, count INTEGER NOT NULL, last INTEGER NOT NULL);
  `);
  return db;
}

export const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);

const ADULT = /\b(porn|xxx|sex ?cam|nsfw|escort|hentai|nude pics|onlyfans leak)\b/i;
const MONEY_SPAM = /\b(casino|viagra|cialis|payday loan|crypto giveaway|replica watches)\b/gi;

/** Page quality and spam heuristics computed at index time. */
export function assess(e: Extracted, url: string): { quality: number; spam: number; adult: boolean } {
  const words = e.content.split(/\s+/).filter(Boolean);
  const unique = new Set(words.map((w) => w.toLowerCase()));
  let quality = 0.3;
  if (e.title) quality += 0.15;
  if (e.description) quality += 0.1;
  if (words.length > 150) quality += 0.15;
  if (words.length > 600) quality += 0.1;
  if (url.startsWith('https:')) quality += 0.1;
  if (e.headings) quality += 0.05;
  let spam = 0;
  // Keyword stuffing: one word dominating the text.
  const counts = new Map<string, number>();
  for (const w of words) { const k = w.toLowerCase(); if (k.length > 3) counts.set(k, (counts.get(k) ?? 0) + 1); }
  const top = Math.max(0, ...counts.values());
  if (words.length > 100 && top / words.length > 0.08) spam += 0.4;
  if (words.length > 100 && unique.size / words.length < 0.15) spam += 0.3;
  if ((e.content.match(MONEY_SPAM)?.length ?? 0) > 5) spam += 0.3;
  if (e.links.length > 400 && words.length < 400) spam += 0.2;
  if (e.title.length > 200) spam += 0.1;
  return { quality: Math.min(1, quality), spam: Math.min(1, spam), adult: ADULT.test(`${e.title} ${e.description} ${e.content.slice(0, 5000)}`) };
}

export interface IndexResult { status: 'new' | 'updated' | 'unchanged' | 'duplicate' | 'skipped' }

export function indexPage(db: Db, url: string, e: Extracted, now = Date.now()): IndexResult {
  if (e.noindex) {
    db.prepare('DELETE FROM pages WHERE url = ?').run(url);
    return { status: 'skipped' };
  }
  const contentHash = hash(`${e.title}\n${e.content}`);
  const existing = db.prepare('SELECT id, content_hash FROM pages WHERE url = ?').get(url) as { id: number; content_hash: string } | undefined;
  if (!existing) {
    const dupe = db.prepare('SELECT url FROM pages WHERE content_hash = ? AND url != ? LIMIT 1').get(contentHash, url) as { url: string } | undefined;
    if (dupe) return { status: 'duplicate' };
  }
  const host = new URL(url).hostname;
  const a = assess(e, url);
  const published = e.published ? Date.parse(e.published) || null : null;
  if (existing && existing.content_hash === contentHash) {
    db.prepare('UPDATE pages SET fetched_at = ? WHERE id = ?').run(now, existing.id);
    return { status: 'unchanged' };
  }
  const params = [url, e.canonical ?? null, host, e.title, e.description, e.headings, e.content, e.lang, e.kind, e.price ?? null, published, now, now, contentHash, a.quality, a.spam, a.adult ? 1 : 0] as const;
  let id: number;
  if (existing) {
    db.prepare(`UPDATE pages SET url=?, canonical=?, host=?, title=?, description=?, headings=?, content=?, lang=?, kind=?, price=?, published=?, fetched_at=?, changed_at=?, content_hash=?, quality=?, spam=?, adult=? WHERE id = ?`).run(...params, existing.id);
    id = existing.id;
    db.prepare('DELETE FROM images WHERE page_id = ?').run(id);
    db.prepare('DELETE FROM images_fts WHERE page_id = ?').run(id);
  } else {
    const r = db.prepare(`INSERT INTO pages (url, canonical, host, title, description, headings, content, lang, kind, price, published, fetched_at, changed_at, content_hash, quality, spam, adult) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...params);
    id = Number(r.lastInsertRowid);
  }
  const insImg = db.prepare('INSERT OR IGNORE INTO images (page_id, src, alt) VALUES (?, ?, ?)');
  const insImgFts = db.prepare('INSERT INTO images_fts (alt, src, page_id) VALUES (?, ?, ?)');
  for (const img of e.images) { insImg.run(id, img.src, img.alt); insImgFts.run(img.alt, img.src, id); }
  db.prepare('DELETE FROM links WHERE src = ?').run(url);
  const insLink = db.prepare('INSERT OR IGNORE INTO links (src, dst) VALUES (?, ?)');
  for (const l of e.links) insLink.run(url, l);
  return { status: existing ? 'updated' : 'new' };
}

/** Recomputes inbound-link counts (cross-site links count more). Run after crawls. */
export function updateLinkScores(db: Db) {
  db.exec(`UPDATE pages SET inlinks = COALESCE((SELECT COUNT(DISTINCT src) FROM links WHERE links.dst = pages.url), 0)`);
}

export function stats(db: Db) {
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    pages: n('SELECT COUNT(*) n FROM pages'),
    hosts: n('SELECT COUNT(DISTINCT host) n FROM pages'),
    queued: n('SELECT COUNT(*) n FROM queue WHERE next_fetch <= ' + Date.now()),
    images: n('SELECT COUNT(*) n FROM images'),
  };
}
