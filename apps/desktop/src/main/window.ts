// One browser window: the Nude UI (the window's own webContents) plus one WebContentsView per tab.
import {
  BrowserWindow, Menu, clipboard, nativeTheme, screen, shell, type Session, type WebContents, type MenuItemConstructorOptions,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { Tab, type TabOptions } from './tab';
import { CHROME_HTML, CHROME_PRELOAD } from './paths';
import type { NudeApp } from './app';
import type { ChromeCommand, ContentBounds, FindState, WindowState } from '../shared/types';
import { NEW_TAB_URL, resolveInput, searchUrl } from '../shared/omnibox';
import { matchShortcut, type ShortcutCommand } from '../shared/shortcuts';
import type { SavedWindow } from './profile';

const IGNORED_LOAD_ERRORS = new Set([-3 /* ABORTED */, -20 /* BLOCKED_BY_CLIENT (Nude Security) */]);

export class BrowserWindowController {
  readonly win: BrowserWindow;
  readonly tabs: Tab[] = [];
  activeTabId: number | null = null;
  split: WindowState['split'] = null;
  private contentBounds: ContentBounds = { x: 0, y: 88, width: 800, height: 600 };
  private overlayOpen = false;
  private find: FindState = { open: false, text: '', activeMatch: 0, matches: 0 };
  private htmlFullscreen = false;
  private stateTimer: NodeJS.Timeout | null = null;
  private uiReady = false;
  readonly partitionKey: string | null;

  constructor(readonly app: NudeApp, readonly session: Session, readonly isPrivate: boolean, saved?: SavedWindow, partitionKey?: string) {
    this.partitionKey = partitionKey ?? null;
    const dark = nativeTheme.shouldUseDarkColors;
    const display = screen.getPrimaryDisplay().workArea;
    const bounds = saved?.bounds ?? { width: Math.min(1360, display.width), height: Math.min(880, display.height) };
    this.win = new BrowserWindow({
      ...bounds,
      minWidth: 420,
      minHeight: 320,
      show: false,
      title: isPrivate ? 'Nude — Private' : 'Nude',
      backgroundColor: isPrivate ? '#16121f' : dark ? '#111214' : '#f4f3f1',
      titleBarStyle: 'hidden',
      ...(process.platform === 'darwin'
        ? { trafficLightPosition: { x: 14, y: 14 } }
        : { titleBarOverlay: this.overlayColors() }),
      webPreferences: {
        preload: CHROME_PRELOAD,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    if (saved?.maximized) this.win.maximize();
    void this.win.loadFile(CHROME_HTML, { query: { private: isPrivate ? '1' : '0' } });
    this.win.webContents.on('before-input-event', (e, input) => this.handleInput(e, input, false));
    this.win.webContents.on('will-navigate', (e) => e.preventDefault()); // the UI never navigates
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.win.once('ready-to-show', () => this.win.show());
    this.win.on('focus', () => this.app.setLastFocused(this));
    this.win.on('enter-full-screen', () => this.pushState());
    this.win.on('leave-full-screen', () => { this.htmlFullscreen = false; this.pushState(); this.layout(); });
    this.win.on('maximize', () => this.pushState());
    this.win.on('unmaximize', () => this.pushState());
    this.win.on('resize', () => this.app.saveSessionSoon());
    this.win.on('move', () => this.app.saveSessionSoon());
    this.win.on('close', () => this.app.beforeWindowClose(this));
    this.win.on('closed', () => this.app.windowClosed(this));

    if (saved?.tabs.length) {
      saved.tabs.forEach((t, i) => this.addTab({ url: t.url, title: t.title, favicon: t.favicon, pinned: t.pinned, lazy: i !== saved.activeIndex }, i === saved.activeIndex));
      if (this.activeTabId === null) this.activate(this.tabs[0].id);
    }
  }

  overlayColors() {
    const dark = nativeTheme.shouldUseDarkColors || this.isPrivate;
    return { color: '#00000000', symbolColor: dark ? '#e9e7f0' : '#26252b', height: 44 };
  }

  refreshTheme() {
    if (process.platform !== 'darwin') {
      try {
        this.win.setTitleBarOverlay(this.overlayColors());
      } catch { /* not supported on this platform */ }
    }
    this.pushState();
  }

  // ---------------------------------------------------------------- tabs
  get activeTab(): Tab | undefined {
    return this.tabs.find((t) => t.id === this.activeTabId);
  }

  tabById(id: number) {
    return this.tabs.find((t) => t.id === id);
  }

  addTab(opts: TabOptions & { index?: number }, activate = true): Tab {
    const tab = new Tab(this, opts);
    this.wireTab(tab);
    const pinnedCount = this.tabs.filter((t) => t.pinned).length;
    let index = opts.index ?? this.tabs.length;
    if (!tab.pinned) index = Math.max(index, pinnedCount);
    this.tabs.splice(index, 0, tab);
    this.win.contentView.addChildView(tab.view);
    tab.view.setVisible(false);
    if (activate || this.activeTabId === null) this.activate(tab.id);
    else this.pushState();
    this.app.saveSessionSoon();
    return tab;
  }

  newTab(url = NEW_TAB_URL, activate = true, openerIndex?: number) {
    const index = openerIndex !== undefined ? this.nextIndexAfterOpener(openerIndex) : undefined;
    const tab = this.addTab({ url, index }, activate);
    if (activate && url === NEW_TAB_URL) this.sendCommand({ type: 'focus-omnibox' });
    return tab;
  }

  private nextIndexAfterOpener(openerIndex: number) {
    return openerIndex + 1;
  }

  activate(id: number) {
    const tab = this.tabById(id);
    if (!tab) return;
    const prev = this.activeTab;
    if (prev && prev !== tab) void prev.captureThumbnail();
    this.activeTabId = id;
    if (this.split && id !== this.split.leftId && id !== this.split.rightId) this.split = null;
    tab.ensureLoaded();
    if (this.find.open) this.closeFind();
    this.layout();
    if (!this.overlayOpen) tab.wc.focus();
    this.pushState();
  }

  closeTab(id: number) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const tab = this.tabs[i];
    if (!this.isPrivate && tab.url && tab.url !== NEW_TAB_URL) this.app.rememberClosed(tab.url, tab.title, i);
    this.tabs.splice(i, 1);
    this.app.permissions.cancelForTab(id);
    this.app.security.forgetTab(id);
    if (this.split && (this.split.leftId === id || this.split.rightId === id)) this.split = null;
    this.win.contentView.removeChildView(tab.view);
    tab.destroy();
    if (this.tabs.length === 0) {
      this.win.close();
      return;
    }
    if (this.activeTabId === id) this.activate(this.tabs[Math.min(i, this.tabs.length - 1)].id);
    else this.pushState();
    this.app.saveSessionSoon();
  }

  moveTab(id: number, toIndex: number) {
    const from = this.tabs.findIndex((t) => t.id === id);
    if (from < 0) return;
    const [tab] = this.tabs.splice(from, 1);
    const pinnedCount = this.tabs.filter((t) => t.pinned).length;
    const clamped = tab.pinned ? Math.min(toIndex, pinnedCount) : Math.max(pinnedCount, Math.min(toIndex, this.tabs.length));
    this.tabs.splice(clamped, 0, tab);
    this.pushState();
    this.app.saveSessionSoon();
  }

  setPinned(id: number, pinned: boolean) {
    const tab = this.tabById(id);
    if (!tab) return;
    tab.pinned = pinned;
    const others = this.tabs.filter((t) => t !== tab);
    const pinnedCount = others.filter((t) => t.pinned).length;
    others.splice(pinned ? pinnedCount : pinnedCount, 0, tab);
    this.tabs.splice(0, this.tabs.length, ...others);
    this.pushState();
    this.app.saveSessionSoon();
  }

  duplicate(id: number) {
    const tab = this.tabById(id);
    if (tab) this.addTab({ url: tab.url, index: this.tabs.indexOf(tab) + 1 });
  }

  closeOthers(id: number) {
    for (const t of [...this.tabs]) if (t.id !== id && !t.pinned) this.closeTab(t.id);
  }

  closeToRight(id: number) {
    const i = this.tabs.findIndex((t) => t.id === id);
    for (const t of this.tabs.slice(i + 1)) this.closeTab(t.id);
  }

  toggleMute(id: number) {
    const t = this.tabById(id);
    if (t) {
      t.wc.setAudioMuted(!t.wc.isAudioMuted());
      this.pushState();
    }
  }

  // ---------------------------------------------------------------- split view
  toggleSplit() {
    if (this.split) {
      this.split = null;
    } else {
      const active = this.activeTab;
      if (!active) return;
      const others = this.tabs.filter((t) => t !== active);
      const right = others[this.tabs.indexOf(active)] ?? others[others.length - 1] ?? this.addTab({ url: NEW_TAB_URL }, false);
      right.ensureLoaded();
      this.split = { leftId: active.id, rightId: right.id, ratio: 0.5 };
    }
    this.layout();
    this.pushState();
  }

  setSplitRatio(ratio: number) {
    if (!this.split) return;
    this.split.ratio = Math.max(0.2, Math.min(0.8, ratio));
    this.layout();
  }

  // ---------------------------------------------------------------- layout
  setContentBounds(b: ContentBounds) {
    this.contentBounds = {
      x: Math.round(b.x), y: Math.round(b.y), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)),
    };
    this.layout();
  }

  layout() {
    const visible = new Set<number>();
    const full = this.htmlFullscreen;
    const area = full ? { x: 0, y: 0, ...this.sizeOf() } : this.contentBounds;
    if (this.split && !full) {
      const gap = 8;
      const leftW = Math.round((area.width - gap) * this.split.ratio);
      const l = this.tabById(this.split.leftId);
      const r = this.tabById(this.split.rightId);
      if (l && r) {
        l.view.setBounds({ x: area.x, y: area.y, width: leftW, height: area.height });
        r.view.setBounds({ x: area.x + leftW + gap, y: area.y, width: area.width - leftW - gap, height: area.height });
        visible.add(l.id).add(r.id);
      }
    } else if (this.activeTab) {
      this.activeTab.view.setBounds(area);
      this.activeTab.view.setBorderRadius(full ? 0 : 12);
      visible.add(this.activeTab.id);
    }
    for (const t of this.tabs) t.view.setVisible(!this.overlayOpen && visible.has(t.id) && (Boolean(this.split) || (!t.error && !t.crashed)));
  }

  private sizeOf() {
    const [width, height] = this.win.getContentSize();
    return { width, height };
  }

  /** Overlays (menus, suggestions) can't draw over native views, so the UI shows a snapshot instead. */
  async setOverlay(open: boolean): Promise<string | null> {
    let snapshot: string | null = null;
    if (open && !this.overlayOpen && this.activeTab && !this.split) {
      try {
        const img = await this.activeTab.wc.capturePage();
        snapshot = img.isEmpty() ? null : img.toDataURL();
      } catch { /* ignore */ }
    }
    this.overlayOpen = open;
    this.layout();
    if (!open) this.activeTab?.wc.focus();
    return snapshot;
  }

  // ---------------------------------------------------------------- navigation
  navigate(input: string, opts: { newTab?: boolean; background?: boolean } = {}) {
    const engine = this.app.profile.settings.get().searchEngine;
    const r = resolveInput(input, engine);
    if (!r) return;
    if (r.type === 'blocked') {
      this.sendCommand({ type: 'toast', message: r.reason });
      return;
    }
    if (opts.newTab || !this.activeTab) {
      this.addTab({ url: r.url }, !opts.background);
    } else {
      void this.activeTab.load(r.url, true);
      this.activeTab.wc.focus();
    }
  }

  loadInActive(url: string) {
    if (this.activeTab) void this.activeTab.load(url);
    else this.addTab({ url });
  }

  runShortcut(cmd: ShortcutCommand) {
    const tab = this.activeTab;
    const wc = tab?.wc;
    switch (cmd) {
      case 'new-tab': this.newTab(); break;
      case 'close-tab': if (tab) this.closeTab(tab.id); break;
      case 'reopen-tab': this.app.reopenClosed(this); break;
      case 'new-window': this.app.createWindow(false); break;
      case 'new-private-window': this.app.createWindow(true); break;
      case 'close-window': this.win.close(); break;
      case 'focus-omnibox': this.sendCommand({ type: 'focus-omnibox' }); break;
      case 'reload': wc?.reload(); break;
      case 'hard-reload': wc?.reloadIgnoringCache(); break;
      case 'stop': wc?.stop(); break;
      case 'back': if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
      case 'forward': if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
      case 'home': this.loadInActive(this.app.profile.settings.get().homepage || NEW_TAB_URL); break;
      case 'next-tab': case 'prev-tab': {
        if (!tab || this.tabs.length < 2) break;
        const i = this.tabs.indexOf(tab);
        const n = this.tabs.length;
        this.activate(this.tabs[(i + (cmd === 'next-tab' ? 1 : -1) + n) % n].id);
        break;
      }
      case 'last-tab': if (this.tabs.length) this.activate(this.tabs[this.tabs.length - 1].id); break;
      case 'bookmark': if (tab && /^https?:/.test(tab.url)) {
        const added = this.app.profile.toggleBookmark(tab.url, tab.title, tab.favicon);
        this.sendCommand({ type: 'toast', message: added ? 'Bookmark added' : 'Bookmark removed' });
      } break;
      case 'history': this.openInternal('history'); break;
      case 'downloads': this.openInternal('downloads'); this.app.downloads.markSeen(); break;
      case 'bookmarks': this.openInternal('bookmarks'); break;
      case 'settings': this.openInternal('settings'); break;
      case 'toggle-bookmarks-bar': {
        const s = this.app.profile.settings.get();
        this.app.profile.updateSettings({ showBookmarksBar: !s.showBookmarksBar });
        break;
      }
      case 'find': this.openFind(); break;
      case 'find-next': this.findNext(true); break;
      case 'find-prev': this.findNext(false); break;
      case 'escape':
        if (this.find.open) this.closeFind();
        else if (this.win.isFullScreen() && !this.htmlFullscreen) this.win.setFullScreen(false);
        else wc?.stop();
        break;
      case 'zoom-in': this.zoom(+0.5); break;
      case 'zoom-out': this.zoom(-0.5); break;
      case 'zoom-reset': if (wc) { wc.setZoomLevel(this.app.profile.settings.get().defaultZoom); this.pushState(); } break;
      case 'fullscreen': this.win.setFullScreen(!this.win.isFullScreen()); break;
      case 'print': wc?.print(); break;
      case 'devtools': wc?.toggleDevTools(); break;
      case 'view-source': if (tab && /^https?:/.test(tab.url)) this.addTab({ url: `view-source:${tab.url}` }); break;
      case 'clear-data': this.openInternal('settings', '#privacy'); break;
    }
  }

  openInternal(page: string, hash = '') {
    const url = `nude://${page}${hash}`;
    const existing = this.tabs.find((t) => t.url.startsWith(`nude://${page}`));
    if (existing) {
      this.activate(existing.id);
      if (hash) void existing.load(url);
      return;
    }
    const tab = this.activeTab;
    if (tab && (tab.url === NEW_TAB_URL || tab.url === '')) void tab.load(url);
    else this.addTab({ url });
  }

  zoom(delta: number) {
    const wc = this.activeTab?.wc;
    if (!wc) return;
    wc.setZoomLevel(Math.max(-3, Math.min(5, wc.getZoomLevel() + delta)));
    this.pushState();
  }

  // ---------------------------------------------------------------- find in page
  openFind() {
    this.find = { ...this.find, open: true };
    this.pushState();
    this.sendCommand({ type: 'open-find' });
  }

  findText(text: string) {
    const wc = this.activeTab?.wc;
    this.find.text = text;
    if (!wc) return;
    if (!text) {
      wc.stopFindInPage('clearSelection');
      this.find = { ...this.find, activeMatch: 0, matches: 0 };
      this.pushState();
      return;
    }
    wc.findInPage(text, { findNext: true });
  }

  findNext(forward: boolean) {
    if (!this.find.open) return this.openFind();
    if (this.find.text) this.activeTab?.wc.findInPage(this.find.text, { forward, findNext: false });
  }

  closeFind() {
    this.activeTab?.wc.stopFindInPage('keepSelection');
    this.find = { open: false, text: this.find.text, activeMatch: 0, matches: 0 };
    this.pushState();
    this.activeTab?.wc.focus();
  }

  // ---------------------------------------------------------------- reader mode
  async openReader() {
    const tab = this.activeTab;
    if (!tab) return;
    const id = await this.app.reader.extract(tab.wc);
    if (!id) {
      this.sendCommand({ type: 'toast', message: 'Reader view isn\'t available for this page.' });
      return;
    }
    void tab.load(`nude://reader?id=${id}`);
  }

  // ---------------------------------------------------------------- tab wiring
  private wireTab(tab: Tab) {
    const wc = tab.wc;
    const changed = () => this.pushState();
    wc.setZoomLevel(this.app.profile.settings.get().defaultZoom);

    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (!/^(https?|about|data):/i.test(url) && url !== 'about:blank') {
        if (/^(mailto|tel|sms|zoommtg|msteams|spotify|steam|magnet):/i.test(url)) void shell.openExternal(url);
        return { action: 'deny' };
      }
      const background = disposition === 'background-tab';
      return {
        action: 'allow',
        outlivesOpener: true,
        createWindow: (options) => {
          const child = this.addTab({ openerOptions: options, index: this.tabs.indexOf(tab) + 1 }, !background);
          return child.wc;
        },
      };
    });

    // Web content can never reach nude:// pages.
    wc.on('will-navigate', (e, url) => {
      if (url.startsWith('nude:') && !wc.getURL().startsWith('nude:')) e.preventDefault();
    });
    wc.on('will-frame-navigate', (e) => {
      if (!e.isMainFrame && e.url.startsWith('nude:')) e.preventDefault();
    });
    wc.on('will-redirect', (e, url) => {
      if (url.startsWith('nude:')) e.preventDefault();
    });

    wc.on('did-start-loading', changed);
    wc.on('did-stop-loading', () => {
      changed();
      void tab.probeReader().then(changed);
      if (tab.id === this.activeTabId) void tab.captureThumbnail();
    });
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        if (tab.error || tab.crashed) setImmediate(() => this.layout());
        tab.error = undefined;
        tab.crashed = false;
        tab.readerAvailable = false;
        tab.trackersBlocked = 0;
        this.app.permissions.cancelForTab(tab.id);
      }
    });
    wc.on('did-navigate', (_e, url) => {
      tab.favicon = undefined;
      if (!url.startsWith('nude://blocked')) tab.security = this.app.security.check(url).action === 'allow' ? 'safe' : 'warning';
      else tab.security = 'blocked';
      if (!this.isPrivate) this.app.profile.recordVisit(url, wc.getTitle(), tab.typedNavigation);
      tab.typedNavigation = false;
      changed();
      this.app.saveSessionSoon();
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame && !this.isPrivate) this.app.profile.recordVisit(url, wc.getTitle());
      changed();
      this.app.saveSessionSoon();
    });
    wc.on('page-title-updated', (_e, title) => {
      tab.title = title;
      if (!this.isPrivate) this.app.profile.updateHistoryMeta(wc.getURL(), { title });
      changed();
      this.app.saveSessionSoon();
    });
    wc.on('page-favicon-updated', (_e, favicons) => {
      const icon = favicons.find((f) => /^(https?|data):/.test(f));
      tab.favicon = icon;
      if (icon && !this.isPrivate) this.app.profile.updateHistoryMeta(wc.getURL(), { favicon: icon });
      changed();
    });
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (!isMainFrame || IGNORED_LOAD_ERRORS.has(code)) return;
      tab.error = { code, description, url };
      this.layout();
      changed();
    });
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return;
      tab.crashed = true;
      this.layout();
      changed();
    });
    wc.on('audio-state-changed', changed);
    wc.on('zoom-changed', (_e, dir) => this.zoom(dir === 'in' ? 0.5 : -0.5));
    wc.on('found-in-page', (_e, r) => {
      if (tab.id !== this.activeTabId) return;
      this.find = { ...this.find, activeMatch: r.activeMatchOrdinal, matches: r.matches };
      changed();
    });
    wc.on('enter-html-full-screen', () => {
      this.htmlFullscreen = true;
      this.win.setFullScreen(true);
      this.layout();
      changed();
    });
    wc.on('leave-html-full-screen', () => {
      this.htmlFullscreen = false;
      this.win.setFullScreen(false);
      this.layout();
      changed();
    });
    wc.on('before-input-event', (e, input) => this.handleInput(e, input, true));
    wc.on('context-menu', (_e, params) => this.showContextMenu(tab, params));
    wc.on('focus', () => {
      if (this.split && tab.id !== this.activeTabId) {
        this.activeTabId = tab.id;
        changed();
      }
    });
    wc.on('destroyed', () => {
      if (!tab.closing && this.tabs.includes(tab)) this.closeTab(tab.id);
    });
    // window.close() from a page script (allowed for tabs the page opened).
    wc.on('close' as never, () => this.closeTab(tab.id));
  }

  private handleInput(e: Electron.Event, input: Electron.Input, fromPage: boolean) {
    const cmd = matchShortcut(input, process.platform);
    if (!cmd) return;
    if (cmd === 'escape') {
      if (fromPage && !this.find.open && !(this.win.isFullScreen() && !this.htmlFullscreen)) return; // let the page handle Esc
    }
    // In the UI, plain F6/Escape etc. are handled by the UI itself.
    if (!fromPage && (cmd === 'escape')) return;
    e.preventDefault();
    this.runShortcut(cmd);
  }

  private showContextMenu(tab: Tab, p: Electron.ContextMenuParams) {
    const items: MenuItemConstructorOptions[] = [];
    const engine = this.app.profile.settings.get().searchEngine;
    if (p.linkURL && /^https?:/.test(p.linkURL)) {
      items.push(
        { label: 'Open Link in New Tab', click: () => this.addTab({ url: p.linkURL, index: this.tabs.indexOf(tab) + 1 }, false) },
        { label: 'Open Link in New Window', click: () => this.app.createWindow(this.isPrivate, p.linkURL) },
        { label: 'Open Link in Private Window', click: () => this.app.createWindow(true, p.linkURL) },
        { label: 'Copy Link Address', click: () => clipboard.writeText(p.linkURL) },
        { type: 'separator' },
      );
    }
    if (p.hasImageContents && p.srcURL && /^(https?|data):/.test(p.srcURL)) {
      items.push(
        { label: 'Open Image in New Tab', click: () => this.addTab({ url: p.srcURL }, false) },
        { label: 'Save Image As…', click: () => tab.wc.downloadURL(p.srcURL) },
        { label: 'Copy Image', click: () => tab.wc.copyImageAt(p.x, p.y) },
        { label: 'Copy Image Address', click: () => clipboard.writeText(p.srcURL) },
        { type: 'separator' },
      );
    }
    if (p.selectionText.trim()) {
      const sel = p.selectionText.trim();
      const short = sel.length > 30 ? sel.slice(0, 30) + '…' : sel;
      items.push(
        { label: 'Copy', role: 'copy' },
        { label: `Search for "${short}"`, click: () => this.addTab({ url: searchUrl(engine, sel), index: this.tabs.indexOf(tab) + 1 }) },
        { label: 'Ask Nude AI to Explain', click: () => this.sendCommand({ type: 'ai-prompt', prompt: 'Explain the selected text in simple terms.', context: { selection: true } }) },
        { type: 'separator' },
      );
    }
    if (p.isEditable) {
      items.push(
        { label: 'Undo', role: 'undo', enabled: p.editFlags.canUndo }, { label: 'Redo', role: 'redo', enabled: p.editFlags.canRedo },
        { type: 'separator' },
        { label: 'Cut', role: 'cut', enabled: p.editFlags.canCut }, { label: 'Copy', role: 'copy', enabled: p.editFlags.canCopy },
        { label: 'Paste', role: 'paste', enabled: p.editFlags.canPaste }, { label: 'Select All', role: 'selectAll' },
        { type: 'separator' },
      );
      for (const s of p.dictionarySuggestions.slice(0, 4)) items.unshift({ label: s, click: () => tab.wc.replaceMisspelling(s) });
    }
    if (!p.linkURL && !p.selectionText && !p.isEditable && !p.hasImageContents) {
      items.push(
        { label: 'Back', enabled: tab.wc.navigationHistory.canGoBack(), click: () => tab.wc.navigationHistory.goBack() },
        { label: 'Forward', enabled: tab.wc.navigationHistory.canGoForward(), click: () => tab.wc.navigationHistory.goForward() },
        { label: 'Reload', click: () => tab.wc.reload() },
        { type: 'separator' },
        { label: 'Save Page As…', click: () => tab.wc.downloadURL(tab.wc.getURL()) },
        { label: 'Print…', click: () => tab.wc.print() },
        { label: 'Summarise Page with Nude AI', click: () => this.sendCommand({ type: 'ai-prompt', prompt: 'Summarise this page in five key points.', context: { page: true } }) },
        { label: 'View Page Source', enabled: /^https?:/.test(tab.url), click: () => this.addTab({ url: `view-source:${tab.url}` }) },
        { type: 'separator' },
      );
    }
    items.push({ label: 'Inspect', click: () => tab.wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup({ window: this.win });
  }

  // ---------------------------------------------------------------- state → UI
  sendCommand(cmd: ChromeCommand) {
    if (!this.win.isDestroyed()) this.win.webContents.send('chrome:command', cmd);
  }

  setUiReady() {
    this.uiReady = true;
    if (this.tabs.length === 0) this.newTab();
    this.pushState();
  }

  pushState() {
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      if (this.win.isDestroyed() || !this.uiReady) return;
      this.win.webContents.send('chrome:state', this.state());
    }, 16);
  }

  state(): WindowState {
    const p = this.app.profile;
    const s = p.settings.get();
    const active = this.activeTab;
    return {
      windowId: this.win.id,
      private: this.isPrivate,
      tabs: this.tabs.map((t) => t.state(false, Boolean(p.findBookmark(t.url)))),
      activeTabId: this.activeTabId,
      bookmarksBar: p.bookmarks.get().filter((b) => b.folder === '').slice(0, 60),
      settings: { theme: s.theme, showHomeButton: s.showHomeButton, showBookmarksBar: s.showBookmarksBar, reduceMotion: s.reduceMotion, searchEngine: s.searchEngine },
      downloads: this.app.downloads.summary(this.isPrivate),
      permissionPrompt: active ? this.app.permissions.promptForTab(active.id) : null,
      find: this.find,
      fullscreen: this.win.isFullScreen(),
      htmlFullscreen: this.htmlFullscreen,
      maximized: this.win.isMaximized(),
      platform: process.platform,
      canReopenClosedTab: !this.isPrivate && this.app.hasClosedTabs(),
      groups: [],
      split: this.split,
      passwordPrompt: null,
      downloadPrompt: this.app.downloadPromptFor(this),
      protectionLevel: s.protectionLevel,
      toolbar: s.toolbar,
      aiEnabled: s.aiEnabled,
      accentColor: s.accentColor || this.app.systemAccent(),
    };
  }

  thumbnails(): Record<number, string> {
    const out: Record<number, string> = {};
    for (const t of this.tabs) if (t.thumbnail) out[t.id] = t.thumbnail;
    return out;
  }

  saved(): SavedWindow {
    const normal = this.win.isMaximized() || this.win.isFullScreen() ? this.win.getNormalBounds() : this.win.getBounds();
    const tabs = this.tabs.filter((t) => t.url && !t.url.startsWith('nude://blocked') && !t.url.startsWith('nude://reader'));
    return {
      bounds: normal,
      maximized: this.win.isMaximized(),
      tabs: tabs.map((t) => ({ url: t.url, title: t.title, pinned: t.pinned, favicon: t.favicon })),
      activeIndex: Math.max(0, tabs.findIndex((t) => t.id === this.activeTabId)),
    };
  }

  newId() {
    return randomUUID();
  }

  /** Called for webContents not owned by this window (devtools etc.) */
  owns(wc: WebContents) {
    return this.tabs.some((t) => t.wc === wc);
  }
}
