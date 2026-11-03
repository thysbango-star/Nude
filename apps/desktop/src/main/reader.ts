// Reader mode: extracts the article text in an isolated world (the page can't interfere),
// and serves it as plain data to nude://reader, which renders it with its own typography.
import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';

export interface ReaderArticle {
  url: string;
  title: string;
  byline: string;
  site: string;
  published: string;
  blocks: { type: 'h' | 'p' | 'quote' | 'li' | 'img'; text: string; src?: string }[];
  minutes: number;
}

const EXTRACT = `(() => {
  const meta = (n) => document.querySelector('meta[property="' + n + '"],meta[name="' + n + '"]')?.content || '';
  const candidates = [...document.querySelectorAll('article, main, [role=main], .post, .article, .entry-content, #content, body')];
  let best = document.body, bestScore = 0;
  for (const c of candidates) {
    const ps = [...c.querySelectorAll('p')].filter(p => (p.innerText || '').trim().length > 60);
    const score = ps.reduce((s, p) => s + Math.min(600, p.innerText.length), 0) - (c === document.body ? 2000 : 0);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  const skip = 'nav, aside, footer, header nav, form, script, style, noscript, iframe, button, [aria-hidden=true], .ad, .ads, .advert, .share, .social, .comments, .related, .newsletter';
  const blocks = [];
  const walk = (el) => {
    for (const n of el.children) {
      if (n.matches(skip)) continue;
      const tag = n.tagName;
      const text = (n.innerText || '').replace(/\\s+/g, ' ').trim();
      if (/^H[1-4]$/.test(tag)) { if (text) blocks.push({ type: 'h', text }); }
      else if (tag === 'P') { if (text.length > 1) blocks.push({ type: 'p', text }); }
      else if (tag === 'BLOCKQUOTE') { if (text) blocks.push({ type: 'quote', text }); }
      else if (tag === 'LI') { if (text) blocks.push({ type: 'li', text }); }
      else if (tag === 'IMG' || tag === 'FIGURE') {
        const img = tag === 'IMG' ? n : n.querySelector('img');
        if (img && img.naturalWidth > 200 && /^https?:/.test(img.currentSrc || img.src)) blocks.push({ type: 'img', text: img.alt || '', src: img.currentSrc || img.src });
        if (tag === 'FIGURE') { const cap = n.querySelector('figcaption'); if (cap) blocks.push({ type: 'p', text: cap.innerText.trim() }); }
      }
      else walk(n);
      if (blocks.length > 800) return;
    }
  };
  walk(best);
  const words = blocks.reduce((s, b) => s + b.text.split(' ').length, 0);
  return {
    title: meta('og:title') || document.title,
    byline: meta('author') || document.querySelector('[rel=author], .author, .byline')?.innerText?.trim() || '',
    site: meta('og:site_name') || location.hostname.replace(/^www\\./, ''),
    published: meta('article:published_time') || document.querySelector('time[datetime]')?.getAttribute('datetime') || '',
    blocks, words,
  };
})()`;


