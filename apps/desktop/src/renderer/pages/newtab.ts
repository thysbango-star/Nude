// nude://newtab — the homepage: a landscape wallpaper, one Liquid Glass search bar, a few shortcuts.
import { api, $, esc, faviconImg, host, I, on } from './common';

interface Wallpaper { id: string; name: string; file: string; thumb: string; focus: string }
interface Suggestion { kind: string; title: string; detail?: string; value: string; favicon?: string }
interface Data {
  shortcuts: { id: string; title: string; url: string }[];
  topSites: { url: string; title: string; favicon?: string }[];
  recent: { url: string; title: string; favicon?: string; lastVisit: number }[];
  engine: string; engineId: string; private: boolean;
  wallpapers: Wallpaper[]; wallpaper: string; wallpaperRotate: boolean; hasCustomWallpaper: boolean; reduceMotion: boolean;
  security: { blockedTrackers: number; blockedSites: number };
  account: { firstName: string; name: string } | null;
}

const ICON = {
  picture: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/></svg>',
  globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5S14.5 17.9 12 20.5C9.5 17.9 8.4 15.1 8.4 12S9.5 6.1 12 3.5z"/></svg>',
  tabs: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="6" width="17" height="13" rx="2.5"/><path d="M7 6V4.5h10V6"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V5m0 0-4 4m4-4 4 4M5 19h14"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7.5 3v5.5c0 4.4-3.1 8.2-7.5 9.5-4.4-1.3-7.5-5.1-7.5-9.5V6z"/></svg>',
};

let data: Data;
let saved = '';          // the wallpaper in your settings
let showing = '';        // the wallpaper on screen (a preview may differ)
let rotateTimer: number | undefined;
let customStamp = Date.now();

const wpById = (id: string) => data.wallpapers.find((w) => w.id === id);
const wpSrc = (id: string) => (id === 'custom' ? `custom-wallpaper.jpg?t=${customStamp}` : wpById(id)?.file ?? data.wallpapers[0].file);
const wpName = (id: string) => (id === 'custom' ? 'Your image' : wpById(id)?.name ?? '');
const wpFocus = (id: string) => (id === 'custom' ? '50% 50%' : wpById(id)?.focus ?? '50% 50%');

function greeting(name?: string) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

// ------------------------------------------------------------------ wallpaper crossfade
/** Fades to a wallpaper only once it has fully loaded, so there is never a blank frame. */
async function showWallpaper(id: string, instant = false) {
  if (id === showing && !instant) return;
  const src = wpSrc(id);
  const img = new Image();
  img.src = src;
  try { await img.decode(); } catch {
    if (id !== data.wallpapers[0].id) return showWallpaper(data.wallpapers[0].id, instant);
    return;
  }
  showing = id;
  const layers = [...document.querySelectorAll<HTMLElement>('.wall .layer')];
  const front = layers.find((l) => l.classList.contains('on')) ?? layers[0];
  const back = layers.find((l) => l !== front)!;
  back.style.backgroundImage = `url("${src}")`;
  back.style.backgroundPosition = wpFocus(id);
  back.classList.toggle('instant', instant);
  front.classList.toggle('instant', instant);
  requestAnimationFrame(() => { back.classList.add('on'); front.classList.remove('on'); });
  const credit = document.getElementById('credit');
  if (credit) credit.textContent = wpName(id);
}

function rotation() {
  clearInterval(rotateTimer);
  if (!data.wallpaperRotate || data.private) return;
  const ids = [...data.wallpapers.map((w) => w.id), ...(data.hasCustomWallpaper ? ['custom'] : [])];
  // The same picture in every tab at the same minute; the next one each minute.
  const pick = () => ids[Math.floor(Date.now() / 60_000) % ids.length];
  void showWallpaper(pick(), !showing);
  rotateTimer = window.setInterval(() => { if (!document.hidden && !document.querySelector('.wp-panel:not([hidden])')) void showWallpaper(pick()); }, 15_000);
}

