// Query parsing and ranking: BM25 relevance blended with quality, link popularity, freshness and spam penalties.
import type { Db } from './db';

export type SearchType = 'web' | 'news' | 'images' | 'videos' | 'shopping';
export interface SearchOptions {
  q: string;
  page?: number;
  perPage?: number;
  type?: SearchType;
  lang?: string;
  safe?: 'strict' | 'moderate' | 'off';
  freshness?: 'day' | 'week' | 'month' | 'year' | 'any';
  /** Hosts the user has chosen to prefer (sent by the client, never stored server-side). */
  preferHosts?: string[];
  site?: string;
}

export interface Result {
  url: string;
  title: string;
  description: string;
  snippet: string; // contains <mark> highlights; all other text is escaped
  host: string;
  favicon: string;
  published?: string;
  kind: string;
  price?: string;
  image?: string;
  score: number;
  source: 'nude';
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Turns user text into a safe FTS5 query. Supports "phrases", -exclude and site:host. */
export function parseQuery(raw: string): { fts: string; site?: string; terms: string[] } {
  let site: string | undefined;
  const parts: string[] = [];
  const terms: string[] = [];
  const re = /(-?)"([^"]+)"|(-?)(\S+)/g;
  for (const m of raw.matchAll(re)) {
    const neg = m[1] || m[3];
    const phrase = m[2];
    let word = m[4];
    if (word && /^site:/i.test(word)) { site = word.slice(5).toLowerCase(); continue; }
    if (phrase) {
      const p = phrase.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
      if (!p) continue;
      parts.push(`${neg ? 'NOT ' : ''}"${p}"`);
      if (!neg) terms.push(...p.split(/\s+/));
      continue;
    }
    word = (word ?? '').replace(/[^\p{L}\p{N}]/gu, '');
    if (!word) continue;
    if (neg) parts.push(`NOT "${word}"`);
    else { parts.push(`"${word}"*`); terms.push(word); }
  }
  // FTS5 can't start with NOT; positive terms first.
  parts.sort((a, b) => Number(a.startsWith('NOT')) - Number(b.startsWith('NOT')));
  const fts = parts[0]?.startsWith('NOT') ? '' : parts.join(' ');
  return { fts, site, terms };
}

const FRESH_MS = { day: 86400e3, week: 7 * 86400e3, month: 30 * 86400e3, year: 365 * 86400e3 };

export function search(db: Db, o: SearchOptions): { total: number; results: Result[] } {
  const perPage = Math.min(50, Math.max(1, o.perPage ?? 10));
  const page = Math.max(1, Math.min(50, o.page ?? 1));
  const { fts, site: qSite, terms } = parseQuery(o.q);
  const site = (o.site ?? qSite)?.replace(/^www\./, '');
  if (!fts) return { total: 0, results: [] };

  if (o.type === 'images') return searchImages(db, fts, o, perPage, page);

  const where: string[] = ['pages_fts MATCH ?'];
  const args: (string | number)[] = [fts];
  if (site) { where.push('(p.host = ? OR p.host LIKE ?)'); args.push(site, `%.${site}`); }
  if (o.lang) { where.push('p.lang = ?'); args.push(o.lang); }
  if ((o.safe ?? 'moderate') !== 'off') where.push('p.adult = 0');
  if (o.type === 'news') { where.push("(p.kind = 'article' AND p.published IS NOT NULL)"); }
  if (o.type === 'videos') where.push("p.kind = 'video'");
  if (o.type === 'shopping') where.push("p.kind = 'product'");
  if (o.freshness && o.freshness !== 'any') { where.push('COALESCE(p.published, p.changed_at) >= ?'); args.push(Date.now() - FRESH_MS[o.freshness]); }
  where.push('p.spam < 0.7');

  // bm25 column weights: title 10, description 4, headings 3, content 1.
  const rows = db.prepare(`
    SELECT p.url, p.title, p.description, p.host, p.published, p.changed_at, p.kind, p.price, p.quality, p.spam, p.inlinks,
           bm25(pages_fts, 10.0, 4.0, 3.0, 1.0) AS bm,
           snippet(pages_fts, 3, char(1), char(2), ' … ', 24) AS snip,
           (SELECT src FROM images i WHERE i.page_id = p.id LIMIT 1) AS image
    FROM pages_fts JOIN pages p ON p.id = pages_fts.rowid
    WHERE ${where.join(' AND ')}
    ORDER BY bm LIMIT 400`).all(...args) as {
      url: string; title: string; description: string; host: string; published: number | null; changed_at: number; kind: string; price: string | null;
      quality: number; spam: number; inlinks: number; bm: number; snip: string; image: string | null }[];

  const now = Date.now();
  const prefer = new Set((o.preferHosts ?? []).map((h) => h.toLowerCase()));
  const lowerTerms = terms.map((t) => t.toLowerCase());
  const scored = rows.map((r) => {
    const relevance = -r.bm; // bm25 is negative; larger magnitude = better
    const titleHit = lowerTerms.length && lowerTerms.every((t) => r.title.toLowerCase().includes(t)) ? 1.5 : 0;
    const urlHit = lowerTerms.some((t) => r.host.includes(t)) ? 1.0 : 0;
    const popularity = Math.log2(1 + r.inlinks) * 0.6;
    const ageDays = (now - (r.published ?? r.changed_at)) / 86400e3;
    const freshness = o.type === 'news' ? Math.max(0, 3 - ageDays / 2) : Math.max(0, 0.6 - ageDays / 365);
    const personal = prefer.has(r.host) ? 1 : 0;
    const score = relevance + titleHit + urlHit + popularity + freshness + r.quality * 2 + personal - r.spam * 4;
    return { r, score };
  }).sort((a, b) => b.score - a.score);

  // Host diversity: at most 2 results per host on a page (more on later pages).
  const diversified: typeof scored = [];
  const perHost = new Map<string, number>();
  const overflow: typeof scored = [];
  for (const s of scored) {
    const n = perHost.get(s.r.host) ?? 0;
    if (n < 2 || site) { diversified.push(s); perHost.set(s.r.host, n + 1); } else overflow.push(s);
  }
  const ordered = [...diversified, ...overflow];
  const slice = ordered.slice((page - 1) * perPage, page * perPage);
  return {
    total: ordered.length,
    results: slice.map(({ r, score }) => ({
      url: r.url,
      title: r.title || r.url,
      description: r.description,
      snippet: esc(r.snip || r.description).replace(/\u0001/g, '<mark>').replace(/\u0002/g, '</mark>'),
      host: r.host,
      favicon: `https://${r.host}/favicon.ico`,
      published: r.published ? new Date(r.published).toISOString() : undefined,
      kind: r.kind,
      price: r.price ?? undefined,
      image: r.image ?? undefined,
      score: Math.round(score * 100) / 100,
      source: 'nude' as const,
    })),
  };
}