const PRODUCTS = `(() => {
  const out = [];
  const seen = new Set();
  const push = (p) => {
    const name = String(p.name || '').replace(/\\s+/g, ' ').trim().slice(0, 160);
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    out.push({ name, price: p.price ? String(p.price).slice(0, 40) : undefined, currency: p.currency, image: p.image, url: p.url, rating: p.rating ? String(p.rating).slice(0, 10) : undefined });
  };
  const abs = (u) => { try { return u ? new URL(u, location.href).href : undefined; } catch { return undefined; } };
  const img = (v) => abs(Array.isArray(v) ? v[0] : (v && typeof v === 'object' ? v.url : v));
  // 1. Structured data (schema.org Product / ItemList)
  const visit = (node) => {
    if (!node || typeof node !== 'object' || out.length > 40) return;
    if (Array.isArray(node)) return node.forEach(visit);
    const type = [].concat(node['@type'] || []).join(' ');
    if (/Product/.test(type)) {
      const offer = [].concat(node.offers || [])[0] || {};
      push({ name: node.name, price: offer.price || offer.lowPrice, currency: offer.priceCurrency, image: img(node.image), url: abs(node.url || offer.url), rating: node.aggregateRating && node.aggregateRating.ratingValue });
    }
    if (node.item) visit(node.item);
    if (node.itemListElement) visit(node.itemListElement);
    if (node['@graph']) visit(node['@graph']);
  };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { try { visit(JSON.parse(s.textContent)); } catch {} }
  // 2. Open Graph product page
  const meta = (n) => document.querySelector('meta[property="' + n + '"]')?.content;
  if (meta('product:price:amount')) push({ name: meta('og:title') || document.title, price: meta('product:price:amount'), currency: meta('product:price:currency'), image: abs(meta('og:image')), url: location.href });
  // 3. Visible product cards: an image plus a price nearby.
  const priceRe = /(R|\\$|€|£|USD|ZAR|EUR|GBP)\\s?\\d[\\d,. ]*/;
  if (out.length < 3) {
    for (const el of document.querySelectorAll('li, article, [class*="product" i], [class*="card" i], [data-testid*="product" i]')) {
      if (out.length >= 30) break;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 80 || r.height > 900 || r.width > 700) continue;
      const text = (el.innerText || '').trim();
      const m = priceRe.exec(text);
      const im = el.querySelector('img');
      if (!m || !im) continue;
      const title = el.querySelector('h1,h2,h3,h4,[class*="title" i],[class*="name" i]')?.innerText || im.alt || text.split('\\n')[0];
      push({ name: title, price: m[0].trim(), image: abs(im.currentSrc || im.src), url: abs(el.querySelector('a[href]')?.getAttribute('href')) });
    }
  }
  return out.slice(0, 30);
})()`;

const NEON = 'conic-gradient(from var(--nb-a, 0deg), #ffd400, #ff2bd6, #7a3cff, #1f7bff, #22e3ff, #ffd400)';

function highlightScript(texts: string[]) {
  return `((texts) => {
  const STYLE_ID = 'nebula-hl-style';
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = "@property --nb-a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }" +
      ".nebula-hl{position:absolute;pointer-events:none;z-index:2147483646;border-radius:14px;padding:3px;background:${NEON};" +
      "-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;" +
      "animation:nb-spin 2.4s linear infinite, nb-in .5s cubic-bezier(.2,.8,.2,1);box-shadow:0 0 28px rgba(255,43,214,.35)}" +
      ".nebula-hl-tag{position:absolute;pointer-events:none;z-index:2147483647;font:600 12px system-ui,sans-serif;color:#fff;padding:4px 10px;border-radius:999px;" +
      "background:linear-gradient(90deg,#ff2bd6,#7a3cff,#1f7bff);box-shadow:0 4px 14px rgba(122,60,255,.35);animation:nb-in .5s cubic-bezier(.2,.8,.2,1)}" +
      "@keyframes nb-spin{to{--nb-a:360deg}}@keyframes nb-in{from{opacity:0;transform:scale(.96)}}";
    document.documentElement.appendChild(st);
  }
  document.querySelectorAll('.nebula-hl,.nebula-hl-tag').forEach((n) => n.remove());
  let found = 0;
  let first = null;
  for (const t of texts) {
    const needle = t.toLowerCase();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.toLowerCase().includes(needle)) continue;
      let el = node.parentElement;
      if (!el || el.closest('.nebula-hl')) continue;
      // Prefer the surrounding product/card element when there is one.
      let card = el;
      for (let i = 0; i < 6 && card.parentElement; i++) {
        const r = card.getBoundingClientRect();
        if (card.querySelector('img') && r.height > 60 && r.height < 700) break;
        card = card.parentElement;
      }
      const r = (card.getBoundingClientRect().height < 700 ? card : el).getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const box = document.createElement('div');
      box.className = 'nebula-hl';
      Object.assign(box.style, { left: (r.left + scrollX - 6) + 'px', top: (r.top + scrollY - 6) + 'px', width: (r.width + 12) + 'px', height: (r.height + 12) + 'px' });
      const tag = document.createElement('div');
      tag.className = 'nebula-hl-tag';
      tag.textContent = '✦ Nebula';
      Object.assign(tag.style, { left: (r.left + scrollX) + 'px', top: Math.max(0, r.top + scrollY - 30) + 'px' });
      document.body.append(box, tag);
      first = first || box;
      found++;
      break;
    }
  }
  if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => document.querySelectorAll('.nebula-hl,.nebula-hl-tag').forEach((n) => { n.style.transition = 'opacity .6s'; n.style.opacity = '0'; setTimeout(() => n.remove(), 700); }), 9000);
  return { found };
})(${JSON.stringify(texts)})`;
}

