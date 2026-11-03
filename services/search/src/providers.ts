// Approved fallback providers, used (and labelled) only when Nude's own index has too few results.
import type { SearchType } from './rank';

export interface FallbackResult { url: string; title: string; description: string; snippet: string; host: string; favicon: string; published?: string; image?: string; kind: string; score: number; source: string }
export interface Provider { name: string; search(q: string, opts: { page: number; perPage: number; type: SearchType; safe: string }): Promise<FallbackResult[]> }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const strip = (s: string) => s.replace(/<[^>]*>/g, '');
const host = (u: string) => { try { return new URL(u).hostname; } catch { return ''; } };

/** Brave Search API (https://brave.com/search/api/). Needs BRAVE_SEARCH_API_KEY. */
export function braveProvider(apiKey: string, fetchImpl: typeof fetch = fetch): Provider {
  return {
    name: 'Brave Search',
    async search(q, o) {
      const endpoint = o.type === 'news' ? 'news' : o.type === 'images' ? 'images' : o.type === 'videos' ? 'videos' : 'web';
      const params = new URLSearchParams({ q, count: String(Math.min(20, o.perPage)), offset: String(o.page - 1), safesearch: o.safe === 'off' ? 'off' : o.safe === 'strict' ? 'strict' : 'moderate' });
      const res = await fetchImpl(`https://api.search.brave.com/res/v1/${endpoint}/search?${params}`, { headers: { accept: 'application/json', 'x-subscription-token': apiKey } });
      if (!res.ok) throw new Error(`Brave Search HTTP ${res.status}`);
      const j = (await res.json()) as { web?: { results?: unknown[] }; results?: unknown[] };
      const list = (j.web?.results ?? j.results ?? []) as { url: string; title: string; description?: string; page_age?: string; thumbnail?: { src?: string }; properties?: { url?: string } }[];
      return list.map((r) => ({
        url: r.url, title: strip(r.title ?? r.url), description: strip(r.description ?? ''), snippet: esc(strip(r.description ?? '')),
        host: host(r.url), favicon: `https://${host(r.url)}/favicon.ico`, published: r.page_age, image: r.thumbnail?.src ?? r.properties?.url,
        kind: o.type === 'images' ? 'image' : 'page', score: 0, source: 'Brave Search',
      }));
    },
  };
}

/** A self-hosted SearXNG instance (JSON format must be enabled). Needs SEARXNG_URL. */
export function searxngProvider(base: string, fetchImpl: typeof fetch = fetch): Provider {
  return {
    name: 'SearXNG',
    async search(q, o) {
      const cat = o.type === 'images' ? 'images' : o.type === 'news' ? 'news' : o.type === 'videos' ? 'videos' : 'general';
      const params = new URLSearchParams({ q, format: 'json', pageno: String(o.page), categories: cat, safesearch: o.safe === 'off' ? '0' : o.safe === 'strict' ? '2' : '1' });
      const res = await fetchImpl(`${base.replace(/\/+$/, '')}/search?${params}`, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`);
      const j = (await res.json()) as { results?: { url: string; title: string; content?: string; publishedDate?: string; img_src?: string }[] };
      return (j.results ?? []).slice(0, o.perPage).map((r) => ({
        url: r.url, title: r.title, description: r.content ?? '', snippet: esc(r.content ?? ''), host: host(r.url), favicon: `https://${host(r.url)}/favicon.ico`,
        published: r.publishedDate, image: r.img_src, kind: o.type === 'images' ? 'image' : 'page', score: 0, source: 'SearXNG',
      }));
    },
  };
}

export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): Provider | null {
  if (env.NUDE_FALLBACK === 'off') return null;
  if (env.BRAVE_SEARCH_API_KEY) return braveProvider(env.BRAVE_SEARCH_API_KEY);
  if (env.SEARXNG_URL) return searxngProvider(env.SEARXNG_URL);
  return null;
}
