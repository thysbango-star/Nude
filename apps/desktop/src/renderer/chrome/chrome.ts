// Nude browser UI. A pure view of WindowState pushed by the main process.
import type { ChromeCommand, ClosedTabInfo, Suggestion, TabState, WindowState } from '../../shared/types';
import { displayUrl, extractSearchQuery, NEW_TAB_URL } from '../../shared/omnibox';
import { I, esc, faviconImg, installFaviconFallback } from './icons';
import { Nebula, MODES } from './nebula';

interface NudeBridge {
  invoke<T = unknown>(cmd: string, ...args: unknown[]): Promise<T>;
  onState(cb: (s: WindowState) => void): () => void;
  onCommand(cb: (c: ChromeCommand) => void): () => void;
  onAi(cb: (m: Record<string, unknown>) => void): () => void;
}
const nude = (window as unknown as { nude: NudeBridge }).nude;
export const invoke = nude.invoke;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const isPrivate = new URLSearchParams(location.search).get('private') === '1';
document.documentElement.classList.toggle('private', isPrivate);
installFaviconFallback();

let state: WindowState | null = null;
let shortcuts: { label: string; keys: string }[] = [];
const els = {
  tabstrip: $('tabstrip'), address: $<HTMLInputElement>('address'), omnibox: $('omnibox'), siteInfo: $('site-info'),
  back: $<HTMLButtonElement>('back'), forward: $<HTMLButtonElement>('forward'), reload: $('reload'),
  star: $('star'), reader: $('reader'), bookmarks: $('bookmarks'), tabsBtn: $('tabs-btn'), downloads: $('downloads'),
  ai: $('ai-btn'), menu: $('menu'), bookmarksBar: $('bookmarks-bar'), bars: $('bars'), content: $('content'),
  snapshot: $<HTMLImageElement>('snapshot'), overlay: $('overlay'), toast: $('toast'), pageState: $('page-state'),
  newTab: $('new-tab'), main: $('main'), inner: $('content-inner'),
};

// ------------------------------------------------------------------ static icons
els.back.innerHTML = I.back; els.forward.innerHTML = I.forward; els.reload.innerHTML = I.reload;
els.star.innerHTML = I.star; els.reader.innerHTML = I.reader; els.bookmarks.innerHTML = I.bookmarks;
els.tabsBtn.insertAdjacentHTML('afterbegin', I.tabs); els.downloads.insertAdjacentHTML('afterbegin', I.download);
els.menu.innerHTML = I.dots; els.newTab.innerHTML = I.plus;
document.documentElement.classList.add(navigator.userAgent.includes('Mac') ? 'darwin' : 'other');

const active = (): TabState | undefined => state?.tabs.find((t) => t.id === state!.activeTabId);

// ------------------------------------------------------------------ content bounds → main process
function reportBounds() {
  const r = els.inner.getBoundingClientRect();
  void invoke('bounds', { x: r.left, y: r.top, width: r.width, height: r.height });
}
new ResizeObserver(reportBounds).observe(els.inner);
els.inner.addEventListener('transitionend', reportBounds);
window.addEventListener('resize', reportBounds);

// ------------------------------------------------------------------ overlay (menus, suggestions, overview)
let overlayCloser: (() => void) | null = null;
/** Bumped on every open/close so a slow open can't resurrect an overlay that was closed meanwhile. */
let overlayGen = 0;
async function openOverlay(build: (layer: HTMLElement) => void, onClose?: () => void, useSnapshot = true, frost = false): Promise<boolean> {
  closeOverlay();
  const gen = ++overlayGen;
  const snap = await invoke<string | null>('overlay', true, frost);
  if (gen !== overlayGen) {
    // Closed (or replaced) while we were waiting for the snapshot.
    if (!overlayCloser) void invoke('overlay', false);
    onClose?.();
    return false;
  }
  if (snap && useSnapshot) { els.snapshot.src = snap; els.snapshot.hidden = false; }
  els.snapshot.classList.remove('frost');
  if (frost) requestAnimationFrame(() => els.snapshot.classList.add('frost'));
  els.overlay.hidden = false;
  els.overlay.innerHTML = '';
  build(els.overlay);
  overlayCloser = () => {
    els.overlay.hidden = true;
    els.overlay.innerHTML = '';
    els.snapshot.hidden = true;
    els.snapshot.classList.remove('frost');
    els.snapshot.removeAttribute('src');
    onClose?.();
    void invoke('overlay', false);
  };
  return true;
}
function closeOverlay() {
  overlayGen++;
  const c = overlayCloser;
  overlayCloser = null;
  c?.();
}
els.overlay.addEventListener('mousedown', (e) => { if (e.target === els.overlay) closeOverlay(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && overlayCloser && document.activeElement !== els.address) { e.preventDefault(); closeOverlay(); }
});

function popover(anchor: HTMLElement, cls: string, html: string, align: 'left' | 'right' = 'right'): HTMLElement {
  const r = anchor.getBoundingClientRect();
  const p = document.createElement('div');
  p.className = `popover ${cls}`;
  p.innerHTML = html;
  p.style.top = `${r.bottom + 6}px`;
  if (align === 'right') { p.style.right = `${Math.max(8, innerWidth - r.right)}px`; p.style.transformOrigin = 'top right'; }
  else { p.style.left = `${Math.max(8, r.left)}px`; p.style.transformOrigin = 'top left'; }
  els.overlay.appendChild(p);
  return p;
}

// ------------------------------------------------------------------ toast
let toastTimer = 0;
export function toast(message: string) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), 2600);
}

// ------------------------------------------------------------------ rendering
function render(s: WindowState) {
  const prev = state;
  state = s;
  const root = document.documentElement;
  root.classList.toggle('fullscreen', s.fullscreen);
  root.classList.toggle('reduce-motion', s.settings.reduceMotion);
  if (s.accentColor && !isPrivate) root.style.setProperty('--accent', s.accentColor); else root.style.removeProperty('--accent');
  root.classList.toggle('fullscreen-html', s.htmlFullscreen);
  const dark = s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('theme-dark', dark);
  root.classList.toggle('theme-light', !dark);
  renderTabs(s);
  renderToolbar(s);
  renderBookmarks(s);
  renderBars(s);
  renderPageState();
  if (!prev || prev.activeTabId !== s.activeTabId || prev.mode !== s.mode || prevActiveUrl(prev) !== active()?.url) nebula.onTabChanged();
  nebula.onState();
  const prevUrl = prev?.tabs.find((t) => t.id === prev.activeTabId)?.url;
  if (suggestionsOpen && document.activeElement !== els.address && prevUrl !== active()?.url) closeOverlay();
  document.title = active()?.title ? `${active()!.title} — Nude` : 'Nude';
  requestAnimationFrame(reportBounds);
}

