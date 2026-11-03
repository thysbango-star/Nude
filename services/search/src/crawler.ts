// NudeBot: a polite, incremental web crawler. Respects robots.txt, crawl-delay, noindex/nofollow
// and canonical URLs; discovers pages through links and sitemaps; avoids duplicates.
import type { Db } from './db';
import { indexPage, updateLinkScores } from './db';
import { extract, normalizeUrl, parseSitemap } from './extract';
import { isAllowed, parseRobots, type RobotsRules } from './robots';

export const USER_AGENT = 'NudeBot/0.1 (+https://github.com/thysbango-star/Nude; Nude Search crawler)';

export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  /** Only crawl these hosts (and their subdomains). Empty = follow links anywhere. */
  allowedHosts?: string[];
  concurrency?: number;
  /** Minimum delay between requests to the same host (robots.txt crawl-delay can raise it). */
  hostDelayMs?: number;
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
  /** Stop when the time budget is used (ms). */
  budgetMs?: number;
}

export interface CrawlReport { fetched: number; indexed: number; unchanged: number; duplicates: number; skipped: number; errors: number; blockedByRobots: number }

const HOUR = 3600;
const MAX_INTERVAL = 30 * 24 * HOUR;

export class Crawler {
  private robotsCache = new Map<string, { rules: RobotsRules; at: number }>();
  private hostNext = new Map<string, number>();
  private o: Required<Omit<CrawlOptions, 'fetchImpl' | 'log' | 'allowedHosts' | 'budgetMs'>> & Pick<CrawlOptions, 'fetchImpl' | 'log' | 'allowedHosts' | 'budgetMs'>;

  constructor(private db: Db, opts: CrawlOptions = {}) {
    this.o = { maxPages: 200, maxDepth: 3, concurrency: 4, hostDelayMs: 1000, timeoutMs: 15000, maxBytes: 5_000_000, ...opts };
  }

  private allowedHost(host: string): boolean {
    const list = this.o.allowedHosts;
    if (!list?.length) return true;
    return list.some((h) => host === h || host.endsWith(`.${h}`));
  }

  enqueue(url: string, depth = 0, priority = 0.5) {
    let norm: string;
    try { norm = normalizeUrl(url); } catch { return; }
    const u = new URL(norm);
    if (!/^https?:$/.test(u.protocol) || !this.allowedHost(u.hostname)) return;
    if (/\.(jpg|jpeg|png|gif|webp|svg|ico|css|js|pdf|zip|gz|mp4|mp3|avi|mov|exe|dmg|apk|woff2?|ttf)$/i.test(u.pathname)) return;
    this.db.prepare(`INSERT INTO queue (url, host, depth, priority, next_fetch) VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(url) DO UPDATE SET priority = MAX(priority, excluded.priority), depth = MIN(depth, excluded.depth)`).run(norm, u.hostname, depth, priority);
  }

