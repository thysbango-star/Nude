import { api, $, esc, faviconImg, host, I, on, timeAgo } from './common';

interface Data {
  shortcuts: { id: string; title: string; url: string }[];
  topSites: { url: string; title: string; favicon?: string }[];
  recent: { url: string; title: string; favicon?: string; lastVisit: number }[];
  engine: string; private: boolean;
  security: { blockedTrackers: number; blockedSites: number };
  account: { firstName: string; name: string } | null;
  mode: string;
}

const SUBTITLE: Record<string, string> = {
  everyday: 'What would you like to explore today?',
  shopping: 'Shopping Mode is on — Nebula will compare products and prices for you.',
  research: 'Research Mode is on — Nebula will keep track of sources and facts.',
  study: 'Study Mode is on — Nebula can turn any page into notes and quizzes.',
  focus: 'Focus Mode is on. One thing at a time.',
};

function letterIcon(url: string) {
  const h = host(url);
  const hue = [...h].reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
  return `<span class="letter" style="background:hsl(${hue} 55% 60% / .16);color:hsl(${hue} 45% 42%)">${esc(h.charAt(0).toUpperCase())}</span>`;
}

async function render() {
  const d = await api.invoke<Data>('newtab.data');
  document.documentElement.classList.toggle('private', d.private);
  const name = d.account?.firstName;
  const tiles = d.shortcuts.map((s, i) => {
    const fav = d.topSites.find((t) => host(t.url) === host(s.url))?.favicon;
    return `<div class="tile" data-url="${esc(s.url)}" title="${esc(s.url)}" style="animation-delay:${240 + i * 40}ms"><div class="tile-icon">${fav ? faviconImg(fav) : letterIcon(s.url)}</div>
      <span>${esc(s.title)}</span><button class="tile-x" data-remove="${esc(s.id)}" aria-label="Remove ${esc(s.title)}">${I.close}</button></div>`;
  }).join('') + `<button class="tile add" id="add-tile" style="animation-delay:${240 + d.shortcuts.length * 40}ms"><div class="tile-icon">${I.plus}</div><span>Add</span></button>`;

  $('#root').innerHTML = `
    <div class="blobs" aria-hidden="true"><i class="b1"></i><i class="b2"></i><i class="b3"></i><i class="b4"></i></div>
    <main class="home">
      <div class="hero">
        <img class="logo" src="nude-logo.svg" alt="Nude">
        <h1 class="hello">${d.private ? 'Private browsing' : name ? `Hello, <span>${esc(name)}</span>` : 'Hello there'}</h1>
        <p class="sub">${d.private ? 'Nothing from this window is saved after you close it.' : esc(SUBTITLE[d.mode] ?? SUBTITLE.everyday)}
          ${!d.private && !name ? ' <a href="nude://welcome" data-open="nude://welcome/">Sign in</a>' : ''}</p>
        <form id="search" class="searchbar" autocomplete="off">
          ${I.search}<input id="q" placeholder="Search ${esc(d.engine)} or type an address" aria-label="Search" autofocus>
          <button type="submit" class="go" aria-label="Search">${I.forward}</button>
        </form>
        ${d.private ? `<div class="private-note">${I.private}<div><b>You're browsing privately.</b> Nude won't save your history, cookies, site data or form entries after you close this window. Downloads and bookmarks are kept. Your internet provider, employer and the sites you visit can still see your activity.</div></div>` : ''}
      </div>
      ${d.private ? '' : `<section class="tiles">${tiles}</section>`}
      ${!d.private && d.recent.length ? `<section class="recent"><h2>Jump back in</h2><div class="recent-list">${d.recent.map((r, i) =>
        `<a class="recent-card" style="animation-delay:${420 + i * 50}ms" href="${esc(r.url)}" data-open="${esc(r.url)}">${faviconImg(r.favicon)}<div><b>${esc(r.title || host(r.url))}</b><span>${esc(host(r.url))} · ${timeAgo(r.lastVisit)}</span></div></a>`).join('')}</div></section>` : ''}
      <footer class="stats"><img src="rovian-mark.svg" alt=""><span><b class="rv">Rovian<i>Defender</i></b> has blocked <b>${d.security.blockedTrackers.toLocaleString()}</b> trackers and <b>${d.security.blockedSites.toLocaleString()}</b> dangerous sites</span>
        <a href="nude://security" data-open="nude://security/">See report</a></footer>
    </main>
    <dialog id="add-dialog"><form method="dialog" id="add-form"><h2>Add shortcut</h2>
      <label class="tiny">Name</label><input class="input" id="add-name" required maxlength="80">
      <label class="tiny">Address</label><input class="input" id="add-url" required placeholder="https://">
      <div class="btns"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Add</button></div></form></dialog>`;

  $('#search').addEventListener('submit', (e) => { e.preventDefault(); const q = $<HTMLInputElement>('#q').value.trim(); if (q) void api.invoke('search', q); });
  $('#q').focus();
  document.querySelector('.tiles')?.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const rm = t.closest<HTMLElement>('[data-remove]')?.dataset.remove;
    if (rm) { e.stopPropagation(); void api.invoke('shortcuts.remove', rm); return; }
    if (t.closest('#add-tile')) { $<HTMLDialogElement>('#add-dialog').showModal(); return; }
    const tile = t.closest<HTMLElement>('.tile[data-url]');
    if (tile) void api.invoke('open', tile.dataset.url, (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey);
  });
  $('#add-form').addEventListener('submit', () => {
    const dlg = $<HTMLDialogElement>('#add-dialog');
    if (dlg.returnValue === 'cancel') return;
    let url = $<HTMLInputElement>('#add-url').value.trim();
    if (!/^https?:\/\//.test(url)) url = `https://${url}`;
    void api.invoke('shortcuts.add', $<HTMLInputElement>('#add-name').value.trim(), url);
  });
}
on('shortcuts', render);
on('account', render);
on('settings', render);
void render();