function prevActiveUrl(p: WindowState) { return p.tabs.find((t) => t.id === p.activeTabId)?.url; }

function tabHtml(t: TabState, s: WindowState) {
  const group = t.groupId ? s.groups.find((g) => g.id === t.groupId) : undefined;
  const icon = t.loading ? '<div class="spinner"></div>' : t.crashed ? I.crash : t.security === 'blocked' ? I.shieldX : faviconImg(t.favicon, t.url.startsWith('nude:') ? I.sparkle : I.globe);
  const audio = t.audible || t.muted ? `<button class="tab-audio" data-act="mute" title="${t.muted ? 'Unmute' : 'Mute'} tab">${t.muted ? I.muted : I.volume}</button>` : '';
  return `<div class="tab${t.id === s.activeTabId ? ' active' : ''}${t.pinned ? ' pinned' : ''}" role="tab" draggable="true"
    data-id="${t.id}" aria-selected="${t.id === s.activeTabId}" title="${esc((group ? `${group.name} · ` : '') + (t.title || t.url))}">
    ${group ? `<span class="grp" style="background:${group.color}"></span>` : ''}<span class="tab-icon">${icon}</span><span class="tab-title">${esc(tabTitle(t))}</span>${audio}
    <button class="tab-close" data-act="close" aria-label="Close tab">${I.close}</button></div>`;
}

function tabTitle(t: TabState) {
  if (!t.url || t.url.startsWith('nude://newtab')) return 'New Tab';
  return t.title || displayUrl(t.url);
}

let lastTabsKey = '';
function renderTabs(s: WindowState) {
  const key = JSON.stringify([s.tabs.map((t) => [t.id, t.title, t.favicon, t.loading, t.audible, t.muted, t.pinned, t.crashed, t.security, t.url, t.groupId]), s.activeTabId, s.groups]);
  if (key === lastTabsKey) return;
  lastTabsKey = key;
  els.tabstrip.innerHTML = s.tabs.map((t) => tabHtml(t, s)).join('');
  const width = els.tabstrip.parentElement!.clientWidth - 260;
  const per = Math.max(40, Math.min(190, (width - 6 * s.tabs.length) / Math.max(1, s.tabs.length)));
  for (const el of els.tabstrip.querySelectorAll<HTMLElement>('.tab:not(.pinned)')) el.style.flexBasis = `${per}px`;
}

els.tabstrip.addEventListener('mousedown', (e) => {
  const tabEl = (e.target as HTMLElement).closest<HTMLElement>('.tab');
  if (!tabEl) return;
  const id = Number(tabEl.dataset.id);
  const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
  if (e.button === 1) { e.preventDefault(); void invoke('close', id); return; }
  if (e.button === 0 && !act) void invoke('activate', id);
});
els.tabstrip.addEventListener('click', (e) => {
  const tabEl = (e.target as HTMLElement).closest<HTMLElement>('.tab');
  const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
  if (!tabEl || !act) return;
  const id = Number(tabEl.dataset.id);
  if (act === 'close') void invoke('close', id);
  if (act === 'mute') void invoke('mute', id);
});
els.tabstrip.addEventListener('dblclick', (e) => { if (e.target === els.tabstrip) void invoke('newTab'); });
els.tabstrip.addEventListener('contextmenu', (e) => {
  const tabEl = (e.target as HTMLElement).closest<HTMLElement>('.tab');
  if (!tabEl || !state) return;
  e.preventDefault();
  const t = state.tabs.find((x) => x.id === Number(tabEl.dataset.id));
  if (t) showTabMenu(t, e.clientX, e.clientY);
});

// Drag to reorder
let dragId: number | null = null;
els.tabstrip.addEventListener('dragstart', (e) => {
  const tabEl = (e.target as HTMLElement).closest<HTMLElement>('.tab');
  if (!tabEl) return;
  dragId = Number(tabEl.dataset.id);
  tabEl.classList.add('dragging');
  e.dataTransfer!.effectAllowed = 'move';
});
els.tabstrip.addEventListener('dragover', (e) => { if (dragId !== null) e.preventDefault(); });
els.tabstrip.addEventListener('drop', (e) => {
  e.preventDefault();
  if (dragId === null || !state) return;
  const tabs = [...els.tabstrip.querySelectorAll<HTMLElement>('.tab')];
  let index = tabs.length;
  for (let i = 0; i < tabs.length; i++) {
    const r = tabs[i].getBoundingClientRect();
    if (e.clientX < r.left + r.width / 2) { index = i; break; }
  }
  const from = state.tabs.findIndex((t) => t.id === dragId);
  if (from >= 0 && from < index) index--;
  void invoke('move', dragId, index);
});
els.tabstrip.addEventListener('dragend', (e) => {
  (e.target as HTMLElement).classList?.remove('dragging');
  // Dropped outside the window → move to a new window.
  if (dragId !== null && (e.clientY < -40 || e.clientY > innerHeight || e.clientX < 0 || e.clientX > innerWidth)) void invoke('moveToNewWindow', dragId);
  dragId = null;
});

function showTabMenu(t: TabState, x: number, y: number) {
  void openOverlay((layer) => {
    const items: [string, string, () => void][] = [
      [I.plus, 'New tab to the right', () => invoke('newTab')],
      [I.reload, 'Reload', () => { void invoke('activate', t.id); void invoke('reload'); }],
      [I.copy, 'Duplicate', () => invoke('duplicate', t.id)],
      [I.pin, t.pinned ? 'Unpin' : 'Pin', () => invoke('pin', t.id, !t.pinned)],
      [t.muted ? I.volume : I.muted, t.muted ? 'Unmute site' : 'Mute site', () => invoke('mute', t.id)],
      [I.spaces, t.groupId ? 'Remove from space' : 'Add to new space', () => (t.groupId ? invoke('setTabGroup', t.id, null) : invoke('groupCreate', 'New space', [t.id]))],
      [I.window, 'Move to new window', () => invoke('moveToNewWindow', t.id)],
      [I.close, 'Close other tabs', () => invoke('closeOthers', t.id)],
      [I.close, 'Close tabs to the right', () => invoke('closeRight', t.id)],
      [I.close, 'Close', () => invoke('close', t.id)],
    ];
    const p = document.createElement('div');
    p.className = 'popover';
    p.style.left = `${Math.min(x, innerWidth - 260)}px`;
    p.style.top = `${y}px`;
    p.style.transformOrigin = 'top left';
    p.innerHTML = items.map(([icon, label], i) => (i === 7 ? '<div class="menu-sep"></div>' : '') + `<button class="menu-item" data-i="${i}">${icon}<span>${label}</span></button>`).join('');
    p.addEventListener('click', (e) => {
      const i = (e.target as HTMLElement).closest<HTMLElement>('[data-i]')?.dataset.i;
      if (i === undefined) return;
      closeOverlay();
      void items[Number(i)][2]();
    });
    layer.appendChild(p);
  });
}

