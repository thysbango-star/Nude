// Nude browser UI. A pure view of WindowState pushed by the main process.
import type { ChromeCommand, Suggestion, TabState, WindowState } from '../../shared/types';
import { displayUrl, extractSearchQuery, NEW_TAB_URL } from '../../shared/omnibox';
import { I, esc, faviconImg, installFaviconFallback } from './icons';
import { AiPanel } from './ai-panel';

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
  back: $<HTMLButtonElement>('back'), forward: $<HTMLButtonElement>('forward'), reload: $('reload'), home: $('home'),
  star: $('star'), reader: $('reader'), split: $('split'), overview: $('overview'), shield: $('shield'), downloads: $('downloads'),
  ai: $('ai-btn'), menu: $('menu'), bookmarksBar: $('bookmarks-bar'), bars: $('bars'), content: $('content'),
  snapshot: $<HTMLImageElement>('snapshot'), overlay: $('overlay'), toast: $('toast'), pageState: $('page-state'),
  splitHandle: $('split-handle'), newTab: $('new-tab'), main: $('main'),
};

// ------------------------------------------------------------------ static icons
els.back.innerHTML = I.back; els.forward.innerHTML = I.forward; els.reload.innerHTML = I.reload; els.home.innerHTML = I.home;
els.star.innerHTML = I.star; els.reader.innerHTML = I.reader; els.split.innerHTML = I.split; els.overview.innerHTML = I.grid;
els.shield.insertAdjacentHTML('afterbegin', I.shield); els.downloads.insertAdjacentHTML('afterbegin', I.download);
els.ai.innerHTML = `${I.sparkle}<span>Nude AI</span>`; els.menu.innerHTML = I.menu; els.newTab.innerHTML = I.plus;
document.documentElement.classList.add(navigator.userAgent.includes('Mac') ? 'darwin' : 'other');

const active = (): TabState | undefined => state?.tabs.find((t) => t.id === state!.activeTabId);

// ------------------------------------------------------------------ content bounds → main process
function reportBounds() {
  const r = els.content.getBoundingClientRect();
  void invoke('bounds', { x: r.left, y: r.top, width: r.width, height: r.height });
  positionSplitHandle();
}
new ResizeObserver(reportBounds).observe(els.content);
window.addEventListener('resize', reportBounds);

// ------------------------------------------------------------------ overlay (menus, suggestions, overview)
let overlayCloser: (() => void) | null = null;
async function openOverlay(build: (layer: HTMLElement) => void, onClose?: () => void, useSnapshot = true) {
  closeOverlay();
  const snap = useSnapshot ? await invoke<string | null>('overlay', true) : (await invoke('overlay', true), null);
  if (snap) { els.snapshot.src = snap; els.snapshot.hidden = false; }
  els.overlay.hidden = false;
  els.overlay.innerHTML = '';
  build(els.overlay);
  overlayCloser = () => {
    els.overlay.hidden = true;
    els.overlay.innerHTML = '';
    els.snapshot.hidden = true;
    els.snapshot.removeAttribute('src');
    onClose?.();
    void invoke('overlay', false);
  };
}
function closeOverlay() {
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
  const hideChrome = s.htmlFullscreen;
  for (const el of [$('titlebar'), $('toolbar'), els.bookmarksBar, els.bars]) el.style.display = hideChrome ? 'none' : '';
  renderTabs(s);
  renderToolbar(s);
  renderBookmarks(s);
  renderBars(s);
  renderPageState();
  positionSplitHandle();
  if (!prev || prev.activeTabId !== s.activeTabId) aiPanel.onTabChanged();
  document.title = active()?.title ? `${active()!.title} — Nude` : 'Nude';
  requestAnimationFrame(reportBounds);
}

