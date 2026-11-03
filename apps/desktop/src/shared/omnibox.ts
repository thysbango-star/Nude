// Omnibox input resolution: decides whether typed text is a URL or a search.
// Pure and platform-independent; the same behaviour is specified in packages/spec/omnibox.json.
import type { SearchEngineId } from './types';

export interface SearchEngine {
  id: SearchEngineId;
  name: string;
  searchUrl: string; // {q} is replaced with the encoded query
  suggestUrl?: string; // OpenSearch-style JSON: [query, [suggestions...]]
}

export const SEARCH_ENGINES: Record<SearchEngineId, SearchEngine> = {
  nude: { id: 'nude', name: 'Nude Search', searchUrl: 'http://127.0.0.1:8787/search?q={q}', suggestUrl: 'http://127.0.0.1:8787/api/suggest?q={q}' },
  duckduckgo: { id: 'duckduckgo', name: 'DuckDuckGo', searchUrl: 'https://duckduckgo.com/?q={q}', suggestUrl: 'https://duckduckgo.com/ac/?q={q}&type=list' },
  google: { id: 'google', name: 'Google', searchUrl: 'https://www.google.com/search?q={q}', suggestUrl: 'https://suggestqueries.google.com/complete/search?client=firefox&q={q}' },
  bing: { id: 'bing', name: 'Bing', searchUrl: 'https://www.bing.com/search?q={q}', suggestUrl: 'https://api.bing.com/osjson.aspx?query={q}' },
  brave: { id: 'brave', name: 'Brave Search', searchUrl: 'https://search.brave.com/search?q={q}', suggestUrl: 'https://search.brave.com/api/suggest?q={q}' },
  ecosia: { id: 'ecosia', name: 'Ecosia', searchUrl: 'https://www.ecosia.org/search?q={q}', suggestUrl: 'https://ac.ecosia.org/autocomplete?q={q}&type=list' },
  startpage: { id: 'startpage', name: 'Startpage', searchUrl: 'https://www.startpage.com/do/search?q={q}' },
};

/** Points the Nude Search engine at the configured search server. */
export function configureNudeSearch(baseUrl: string) {
  const base = (baseUrl || 'http://127.0.0.1:8787').replace(/\/+$/, '');
  SEARCH_ENGINES.nude.searchUrl = `${base}/search?q={q}`;
  SEARCH_ENGINES.nude.suggestUrl = `${base}/api/suggest?q={q}`;
}

export function searchUrl(engine: SearchEngineId, query: string): string {
  const e = SEARCH_ENGINES[engine] ?? SEARCH_ENGINES.duckduckgo;
  return e.searchUrl.replace('{q}', encodeURIComponent(query.trim()));
}

export const INTERNAL_PAGES = ['newtab', 'history', 'bookmarks', 'downloads', 'settings', 'security', 'blocked', 'reader', 'passwords', 'welcome', 'account'] as const;
export type InternalPage = (typeof INTERNAL_PAGES)[number];
export const NEW_TAB_URL = 'nude://newtab/';

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'file:', 'nude:', 'about:', 'view-source:']);
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'blob:', 'filesystem:']);

const CC_TLDS =
  'ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg er es et eu fi fj fk fm fo fr ga gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sk sl sm sn so sr ss st su sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw';
const G_TLDS =
  'com net org edu gov mil int info biz name pro mobi aero coop museum jobs travel app dev page xyz online site tech store shop blog cloud link live news art design media agency studio digital email software solutions systems network services club life world today space website fun top icu vip love one wiki africa joburg capetown durban local localhost test internal lan home onion';
const KNOWN_TLDS = new Set(`${CC_TLDS} ${G_TLDS}`.split(' '));

export type ResolvedInput =
  | { type: 'navigate'; url: string }
  | { type: 'search'; url: string; query: string }
  | { type: 'blocked'; reason: string };