function renderToolbar(s: WindowState) {
  const t = active();
  els.back.disabled = !t?.canGoBack;
  els.forward.disabled = !t?.canGoForward;
  setHtml(els.reload, t?.loading ? I.stop : I.reload);
  els.reload.title = t?.loading ? 'Stop' : 'Reload (Ctrl+R)';
  els.omnibox.classList.toggle('loading', Boolean(t?.loading));
  els.star.classList.toggle('on', Boolean(t?.isBookmarked));
  els.star.hidden = !t || !/^https?:/.test(t.url);
  els.reader.hidden = !t?.readerAvailable;
  els.ai.hidden = !s.aiEnabled;
  els.ai.classList.toggle('on', nebula.isOpen());
  els.downloads.hidden = !s.toolbar.includes('downloads') && s.downloads.active === 0;
  const count = els.tabsBtn.querySelector<HTMLElement>('.count')!;
  count.textContent = s.tabs.length > 99 ? ':)' : String(s.tabs.length);

  // Keep the address in sync unless the user is editing it (focus alone, e.g. restored focus, doesn't count).
  if (t && (document.activeElement !== els.address || !addressEdited)) {
    const q = extractSearchQuery(t.url, s.settings.searchEngine);
    els.address.value = q ?? (document.activeElement === els.address ? displayUrl(t.shownUrl ?? t.url) : shortUrl(t.shownUrl ?? t.url));
  }
  els.address.placeholder = isPrivate ? 'Search privately or enter address' : 'Search, ask Nebula, or enter address';

  // Rovian Defender indicator (inside the address bar)
  const si = els.siteInfo;
  si.className = 'site-info';
  let label = '';
  let siHtml: string;
  if (!t || !t.url || t.url.startsWith('nude://newtab')) { siHtml = isPrivate ? I.private : I.search; si.classList.toggle('private', isPrivate); }
  else if (t.security === 'blocked') { siHtml = I.shieldX; si.classList.add('danger'); label = 'Blocked'; }
  else if (t.secure === 'internal') siHtml = I.sparkle;
  else if (t.security === 'warning') { siHtml = I.warn; si.classList.add('insecure'); label = 'Careful'; }
  else if (t.secure === 'secure') { siHtml = I.shieldCheck; si.classList.add('secure'); }
  else if (t.secure === 'insecure') { siHtml = I.unlock; si.classList.add('insecure'); label = 'Not secure'; }
  else siHtml = I.info;
  const trackers = t && t.trackersBlocked && !label ? `<span class="n">${t.trackersBlocked > 99 ? '99+' : t.trackersBlocked}</span>` : '';
  setHtml(si, siHtml + (label ? `<span>${label}</span>` : '') + trackers);
  si.title = t && /^https?:/.test(t.url) ? `Rovian Defender — ${t.trackersBlocked} tracker${t.trackersBlocked === 1 ? '' : 's'} blocked on this page` : 'Rovian Defender';

  // Downloads progress ring
  const ring = els.downloads.querySelector<SVGElement>('.ring')!;
  const d = s.downloads;
  ring.toggleAttribute('hidden', d.active === 0);
  ring.classList.toggle('indeterminate', d.progress < 0);
  if (d.progress >= 0) ring.querySelector('circle')!.style.strokeDashoffset = String(94.25 * (1 - d.progress));
  els.downloads.querySelector<HTMLElement>('.dot')!.hidden = d.unseenCompleted === 0 || d.active > 0;
}

/** When you're not editing, the address bar shows just the site (calm); the full address appears on focus. */
function shortUrl(url: string) {
  if (!url || url.startsWith('nude://newtab')) return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.host.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname.replace(/\/$/, '').slice(0, 40) + (u.pathname.length > 41 ? '…' : '') : '');
  } catch { /* fall through */ }
  return displayUrl(url);
}

function renderBookmarks(s: WindowState) {
  els.bookmarksBar.hidden = !s.settings.showBookmarksBar;
  if (!s.settings.showBookmarksBar) return;
  setHtml(els.bookmarksBar, s.bookmarksBar.length
    ? s.bookmarksBar.map((b) => `<button class="bm" data-url="${esc(b.url)}" title="${esc(b.title)}\n${esc(b.url)}">${faviconImg(b.favicon)}<span>${esc(b.title)}</span></button>`).join('')
    : `<span class="bm-empty">Bookmark pages with the star (Ctrl+D) to see them here.</span>`);
}
els.bookmarksBar.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.bm');
  if (b) void invoke('openBookmark', b.dataset.url, e.ctrlKey || e.metaKey);
});
els.bookmarksBar.addEventListener('auxclick', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.bm');
  if (b && e.button === 1) void invoke('openBookmark', b.dataset.url, true);
});

const PERM_TEXT: Record<string, string> = {
  notifications: 'show notifications', geolocation: 'know your location', camera: 'use your camera', microphone: 'use your microphone',
  midi: 'use MIDI devices', 'clipboard-read': 'see your clipboard', 'display-capture': 'share your screen', openExternal: 'open an app on your computer',
  'idle-detection': 'know when you\'re idle', 'storage-access': 'use cookies across sites',
};

