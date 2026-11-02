// Local omnibox suggestions: ranks history, bookmarks and open tabs against typed text.
import type { Bookmark, HistoryEntry, Suggestion } from './types';

export interface OpenTabRef { id: number; url: string; title: string; favicon?: string }

const DAY = 86_400_000;

/** Strips scheme and "www." so "git" matches "https://www.github.com". */
export function strippedUrl(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '');
}

/** Frequency + recency score (Firefox-style "frecency", simplified). */
export function frecency(e: Pick<HistoryEntry, 'visitCount' | 'typedCount' | 'lastVisit'>, now = Date.now()): number {
  const ageDays = Math.max(0, (now - e.lastVisit) / DAY);
  const recency = ageDays < 1 ? 1 : ageDays < 7 ? 0.7 : ageDays < 30 ? 0.5 : ageDays < 90 ? 0.3 : 0.1;
  return (e.visitCount + e.typedCount * 2) * recency;
}

/** 0 = no match. Higher is better. */
export function matchScore(query: string, url: string, title: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const u = strippedUrl(url).toLowerCase();
  const t = title.toLowerCase();
  if (u.startsWith(q)) return 100;
  if (u.split(/[/?#.]/).some((part) => part.startsWith(q))) return 60;
  if (t.startsWith(q)) return 55;
  const words = q.split(/\s+/);
  if (words.every((w) => t.split(/\s+/).some((tw) => tw.startsWith(w)))) return 45;
  if (words.every((w) => u.includes(w) || t.includes(w))) return 20;
  return 0;
}

export function rankLocalSuggestions(
  query: string,
  history: HistoryEntry[],
  bookmarks: Bookmark[],
  tabs: OpenTabRef[],
  limit = 6,
  now = Date.now(),
): Suggestion[] {
  const byUrl = new Map<string, Suggestion>();
  const add = (s: Suggestion) => {
    const prev = byUrl.get(s.value);
    if (!prev || prev.score < s.score) byUrl.set(s.value, s);
  };

  for (const h of history) {
    const m = matchScore(query, h.url, h.title);
    if (!m) continue;
    add({ kind: 'history', title: h.title || strippedUrl(h.url), detail: h.url, value: h.url, favicon: h.favicon,
      score: m + Math.min(40, Math.log2(1 + frecency(h, now)) * 8) });
  }
  for (const b of bookmarks) {
    const m = matchScore(query, b.url, b.title);
    if (!m) continue;
    add({ kind: 'bookmark', title: b.title || strippedUrl(b.url), detail: b.url, value: b.url, favicon: b.favicon, score: m + 30 });
  }
  const tabSuggestions: Suggestion[] = [];
  for (const t of tabs) {
    if (!/^https?:/.test(t.url)) continue;
    const m = matchScore(query, t.url, t.title);
    if (m >= 45) {
      tabSuggestions.push({ kind: 'tab', title: t.title || strippedUrl(t.url), detail: t.url, value: t.url,
        favicon: t.favicon, tabId: t.id, score: m - 10 });
    }
  }
  const ranked = [...byUrl.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  return [...ranked, ...tabSuggestions.sort((a, b) => b.score - a.score).slice(0, 2)];
}

/**
 * Inline autocompletion: when the user types the start of a host they visit often,
 * returns the full host text to complete to (e.g. "git" → "github.com").
 */
export function inlineCompletion(query: string, history: HistoryEntry[], now = Date.now()): string | null {
  const q = query.toLowerCase();
  if (!q || /\s/.test(q) || q.includes('/')) return null;
  let best: { host: string; score: number } | null = null;
  for (const h of history) {
    if (h.typedCount === 0 && h.visitCount < 3) continue;
    let host: string;
    try {
      host = new URL(h.url).host.replace(/^www\./, '');
    } catch {
      continue;
    }
    if (!host.startsWith(q) || host === q) continue;
    const score = frecency(h, now);
    if (!best || score > best.score) best = { host, score };
  }
  return best?.host ?? null;
}

/** Parses an OpenSearch suggestions response ([query, [s1, s2, ...]]) or DDG-style list. */
export function parseRemoteSuggestions(json: unknown, limit = 5): string[] {
  let list: unknown[] = [];
  if (Array.isArray(json) && Array.isArray(json[1])) list = json[1];
  else if (Array.isArray(json)) list = json.map((x) => (x && typeof x === 'object' && 'phrase' in x ? (x as { phrase: unknown }).phrase : x));
  return list.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length < 200).slice(0, limit);
}