const GLOW = `(() => {
  const d = document.createElement('div');
  d.setAttribute('aria-hidden', 'true');
  Object.assign(d.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483645', mixBlendMode: 'screen', opacity: '0',
    background: 'linear-gradient(100deg, rgba(255,212,0,0) 0%, rgba(255,212,0,.55) 18%, rgba(255,43,214,.55) 36%, rgba(122,60,255,.5) 52%, rgba(31,123,255,.5) 68%, rgba(34,227,255,.45) 82%, rgba(34,227,255,0) 100%)',
    backgroundSize: '220% 100%', backgroundPosition: '120% 0', filter: 'blur(24px) saturate(1.3)', transition: 'opacity .35s ease' });
  document.documentElement.appendChild(d);
  requestAnimationFrame(() => { d.style.opacity = '.55'; d.animate([{ backgroundPosition: '120% 0' }, { backgroundPosition: '-20% 0' }], { duration: 1600, easing: 'cubic-bezier(.4,0,.2,1)' }); });
  setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 400); }, 1500);
})()`;

function adCardScript(frameUrl: string, html: string) {
  return `((url, html) => {
  const swap = () => {
    let n = 0;
    for (const f of document.querySelectorAll('iframe')) {
      if (f.dataset.rovian) continue;
      let src = '';
      try { src = new URL(f.getAttribute('src') || '', location.href).href; } catch {}
      if (src !== url && f.src !== url) continue;
      const r = f.getBoundingClientRect();
      const host = document.createElement('div');
      host.dataset.rovian = '1';
      host.style.cssText = 'display:block;width:' + (r.width || f.width || 300) + 'px;max-width:100%;height:' + Math.max(90, r.height || f.height || 120) + 'px;border-radius:12px;overflow:hidden;' + (getComputedStyle(f).margin ? 'margin:' + getComputedStyle(f).margin : '');
      host.attachShadow({ mode: 'closed' }).innerHTML = html.replace(/^<!doctype html>/i, '');
      f.replaceWith(host);
      n++;
    }
    return n;
  };
  if (swap()) return;
  const mo = new MutationObserver(() => { if (swap()) mo.disconnect(); });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => mo.disconnect(), 15000);
})(${JSON.stringify(frameUrl)}, ${JSON.stringify(html)})`;
}

export class ReaderStore {
  /** Replaces a blocked ad frame with Rovian Defender's "advert blocked" card (shadow DOM, isolated from the page's CSS). */
  static async replaceAdFrame(wc: WebContents, frameUrl: string, html: string) {
    await wc.executeJavaScriptInIsolatedWorld(994, [{ code: adCardScript(frameUrl, html) }]);
  }

  private articles = new Map<string, ReaderArticle>();