let lastBarsKey = '';
function renderBars(s: WindowState) {
  const key = JSON.stringify([s.permissionPrompt, s.downloadPrompt, s.find.open]);
  if (key !== lastBarsKey) {
    lastBarsKey = key;
    const html: string[] = [];
    const p = s.permissionPrompt;
    if (p) {
      let host = p.origin;
      try { host = new URL(p.origin).host; } catch { /* keep origin */ }
      const what = p.permissions.map((x) => PERM_TEXT[x] ?? x).join(' and ');
      html.push(`<div class="bar" data-bar="perm"><div class="bar-icon">${p.permissions.includes('camera') || p.permissions.includes('microphone') ? I.camera : p.permissions.includes('notifications') ? I.bell : I.info}</div>
        <div class="grow"><strong>${esc(host)}</strong> wants to ${esc(what)}${p.externalUrl ? ` <small>${esc(p.externalUrl.slice(0, 120))}</small>` : ''}</div>
        <label><input type="checkbox" id="perm-remember" ${p.permissions.includes('openExternal') ? '' : 'checked'}> Remember${isPrivate ? ' for this window' : ''}</label>
        <button class="btn" data-perm="block">Block</button><button class="btn primary" data-perm="allow">Allow</button></div>`);
    }
    const d = s.downloadPrompt;
    if (d) {
      html.push(`<div class="bar ${d.risk === 'high' || d.risk === 'dangerous' ? 'danger' : 'warn'}"><div class="bar-icon">${I.shield}</div>
        <div class="grow"><strong>Rovian Defender: ${esc(d.filename)} may be dangerous</strong><small>${esc(d.notes[0] ?? 'This type of file can harm your device.')}</small></div>
        <button class="btn" data-dl="discard">Discard</button><button class="btn" data-dl="keep">Keep anyway</button></div>`);
    }
    if (s.find.open) {
      html.push(`<div class="bar find-bar">${I.find}<input id="find-input" placeholder="Find in page" value="${esc(s.find.text)}" spellcheck="false">
        <span class="find-count" id="find-count"></span><div class="grow"></div>
        <button class="icon-btn small" id="find-prev" title="Previous (Shift+Enter)">${I.back}</button>
        <button class="icon-btn small" id="find-next" title="Next (Enter)">${I.forward}</button>
        <button class="icon-btn small" id="find-close" title="Close (Esc)">${I.close}</button></div>`);
    }
    els.bars.innerHTML = html.join('');
    const fi = document.getElementById('find-input') as HTMLInputElement | null;
    if (fi) {
      fi.addEventListener('input', () => invoke('findText', fi.value));
      fi.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void invoke('findNext', !e.shiftKey);
        if (e.key === 'Escape') void invoke('findClose');
      });
      $('find-prev').onclick = () => invoke('findNext', false);
      $('find-next').onclick = () => invoke('findNext', true);
      $('find-close').onclick = () => invoke('findClose');
    }
  }
  const fc = document.getElementById('find-count');
  if (fc) fc.textContent = s.find.text ? (s.find.matches ? `${s.find.activeMatch} of ${s.find.matches}` : 'No matches') : '';
}
els.bars.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const perm = t.closest<HTMLElement>('[data-perm]')?.dataset.perm;
  if (perm && state?.permissionPrompt) {
    const remember = (document.getElementById('perm-remember') as HTMLInputElement | null)?.checked ?? false;
    void invoke('permission', state.permissionPrompt.id, perm === 'allow', remember);
  }
  const dl = t.closest<HTMLElement>('[data-dl]')?.dataset.dl;
  if (dl && state?.downloadPrompt) void invoke('downloadDecision', state.downloadPrompt.id, dl === 'keep');
});

function renderPageState() {
  const t = active();
  const ps = els.pageState;
  if (!t || (!t.error && !t.crashed)) { ps.hidden = true; return; }
  const offline = t.error && [-106, -105, -21, -7, -118, -109].includes(t.error.code);
  const cert = t.error && t.error.code <= -200 && t.error.code > -300;
  const title = t.crashed ? 'This tab stopped working' : offline ? 'Can\'t reach this page' : cert ? 'Your connection isn\'t private' : 'This page couldn\'t load';
  const body = t.crashed ? 'Something went wrong while showing this page. Reloading usually fixes it.'
    : offline ? `Check your internet connection, or the address may be wrong: ${esc(displayUrl(t.error!.url))}`
      : cert ? 'Nude stopped the connection because the site\'s security certificate isn\'t valid. Someone could be trying to intercept your information. Nude doesn\'t let you bypass this.'
        : 'The site returned an error.';
  ps.innerHTML = `<div class="state-card"><div class="state-icon">${t.crashed ? I.crash : offline ? I.offline : cert ? I.shieldX : I.warn}</div>
    <h2>${title}</h2><p>${body}</p>${t.error ? `<code>${esc(t.error.description)} (${t.error.code})</code>` : ''}
    <button class="btn primary" id="retry">Try again</button></div>`;
  ps.hidden = false;
  $('retry').onclick = () => invoke('reload');
}

// ------------------------------------------------------------------ toolbar actions
els.back.onclick = () => invoke('back');
els.forward.onclick = () => invoke('forward');
els.reload.onclick = () => invoke(active()?.loading ? 'stop' : 'reload');
els.newTab.onclick = () => invoke('newTab');
els.star.onclick = () => invoke('toggleBookmark');
els.reader.onclick = () => invoke('reader');
els.bookmarks.onclick = () => showBookmarksMenu();
els.tabsBtn.onclick = () => void showSwitcher();
els.downloads.onclick = () => { void invoke('downloadsSeen'); void nebula.open('downloads'); };
els.siteInfo.onclick = () => showSiteInfo(els.siteInfo);
els.menu.onclick = () => showMenu();
els.ai.onclick = () => nebula.toggle();

/** Neon frame around the page while Nebula reads or changes it (the "dynamic gradients" reference). */
let nebulaTimer = 0;
export function setNebulaActive(on: boolean, minMs = 1400) {
  clearTimeout(nebulaTimer);
  if (on) {
    els.content.classList.add('nebula');
    els.ai.classList.add('thinking');
    if (minMs !== 1400) { nebulaTimer = window.setTimeout(() => { els.content.classList.remove('nebula'); els.ai.classList.remove('thinking'); }, minMs); }
  } else {
    nebulaTimer = window.setTimeout(() => { els.content.classList.remove('nebula'); els.ai.classList.remove('thinking'); }, minMs);
  }
}


/** Only touch the DOM when something changed: rewriting a button mid-click swallows the click. */
const lastHtml = new WeakMap<HTMLElement, string>();
function setHtml(el: HTMLElement, html: string) {
  if (lastHtml.get(el) === html) return;
  lastHtml.set(el, html);
  el.innerHTML = html;
}