// ------------------------------------------------------------------ page
async function render() {
  data = await api.invoke<Data>('newtab.data');
  saved = data.wallpaper;
  document.documentElement.classList.toggle('private', data.private);
  document.documentElement.classList.toggle('calm', data.reduceMotion);
  const name = data.account?.firstName;
  const tiles = data.shortcuts.slice(0, 8).map((s, i) => {
    const fav = data.topSites.find((t) => host(t.url) === host(s.url))?.favicon;
    return `<div class="tile" data-url="${esc(s.url)}" title="${esc(s.url)}" style="--i:${i}"><span class="tile-icon glass">${fav ? faviconImg(fav) : `<b>${esc(host(s.url).charAt(0).toUpperCase())}</b>`}</span>
      <span class="tile-name">${esc(s.title)}</span><button class="tile-x" data-remove="${esc(s.id)}" aria-label="Remove ${esc(s.title)}">${I.close}</button></div>`;
  }).join('') + (data.shortcuts.length < 8 ? `<button class="tile add" id="add-tile" style="--i:${Math.min(8, data.shortcuts.length)}"><span class="tile-icon glass">${I.plus}</span><span class="tile-name">Add</span></button>` : '');

  $('#root').innerHTML = `
    <div class="wall" aria-hidden="true"><div class="layer"></div><div class="layer"></div><div class="shade"></div></div>
    <header class="top">
      <div class="brand">Nude</div>
      <div class="top-right">
        ${data.private ? '<span class="pill glass">Private window</span>' : `<button class="round glass" id="wp-btn" aria-label="Change wallpaper" title="Wallpaper">${ICON.picture}</button>`}
        ${!data.private ? (name ? `<a class="pill glass" href="nude://account" data-open="nude://account/">${esc(data.account!.name)}</a>` : '<a class="pill glass" href="nude://welcome" data-open="nude://welcome/">Sign in</a>') : ''}
      </div>
    </header>
    <main class="center">
      <p class="greet">${data.private ? 'Private browsing' : esc(greeting(name))}</p>
      <div class="home-search" id="home-search">
        <form id="search" class="search" autocomplete="off" role="search">
          <span class="s-icon">${I.search}</span>
          <input id="q" placeholder="Search with ${esc(data.engine)} or type an address" aria-label="Search or type an address"
            role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="suggest" autofocus spellcheck="false">
          <span class="engine" id="engine">${esc(data.engine)}</span>
          <button type="submit" class="go" aria-label="Search">${I.forward}</button>
        </form>
        <div class="suggest" id="suggest" role="listbox" hidden></div>
      </div>
      <p class="status" id="status" role="status" hidden></p>
      ${data.private
        ? '<div class="private-note glass">Nude won\'t keep this window\'s history, cookies, site data or form entries after you close it. Downloads and bookmarks are kept. Your internet provider, employer and the sites you visit can still see what you do.</div>'
        : `<nav class="shortcuts" aria-label="Shortcuts">${tiles}</nav>
           ${data.recent.length ? `<div class="recent">${ICON.clock}${data.recent.slice(0, 4).map((r) => `<a href="${esc(r.url)}" data-open="${esc(r.url)}" title="${esc(r.url)}">${esc(r.title || host(r.url))}</a>`).join('')}</div>` : ''}`}
    </main>
    <footer class="bottom">
      <a class="pill glass defender" href="nude://security" data-open="nude://security/">${ICON.shield}<span>Rovian Defender blocked <b>${data.security.blockedTrackers.toLocaleString()}</b> trackers and <b>${data.security.blockedSites.toLocaleString()}</b> dangerous sites</span></a>
      ${data.private ? '' : '<span class="credit" id="credit"></span>'}
    </footer>
    ${data.private ? '' : panelHtml()}
    <dialog id="add-dialog" class="glass-dialog"><form method="dialog" id="add-form"><h2>Add shortcut</h2>
      <label>Name<input class="input" id="add-name" required maxlength="80"></label>
      <label>Address<input class="input" id="add-url" required placeholder="https://"></label>
      <div class="btns"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Add</button></div></form></dialog>`;

  showing = '';
  if (data.private) document.querySelectorAll<HTMLElement>('.wall .layer').forEach((l) => { l.style.backgroundImage = 'none'; });
  else if (data.wallpaperRotate) rotation();
  else void showWallpaper(saved, true);

  wireSearch();
  wireShortcuts();
  if (!data.private) wirePanel();
  void checkSearch();
  $('#q').focus();
}

// ------------------------------------------------------------------ search
async function checkSearch() {
  const s = await api.invoke<{ engine: string; ok: boolean; detail?: string }>('newtab.searchStatus');
  if (s.ok) return;
  status(`${s.detail ?? 'Search isn\'t available right now.'} <a href="nude://settings" data-open="nude://settings/">Choose another search engine</a>`, true);
}

function status(html: string, error = false) {
  const el = $('#status');
  el.innerHTML = html;
  el.classList.toggle('error', error);
  el.hidden = !html;
}