  async extract(wc: WebContents): Promise<string | null> {
    const url = wc.getURL();
    if (!/^https?:/.test(url)) return null;
    try {
      const r = (await wc.executeJavaScriptInIsolatedWorld(998, [{ code: EXTRACT }])) as Omit<ReaderArticle, 'url' | 'minutes'> & { words: number };
      const blocks = (r.blocks ?? []).slice(0, 800).map((b) => ({ type: b.type, text: String(b.text).slice(0, 20_000), src: b.src }));
      if (blocks.filter((b) => b.type === 'p').length < 2) return null;
      const id = randomUUID();
      this.articles.set(id, {
        url, title: String(r.title).slice(0, 500), byline: String(r.byline).slice(0, 200), site: String(r.site).slice(0, 200),
        published: String(r.published).slice(0, 60), blocks, minutes: Math.max(1, Math.round((r.words || 0) / 230)),
      });
      if (this.articles.size > 50) this.articles.delete(this.articles.keys().next().value!);
      return id;
    } catch {
      return null;
    }
  }

  get(id: string) {
    return this.articles.get(id) ?? null;
  }

  /** Plain text of the current page, for Nebula (only when the user shares the page). */
  static async pageText(wc: WebContents, maxChars = 60_000): Promise<{ title: string; url: string; text: string }> {
    const url = wc.getURL();
    const r = (await wc.executeJavaScriptInIsolatedWorld(997, [{ code: `({ title: document.title, text: (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n') })` }])) as { title: string; text: string };
    return { title: String(r.title), url, text: String(r.text).slice(0, maxChars) };
  }

  /** Products on the page (structured data first, then visible cards). Used by Nebula in Shopping mode. */
  /** Images and videos on the page, largest first, for Nebula's Media view. */
  static async pageMedia(wc: WebContents): Promise<import('../shared/types').PageMedia[]> {
    const r = await wc.executeJavaScriptInIsolatedWorld(993, [{ code: MEDIA }]);
    return Array.isArray(r) ? r.slice(0, 60) : [];
  }

  static async pageProducts(wc: WebContents): Promise<import('../shared/types').PageProduct[]> {
    const r = await wc.executeJavaScriptInIsolatedWorld(996, [{ code: PRODUCTS }]);
    return Array.isArray(r) ? r.slice(0, 30) : [];
  }

  /** Nebula's on-screen action: outline matching items with the neon gradient and scroll to the first. Visual only. */
  static async highlight(wc: WebContents, texts: string[]): Promise<{ found: number }> {
    if (!texts.length) return { found: 0 };
    return (await wc.executeJavaScriptInIsolatedWorld(995, [{ code: highlightScript(texts) }])) as { found: number };
  }

  /** The neon sweep shown when Nebula reads or changes the page. */
  static async glow(wc: WebContents) {
    await wc.executeJavaScriptInIsolatedWorld(995, [{ code: GLOW }]);
  }

  static async selection(wc: WebContents): Promise<string> {
    const r = await wc.executeJavaScriptInIsolatedWorld(997, [{ code: 'String(getSelection() || "")' }]);
    return String(r).slice(0, 20_000);
  }
}

/** Collects visible-size images (and video posters) with absolute https URLs. */
const MEDIA = String.raw`(() => {
  const seen = new Set(); const out = [];
  const add = (src, alt, w, h, kind) => {
    try { src = new URL(src, location.href).href; } catch { return; }
    if (!/^https:\/\//.test(src) || seen.has(src) || w < 120 || h < 90) return;
    seen.add(src); out.push({ src, alt: String(alt || '').slice(0, 200), width: Math.round(w), height: Math.round(h), kind });
  };
  for (const img of document.images) {
    const r = img.getBoundingClientRect();
    add(img.currentSrc || img.src, img.alt || img.title, r.width || img.naturalWidth, r.height || img.naturalHeight, 'image');
  }
  for (const v of document.querySelectorAll('video[poster]')) { const r = v.getBoundingClientRect(); add(v.poster, v.title || 'Video', r.width, r.height, 'video'); }
  const og = document.querySelector('meta[property="og:image"]')?.content;
  if (og) add(og, document.title, 1200, 630, 'image');
  return out.sort((a, b) => b.width * b.height - a.width * a.height);
})()`;