function showBookmarksMenu() {
  void openOverlay(async (layer) => {
    const t = active();
    const p = popover(els.bookmarks, 'bm-menu', `<div class="menu-head">Bookmarks</div>
      ${t && /^https?:/.test(t.url) ? `<button class="menu-item" data-bm-toggle>${I.star}<span>${t.isBookmarked ? 'Remove this page' : 'Bookmark this page'}</span><span class="kbd">Ctrl+D</span></button><div class="menu-sep"></div>` : ''}
      ${(state?.bookmarksBar ?? []).slice(0, 14).map((b) => `<button class="menu-item" data-url="${esc(b.url)}" title="${esc(b.url)}">${faviconImg(b.favicon)}<span>${esc(b.title)}</span></button>`).join('') || '<div class="tiny" style="padding:6px 10px">No bookmarks yet.</div>'}
      <div class="menu-sep"></div>
      <button class="menu-item" data-bm-all>${I.bookmarks}<span>All bookmarks</span><span class="kbd">Ctrl+Shift+O</span></button>
      <button class="menu-item" data-bm-bar>${I.list}<span>${state?.settings.showBookmarksBar ? 'Hide' : 'Show'} bookmarks bar</span></button>`);
    p.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      const url = el.closest<HTMLElement>('[data-url]')?.dataset.url;
      if (url) { closeOverlay(); void invoke('openBookmark', url, e.ctrlKey || e.metaKey); return; }
      if (el.closest('[data-bm-toggle]')) { closeOverlay(); void invoke('toggleBookmark'); }
      if (el.closest('[data-bm-all]')) { closeOverlay(); void invoke('openInternal', 'bookmarks'); }
      if (el.closest('[data-bm-bar]')) { closeOverlay(); void invoke('shortcut', 'toggle-bookmarks-bar'); }
    });
    layer.appendChild(p);
  });
}

function avatarHtml(a: WindowState['account']) {
  if (!a) return { cls: 'avatar guest', html: I.user, style: '' };
  return { cls: 'avatar', html: a.photo ? `<img src="${esc(a.photo)}" alt="">` : esc(a.initials), style: a.photo ? '' : `background:${a.color}` };
}

// ------------------------------------------------------------------ omnibox
let suggestions: Suggestion[] = [];
let selected = -1;
let addressEdited = false;
let typed = '';
let suggestSeq = 0;
let suggestionsOpen = false;

els.address.addEventListener('focus', () => {
  addressEdited = false;
  els.omnibox.classList.add('focused');
  const t = active();
  if (t && !extractSearchQuery(t.url, state?.settings.searchEngine ?? 'duckduckgo')) els.address.value = displayUrl(t.shownUrl ?? t.url);
  // Select everything so typing replaces it — unless the user already started typing.
  els.address.select();
  requestAnimationFrame(() => { if (!addressEdited) els.address.select(); });
});
els.address.addEventListener('blur', () => {
  els.omnibox.classList.remove('focused');
  suggestSeq++; // discard suggestion responses still in flight
  setTimeout(() => { if (document.activeElement !== els.address && suggestionsOpen) closeOverlay(); }, 120);
  if (state) renderToolbar(state);
});
els.address.addEventListener('input', () => {
  addressEdited = true;
  typed = els.address.value;
  void updateSuggestions((window.event as InputEvent | undefined)?.inputType?.startsWith('delete') ?? false);
});
els.address.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!suggestions.length) return;
    e.preventDefault();
    selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length + 1) % (suggestions.length + 1) - 1;
    if (selected === -1) selected = e.key === 'ArrowDown' ? 0 : suggestions.length - 1;
    els.address.value = suggestions[selected].value;
    paintSuggestions();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    suggestSeq++; // a late suggestion response must not reopen the dropdown
    const s = selected >= 0 ? suggestions[selected] : null;
    const newTab = e.altKey || e.metaKey;
    if (s?.kind === 'ai') { closeOverlay(); els.address.blur(); nebula.ask(s.value, { page: false }); return; }
    if (s?.kind === 'tab' && s.tabId) void invoke('activate', s.tabId);
    else if (s?.kind === 'remote' || s?.kind === 'search') void invoke('navigate', `?${s.value}`, { newTab });
    else {
      let v = els.address.value;
      if (e.ctrlKey && !/[.:/\s]/.test(v)) v = `www.${v}.com`;
      void invoke('navigate', s ? s.value : v, { newTab });
    }
    closeOverlay();
    els.address.blur();
  } else if (e.key === 'Escape') {
    suggestSeq++;
    if (suggestionsOpen) closeOverlay();
    else { const a = active(); els.address.value = displayUrl(a?.shownUrl ?? a?.url ?? ''); els.address.select(); }
    if (!suggestionsOpen && document.activeElement === els.address) { els.address.blur(); void invoke('overlay', false); }
  }
});

async function updateSuggestions(deleting: boolean) {
  const q = typed;
  const seq = ++suggestSeq;
  if (!q.trim()) { if (suggestionsOpen) closeOverlay(); suggestions = []; return; }
  const remoteP = invoke<string[]>('suggestRemote', q).catch(() => [] as string[]);
  const r = await invoke<{ local: Suggestion[]; remote: string[]; inline: string | null; engine: string }>('suggest', q);
  if (seq !== suggestSeq || document.activeElement !== els.address) return;
  // Inline completion ("git" → "github.com"), never while deleting.
  if (r.inline && !deleting && els.address.value === q && els.address.selectionEnd === q.length) {
    els.address.value = r.inline;
    els.address.setSelectionRange(q.length, r.inline.length);
  }
  const looksUrl = /^[^\s]+\.[^\s]{2,}|^[a-z]+:\/\/|^localhost/i.test(q.trim());
  const top: Suggestion = looksUrl
    ? { kind: 'url', title: q.trim(), value: q.trim(), score: 1000 }
    : { kind: 'search', title: q.trim(), detail: `Search ${r.engine}`, value: q.trim(), score: 1000 };
  // Questions go to Nebula as well as to search.
  const question = !looksUrl && state?.aiEnabled && !isPrivate && (/\?$|^(what|why|how|who|when|where|which|is|are|can|should|explain|compare|summari[sz]e)\b/i.test(q.trim()) || q.trim().split(/\s+/).length >= 5);
  const ask: Suggestion[] = question ? [{ kind: 'ai', title: q.trim(), detail: 'Ask Nebula', value: q.trim(), score: 999 }] : [];
  const build = (remote: string[]) => {
    const rem: Suggestion[] = remote.filter((x) => x.toLowerCase() !== q.trim().toLowerCase()).slice(0, 4).map((x) => ({ kind: 'remote', title: x, value: x, score: 0 }));
    return [top, ...ask, ...r.local.slice(0, 5), ...rem].slice(0, 10);
  };
  suggestions = build([]);
  selected = -1;
  if (!suggestionsOpen) {
    suggestionsOpen = true;
    const opened = await openOverlay(() => {}, () => { suggestionsOpen = false; }, true);
    if (!opened) return;
    if (document.activeElement !== els.address) { closeOverlay(); return; }
    // Typing continued while the dropdown opened: show the newest list.
    if (seq !== suggestSeq) { paintSuggestions(); return; }
  }
  paintSuggestions();
  const remote = await remoteP;
  if (seq !== suggestSeq || !suggestionsOpen || !remote.length) return;
  const keep = selected >= 0 ? suggestions[selected]?.value : null;
  suggestions = build(remote);
  if (keep) selected = suggestions.findIndex((x) => x.value === keep);
  paintSuggestions();
}