function searchImages(db: Db, fts: string, o: SearchOptions, perPage: number, page: number) {
  const rows = db.prepare(`
    SELECT i.alt, i.src, p.url, p.title, p.host, p.adult FROM images_fts i JOIN pages p ON p.id = i.page_id
    WHERE images_fts MATCH ? ${(o.safe ?? 'moderate') !== 'off' ? 'AND p.adult = 0' : ''} ORDER BY bm25(images_fts) LIMIT 300`).all(fts.replace(/"(\w+)"\*/g, '$1*')) as
    { alt: string; src: string; url: string; title: string; host: string }[];
  return {
    total: rows.length,
    results: rows.slice((page - 1) * perPage, page * perPage).map((r) => ({
      url: r.url, title: r.alt || r.title, description: r.title, snippet: esc(r.alt), host: r.host, favicon: `https://${r.host}/favicon.ico`,
      kind: 'image', image: r.src, score: 0, source: 'nude' as const,
    })),
  };
}

/** Autocomplete from popular past queries and indexed titles. */
export function suggest(db: Db, prefix: string, limit = 8): string[] {
  const p = prefix.trim().toLowerCase();
  if (!p || p.length > 100) return [];
  const fromQueries = (db.prepare('SELECT q FROM queries WHERE q LIKE ? ESCAPE \'\\\' ORDER BY count DESC, last DESC LIMIT ?')
    .all(p.replace(/[%_\\]/g, '\\$&') + '%', limit) as { q: string }[]).map((r) => r.q);
  const { fts } = parseQuery(p);
  let fromTitles: string[] = [];
  if (fts && fromQueries.length < limit) {
    fromTitles = (db.prepare(`SELECT p.title FROM pages_fts JOIN pages p ON p.id = pages_fts.rowid WHERE pages_fts MATCH ? AND p.adult = 0 ORDER BY bm25(pages_fts, 10, 1, 1, 0.1) LIMIT 20`)
      .all(`title : ${fts}`) as { title: string }[])
      .map((r) => r.title.toLowerCase().replace(/\s+[|–—-]\s+.*$/, '').trim())
      .filter((t) => t.startsWith(p.split(' ')[0]) && t.length < 80);
  }
  return [...new Set([...fromQueries, ...fromTitles])].slice(0, limit);
}

export function recordQuery(db: Db, q: string) {
  const norm = q.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!norm || norm.length > 120 || /\b(site:|http)/.test(norm)) return;
  db.prepare('INSERT INTO queries (q, count, last) VALUES (?, 1, ?) ON CONFLICT(q) DO UPDATE SET count = count + 1, last = excluded.last').run(norm, Date.now());
}

/** Trending: queries searched most in the last 3 days, needing at least 3 searches (k-anonymity-style floor). */
export function trending(db: Db, limit = 8): string[] {
  return (db.prepare('SELECT q FROM queries WHERE last >= ? AND count >= 3 ORDER BY count DESC LIMIT ?').all(Date.now() - 3 * 86400e3, limit) as { q: string }[]).map((r) => r.q);
}