function isIPv4(host: string): boolean {
  const parts = host.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** Returns true when `text` (no scheme) looks like a hostname with optional port/path. */
export function looksLikeHost(text: string): boolean {
  if (/\s/.test(text)) return false;
  const m = /^(\[[0-9a-f:]+\]|[^/:?#]+)(:\d{1,5})?([/?#].*)?$/i.exec(text);
  if (!m) return false;
  const host = m[1].toLowerCase();
  const hasPortOrPath = Boolean(m[2] || m[3]);
  if (host.startsWith('[')) return true; // IPv6 literal
  if (host === 'localhost' || isIPv4(host)) return true;
  if (!/^[a-z0-9.-]+$/.test(host) && !/^[^\s./]+(\.[^\s./]+)+$/u.test(host)) return false;
  const labels = host.split('.');
  if (labels.length < 2) return false;
  if (labels.some((l) => l.length === 0 || l.length > 63 || l.startsWith('-') || l.endsWith('-'))) return false;
  const tld = labels[labels.length - 1];
  if (KNOWN_TLDS.has(tld) || tld.startsWith('xn--')) return true;
  // Unknown TLD: only treat as host if the user clearly typed a path or port ("myhost.corp/path").
  return hasPortOrPath && /^[a-z]{2,63}$/.test(tld);
}

function isLocalHost(text: string): boolean {
  const host = text.replace(/^\[|\].*$/g, '').split(/[:/?#]/)[0].toLowerCase();
  return host === 'localhost' || isIPv4(host) || text.startsWith('[') ||
    host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.test') || host.endsWith('.lan');
}

/**
 * Resolves omnibox text to a navigation or a search.
 * Typed hostnames default to HTTPS (HTTPS-first), except local/LAN hosts which use HTTP.
 */
export function resolveInput(raw: string, engine: SearchEngineId): ResolvedInput | null {
  const text = raw.trim();
  if (!text) return null;

  // "?query" forces a search.
  if (text.startsWith('?')) {
    const q = text.slice(1).trim();
    return q ? { type: 'search', url: searchUrl(engine, q), query: q } : null;
  }

  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(text);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase() + ':';
    if (BLOCKED_SCHEMES.has(scheme)) {
      return { type: 'blocked', reason: `${scheme} addresses can't be opened from the address bar.` };
    }
    if (ALLOWED_SCHEMES.has(scheme) && !/\s/.test(text)) {
      // "localhost:3000" parses as scheme "localhost:" — handled below because it is not allowed.
      try {
        const u = new URL(text);
        if (u.protocol === 'nude:') {
          const page = (u.hostname || u.pathname.replace(/^\/+/, '')).toLowerCase();
          if (!(INTERNAL_PAGES as readonly string[]).includes(page)) {
            return { type: 'blocked', reason: `nude://${page} isn't a Nude page.` };
          }
          return { type: 'navigate', url: `nude://${page}/${u.search}${u.hash}` };
        }
        if ((u.protocol === 'http:' || u.protocol === 'https:') && !u.hostname) return searchOf(text, engine);
        return { type: 'navigate', url: u.href };
      } catch {
        return searchOf(text, engine);
      }
    }
  }

  if (looksLikeHost(text)) {
    const scheme = isLocalHost(text) ? 'http://' : 'https://';
    try {
      return { type: 'navigate', url: new URL(scheme + text).href };
    } catch {
      return searchOf(text, engine);
    }
  }
  return searchOf(text, engine);
}

function searchOf(query: string, engine: SearchEngineId): ResolvedInput {
  return { type: 'search', url: searchUrl(engine, query), query };
}

/** Text shown in the omnibox when it isn't focused. */
export function displayUrl(url: string): string {
  if (!url || url.startsWith('nude://newtab') || url === 'about:blank') return '';
  if (url.startsWith('nude://')) return url.replace(/\/(?=$|[?#])/, '');
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') {
      const rest = (u.pathname === '/' ? '' : u.pathname) + u.search + u.hash;
      return decodeSafe(u.host.replace(/^www\./, '') + rest);
    }
    return decodeSafe(url);
  } catch {
    return url;
  }
}

function decodeSafe(s: string): string {
  try {
    // Decode for readability, but keep spaces/controls encoded to avoid spoofing.
    return decodeURI(s).replace(/[\s​-‏‪-‮⁦-⁩]/g, (c) => encodeURIComponent(c));
  } catch {
    return s;
  }
}

/** Reverse of searchUrl: returns the query if `url` is a results page of `engine`. */
export function extractSearchQuery(url: string, engine: SearchEngineId): string | null {
  try {
    const tpl = new URL(SEARCH_ENGINES[engine].searchUrl.replace('{q}', 'QUERY'));
    const u = new URL(url);
    if (u.host !== tpl.host || u.pathname !== tpl.pathname) return null;
    for (const [k, v] of tpl.searchParams) if (v === 'QUERY') return u.searchParams.get(k);
    return null;
  } catch {
    return null;
  }
}

export function securityStateOf(url: string): 'secure' | 'insecure' | 'internal' | 'file' | 'none' {
  if (!url || url === 'about:blank') return 'none';
  if (url.startsWith('nude:')) return 'internal';
  if (url.startsWith('https:')) return 'secure';
  if (url.startsWith('http:')) return 'insecure';
  if (url.startsWith('file:')) return 'file';
  return 'none';
}

export function originOf(url: string): string {
  try {
    const u = new URL(url);
    return u.origin === 'null' ? `${u.protocol}//${u.host}` : u.origin;
  } catch {
    return url;
  }
}