function tabHtml(t: TabState, s: WindowState) {
  const inSplit = s.split && (s.split.leftId === t.id || s.split.rightId === t.id);
  const icon = t.loading ? '<div class="spinner"></div>' : t.crashed ? I.crash : t.security === 'blocked' ? I.shieldX : faviconImg(t.favicon, t.url.startsWith('nude:') ? I.sparkle : I.globe);
  const audio = t.audible || t.muted ? `<button class="tab-audio" data-act="mute" title="${t.muted ? 'Unmute' : 'Mute'} tab">${t.muted ? I.muted : I.volume}</button>` : '';
  return `<div class="tab${t.id === s.activeTabId ? ' active' : ''}${t.pinned ? ' pinned' : ''}${inSplit ? ' in-split' : ''}" role="tab" draggable="true"
    data-id="${t.id}" aria-selected="${t.id === s.activeTabId}" title="${esc(t.title || t.url)}">
    <span class="tab-icon">${icon}</span><span class="tab-title">${esc(tabTitle(t))}</span>${audio}
    <button class="tab-close" data-act="close" aria-label="Close tab">${I.close}</button></div>`;
}

function tabTitle(t: TabState) {
  if (!t.url || t.url.startsWith('nude://newtab')) return 'New Tab';
  return t.title || displayUrl(t.url);
}

let lastTabsKey = '';
function renderTabs(s: WindowState) {
  const key = JSON.stringify([s.tabs.map((t) => [t.id, t.title, t.favicon, t.loading, t.audible, t.muted, t.pinned, t.crashed, t.security, t.url]), s.activeTabId, s.split]);
  if (key === lastTabsKey) return;
  lastTabsKey = key;
  els.tabstrip.innerHTML = s.tabs.map((t) => tabHtml(t, s)).join('');
  const width = els.tabstrip.parentElement!.clientWidth - 200;
  const per = Math.max(40, Math.min(220, width / Math.max(1, s.tabs.length)));
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
      [I.split, state?.split ? 'Exit split view' : 'Open in split view', () => { void invoke('activate', t.id); void invoke('split'); }],
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
  els.reload.innerHTML = t?.loading ? I.stop : I.reload;
  els.reload.title = t?.loading ? 'Stop' : 'Reload (Ctrl+R)';
  els.home.hidden = !s.settings.showHomeButton || !s.toolbar.includes('home');
  els.star.classList.toggle('on', Boolean(t?.isBookmarked));
  els.star.hidden = !t || !/^https?:/.test(t.url);
  els.reader.hidden = !t?.readerAvailable || !s.toolbar.includes('reader');
  els.split.hidden = !s.toolbar.includes('split');
  els.split.classList.toggle('on', Boolean(s.split));
  els.overview.hidden = !s.toolbar.includes('overview');
  els.ai.hidden = !s.aiEnabled || !s.toolbar.includes('ai');
  els.shield.hidden = !s.toolbar.includes('security');
  els.downloads.hidden = !s.toolbar.includes('downloads') && s.downloads.active === 0;

  if (document.activeElement !== els.address && t) {
    const q = extractSearchQuery(t.url, s.settings.searchEngine);
    els.address.value = q ?? displayUrl(t.url);
  }
  els.address.placeholder = isPrivate ? 'Search privately or enter address' : 'Search or enter address';

  // Site info chip
  const si = els.siteInfo;
  si.className = 'site-info';
  let label = '';
  if (!t || !t.url || t.url.startsWith('nude://newtab')) si.innerHTML = isPrivate ? I.private : I.search, si.classList.toggle('private', isPrivate);
  else if (t.security === 'blocked') { si.innerHTML = I.shieldX; si.classList.add('danger'); label = 'Blocked'; }
  else if (t.secure === 'internal') si.innerHTML = I.sparkle;
  else if (t.secure === 'secure') si.innerHTML = t.security === 'warning' ? I.warn : I.lock;
  else if (t.secure === 'insecure') { si.innerHTML = I.unlock; si.classList.add('insecure'); label = 'Not secure'; }
  else si.innerHTML = I.info;
  if (t?.security === 'warning') si.classList.add('insecure');
  if (label) si.insertAdjacentHTML('beforeend', `<span>${label}</span>`);

  // Shield
  const badge = els.shield.querySelector<HTMLElement>('.badge')!;
  badge.hidden = !t?.trackersBlocked;
  badge.textContent = t && t.trackersBlocked > 99 ? '99+' : String(t?.trackersBlocked ?? '');
  els.shield.classList.toggle('danger', t?.security === 'blocked');
  els.shield.title = `Nude Security — ${t?.trackersBlocked ?? 0} trackers blocked on this page`;

  // Downloads progress ring
  const ring = els.downloads.querySelector<SVGElement>('.ring')!;
  const d = s.downloads;
  ring.toggleAttribute('hidden', d.active === 0);
  ring.classList.toggle('indeterminate', d.progress < 0);
  if (d.progress >= 0) ring.querySelector('circle')!.style.strokeDashoffset = String(94.25 * (1 - d.progress));
  els.downloads.querySelector<HTMLElement>('.dot')!.hidden = d.unseenCompleted === 0 || d.active > 0;
}

