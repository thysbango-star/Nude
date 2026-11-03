// Dependency-free HTML extraction: title, description, headings, text, links, images, metadata.
export interface Extracted {
  title: string;
  description: string;
  headings: string;
  content: string;
  canonical?: string;
  lang: string;
  published?: string;
  links: string[];
  images: { src: string; alt: string }[];
  noindex: boolean;
  nofollow: boolean;
  kind: 'page' | 'article' | 'video' | 'product';
  price?: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const clean = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : undefined;
}

function meta(html: string, key: string): string | undefined {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const t = m[0];
    const n = (attr(t, 'name') ?? attr(t, 'property') ?? attr(t, 'itemprop') ?? '').toLowerCase();
    if (n === key) return attr(t, 'content');
  }
  return undefined;
}

const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'and', 'of', 'to', 'is', 'in', 'that', 'for', 'with', 'you'],
  af: ['die', 'en', 'van', 'is', 'het', 'nie', 'vir', 'met', 'wat', 'ons'],
  zu: ['ukuthi', 'futhi', 'kanye', 'noma', 'kodwa', 'ngoba', 'lapho', 'abantu'],
  fr: ['le', 'la', 'les', 'et', 'des', 'est', 'une', 'pour', 'dans', 'que'],
  de: ['der', 'die', 'und', 'das', 'ist', 'nicht', 'mit', 'ein', 'auf', 'für'],
  es: ['el', 'la', 'los', 'y', 'que', 'en', 'es', 'por', 'una', 'para'],
  pt: ['o', 'a', 'os', 'e', 'que', 'em', 'um', 'uma', 'para', 'não'],
};

export function detectLanguage(text: string, declared?: string): string {
  if (declared) return declared.toLowerCase().split(/[-_]/)[0];
  const words = text.toLowerCase().split(/\W+/).slice(0, 2000);
  let best = 'en';
  let bestScore = 0;
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    const set = new Set(list);
    const score = words.reduce((s, w) => s + (set.has(w) ? 1 : 0), 0);
    if (score > bestScore) { best = lang; bestScore = score; }
  }
  return best;
}

export function resolveUrl(href: string, base: string): string | null {
  try {
    const u = new URL(href.trim(), base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return normalizeUrl(u.href);
  } catch {
    return null;
  }
}

const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|ref|ref_src|igshid)$/i;
export function normalizeUrl(url: string): string {
  const u = new URL(url);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  return u.href;
}

export function extract(html: string, url: string): Extracted {
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : html.slice(0, 20000);
  const robots = (meta(head, 'robots') ?? '') + ',' + (meta(head, 'nudebot') ?? '');
  const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '') || meta(head, 'og:title') || '';
  const canonicalTag = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => (attr(t, 'rel') ?? '').toLowerCase() === 'canonical');
  const canonical = canonicalTag ? resolveUrl(attr(canonicalTag, 'href') ?? '', url) ?? undefined : undefined;
  const ogType = (meta(head, 'og:type') ?? '').toLowerCase();

  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe)\b[\s\S]*?<\/\1>/gi, ' ');
  const links: string[] = [];
  for (const m of body.matchAll(/<a\b[^>]*>/gi)) {
    const rel = (attr(m[0], 'rel') ?? '').toLowerCase();
    if (rel.includes('nofollow') || rel.includes('sponsored') || rel.includes('ugc')) continue;
    const href = attr(m[0], 'href');
    const abs = href && resolveUrl(href, url);
    if (abs) links.push(abs);
  }
  const images: { src: string; alt: string }[] = [];
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    const src = attr(m[0], 'src') ?? attr(m[0], 'data-src');
    const abs = src && resolveUrl(src, url);
    const alt = attr(m[0], 'alt') ?? '';
    if (abs && alt.length > 2) images.push({ src: abs, alt: alt.slice(0, 200) });
    if (images.length >= 30) break;
  }
  const headings = [...body.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => clean(m[2])).filter(Boolean).slice(0, 40).join(' · ');
  const mainMatch = /<(article|main)\b[\s\S]*?<\/\1>/i.exec(body);
  const textSource = (mainMatch?.[0] ?? body).replace(/<(nav|footer|header|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
  const content = clean(textSource).slice(0, 100_000);
  const description = meta(head, 'description') ?? meta(head, 'og:description') ?? content.slice(0, 280);
  const declaredLang = attr(/<html\b[^>]*>/i.exec(html)?.[0] ?? '', 'lang');
  const published = meta(head, 'article:published_time') ?? meta(head, 'datepublished') ?? meta(head, 'date') ??
    attr(/<time\b[^>]*datetime[^>]*>/i.exec(body)?.[0] ?? '', 'datetime');
  const price = meta(head, 'product:price:amount') ?? meta(head, 'og:price:amount') ?? /"price"\s*:\s*"?([\d.,]+)/.exec(html)?.[1];
  const kind = ogType.startsWith('video') || meta(head, 'og:video') ? 'video'
    : ogType === 'product' || price ? 'product'
      : ogType === 'article' || published ? 'article' : 'page';
  return {
    title: title.slice(0, 300), description: clean(description).slice(0, 500), headings: headings.slice(0, 2000), content,
    canonical, lang: detectLanguage(content, declaredLang), published, links: [...new Set(links)].slice(0, 500), images,
    noindex: /noindex|none/i.test(robots), nofollow: /nofollow|none/i.test(robots), kind, price,
  };
}

/** Very small sitemap reader: <loc> entries from urlset or sitemapindex. */
export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[]; } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]));
  return /<sitemapindex/i.test(xml) ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] };
}