function highlight(text: string, q: string) {
  const e = esc(text);
  const words = q.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return e;
  return e.replace(new RegExp(`(${words.map((w) => esc(w)).join('|')})`, 'gi'), '<mark>$1</mark>');
}

function paintSuggestions() {
  if (!suggestionsOpen) return;
  let box = els.overlay.querySelector<HTMLElement>('.suggestions');
  if (!box) {
    box = document.createElement('div');
    box.className = 'suggestions';
    const r = els.omnibox.getBoundingClientRect();
    box.style.left = `${r.left - 6}px`;
    box.style.width = `${r.width + 12}px`;
    box.style.top = `${r.bottom + 6}px`;
    box.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const i = (e.target as HTMLElement).closest<HTMLElement>('.sugg')?.dataset.i;
      if (i === undefined) return;
      selected = Number(i);
      els.address.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: e.button === 1 }));
    });
    els.overlay.appendChild(box);
  }
  const iconFor = (s: Suggestion) => s.kind === 'ai' ? '<span class="orb"></span>' : s.kind === 'search' || s.kind === 'remote' ? I.search : s.kind === 'history' ? (s.favicon ? faviconImg(s.favicon) : I.clock)
    : s.kind === 'bookmark' ? (s.favicon ? faviconImg(s.favicon, I.star) : I.star) : s.kind === 'tab' ? I.tab : I.globe;
  const tag = (s: Suggestion) => s.kind === 'bookmark' ? 'Bookmark' : s.kind === 'tab' ? 'Switch to tab' : s.kind === 'history' ? 'History' : '';
  box.innerHTML = suggestions.map((s, i) => `<div class="sugg${i === selected ? ' sel' : ''}${s.kind === 'ai' ? ' ai' : ''}" data-i="${i}"><span class="si">${iconFor(s)}</span>
    <span class="st">${s.kind === 'ai' ? `<b>Ask Nebula:</b> ${esc(s.title)}` : highlight(s.title, typed)}</span>${s.detail && (s.kind as string) !== 'ai' ? `<span class="sd">${esc(s.kind === 'search' ? s.detail : displayUrl(s.detail))}</span>` : ''}
    ${tag(s) ? `<span class="tag">${tag(s)}</span>` : ''}</div>`).join('');
}

// ------------------------------------------------------------------ menus & panels
async function showMenu() {
  await openOverlay((layer) => {
    const t = active();
    const zoom = Math.round(Math.pow(1.2, t?.zoom ?? 0) * 100);
    const k = (keys: string) => `<span class="kbd">${keys}</span>`;
    const a = state?.account ?? null;
    const av = avatarHtml(a);
    const theme = state?.theme ?? 'system';
    const mode = state?.mode ?? 'everyday';
    const p = popover(els.menu, 'main-menu', `
      ${isPrivate ? '<div class="menu-head">Private window</div>' : a
        ? `<button class="account-head menu-item" data-a="account"><span class="${av.cls}" style="${av.style}">${av.html}</span><span><b>${esc(a.name)}</b><span>${esc(a.email)}</span></span></button>`
        : `<button class="menu-item" data-a="signin">${I.user}<span>Sign in to Nude</span></button>`}
      <div class="menu-sep"></div>
      <button class="menu-item" data-a="newTab">${I.plus}<span>New tab</span>${k('Ctrl+T')}</button>
      <button class="menu-item" data-a="newWindow">${I.window}<span>New window</span>${k('Ctrl+N')}</button>
      <button class="menu-item" data-a="newPrivate">${I.private}<span>New private window</span>${k('Ctrl+Shift+N')}</button>
      ${state?.canReopenClosedTab ? `<button class="menu-item" data-a="reopen">${I.reopen}<span>Reopen closed tab</span>${k('Ctrl+Shift+T')}</button>` : ''}
      <div class="menu-sep"></div>
      <div class="menu-row"><span class="label">Zoom</span><button class="icon-btn small" data-a="zoomOut" aria-label="Zoom out">${I.minus}</button><span class="zoom-val">${zoom}%</span><button class="icon-btn small" data-a="zoomIn" aria-label="Zoom in">${I.plus}</button><button class="icon-btn small" data-a="fullscreen" title="Full screen (F11)" aria-label="Full screen">${I.fullscreen}</button></div>
      <div class="menu-row"><span class="label">Theme</span><div class="seg">
        <button data-theme="light" class="${theme === 'light' ? 'on' : ''}">${I.sun}Light</button><button data-theme="dark" class="${theme === 'dark' ? 'on' : ''}">${I.moon}Dark</button><button data-theme="system" class="${theme === 'system' ? 'on' : ''}">Auto</button></div></div>
      ${isPrivate ? '' : `<div class="menu-row"><span class="label">Mode</span><div class="seg">${Object.entries(MODES).map(([key, m]) => `<button data-mode="${key}" class="${key === mode ? 'on' : ''}" title="${esc(m.desc)}">${m.icon}</button>`).join('')}</div></div>`}
      <div class="menu-sep"></div>
      <button class="menu-item" data-a="history">${I.history}<span>History</span>${k('Ctrl+H')}</button>
      <button class="menu-item" data-a="downloads">${I.download}<span>Downloads</span>${k('Ctrl+J')}</button>
      <button class="menu-item" data-a="bookmarks">${I.bookmarks}<span>Bookmarks</span>${k('Ctrl+Shift+O')}</button>
      <button class="menu-item" data-a="security">${I.shield}<span>Rovian Defender</span></button>
      <div class="menu-sep"></div>
      <button class="menu-item" data-a="find">${I.find}<span>Find in page</span>${k('Ctrl+F')}</button>
      <button class="menu-item" data-a="print">${I.print}<span>Print…</span>${k('Ctrl+P')}</button>
      <button class="menu-item" data-a="shortcuts">${I.keyboard}<span>Keyboard shortcuts</span></button>
      <button class="menu-item" data-a="settings">${I.settings}<span>Settings</span>${k('Ctrl+,')}</button>`);
    p.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      const th = el.closest<HTMLElement>('[data-theme]')?.dataset.theme;
      if (th) { void invoke('setTheme', th); p.querySelectorAll('[data-theme]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.theme === th)); return; }
      const md = el.closest<HTMLElement>('[data-mode]')?.dataset.mode;
      if (md) { void invoke('setMode', md); p.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.mode === md)); toast(`${MODES[md].label} mode${md === 'shopping' ? ': Nebula compares products for you' : ''}`); return; }
      const act = el.closest<HTMLElement>('[data-a]')?.dataset.a;
      if (!act) return;
      if (act === 'zoomIn' || act === 'zoomOut') {
        void invoke('zoom', act === 'zoomIn' ? 1 : -1).then(() => setTimeout(() => {
          const z = p.querySelector('.zoom-val');
          const tt = active();
          if (z) z.textContent = `${Math.round(Math.pow(1.2, tt?.zoom ?? 0) * 100)}%`;
        }, 60));
        return;
      }
      closeOverlay();
      const map: Record<string, () => unknown> = {
        newTab: () => invoke('newTab'), newWindow: () => invoke('newWindow', false), newPrivate: () => invoke('newWindow', true),
        reopen: () => invoke('reopen'), fullscreen: () => invoke('fullscreen'), bookmarks: () => invoke('openInternal', 'bookmarks'),
        history: () => invoke('openInternal', 'history'), downloads: () => invoke('openInternal', 'downloads'),
        security: () => invoke('openInternal', 'security'), find: () => invoke('shortcut', 'find'),
        print: () => invoke('shortcut', 'print'), settings: () => invoke('openInternal', 'settings'), shortcuts: () => showShortcuts(),
        account: () => invoke('openInternal', 'account'), signin: () => invoke('openInternal', 'welcome'),
      };
      void map[act]?.();
    });
  });
}