function renderBookmarks(s: WindowState) {
  els.bookmarksBar.hidden = !s.settings.showBookmarksBar;
  if (!s.settings.showBookmarksBar) return;
  els.bookmarksBar.innerHTML = s.bookmarksBar.length
    ? s.bookmarksBar.map((b) => `<button class="bm" data-url="${esc(b.url)}" title="${esc(b.title)}\n${esc(b.url)}">${faviconImg(b.favicon)}<span>${esc(b.title)}</span></button>`).join('')
    : `<span class="bm-empty">Bookmark pages with the star (Ctrl+D) to see them here.</span>`;
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
        <div class="grow"><strong>Nude Security: ${esc(d.filename)} may be dangerous</strong><small>${esc(d.notes[0] ?? 'This type of file can harm your device.')}</small></div>
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
  if (!t || (!t.error && !t.crashed) || state?.split) { ps.hidden = true; return; }
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

function positionSplitHandle() {
  const s = state?.split;
  els.splitHandle.hidden = !s || overlayCloser !== null;
  if (!s) return;
  const w = els.content.clientWidth;
  els.splitHandle.style.left = `${Math.round((w - 8) * s.ratio)}px`;
}
els.splitHandle.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const r = els.content.getBoundingClientRect();
  const move = (ev: MouseEvent) => {
    void invoke('splitRatio', (ev.clientX - r.left) / r.width);
    if (state?.split) { state.split.ratio = Math.max(0.2, Math.min(0.8, (ev.clientX - r.left) / r.width)); positionSplitHandle(); }
  };
  const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
  addEventListener('mousemove', move);
  addEventListener('mouseup', up);
});

// ------------------------------------------------------------------ toolbar actions
els.back.onclick = () => invoke('back');
els.forward.onclick = () => invoke('forward');
els.reload.onclick = () => invoke(active()?.loading ? 'stop' : 'reload');
els.home.onclick = () => invoke('shortcut', 'home');
els.newTab.onclick = () => invoke('newTab');
els.star.onclick = () => invoke('toggleBookmark');
els.reader.onclick = () => invoke('reader');
els.split.onclick = () => invoke('split');
els.downloads.onclick = () => { void invoke('downloadsSeen'); void invoke('openInternal', 'downloads'); };
els.shield.onclick = () => showSiteInfo(els.shield);
els.siteInfo.onclick = () => showSiteInfo(els.siteInfo);
els.menu.onclick = () => showMenu();
els.overview.onclick = () => showOverview();
els.ai.onclick = () => aiPanel.toggle();

// ------------------------------------------------------------------ omnibox
let suggestions: Suggestion[] = [];
let selected = -1;
let typed = '';
let suggestSeq = 0;
let suggestionsOpen = false;

els.address.addEventListener('focus', () => {
  els.omnibox.classList.add('focused');
  requestAnimationFrame(() => els.address.select());
});
els.address.addEventListener('blur', () => {
  els.omnibox.classList.remove('focused');
  setTimeout(() => { if (document.activeElement !== els.address && suggestionsOpen) closeOverlay(); }, 120);
  if (state) renderToolbar(state);
});
els.address.addEventListener('input', () => {
  typed = els.address.value;
  void updateSuggestions((window.event as InputEvent | undefined)?.inputType?.startsWith('delete') ?? false);
});
els.address.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!suggestions.length) return;
    e.preventDefault();
    selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length + 1) % (suggestions.length + 1) - 1;
    if (selected === -1) selected = e.key === 'ArrowDown' ? 0 : suggestions.length - 1;
    els.address.value = suggestions[selected].kind === 'search' || suggestions[selected].kind === 'remote' ? suggestions[selected].value : suggestions[selected].value;
    paintSuggestions();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const s = selected >= 0 ? suggestions[selected] : null;
    const newTab = e.altKey || e.metaKey;
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
    if (suggestionsOpen) closeOverlay();
    else { els.address.value = displayUrl(active()?.url ?? ''); els.address.select(); }
    if (!suggestionsOpen && document.activeElement === els.address) { els.address.blur(); void invoke('overlay', false); }
  }
});