function wireSearch() {
  const q = $<HTMLInputElement>('#q');
  const box = $('#suggest');
  let items: Suggestion[] = [];
  let active = -1;
  let seq = 0;
  let remoteTimer: number | undefined;

  const kindIcon = (k: string) => (k === 'history' ? ICON.clock : k === 'bookmark' ? ICON.star : k === 'tab' ? ICON.tabs : k === 'url' ? ICON.globe : I.search);
  const close = () => { box.hidden = true; active = -1; q.setAttribute('aria-expanded', 'false'); $('#home-search').classList.remove('open'); };
  const draw = (loading: boolean) => {
    if (!items.length && !loading) { close(); return; }
    box.innerHTML = items.map((s, i) => `<div class="opt${i === active ? ' on' : ''}" role="option" id="opt-${i}" aria-selected="${i === active}" data-i="${i}">
      <span class="o-icon">${s.favicon && s.kind !== 'remote' ? faviconImg(s.favicon) : kindIcon(s.kind)}</span>
      <span class="o-text"><b>${esc(s.title)}</b>${s.detail ? `<span>${esc(s.detail)}</span>` : ''}</span>
      ${s.kind === 'tab' ? '<span class="o-tag">Open tab</span>' : ''}</div>`).join('') + (loading ? '<div class="loading-line" aria-hidden="true"></div>' : '');
    box.hidden = false;
    q.setAttribute('aria-expanded', 'true');
    if (active >= 0) q.setAttribute('aria-activedescendant', `opt-${active}`); else q.removeAttribute('aria-activedescendant');
    $('#home-search').classList.add('open');
  };

  let typed = '';
  q.addEventListener('input', async () => {
    const text = q.value;
    typed = text;
    const my = ++seq;
    status('');
    clearTimeout(remoteTimer);
    if (!text.trim()) { items = []; close(); return; }
    const r = await api.invoke<{ local: Suggestion[]; remote: string[] }>('newtab.suggest', text);
    if (my !== seq) return;
    items = [{ kind: 'search', title: text, detail: `Search with ${data.engine}`, value: text }, ...r.local.filter((s) => s.kind !== 'search')].slice(0, 7);
    active = -1;
    draw(true);
    remoteTimer = window.setTimeout(async () => {
      const remote = await api.invoke<string[]>('newtab.suggestRemote', text).catch(() => [] as string[]);
      if (my !== seq) return;
      const have = new Set(items.map((s) => s.value.toLowerCase()));
      items = [...items, ...remote.filter((x) => !have.has(x.toLowerCase())).map((x) => ({ kind: 'remote', title: x, value: x }))].slice(0, 9);
      draw(false);
    }, 140);
  });
  q.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (e.key === 'ArrowDown') active = active + 1 >= items.length ? -1 : active + 1;
      else active = active - 1 < -1 ? items.length - 1 : active - 1;
      draw(false);
      const pick = items[active];
      q.value = pick && (pick.kind === 'remote' || pick.kind === 'search') ? pick.value : typed;
    } else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  box.addEventListener('mousedown', (e) => {
    const opt = (e.target as HTMLElement).closest<HTMLElement>('.opt');
    if (!opt) return;
    e.preventDefault();
    void go(items[Number(opt.dataset.i)].value);
  });
  q.addEventListener('blur', () => setTimeout(close, 120));
  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    const pick = active >= 0 ? items[active].value : q.value;
    void go(pick);
  });
  const go = async (value: string) => {
    if (!value.trim()) return;
    close();
    $('#home-search').classList.add('going');
    const r = await api.invoke<{ ok: boolean; error?: string }>('newtab.go', value);
    $('#home-search').classList.remove('going');
    if (!r.ok) status(esc(r.error ?? 'Nude couldn\'t open that.'), true);
  };
}