  private async fetchText(url: string, accept: string): Promise<{ status: number; url: string; type: string; body: string; location?: string }> {
    const f = this.o.fetchImpl ?? fetch;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs);
    try {
      const res = await f(url, { headers: { 'user-agent': USER_AGENT, accept, 'accept-language': 'en;q=0.9,*;q=0.5' }, redirect: 'manual', signal: ctrl.signal });
      const type = res.headers.get('content-type') ?? '';
      const location = res.headers.get('location') ?? undefined;
      if (res.status >= 300 && res.status < 400) return { status: res.status, url, type, body: '', location };
      const reader = res.body?.getReader();
      let received = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > this.o.maxBytes) { await reader.cancel(); break; }
          chunks.push(value);
        }
      }
      return { status: res.status, url, type, body: Buffer.concat(chunks).toString('utf8') };
    } finally {
      clearTimeout(timer);
    }
  }

  async robotsFor(origin: string): Promise<RobotsRules> {
    const host = new URL(origin).host;
    const cached = this.robotsCache.get(host);
    if (cached && Date.now() - cached.at < 86400e3) return cached.rules;
    const row = this.db.prepare('SELECT body, fetched_at FROM robots WHERE host = ?').get(host) as { body: string | null; fetched_at: number } | undefined;
    let body: string | null;
    if (row && Date.now() - row.fetched_at < 86400e3) body = row.body;
    else {
      try {
        const r = await this.fetchText(`${origin}/robots.txt`, 'text/plain');
        // 4xx = no restrictions; 5xx/unreachable = assume full disallow (RFC 9309).
        body = r.status >= 200 && r.status < 300 ? r.body : r.status >= 400 && r.status < 500 ? '' : null;
      } catch {
        body = null;
      }
      this.db.prepare('INSERT INTO robots (host, body, fetched_at) VALUES (?, ?, ?) ON CONFLICT(host) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at').run(host, body, Date.now());
    }
    const rules = body === null ? { allow: [], disallow: ['/'], sitemaps: [] } : parseRobots(body, 'NudeBot');
    this.robotsCache.set(host, { rules, at: Date.now() });
    if (!cached && !row) for (const sm of rules.sitemaps.slice(0, 5)) await this.readSitemap(sm, 0).catch(() => {});
    return rules;
  }

  async readSitemap(url: string, level: number) {
    if (level > 2) return;
    const r = await this.fetchText(url, 'application/xml,text/xml');
    if (r.status !== 200) return;
    const sm = parseSitemap(r.body);
    for (const u of sm.urls.slice(0, 5000)) this.enqueue(u, 0, 0.7);
    for (const s of sm.sitemaps.slice(0, 20)) await this.readSitemap(s, level + 1);
  }

  private schedule(url: string, changed: boolean | null, status: number | null) {
    const row = this.db.prepare('SELECT interval_s, attempts FROM queue WHERE url = ?').get(url) as { interval_s: number; attempts: number } | undefined;
    if (!row) return;
    if (status === null || status >= 500 || status === 429) {
      const attempts = row.attempts + 1;
      if (attempts >= 5) { this.db.prepare('DELETE FROM queue WHERE url = ?').run(url); return; }
      this.db.prepare('UPDATE queue SET attempts = ?, next_fetch = ?, last_status = ? WHERE url = ?').run(attempts, Date.now() + 2 ** attempts * 600e3, status, url);
      return;
    }
    if (status >= 400) { this.db.prepare('DELETE FROM queue WHERE url = ?').run(url); this.db.prepare('DELETE FROM pages WHERE url = ?').run(url); return; }
    const interval = changed === null ? row.interval_s : changed ? Math.max(HOUR, row.interval_s / 2) : Math.min(MAX_INTERVAL, row.interval_s * 2);
    this.db.prepare('UPDATE queue SET interval_s = ?, next_fetch = ?, attempts = 0, last_status = ? WHERE url = ?').run(Math.round(interval), Date.now() + interval * 1000, status, url);
  }

  async run(): Promise<CrawlReport> {
    const report: CrawlReport = { fetched: 0, indexed: 0, unchanged: 0, duplicates: 0, skipped: 0, errors: 0, blockedByRobots: 0 };
    const start = Date.now();
    const inFlight = new Set<string>();
    const worker = async () => {
      while (report.fetched < this.o.maxPages && (!this.o.budgetMs || Date.now() - start < this.o.budgetMs)) {
        const now = Date.now();
        const candidates = this.db.prepare('SELECT url, host, depth FROM queue WHERE next_fetch <= ? ORDER BY priority DESC, depth ASC LIMIT 50').all(now) as { url: string; host: string; depth: number }[];
        const next = candidates.find((c) => !inFlight.has(c.url) && (this.hostNext.get(c.host) ?? 0) <= now && ![...inFlight].some((u) => new URL(u).host === c.host));
        if (!next) {
          if (!candidates.length && inFlight.size === 0) return;
          await new Promise((r) => setTimeout(r, 100));
          if (!candidates.length && inFlight.size === 0) return;
          continue;
        }
        inFlight.add(next.url);
        try {
          await this.crawlOne(next.url, next.host, next.depth, report);
        } finally {
          inFlight.delete(next.url);
        }
      }
    };
    await Promise.all(Array.from({ length: this.o.concurrency }, worker));
    updateLinkScores(this.db);
    return report;
  }

  private async crawlOne(url: string, host: string, depth: number, report: CrawlReport) {
    const u = new URL(url);
    const rules = await this.robotsFor(u.origin);
    const delay = Math.max(this.o.hostDelayMs, (rules.crawlDelay ?? 0) * 1000);
    this.hostNext.set(host, Date.now() + delay);
    if (!isAllowed(rules, u.pathname + u.search)) {
      report.blockedByRobots++;
      this.db.prepare('DELETE FROM queue WHERE url = ?').run(url);
      this.db.prepare('DELETE FROM pages WHERE url = ?').run(url);
      return;
    }
    let r;
    try {
      r = await this.fetchText(url, 'text/html,application/xhtml+xml');
      report.fetched++;
    } catch (err) {
      report.errors++;
      this.o.log?.(`error ${url}: ${(err as Error).message}`);
      this.schedule(url, null, null);
      return;
    }
    this.hostNext.set(host, Date.now() + delay);
    if (r.location) {
      const target = new URL(r.location, url).href;
      this.enqueue(target, depth, 0.6);
      this.db.prepare('DELETE FROM queue WHERE url = ?').run(url);
      return;
    }
    if (r.status !== 200 || !/html/i.test(r.type)) {
      if (r.status === 200) report.skipped++;
      else report.errors++;
      this.schedule(url, null, r.status === 200 ? 404 : r.status);
      return;
    }
    const e = extract(r.body, url);
    if (e.canonical && e.canonical !== url) {
      this.enqueue(e.canonical, depth, 0.8);
      if (new URL(e.canonical).host === u.host) { this.db.prepare('DELETE FROM queue WHERE url = ?').run(url); report.skipped++; return; }
    }
    const res = indexPage(this.db, url, e);
    if (res.status === 'new' || res.status === 'updated') report.indexed++;
    else if (res.status === 'unchanged') report.unchanged++;
    else if (res.status === 'duplicate') report.duplicates++;
    else report.skipped++;
    this.o.log?.(`${res.status.padEnd(9)} ${url}`);
    this.schedule(url, res.status === 'unchanged' ? false : true, 200);
    if (!e.nofollow && depth < this.o.maxDepth) {
      for (const link of e.links) this.enqueue(link, depth + 1, new URL(link).host === host ? 0.5 : 0.3);
    }
  }
}