async function updateSuggestions(deleting: boolean) {
  const q = typed;
  const seq = ++suggestSeq;
  if (!q.trim()) { if (suggestionsOpen) closeOverlay(); suggestions = []; return; }
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
  const remote: Suggestion[] = r.remote.filter((x) => x.toLowerCase() !== q.trim().toLowerCase()).slice(0, 4).map((x) => ({ kind: 'remote', title: x, value: x, score: 0 }));
  suggestions = [top, ...r.local.slice(0, 5), ...remote].slice(0, 10);
  selected = -1;
  if (!suggestionsOpen) {
    suggestionsOpen = true;
    await openOverlay(() => {}, () => { suggestionsOpen = false; }, true);
    els.address.focus();
  }
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
    box.style.left = `${r.left}px`;
    box.style.width = `${r.width}px`;
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
  const iconFor = (s: Suggestion) => s.kind === 'search' || s.kind === 'remote' ? I.search : s.kind === 'history' ? (s.favicon ? faviconImg(s.favicon) : I.clock)
    : s.kind === 'bookmark' ? (s.favicon ? faviconImg(s.favicon, I.star) : I.star) : s.kind === 'tab' ? I.tab : I.globe;
  const tag = (s: Suggestion) => s.kind === 'bookmark' ? 'Bookmark' : s.kind === 'tab' ? 'Switch to tab' : s.kind === 'history' ? 'History' : '';
  box.innerHTML = suggestions.map((s, i) => `<div class="sugg${i === selected ? ' sel' : ''}" data-i="${i}"><span class="si">${iconFor(s)}</span>
    <span class="st">${highlight(s.title, typed)}</span>${s.detail ? `<span class="sd">${esc(s.kind === 'search' ? s.detail : displayUrl(s.detail))}</span>` : ''}
    ${tag(s) ? `<span class="tag">${tag(s)}</span>` : ''}</div>`).join('');
}

// ------------------------------------------------------------------ menus & panels
async function showMenu() {
  await openOverlay((layer) => {
    const t = active();
    const zoom = Math.round(Math.pow(1.2, t?.zoom ?? 0) * 100);
    const k = (keys: string) => `<span class="kbd">${keys}</span>`;
    const p = popover(els.menu, 'main-menu', `
      <button class="menu-item" data-a="newTab">${I.plus}<span>New tab</span>${k('Ctrl+T')}</button>
      <button class="menu-item" data-a="newWindow">${I.window}<span>New window</span>${k('Ctrl+N')}</button>
      <button class="menu-item" data-a="newPrivate">${I.private}<span>New private window</span>${k('Ctrl+Shift+N')}</button>
      ${state?.canReopenClosedTab ? `<button class="menu-item" data-a="reopen">${I.reopen}<span>Reopen closed tab</span>${k('Ctrl+Shift+T')}</button>` : ''}
      <div class="menu-sep"></div>
      <div class="menu-row"><span class="label">Zoom</span><button class="icon-btn small" data-a="zoomOut">${I.minus}</button><span class="zoom-val">${zoom}%</span><button class="icon-btn small" data-a="zoomIn">${I.plus}</button><button class="icon-btn small" data-a="fullscreen" title="Full screen (F11)">${I.fullscreen}</button></div>
      <div class="menu-sep"></div>
      <button class="menu-item" data-a="bookmarks">${I.bookmarks}<span>Bookmarks</span>${k('Ctrl+Shift+O')}</button>
      <button class="menu-item" data-a="history">${I.history}<span>History</span>${k('Ctrl+H')}</button>
      <button class="menu-item" data-a="downloads">${I.download}<span>Downloads</span>${k('Ctrl+J')}</button>
      <button class="menu-item" data-a="security">${I.shield}<span>Nude Security</span></button>
      <div class="menu-sep"></div>
      <button class="menu-item" data-a="find">${I.find}<span>Find in page</span>${k('Ctrl+F')}</button>
      <button class="menu-item" data-a="reader">${I.reader}<span>Reader view</span></button>
      <button class="menu-item" data-a="print">${I.print}<span>Print…</span>${k('Ctrl+P')}</button>
      <div class="menu-sep"></div>
      <button class="menu-item" data-a="shortcuts">${I.keyboard}<span>Keyboard shortcuts</span></button>
      <button class="menu-item" data-a="settings">${I.settings}<span>Settings</span>${k('Ctrl+,')}</button>`);
    p.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (!a) return;
      const keepOpen = a === 'zoomIn' || a === 'zoomOut';
      if (keepOpen) {
        void invoke('zoom', a === 'zoomIn' ? 1 : -1).then(() => setTimeout(() => { closeOverlay(); void showMenu(); }, 40));
        return;
      }
      closeOverlay();
      const map: Record<string, () => unknown> = {
        newTab: () => invoke('newTab'), newWindow: () => invoke('newWindow', false), newPrivate: () => invoke('newWindow', true),
        reopen: () => invoke('reopen'), fullscreen: () => invoke('fullscreen'), bookmarks: () => invoke('openInternal', 'bookmarks'),
        history: () => invoke('openInternal', 'history'), downloads: () => invoke('openInternal', 'downloads'),
        security: () => invoke('openInternal', 'security'), find: () => invoke('shortcut', 'find'), reader: () => invoke('reader'),
        print: () => invoke('shortcut', 'print'), settings: () => invoke('openInternal', 'settings'), shortcuts: () => showShortcuts(),
      };
      void map[a]?.();
    });
  });
}