// ------------------------------------------------------------------ shortcuts
function wireShortcuts() {
  document.querySelector('.shortcuts')?.addEventListener('click', (e) => {
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

// ------------------------------------------------------------------ wallpaper panel
function panelHtml() {
  const thumbs = data.wallpapers.map((w) => `<button class="thumb${w.id === saved ? ' sel' : ''}" data-wp="${esc(w.id)}" aria-label="${esc(w.name)}"><img src="${esc(w.thumb)}" alt=""><span>${esc(w.name)}</span></button>`).join('');
  const custom = data.hasCustomWallpaper
    ? `<button class="thumb${saved === 'custom' ? ' sel' : ''}" data-wp="custom" aria-label="Your image"><img src="custom-wallpaper.jpg?t=${customStamp}" alt=""><span>Your image</span></button>`
    : '';
  return `<section class="wp-panel" id="wp-panel" hidden aria-label="Wallpaper">
    <div class="wp-head"><b>Wallpaper</b><button class="x" id="wp-close" aria-label="Close">${I.close}</button></div>
    <div class="thumbs">${thumbs}${custom}
      <label class="thumb upload" title="Use your own picture">${ICON.upload}<span>Upload</span><input type="file" id="wp-file" accept="image/jpeg,image/png,image/webp" hidden></label>
    </div>
    <p class="wp-msg" id="wp-msg" hidden></p>
    <label class="switch-row"><span>Change automatically</span><input type="checkbox" id="wp-rotate" ${data.wallpaperRotate ? 'checked' : ''}><i aria-hidden="true"></i></label>
    <div class="wp-actions">
      <button class="link" id="wp-default">Nude default</button>
      ${data.hasCustomWallpaper ? '<button class="link" id="wp-remove">Remove your image</button>' : ''}
      <span class="grow"></span>
      <button class="btn" id="wp-cancel">Cancel</button>
      <button class="btn primary" id="wp-apply" disabled>Apply</button>
    </div>
  </section>`;
}

function wirePanel() {
  const panel = $('#wp-panel');
  let preview = saved;
  const sync = () => {
    panel.querySelectorAll<HTMLElement>('[data-wp]').forEach((b) => b.classList.toggle('sel', b.dataset.wp === preview));
    $<HTMLButtonElement>('#wp-apply').disabled = preview === saved;
  };
  const open = () => { panel.hidden = false; requestAnimationFrame(() => panel.classList.add('in')); preview = data.wallpaperRotate ? showing : saved; sync(); };
  const close = (revert: boolean) => {
    panel.classList.remove('in');
    setTimeout(() => { panel.hidden = true; }, 220);
    if (revert && !data.wallpaperRotate) void showWallpaper(saved);
  };
  const msg = (t: string) => { const m = $('#wp-msg'); m.textContent = t; m.hidden = !t; };
  $('#wp-btn').addEventListener('click', () => (panel.hidden ? open() : close(true)));
  $('#wp-close').addEventListener('click', () => close(true));
  $('#wp-cancel').addEventListener('click', () => close(true));
  panel.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-wp]');
    if (!b) return;
    preview = b.dataset.wp!;
    msg('');
    void showWallpaper(preview);
    sync();
  });
  $('#wp-apply').addEventListener('click', async () => {
    await api.invoke('wallpaper.set', preview, false);
    saved = preview; data.wallpaper = preview; data.wallpaperRotate = false;
    $<HTMLInputElement>('#wp-rotate').checked = false;
    clearInterval(rotateTimer);
    sync();
    close(false);
  });
  $('#wp-default').addEventListener('click', () => { preview = data.wallpapers[0].id; void showWallpaper(preview); sync(); });
  document.getElementById('wp-remove')?.addEventListener('click', async () => {
    await api.invoke('wallpaper.removeCustom');
    await render();
  });
  $<HTMLInputElement>('#wp-rotate').addEventListener('change', async (e) => {
    const on = (e.target as HTMLInputElement).checked;
    await api.invoke('wallpaper.set', undefined, on);
    data.wallpaperRotate = on;
    if (on) rotation(); else { clearInterval(rotateTimer); void showWallpaper(saved); }
  });
  $<HTMLInputElement>('#wp-file').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    msg('Adding your picture…');
    const r = await api.invoke<{ ok: boolean; error?: string }>('wallpaper.upload', new Uint8Array(await f.arrayBuffer()));
    if (!r.ok) { msg(r.error ?? 'That picture couldn\'t be used.'); return; }
    customStamp = Date.now();
    await render();
    $('#wp-btn').click();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(true); });
}

on('shortcuts', render);
on('account', render);
on('settings', async () => {
  // Only redraw for what the homepage shows; a wallpaper change in another tab crossfades here too.
  const before = data;
  const next = await api.invoke<Data>('newtab.data');
  if (!before || next.engine !== before.engine || next.wallpaperRotate !== before.wallpaperRotate || next.reduceMotion !== before.reduceMotion) { await render(); return; }
  data = next;
  if (next.wallpaper !== saved) { saved = next.wallpaper; if (!data.wallpaperRotate) void showWallpaper(saved); }
});
void render();
