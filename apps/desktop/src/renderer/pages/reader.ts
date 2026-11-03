import { api, $, esc, I } from './common';

interface A { url: string; title: string; byline: string; site: string; published: string; minutes: number;
  blocks: { type: string; text: string; src?: string }[] }

const prefs = (() => { try { return JSON.parse(localStorage.getItem('reader') || '{}'); } catch { return {}; } })() as { size?: number; font?: string; theme?: string };
function apply() {
  document.body.style.setProperty('--reader-size', `${prefs.size ?? 19}px`);
  document.body.dataset.font = prefs.font ?? 'serif';
  document.body.dataset.theme = prefs.theme ?? 'auto';
  try { localStorage.setItem('reader', JSON.stringify(prefs)); } catch { /* ignore */ }
}

async function render() {
  const a = await api.invoke<A | null>('reader.get');
  if (!a) { $('#root').innerHTML = '<div class="page"><div class="empty"><h3>This article is no longer available</h3><div>Go back and open reader view again.</div></div></div>'; return; }
  document.title = a.title;
  let date = '';
  try { if (a.published) date = new Date(a.published).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }); } catch { /* ignore */ }
  let list = false;
  const body = a.blocks.map((b) => {
    let pre = '';
    if (b.type === 'li' && !list) { pre = '<ul>'; list = true; } else if (b.type !== 'li' && list) { pre = '</ul>'; list = false; }
    const el = b.type === 'h' ? `<h2>${esc(b.text)}</h2>` : b.type === 'quote' ? `<blockquote>${esc(b.text)}</blockquote>` : b.type === 'li' ? `<li>${esc(b.text)}</li>`
      : b.type === 'img' ? `<figure><img src="${esc(b.src ?? '')}" alt="${esc(b.text)}" loading="lazy" referrerpolicy="no-referrer"></figure>` : `<p>${esc(b.text)}</p>`;
    return pre + el;
  }).join('') + (list ? '</ul>' : '');
  $('#root').innerHTML = `<div class="reader-bar">
      <a class="btn" href="${esc(a.url)}" data-open="${esc(a.url)}">${I.back}Exit reader</a><span class="grow"></span>
      <button class="icon-btn" data-size="-1" title="Smaller text">A−</button><button class="icon-btn" data-size="1" title="Larger text">A+</button>
      <button class="btn" data-font>${prefs.font === 'sans' ? 'Serif' : 'Sans'}</button>
      <div class="seg">${['auto', 'light', 'sepia', 'dark'].map((t) => `<button data-theme="${t}" class="${(prefs.theme ?? 'auto') === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
    <article class="article"><div class="kicker">${esc(a.site)}</div><h1>${esc(a.title)}</h1>
      <div class="meta">${[a.byline, date, `${a.minutes} min read`].filter(Boolean).map(esc).join(' · ')}</div>${body}
      <footer><a href="${esc(a.url)}" data-open="${esc(a.url)}">View original article</a></footer></article>`;
}
document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const s = t.closest<HTMLElement>('[data-size]')?.dataset.size;
  if (s) { prefs.size = Math.max(14, Math.min(28, (prefs.size ?? 19) + Number(s))); apply(); }
  if (t.closest('[data-font]')) { prefs.font = prefs.font === 'sans' ? 'serif' : 'sans'; apply(); void render(); }
  const th = t.closest<HTMLElement>('[data-theme]')?.dataset.theme;
  if (th) { prefs.theme = th; apply(); document.querySelectorAll('[data-theme]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.theme === th)); }
});
apply();
void render();
