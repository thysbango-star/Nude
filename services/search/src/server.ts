// Nude Search HTTP server: JSON API + the Nude Search web interface.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, stats, type Db } from './db';
import { search, suggest, recordQuery, trending, type SearchType } from './rank';
import { providerFromEnv, type Provider } from './providers';
import { Crawler } from './crawler';
import { renderHome, renderResults } from './ui';

export interface Ad { keywords: string[]; title: string; url: string; description: string; advertiser: string }

export interface ServerOptions {
  db: Db;
  provider?: Provider | null;
  /** Use the fallback provider when Nude's index returns fewer results than this. */
  fallbackMin?: number;
  adminToken?: string;
  ads?: Ad[];
  aiGatewayUrl?: string;
  aiToken?: string;
}

const TYPES: SearchType[] = ['web', 'news', 'images', 'videos', 'shopping'];

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const isString = typeof body === 'string';
  res.writeHead(status, {
    'content-type': isString ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
    ...(isString ? { 'content-security-policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; form-action 'self'" } : { 'access-control-allow-origin': '*' }),
    ...headers,
  });
  res.end(isString ? body : JSON.stringify(body));
}

export async function runSearch(o: ServerOptions, params: URLSearchParams) {
  const q = (params.get('q') ?? '').slice(0, 300).trim();
  const type = (TYPES.includes(params.get('type') as SearchType) ? params.get('type') : 'web') as SearchType;
  const page = Math.max(1, Math.min(50, Number(params.get('page')) || 1));
  const perPage = Math.max(1, Math.min(50, Number(params.get('per_page')) || 10));
  const safe = (['strict', 'moderate', 'off'].includes(params.get('safe') ?? '') ? params.get('safe') : 'moderate') as 'strict' | 'moderate' | 'off';
  const freshness = (['day', 'week', 'month', 'year'].includes(params.get('time') ?? '') ? params.get('time') : 'any') as 'day' | 'week' | 'month' | 'year' | 'any';
  const lang = params.get('lang')?.slice(0, 5) || undefined;
  const preferHosts = (params.get('prefer') ?? '').split(',').map((h) => h.trim()).filter(Boolean).slice(0, 20);
  if (!q) return { query: q, type, page, perPage, total: 0, results: [], ads: [], fallback: null, index: stats(o.db) };
  const started = performance.now();
  const own = search(o.db, { q, page, perPage, type, safe, freshness, lang, preferHosts });
  if (page === 1) recordQuery(o.db, q);
  let results: Record<string, unknown>[] = own.results;
  let fallback: { provider: string; used: boolean; error?: string } | null = null;
  const min = o.fallbackMin ?? 5;
  if (o.provider && own.total < min) {
    try {
      const extra = await o.provider.search(q, { page, perPage, type, safe });
      const seen = new Set(own.results.map((r) => r.url));
      results = [...own.results, ...extra.filter((r) => !seen.has(r.url)).slice(0, perPage - own.results.length)];
      fallback = { provider: o.provider.name, used: true };
    } catch (err) {
      fallback = { provider: o.provider.name, used: false, error: (err as Error).message };
    }
  }
  // Ads are matched separately and always labelled; they never change organic ranking.
  const words = new Set(q.toLowerCase().split(/\s+/));
  const ads = (o.ads ?? []).filter((a) => a.keywords.some((k) => words.has(k.toLowerCase()))).slice(0, 2).map((a) => ({ ...a, label: 'Ad' }));
  return {
    query: q, type, page, perPage, total: Math.max(own.total, results.length), results, ads, fallback,
    index: stats(o.db), took_ms: Math.round(performance.now() - started),
  };
}

/** AI answer over the top results, streamed from the Nude AI gateway (which holds the model keys). */
async function answer(o: ServerOptions, params: URLSearchParams, res: ServerResponse) {
  const gateway = o.aiGatewayUrl;
  if (!gateway) return send(res, 503, { error: 'AI answers need a Nude AI gateway (set NUDE_AI_GATEWAY_URL).' });
  const data = await runSearch(o, new URLSearchParams({ q: params.get('q') ?? '', per_page: '6' }));
  if (!data.query) return send(res, 400, { error: 'Missing q' });
  const top = (data.results as { url: string; title: string; snippet?: string; description?: string }[]).slice(0, 6);
  const sources = top.map((r, i) => ({ id: `S${i + 1}`, kind: 'search', title: r.title, url: r.url, content: `${r.description ?? ''}\n${(r.snippet ?? '').replace(/<\/?mark>/g, '')}` }));
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.write(`data: ${JSON.stringify({ sources: sources.map(({ content: _c, ...s }) => s) })}\n\n`);
  if (!sources.length) {
    res.write(`data: ${JSON.stringify({ delta: "Nude couldn't find sources for this question yet, so there's no AI answer." })}\n\n`);
    return res.end();
  }
  try {
    const upstream = await fetch(`${gateway.replace(/\/+$/, '')}/v1/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...(o.aiToken ? { authorization: `Bearer ${o.aiToken}` } : {}) },
      body: JSON.stringify({ stream: true, sources, messages: [{ role: 'user', content: `Answer this search using only the search results provided, citing them like [S1]. If the results don't answer it, say so. Search: ${data.query}` }] }),
    });
    if (!upstream.ok || !upstream.body) throw new Error(`gateway HTTP ${upstream.status}`);
    for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
  }
  res.end();
}

