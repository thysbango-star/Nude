// Server-rendered Nude Search pages. All dynamic text is escaped.
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M20 20l-4.2-4.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function shell(title: string, body: string, bodyClass = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="/search.css"><link rel="search" type="application/opensearchdescription+xml" title="Nude Search" href="/opensearch.xml">
<link rel="icon" href="/logo.svg"></head><body class="${bodyClass}">${body}<script src="/search.js"></script></body></html>`;
}

function searchForm(q = '', type = 'web', big = false) {
  return `<form class="sbox${big ? ' big' : ''}" action="/search" method="get" role="search" autocomplete="off">
    <span class="sicon">${SEARCH}</span>
    <input name="q" value="${esc(q)}" placeholder="Search with Nude" aria-label="Search" ${big ? 'autofocus' : ''} maxlength="300" id="q">
    ${type !== 'web' ? `<input type="hidden" name="type" value="${esc(type)}">` : ''}
    <button type="button" class="mic" id="voice" title="Search by voice" aria-label="Search by voice" hidden>${MIC}</button>
    <button class="go" aria-label="Search">${SEARCH}</button>
    <div class="suggest" id="suggest" role="listbox" hidden></div>
  </form>`;
}

export function renderHome(trending: string[], index: { pages: number; hosts: number }) {
  const cats: [string, string][] = [['News', 'news'], ['Images', 'images'], ['Videos', 'videos'], ['Shopping', 'shopping']];
  return shell('Nude Search', `
  <main class="home">
    <div class="brand"><img class="logo-img" src="/logo.svg" alt="" width="64" height="64"><h1>Nude <span>Search</span></h1></div>
    ${searchForm('', 'web', true)}
    <div class="ai-toggle"><label class="switch"><input type="checkbox" id="ai-mode"><span></span></label><span><i class="orb"></i>Answers from Nebula</span></div>
    <div class="cats">${cats.map(([l, t]) => `<a class="chip" href="/search?type=${t}&q=" data-type="${t}">${l}</a>`).join('')}</div>
    <section class="lists">
      <div id="recent-wrap" hidden><h2>Recent searches</h2><div id="recent" class="chips"></div><button class="link" id="clear-recent">Clear</button></div>
      ${trending.length ? `<div><h2>Trending on Nude</h2><div class="chips">${trending.map((t) => `<a class="chip" href="/search?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div></div>` : ''}
    </section>
    <footer class="foot">Nude's own index covers ${index.pages.toLocaleString()} pages from ${index.hosts.toLocaleString()} sites and is growing. We don't track you or sell your searches.</footer>
  </main>`, 'home-page');
}

interface Data {
  query: string; type: string; page: number; perPage: number; total: number; took_ms?: number;
  results: { url: string; title: string; snippet: string; host: string; favicon: string; published?: string; source: string; image?: string; price?: string; kind?: string }[];
  ads: { title: string; url: string; description: string; advertiser: string }[];
  fallback: { provider: string; used: boolean; error?: string } | null;
  index: { pages: number };
}

function displayUrl(url: string) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean).slice(0, 3).map(decodeURIComponent);
    return [u.hostname.replace(/^www\./, ''), ...parts].join(' › ');
  } catch { return url; }
}

function date(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(+d) ? '' : d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function renderResults(d: Data) {
  const tabs: [string, string][] = [['All', 'web'], ['News', 'news'], ['Images', 'images'], ['Videos', 'videos'], ['Shopping', 'shopping']];
  const q = encodeURIComponent(d.query);
  const nude = d.results.filter((r) => r.source === 'nude').length;
  const partner = d.results.length - nude;
  const body = d.type === 'images'
    ? `<div class="img-grid">${d.results.map((r) => `<a class="img-card" href="${esc(r.url)}" rel="noopener"><img src="${esc(r.image ?? '')}" alt="${esc(r.title)}" loading="lazy" referrerpolicy="no-referrer"><span>${esc(r.host)}</span></a>`).join('')}</div>`
    : d.results.map((r, i) => `
      <article class="result" style="animation-delay:${Math.min(i, 10) * 30}ms">
        <div class="site"><img class="fav" src="${esc(r.favicon)}" alt="" loading="lazy" referrerpolicy="no-referrer"><div><b>${esc(r.host.replace(/^www\./, ''))}</b><span>${esc(displayUrl(r.url))}</span></div>
          ${r.source !== 'nude' ? `<span class="badge partner" title="From ${esc(r.source)}, used while Nude's own index grows">via ${esc(r.source)}</span>` : ''}</div>
        <h3><a href="${esc(r.url)}" rel="noopener">${esc(r.title)}</a></h3>
        <p>${r.published ? `<time>${esc(date(r.published))}</time> — ` : ''}${r.price ? `<b class="price">${esc(r.price)}</b> — ` : ''}${r.snippet}</p>
        <div class="qa"><a href="${esc(r.url)}" rel="noopener">Open</a><button data-share="${esc(r.url)}" data-title="${esc(r.title)}">Share</button><button data-save="${esc(r.url)}" data-title="${esc(r.title)}">Save</button></div>
      </article>`).join('');
  const empty = !d.results.length ? `<div class="empty"><h2>No results${d.query ? ` for “${esc(d.query)}”` : ''}</h2>
      <p>Nude's own index doesn't cover this yet${d.fallback ? '' : ', and no partner search provider is configured'}. Try different words, or check the spelling.</p></div>` : '';
  const pager = d.total > d.perPage ? `<nav class="pager">${d.page > 1 ? `<a class="chip" href="/search?q=${q}&type=${d.type}&page=${d.page - 1}">Previous</a>` : ''}
      <span>Page ${d.page}</span>${d.page * d.perPage < d.total ? `<a class="chip" href="/search?q=${q}&type=${d.type}&page=${d.page + 1}">Next</a>` : ''}</nav>` : '';
  return shell(`${d.query} — Nude Search`, `
  <header class="top"><a class="mini-brand" href="/" aria-label="Nude Search home"><img src="/logo.svg" alt="" width="34" height="34"></a>${searchForm(d.query, d.type)}
    <div class="ai-toggle compact"><label class="switch"><input type="checkbox" id="ai-mode"><span></span></label><span><i class="orb"></i>Nebula</span></div></header>
  <nav class="tabs">${tabs.map(([l, t]) => `<a class="${d.type === t ? 'on' : ''}" href="/search?q=${q}&type=${t}">${l}</a>`).join('')}
    <span class="filters"><select id="time" aria-label="Time"><option value="">Any time</option><option value="day">Past day</option><option value="week">Past week</option><option value="month">Past month</option><option value="year">Past year</option></select>
    <select id="safe" aria-label="Safe search"><option value="moderate">SafeSearch: on</option><option value="strict">SafeSearch: strict</option><option value="off">SafeSearch: off</option></select></span></nav>
  <main class="results">
    <div class="meta">${d.total.toLocaleString()} result${d.total === 1 ? '' : 's'}${d.took_ms !== undefined ? ` · ${(d.took_ms / 1000).toFixed(2)}s` : ''}
      ${nude ? ` · <span class="badge own">${nude} from Nude's index</span>` : ''}${partner ? ` · <span class="badge partner">${partner} from ${esc(d.fallback?.provider ?? 'partner')}</span>` : ''}</div>
    <section id="ai-answer" class="ai-card" hidden data-q="${esc(d.query)}"></section>
    ${d.ads.map((a) => `<article class="result ad"><div class="site"><span class="badge ad-badge">Ad</span><b>${esc(a.advertiser)}</b></div><h3><a href="${esc(a.url)}" rel="sponsored noopener">${esc(a.title)}</a></h3><p>${esc(a.description)}</p></article>`).join('')}
    ${empty}${body}${pager}
  </main>`, 'results-page');
}
