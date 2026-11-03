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

export class ReaderStore {
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

  /** Plain text of the current page, for Nude AI (only when the user shares the page). */
  static async pageText(wc: WebContents, maxChars = 60_000): Promise<{ title: string; url: string; text: string }> {
    const url = wc.getURL();
    const r = (await wc.executeJavaScriptInIsolatedWorld(997, [{ code: `({ title: document.title, text: (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n') })` }])) as { title: string; text: string };
    return { title: String(r.title), url, text: String(r.text).slice(0, maxChars) };
  }

  static async selection(wc: WebContents): Promise<string> {
    const r = await wc.executeJavaScriptInIsolatedWorld(997, [{ code: 'String(getSelection() || "")' }]);
    return String(r).slice(0, 20_000);
  }
}