async function readBody(req: IncomingMessage, limit = 100_000): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error('Body too large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createSearchServer(o: ServerOptions) {
  const publicDir = join(__dirname, '..', 'public');
  let crawling = false;
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const p = url.pathname;
      if (req.method === 'OPTIONS') return send(res, 204, '', { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization' });
      if (p === '/health') return send(res, 200, { ok: true, service: 'nude-search', index: stats(o.db) });
      if (p === '/api/search') return send(res, 200, await runSearch(o, url.searchParams));
      if (p === '/api/suggest') {
        const q = (url.searchParams.get('q') ?? '').slice(0, 100);
        return send(res, 200, [q, suggest(o.db, q)]); // OpenSearch suggestions format
      }
      if (p === '/api/answer') return answer(o, url.searchParams, res);
      if (p === '/api/trending') return send(res, 200, { trending: trending(o.db) });
      if (p === '/api/stats') return send(res, 200, stats(o.db));
      if (p === '/api/crawl' && req.method === 'POST') {
        if (!o.adminToken || req.headers.authorization !== `Bearer ${o.adminToken}`) return send(res, 401, { error: 'Admin token required' });
        if (crawling) return send(res, 409, { error: 'A crawl is already running' });
        const body = JSON.parse(await readBody(req)) as { seeds?: string[]; maxPages?: number; maxDepth?: number; sameHost?: boolean };
        const seeds = (body.seeds ?? []).filter((s) => /^https?:\/\//.test(s)).slice(0, 100);
        if (!seeds.length) return send(res, 400, { error: 'Provide seeds: ["https://…"]' });
        const crawler = new Crawler(o.db, {
          maxPages: Math.min(10_000, body.maxPages ?? 200), maxDepth: Math.min(10, body.maxDepth ?? 3),
          allowedHosts: body.sameHost ? seeds.map((s) => new URL(s).hostname) : undefined,
        });
        seeds.forEach((s) => crawler.enqueue(s, 0, 1));
        crawling = true;
        void crawler.run().finally(() => { crawling = false; });
        return send(res, 202, { started: true, seeds });
      }
      if (p === '/opensearch.xml') {
        const origin = `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`;
        res.writeHead(200, { 'content-type': 'application/opensearchdescription+xml' });
        return res.end(`<?xml version="1.0"?><OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/"><ShortName>Nude Search</ShortName><Description>Search with Nude</Description><InputEncoding>UTF-8</InputEncoding><Url type="text/html" template="${origin}/search?q={searchTerms}"/><Url type="application/x-suggestions+json" template="${origin}/api/suggest?q={searchTerms}"/></OpenSearchDescription>`);
      }
      if (p === '/' ) return send(res, 200, renderHome(trending(o.db), stats(o.db)));
      if (p === '/search') {
        const data = await runSearch(o, url.searchParams);
        return send(res, 200, renderResults(data as Parameters<typeof renderResults>[0]));
      }
      const file = p.replace(/^\/+/, '');
      if (/^[a-z0-9_-]+\.(css|js|svg)$/i.test(file) && existsSync(join(publicDir, file))) {
        const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'image/svg+xml';
        res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' });
        return res.end(readFileSync(join(publicDir, file)));
      }
      send(res, 404, { error: 'Not found' });
    } catch (err) {
      console.error(err);
      send(res, 500, { error: 'Internal error' });
    }
  });
}

if (require.main === module) {
  const dbFile = process.env.NUDE_SEARCH_DB ?? join(process.cwd(), 'data', 'nude-search.db');
  const db = openDb(dbFile);
  const ads = process.env.NUDE_ADS_FILE && existsSync(process.env.NUDE_ADS_FILE) ? JSON.parse(readFileSync(process.env.NUDE_ADS_FILE, 'utf8')) as Ad[] : [];
  const provider = providerFromEnv();
  const server = createSearchServer({ db, provider, fallbackMin: Number(process.env.NUDE_FALLBACK_MIN ?? 5), adminToken: process.env.NUDE_ADMIN_TOKEN, ads,
    aiGatewayUrl: process.env.NUDE_AI_GATEWAY_URL, aiToken: process.env.NUDE_SERVICE_TOKEN });
  const port = Number(process.env.PORT ?? 8787);
  server.listen(port, listenHost(), () => {
    console.log(`Nude Search on http://${listenHost()}:${port}  (index: ${dbFile}, fallback: ${provider?.name ?? 'none'})`);
  });
  // Scheduled incremental re-crawl of due pages.
  const every = Number(process.env.NUDE_RECRAWL_MINUTES ?? 0);
  if (every > 0) setInterval(() => void new Crawler(db, { maxPages: 200, budgetMs: every * 50_000 }).run(), every * 60_000);
}

/** Local runs stay on this computer; on a host such as Render (which sets RENDER) the service must listen on all interfaces. */
function listenHost(): string {
  return process.env.HOST ?? (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
}