function showShortcuts() {
  void openOverlay(() => {
    const p = popover(els.menu, '', `<div class="menu-head">Keyboard shortcuts</div>` + shortcuts.map((x) =>
      `<div class="menu-item"><span>${esc(x.label)}</span><span class="kbd">${esc(x.keys.replace(/Mod/g, navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl'))}</span></div>`).join(''));
    p.style.width = '360px';
  });
}

interface SiteInfo {
  url: string; origin: string; secure: boolean; internal: boolean; trackersBlocked: number;
  verdict: { action: string; confidence: string; category?: string; signals: string[] };
  permissions: { origin: string; permission: string; decision: string; label: string }[];
}

/** Rovian Defender's compact panel: connection, reputation, trackers, permissions. */
async function showSiteInfo(anchor: HTMLElement) {
  const info = await invoke<SiteInfo | null>('siteInfo');
  await openOverlay(() => {
    const t = active();
    if (!info || !t) return;
    let host = '';
    try { host = new URL(info.url).host; } catch { host = info.url; }
    const web = /^https?:/.test(info.url);
    const v = info.verdict;
    const row = (cls: string, icon: string, k: string, val: string, st: string) => `<div class="sp-row ${cls}">${icon}<span><span class="k">${k}</span><br><span class="v">${val}</span></span>${st ? `<span class="state">${st}</span>` : '<span></span>'}</div>`;
    const conn = info.internal ? row('ok', I.sparkle, 'Nude page', 'Built into the browser', 'Secure')
      : info.secure ? row('ok', I.lock, 'Connection', 'Encrypted (HTTPS)', 'Secure')
        : web ? row('warn', I.unlock, 'Connection', 'Not encrypted. Don\'t enter passwords or card details.', 'Not secure') : '';
    const rep = !web ? '' : t.security === 'blocked' ? row('danger', I.shieldX, 'Reputation', 'Rovian Defender blocked this site', 'Blocked')
      : v.action === 'allow' ? row('ok', I.shieldCheck, 'Reputation', 'No known threats. That isn\'t a guarantee.', 'Clear')
        : row(v.action === 'block' ? 'danger' : 'warn', I.warn, 'Reputation', v.confidence === 'confirmed' ? 'On a known-threat list' : 'Warning signs found', v.confidence === 'confirmed' ? 'Threat' : 'Careful');
    const trk = web ? row('ok', I.shield, 'Trackers', `${info.trackersBlocked} blocked on this page`, '') : '';
    const perms = info.permissions.length ? row('', I.sliders, 'Permissions', `${info.permissions.length} set for this site`, '') : '';
    const p = popover(anchor, 'site-panel', `
      <div class="sp-head"><img src="rovian-mark.svg" alt=""><div style="min-width:0"><h3>${esc(host || 'This page')}</h3><div class="brand"><b>Rovian</b>Defender</div></div></div>
      <div class="sp-rows">${conn}${rep}${trk}${perms}</div>
      ${v.action !== 'allow' && v.signals.length ? `<ul>${v.signals.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${info.permissions.map((x) => `<div class="perm-row"><span>${esc(x.label)}: <b>${x.decision === 'allow' ? 'Allowed' : 'Blocked'}</b></span><button class="btn" data-revoke="${esc(x.permission)}">Reset</button></div>`).join('')}
      <div class="sp-actions">${web && state?.aiEnabled ? `<button class="btn" data-x="ask">Ask Nebula if it's safe</button>` : ''}<button class="btn" data-x="security">Security details</button></div>`, 'left');
    p.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const rv = target.closest<HTMLElement>('[data-revoke]')?.dataset.revoke;
      if (rv) { void invoke('revokePermission', info.origin, rv); target.closest('.perm-row')?.remove(); return; }
      const x = target.closest<HTMLElement>('[data-x]')?.dataset.x;
      if (x === 'security') { closeOverlay(); void invoke('openInternal', 'security'); }
      if (x === 'ask') { closeOverlay(); setTimeout(() => nebula.ask('Is this website safe?', { page: false }), 60); }
    });
  });
}

/** The tab switcher: every tab as a preview, grouped by space, plus recently closed. */
async function showSwitcher() {
  const [thumbs, closed] = await Promise.all([invoke<Record<number, string>>('thumbnails'), invoke<ClosedTabInfo[]>('closedTabs').catch(() => [])]);
  await openOverlay((layer) => {
    const r = els.content.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = 'switcher matte';
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, right: `${innerWidth - r.right}px`, bottom: `${innerHeight - r.bottom}px` });
    const s = state!;
    const card = (t: TabState, i: number) => `<div class="sw-card${t.id === s.activeTabId ? ' active' : ''}" data-id="${t.id}" style="animation-delay:${Math.min(i, 14) * 22}ms">
      <div class="sw-thumb" ${thumbs[t.id] ? `style="background-image:url('${thumbs[t.id]}')"` : ''}>${thumbs[t.id] ? '' : faviconImg(t.favicon, I.globe)}</div>
      <div class="sw-meta">${faviconImg(t.favicon)}<span class="t">${esc(tabTitle(t))}</span><button class="icon-btn small" data-close="${t.id}" aria-label="Close tab">${I.close}</button></div></div>`;
    const groups = [{ id: '', name: s.groups.length ? 'Open tabs' : '', color: 'var(--text-3)', tabs: s.tabs.filter((t) => !t.groupId || !s.groups.some((g) => g.id === t.groupId)) },
      ...s.groups.map((g) => ({ id: g.id, name: g.name, color: g.color, tabs: s.tabs.filter((t) => t.groupId === g.id) }))].filter((g) => g.tabs.length);
    let n = 0;
    const paint = (q: string) => {
      const m = (t: TabState) => !q || t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q);
      n = 0;
      box.querySelector('.sw-body')!.innerHTML = groups.map((g) => {
        const list = g.tabs.filter(m);
        if (!list.length) return '';
        return `<div class="sw-group">${g.name ? `<div class="sw-group-head"><i style="background:${g.color}"></i>${esc(g.name)}<span>${list.length}</span></div>` : ''}
          <div class="sw-grid">${list.map((t) => card(t, n++)).join('')}</div></div>`;
      }).join('') + (closed.length && !q ? `<div class="sw-group"><div class="sw-group-head">${I.reopen.replace('<svg', '<svg style="width:15px;height:15px"')}Recently closed</div>
        <div class="sw-closed">${closed.slice(0, 8).map((c, i) => `<button data-reopen="${i}" title="${esc(c.url)}">${I.reopen}<span>${esc(c.title || c.url)}</span></button>`).join('')}</div></div>` : '');
    };
    box.innerHTML = `<div class="sw-head"><h2>${s.tabs.length} tab${s.tabs.length === 1 ? '' : 's'}</h2>
      <input class="sw-search" placeholder="Search tabs" aria-label="Search tabs">
      <button class="btn" data-spaces>${I.spaces.replace('<svg', '<svg style="width:15px;height:15px;display:inline;vertical-align:-3px;margin-right:6px"')}Spaces</button>
      <button class="btn primary" data-new>New tab</button></div><div class="sw-body"></div>`;
    paint('');
    const input = box.querySelector<HTMLInputElement>('.sw-search')!;
    input.addEventListener('input', () => paint(input.value.toLowerCase().trim()));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = box.querySelector<HTMLElement>('.sw-card'); if (first) { closeOverlay(); void invoke('activate', Number(first.dataset.id)); } }
    });
    box.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const close = target.closest<HTMLElement>('[data-close]')?.dataset.close;
      if (close) {
        void invoke('close', Number(close));
        const c = target.closest<HTMLElement>('.sw-card')!;
        c.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.9)' }], { duration: 160, easing: 'ease-in' }).onfinish = () => c.remove();
        return;
      }
      const ro = target.closest<HTMLElement>('[data-reopen]')?.dataset.reopen;
      if (ro !== undefined) { closeOverlay(); void invoke('reopenClosedAt', Number(ro)); return; }
      if (target.closest('[data-new]')) { closeOverlay(); void invoke('newTab'); return; }
      if (target.closest('[data-spaces]')) { closeOverlay(); setTimeout(() => void nebula.open('spaces'), 30); return; }
      const c = target.closest<HTMLElement>('.sw-card');
      if (c) { closeOverlay(); void invoke('activate', Number(c.dataset.id)); }
    });
    layer.appendChild(box);
    requestAnimationFrame(() => input.focus());
  }, undefined, true, true);
}

// ------------------------------------------------------------------ Nebula
const nebula = new Nebula({
  getState: () => state,
  toast,
  setActivity: (on, minMs) => setNebulaActive(on, minMs),
  openLayer: (build, onClose) => openOverlay(build, onClose, true, true),
  closeLayer: () => closeOverlay(),
  contentRect: () => els.content.getBoundingClientRect(),
  button: els.ai,
  onToggle: () => { if (state) renderToolbar(state); },
});

// ------------------------------------------------------------------ commands from main
nude.onCommand((c) => {
  switch (c.type) {
    case 'focus-omnibox': closeOverlay(); els.address.focus(); els.address.select(); break;
    case 'open-find': requestAnimationFrame(() => { const f = document.getElementById('find-input') as HTMLInputElement | null; f?.focus(); f?.select(); }); break;
    case 'open-menu': void showMenu(); break;
    case 'toast': toast(c.message); break;
    case 'toggle-ai': nebula.toggle(); break;
    case 'ai-prompt': nebula.ask(c.prompt, c.context); break;
    case 'toggle-overview': void showSwitcher(); break;
    case 'nebula-activity': setNebulaActive(c.active); break;
  }
});
nude.onState((s) => render(s as WindowState));

// UI-local shortcuts (main process handles the rest, including when a page has focus).
document.addEventListener('keydown', (e) => {
  if (e.key === 'F6' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l')) { e.preventDefault(); els.address.focus(); els.address.select(); }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); nebula.toggle(); }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === ' ') { e.preventDefault(); void showSwitcher(); }
});

void invoke<{ shortcuts: typeof shortcuts }>('ready').then((r) => { shortcuts = r.shortcuts; });