function showShortcuts() {
  void openOverlay((layer) => {
    popover(els.menu, '', `<div style="padding:8px 10px 4px;font-weight:600">Keyboard shortcuts</div>` + shortcuts.map((s) =>
      `<div class="menu-item"><span>${esc(s.label)}</span><span class="kbd">${esc(s.keys.replace(/Mod/g, navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl'))}</span></div>`).join(''));
    layer.querySelector('.popover')!.setAttribute('style', layer.querySelector('.popover')!.getAttribute('style') + ';width:360px');
  });
}

interface SiteInfo {
  url: string; origin: string; secure: boolean; internal: boolean; trackersBlocked: number;
  verdict: { action: string; confidence: string; category?: string; signals: string[] };
  permissions: { origin: string; permission: string; decision: string; label: string }[];
}

async function showSiteInfo(anchor: HTMLElement) {
  const info = await invoke<SiteInfo | null>('siteInfo');
  await openOverlay((layer) => {
    const t = active();
    if (!info || !t) return;
    let host = '';
    try { host = new URL(info.url).host; } catch { host = info.url; }
    const v = info.verdict;
    const conn = info.internal ? `<div class="status-row ok">${I.sparkle}<span>This is a secure Nude page.</span></div>`
      : info.secure ? `<div class="status-row ok">${I.lock}<span>Connection is encrypted (HTTPS).</span></div>`
        : /^http:/.test(info.url) ? `<div class="status-row warn">${I.unlock}<span>Connection is <b>not</b> encrypted. Don't enter passwords or card details.</span></div>` : '';
    const threat = t.security === 'blocked' ? `<div class="status-row danger">${I.shieldX}<span>Nude Security blocked this site.</span></div>`
      : v.action === 'allow' ? (/^https?:/.test(info.url) ? `<div class="status-row ok">${I.shieldCheck}<span>No known threats. That isn't a guarantee — stay alert.</span></div>` : '')
        : `<div class="status-row ${v.action === 'block' ? 'danger' : 'warn'}">${I.warn}<span>${v.confidence === 'confirmed' ? 'Known threat' : 'Warning signs found'}:</span></div><ul>${v.signals.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`;
    const perms = info.permissions.length ? `<div class="menu-sep"></div><div class="tiny" style="margin:6px 0 2px">Permissions for this site</div>` +
      info.permissions.map((p) => `<div class="perm-row"><span>${esc(p.label)} — <b>${p.decision === 'allow' ? 'Allowed' : 'Blocked'}</b></span><button class="btn" data-revoke="${esc(p.permission)}">Reset</button></div>`).join('') : '';
    const p = popover(anchor, 'site-panel', `<h3>${esc(host || 'This page')}</h3><div class="tiny">${esc(info.url.slice(0, 200))}</div>
      ${conn}${threat}
      ${/^https?:/.test(info.url) ? `<div class="status-row">${I.shield}<span><b>${info.trackersBlocked}</b> tracker${info.trackersBlocked === 1 ? '' : 's'} blocked on this page</span></div>` : ''}
      ${perms}
      <div class="menu-sep"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn" data-x="ask">${'Ask Nude AI: is this safe?'}</button>
        <button class="btn" data-x="security">Security dashboard</button>
      </div>`, anchor === els.siteInfo ? 'left' : 'right');
    p.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const rv = target.closest<HTMLElement>('[data-revoke]')?.dataset.revoke;
      if (rv) { void invoke('revokePermission', info.origin, rv); target.closest('.perm-row')?.remove(); return; }
      const x = target.closest<HTMLElement>('[data-x]')?.dataset.x;
      if (x === 'security') { closeOverlay(); void invoke('openInternal', 'security'); }
      if (x === 'ask') { closeOverlay(); aiPanel.ask('Is this website safe?', { page: false }); }
    });
  });
}

async function showOverview() {
  const thumbs = await invoke<Record<number, string>>('thumbnails');
  await openOverlay((layer) => {
    const r = els.content.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = 'overview';
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const tabs = state?.tabs ?? [];
    box.innerHTML = `<div class="overview-head"><h2>${tabs.length} tab${tabs.length === 1 ? '' : 's'}</h2><button class="btn primary" data-new>${'New tab'}</button></div>
      <div class="overview-grid">${tabs.map((t, i) => `<div class="ov-card${t.id === state?.activeTabId ? ' active' : ''}" data-id="${t.id}" style="animation-delay:${Math.min(i, 12) * 18}ms">
        <div class="ov-thumb" ${thumbs[t.id] ? `style="background-image:url('${thumbs[t.id]}')"` : ''}>${thumbs[t.id] ? '' : I.globe}</div>
        <div class="ov-meta">${faviconImg(t.favicon)}<span class="t">${esc(tabTitle(t))}</span><button class="icon-btn small" data-close="${t.id}" aria-label="Close">${I.close}</button></div></div>`).join('')}</div>`;
    box.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const close = target.closest<HTMLElement>('[data-close]')?.dataset.close;
      if (close) { void invoke('close', Number(close)); target.closest('.ov-card')?.remove(); return; }
      if (target.closest('[data-new]')) { closeOverlay(); void invoke('newTab'); return; }
      const card = target.closest<HTMLElement>('.ov-card');
      if (card) { closeOverlay(); void invoke('activate', Number(card.dataset.id)); }
    });
    layer.appendChild(box);
  }, undefined, false);
}

// ------------------------------------------------------------------ AI panel
const aiPanel = new AiPanel($('ai-panel'), els.ai, els.main, () => state, toast);

// ------------------------------------------------------------------ commands from main
nude.onCommand((c) => {
  switch (c.type) {
    case 'focus-omnibox': closeOverlay(); els.address.focus(); els.address.select(); break;
    case 'open-find': requestAnimationFrame(() => { const f = document.getElementById('find-input') as HTMLInputElement | null; f?.focus(); f?.select(); }); break;
    case 'open-menu': void showMenu(); break;
    case 'toast': toast(c.message); break;
    case 'toggle-ai': aiPanel.toggle(); break;
    case 'ai-prompt': aiPanel.ask(c.prompt, c.context); break;
    case 'toggle-overview': void showOverview(); break;
  }
});
nude.onState((s) => render(s as WindowState));

// UI-local shortcuts (main process handles the rest, including when a page has focus).
document.addEventListener('keydown', (e) => {
  if (e.key === 'F6' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l')) { e.preventDefault(); els.address.focus(); els.address.select(); }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); aiPanel.toggle(); }
});

void invoke<{ shortcuts: typeof shortcuts }>('ready').then((r) => { shortcuts = r.shortcuts; });
