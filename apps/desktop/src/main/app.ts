// Application controller: windows, sessions, the nude:// protocol, IPC and session restore.
import {
  app, ipcMain, nativeTheme, session, shell, systemPreferences, dialog, net,
  type IpcMainInvokeEvent, type Session, type WebContents,
} from 'electron';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Profile } from './profile';
import { PermissionManager, PERMISSION_LABELS } from './permissions';
import { DownloadManager } from './downloads';
import { SecurityService } from './security';
import { ReaderStore } from './reader';
import { AiBridge, type AiRequest } from './ai';
import { Accounts } from './accounts';
import { BrowserWindowController } from './window';
import { PAGES_DIR } from './paths';
import { configureNudeSearch, NEW_TAB_URL, SEARCH_ENGINES, searchUrl } from '../shared/omnibox';
import { rankLocalSuggestions, inlineCompletion, parseRemoteSuggestions } from '../shared/suggest';
import { SHORTCUT_HELP } from '../shared/shortcuts';
import { PROTECTION_LEVELS, isPrivateIP, CATEGORY_INFO, type UrlVerdict } from '@nude/security-engine';
import type { ClearDataOptions, InternalEvent, ContentBounds, DownloadPrompt } from '../shared/types';

const PERSIST_PARTITION = 'persist:nude';
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

interface ClosedTab { url: string; title: string; index: number }

export class NudeApp {
  readonly profile: Profile;
  readonly permissions: PermissionManager;
  readonly downloads: DownloadManager;
  readonly security: SecurityService;
  readonly reader = new ReaderStore();
  readonly ai: AiBridge;
  readonly accounts: Accounts;
  readonly windows: BrowserWindowController[] = [];
  private lastFocused: BrowserWindowController | null = null;
  private closed: ClosedTab[] = [];
  private blockedPages = new Map<string, { url: string; verdict: UrlVerdict; tabId: number }>();
  private downloadPrompts = new Map<string, DownloadPrompt & { windowId: number }>();
  private sessionTimer: NodeJS.Timeout | null = null;
  private quitting = false;
  private persistSession!: Session;

  constructor() {
    const dir = app.getPath('userData');
    this.profile = new Profile(dir);
    this.permissions = new PermissionManager(this.profile, {
      tabFor: (wc) => {
        for (const w of this.windows) {
          const t = w.tabs.find((x) => x.wc === wc);
          if (t) return { id: t.id, private: w.isPrivate, isActive: () => w.activeTabId === t.id, showPrompt: () => w.pushState() };
        }
        return null;
      },
    });
    this.downloads = new DownloadManager(this.profile);
    this.security = new SecurityService(this.profile, dir, {
      onMainFrame: (wc, url) => this.checkNavigation(wc, url),
      onAdFrameBlocked: (wc, frameUrl, html) => {
        const found = wc && this.findTab(wc);
        if (!found) return;
        const run = () => void ReaderStore.replaceAdFrame(found.tab.wc, frameUrl, html).catch(() => {});
        // The frame element may not be in the DOM yet; try now and again once the page has loaded.
        setTimeout(run, 30);
        found.tab.wc.once('did-finish-load', run);
      },
      onTrackerBlocked: (wc) => {
        const found = wc && this.findTab(wc);
        if (found) {
          found.tab.trackersBlocked++;
          found.win.pushState();
        }
      },
      firstPartyHost: (wc) => {
        try {
          return wc && !wc.isDestroyed() ? new URL(wc.getURL()).hostname || null : null;
        } catch {
          return null;
        }
      },
    });
    this.ai = new AiBridge(this);
    this.accounts = new Accounts(dir);
    this.accounts.onChange = () => {
      for (const w of this.windows) w.pushState();
      this.broadcast({ topic: 'account' });
    };
    this.downloads.onChange = () => {
      for (const w of this.windows) w.pushState();
      this.broadcast({ topic: 'downloads' });
    };
    this.downloads.security = {
      check: (filename, mime, url, pageUrl) => {
        const v = this.security.checkDownload(filename, mime, url, pageUrl);
        return { action: v.action, risk: v.risk, notes: v.signals.map((s) => s.message) };
      },
      inspect: (path, filename) => this.security.inspectFile(path, filename),
      prompt: (id, wc, info) => {
        const w = this.windowFor(wc);
        if (!w) return;
        this.downloadPrompts.set(id, { id, ...info, windowId: w.win.id });
        w.pushState();
      },
      flagged: (d, notes) => {
        this.security.log({ type: 'download-flagged', url: d.url, detail: `${d.filename}: ${notes[0]}` });
        for (const w of this.windows) w.sendCommand({ type: 'toast', message: `Rovian Defender: ${d.filename} looks dangerous — don't open it.` });
      },
      blocked: (d, wc) => {
        this.windowFor(wc)?.sendCommand({ type: 'toast', message: `Rovian Defender blocked a dangerous download: ${d.filename}` });
      },
    };
    this.profile.on('changed', (e: InternalEvent) => this.onProfileChanged(e));
  }

  // ------------------------------------------------------------------ startup
  async start() {
    configureNudeSearch(this.profile.settings.get().searchServerUrl);
    nativeTheme.themeSource = this.profile.settings.get().theme;
    nativeTheme.on('updated', () => this.windows.forEach((w) => w.refreshTheme()));
    this.persistSession = session.fromPartition(PERSIST_PARTITION);
    this.setupSession(this.persistSession, false, null);
    this.registerIpc();
    void this.security.updateLists();

    const saved = this.profile.session.get();
    const settings = this.profile.settings.get();
    const urls = process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => /^https?:\/\//i.test(a));
    if (this.accounts.needsWelcome()) {
      // First run: sign in or create a Nude account (or continue without one).
      this.createWindow(false, 'nude://welcome/');
    } else if (settings.startup === 'restore' && saved.windows.length) {
      for (const w of saved.windows) this.createWindow(false, undefined, w);
    } else {
      this.createWindow(false, settings.startup === 'homepage' ? settings.homepage : undefined);
    }
    if (urls.length) for (const u of urls) this.lastFocused?.addTab({ url: u });
    this.profile.session.set({ windows: saved.windows, cleanExit: false });
  }

  setupSession(ses: Session, isPrivate: boolean, partitionKey: string | null) {
    ses.protocol.handle('nude', (req) => this.serveInternal(req.url));
    this.permissions.attach(ses, partitionKey);
    this.downloads.attach(ses, isPrivate);
    this.security.attach(ses);
    ses.setUserAgent(ses.getUserAgent().replace(/\s?Electron\/\S+/, '').replace(/\s?nude\/\S+/i, ''));
    ses.setSpellCheckerLanguages(['en-US']);
    // No silent bypass of certificate errors: Chromium's default rejects them.
    ses.setCertificateVerifyProc((_req, cb) => cb(-3));
  }

  createWindow(isPrivate: boolean, url?: string, saved?: import('./profile').SavedWindow): BrowserWindowController {
    let ses = this.persistSession;
    let key: string | null = null;
    if (isPrivate) {
      key = `nude-private-${randomUUID()}`;
      ses = session.fromPartition(key); // no "persist:" prefix → in memory only
      this.setupSession(ses, true, key);
    }
    const w = new BrowserWindowController(this, ses, isPrivate, saved, key ?? undefined);
    this.windows.push(w);
    this.lastFocused = w;
    if (url) w.addTab({ url });
    return w;
  }

  setLastFocused(w: BrowserWindowController) {
    this.lastFocused = w;
  }

  beforeWindowClose(w: BrowserWindowController) {
    if (!this.quitting && !w.isPrivate) {
      const remainingNormal = this.windows.filter((x) => x !== w && !x.isPrivate);
      if (remainingNormal.length === 0) this.saveSessionNow(); // keep the last window for restore
      else this.saveSessionSoon();
    }
  }

  windowClosed(w: BrowserWindowController) {
    const i = this.windows.indexOf(w);
    if (i >= 0) this.windows.splice(i, 1);
    if (this.lastFocused === w) this.lastFocused = this.windows[this.windows.length - 1] ?? null;
    if (w.isPrivate && w.partitionKey) {
      // Wipe everything from the private session.
      void w.session.clearStorageData();
      void w.session.clearCache();
      this.permissions.forgetPrivate(w.partitionKey);
      if (!this.windows.some((x) => x.isPrivate)) this.downloads.clearPrivate();
    }
  }

  // ------------------------------------------------------------------ session restore
  saveSessionSoon() {
    if (this.quitting || this.sessionTimer) return;
    this.sessionTimer = setTimeout(() => this.saveSessionNow(), 1000);
  }

  saveSessionNow() {
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.sessionTimer = null;
    const windows = this.windows.filter((w) => !w.isPrivate && !w.win.isDestroyed() && w.tabs.length).map((w) => w.saved());
    if (windows.length || this.quitting) this.profile.session.set({ windows, cleanExit: false });
    else this.profile.session.set((s) => s); // keep the last window's tabs when it closed
  }

  async shutdown() {
    this.quitting = true;
    this.saveSessionNow();
    this.profile.session.set((s) => ({ ...s, cleanExit: true }));
    if (this.profile.settings.get().clearHistoryOnExit) {
      this.profile.clearHistorySince(0);
      await this.persistSession.clearCache();
    }
    this.security.flush();
    this.profile.flushAll();
  }

  // ------------------------------------------------------------------ closed tabs
  rememberClosed(url: string, title: string, index: number) {
    this.closed.push({ url, title, index });
    if (this.closed.length > 25) this.closed.shift();
  }

  hasClosedTabs() {
    return this.closed.length > 0;
  }

  closedTabs() {
    return [...this.closed].reverse();
  }

  /** index counts from the most recently closed tab (0). */
  reopenClosedAt(w: BrowserWindowController, index: number) {
    if (w.isPrivate || index < 0 || index >= this.closed.length) return;
    const [c] = this.closed.splice(this.closed.length - 1 - index, 1);
    w.addTab({ url: c.url, title: c.title, index: c.index });
    this.windows.forEach((x) => x.pushState());
  }

  reopenClosed(w: BrowserWindowController) {
    if (w.isPrivate) return;
    const c = this.closed.pop();
    if (c) w.addTab({ url: c.url, title: c.title, index: c.index });
    this.windows.forEach((x) => x.pushState());
  }

  // ------------------------------------------------------------------ security navigation hook
  private checkNavigation(wc: WebContents | null, url: string): boolean {
    const found = wc && this.findTab(wc);
    if (!found) return false;
    const { tab, win } = found;
    // HTTPS-only at Maximum protection.
    if (this.profile.settings.get().protectionLevel === 'maximum' && url.startsWith('http:')) {
      const host = new URL(url).hostname;
      if (!isPrivateIP(host)) {
        setImmediate(() => void tab.load(url.replace(/^http:/, 'https:')));
        return true;
      }
    }
    const verdict = this.security.checkNavigation(tab.id, url);
    if (!verdict) return false;
    const id = randomUUID();
    this.blockedPages.set(id, { url, verdict, tabId: tab.id });
    if (this.blockedPages.size > 100) this.blockedPages.delete(this.blockedPages.keys().next().value!);
    tab.security = 'blocked';
    tab.blockedTarget = url;
    setImmediate(() => {
      void tab.wc.loadURL(`nude://blocked?id=${id}`);
      win.pushState();
    });
    return true;
  }

  // ------------------------------------------------------------------ lookup helpers
  findTab(wc: WebContents) {
    for (const win of this.windows) {
      const tab = win.tabs.find((t) => !t.wc.isDestroyed() && t.wc.id === wc.id);
      if (tab) return { win, tab };
    }
    return null;
  }

  windowFor(wc: WebContents) {
    return this.findTab(wc)?.win ?? this.windows.find((w) => w.win.webContents === wc) ?? null;
  }

  downloadPromptFor(w: BrowserWindowController): DownloadPrompt | null {
    for (const p of this.downloadPrompts.values()) if (p.windowId === w.win.id) return { id: p.id, filename: p.filename, risk: p.risk, notes: p.notes };
    return null;
  }

  systemAccent(): string {
    try {
      if (process.platform === 'win32' || process.platform === 'darwin') {
        const c = systemPreferences.getAccentColor();
        if (/^[0-9a-f]{6}/i.test(c)) return `#${c.slice(0, 6)}`;
      }
    } catch { /* not available */ }
    return '';
  }

  private broadcast(e: InternalEvent) {
    for (const w of this.windows) {
      for (const t of w.tabs) if (!t.wc.isDestroyed() && t.wc.getURL().startsWith('nude:')) t.wc.send('internal:event', e);
    }
  }

  private onProfileChanged(e: InternalEvent) {
    if (e.topic === 'settings') {
      const s = this.profile.settings.get();
      nativeTheme.themeSource = s.theme;
      configureNudeSearch(s.searchServerUrl);
      this.windows.forEach((w) => w.refreshTheme());
    }
    if (e.topic === 'bookmarks') this.windows.forEach((w) => w.pushState());
    this.broadcast(e);
  }

  // ------------------------------------------------------------------ nude:// pages
  private async serveInternal(rawUrl: string): Promise<Response> {
    let u: URL;
    try {
      u = new URL(rawUrl);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    const page = u.hostname;
    let file = u.pathname === '/' || u.pathname === '' ? `${page}.html` : u.pathname.replace(/^\/+/, '');
    if (!/^[a-z0-9_-]+\.(html|js|css|svg|png|map)$/i.test(file)) return new Response('Not found', { status: 404 });
    if (file.endsWith('.html') && file !== `${page}.html`) file = `${page}.html`;
    const full = normalize(join(PAGES_DIR, file));
    if (!full.startsWith(normalize(PAGES_DIR))) return new Response('Not found', { status: 404 });
    try {
      const body = await readFile(full);
      const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8'
        : file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'application/json';
      return new Response(body, { headers: { 'content-type': type, 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }

  // ------------------------------------------------------------------ IPC
  private registerIpc() {
    const chromeOf = (e: IpcMainInvokeEvent) => {
      const w = this.windows.find((x) => !x.win.isDestroyed() && x.win.webContents.id === e.sender.id);
      if (!w || e.senderFrame?.url && !e.senderFrame.url.startsWith('file:')) throw new Error('Unauthorized');
      return w;
    };

    ipcMain.handle('chrome', async (e, cmd: string, ...a: unknown[]) => {
      const w = chromeOf(e);
      const tab = w.activeTab;
      const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : -1);
      const str = (x: unknown, max = 8192) => (typeof x === 'string' ? x.slice(0, max) : '');
      switch (cmd) {
        case 'ready': w.setUiReady(); return { shortcuts: SHORTCUT_HELP, engines: Object.values(SEARCH_ENGINES).map((x) => ({ id: x.id, name: x.name })) };
        case 'bounds': w.setContentBounds(a[0] as ContentBounds); return;
        case 'overlay': return w.setOverlay(Boolean(a[0]), Boolean(a[1]));
        case 'navigate': w.navigate(str(a[0]), (a[1] ?? {}) as { newTab?: boolean; background?: boolean }); return;
        case 'newTab': w.newTab(); return;
        case 'activate': w.activate(num(a[0])); return;
        case 'close': w.closeTab(num(a[0])); return;
        case 'move': w.moveTab(num(a[0]), num(a[1])); return;
        case 'pin': w.setPinned(num(a[0]), Boolean(a[1])); return;
        case 'duplicate': w.duplicate(num(a[0])); return;
        case 'closeOthers': w.closeOthers(num(a[0])); return;
        case 'closeRight': w.closeToRight(num(a[0])); return;
        case 'mute': w.toggleMute(num(a[0])); return;
        case 'reopen': this.reopenClosed(w); return;
        case 'moveToNewWindow': {
          const t = w.tabById(num(a[0]));
          if (t && w.tabs.length > 1) {
            const url = t.url;
            w.closeTab(t.id);
            this.createWindow(w.isPrivate, url);
          }
          return;
        }
        case 'back': if (tab?.wc.navigationHistory.canGoBack()) tab.wc.navigationHistory.goBack(); return;
        case 'forward': if (tab?.wc.navigationHistory.canGoForward()) tab.wc.navigationHistory.goForward(); return;
        case 'reload': tab?.wc.reload(); return;
        case 'stop': tab?.wc.stop(); return;
        case 'shortcut': w.runShortcut(str(a[0]) as never); return;
        case 'openInternal': w.openInternal(str(a[0], 40).replace(/[^a-z]/g, ''), str(a[1], 40).replace(/[^#a-z-]/g, '')); return;
        case 'newWindow': this.createWindow(Boolean(a[0])); return;
        case 'zoom': w.zoom(num(a[0]) === 0 ? 0 : Math.sign(num(a[0])) * 0.5); return;
        case 'zoomReset': w.runShortcut('zoom-reset'); return;
        case 'fullscreen': w.runShortcut('fullscreen'); return;
        case 'findText': w.findText(str(a[0], 500)); return;
        case 'findNext': w.findNext(a[0] !== false); return;
        case 'findClose': w.closeFind(); return;
        case 'toggleBookmark': w.runShortcut('bookmark'); return;
        case 'openBookmark': w.navigate(str(a[0]), { newTab: Boolean(a[1]), background: Boolean(a[1]) }); return;
        case 'reader': await w.openReader(); return;
        // Spaces (tab groups)
        case 'groupCreate': {
          const ids = (Array.isArray(a[1]) ? a[1] : []).map(Number).filter(Number.isFinite);
          return w.createGroup(str(a[0], 60), ids.length ? ids : tab ? [tab.id] : []);
        }
        case 'groupRename': w.renameGroup(str(a[0], 100), str(a[1], 60)); return;
        case 'groupDelete': w.deleteGroup(str(a[0], 100)); return;
        case 'groupClear': w.clearGroup(a[0] === null ? null : str(a[0], 100)); return;
        case 'setTabGroup': w.setTabGroup(num(a[0]), a[1] === null ? null : str(a[1], 100)); return;
        case 'groupTidy': {
          const loose = w.tabs.filter((t) => !t.pinned && !t.groupId && /^https?:/.test(t.url));
          if (loose.length < 2) return { made: 0, by: 'none' };
          const plan = await this.ai.suggestSpaces(loose.map((t) => ({ id: t.id, title: t.title, url: t.url })));
          if (plan) return { made: w.applyGroups(plan), by: 'nebula' };
          return { made: w.tidyBySite(), by: 'site' };
        }
        case 'closedTabs': return w.isPrivate ? [] : this.closedTabs();
        case 'reopenClosedAt': this.reopenClosedAt(w, num(a[0])); return;
        case 'pageMedia': {
          if (!tab || !/^https?:/.test(tab.url)) return [];
          return ReaderStore.pageMedia(tab.wc).catch(() => []);
        }
        case 'downloadsList': return this.profile.downloads.get().filter((d) => d.private === w.isPrivate).slice(-30).reverse();
        case 'downloadOpen': {
          const d = this.profile.downloads.get().find((x) => x.id === str(a[0], 100));
          if (d && d.status === 'completed' && !d.blocked) void shell.openPath(d.savePath);
          return;
        }
        case 'downloadShow': {
          const d = this.profile.downloads.get().find((x) => x.id === str(a[0], 100));
          if (d) shell.showItemInFolder(d.savePath);
          return;
        }
        case 'notes': return w.isPrivate ? [] : this.profile.notes.get();
        case 'noteAdd': if (!w.isPrivate) return this.profile.addNote({ text: str(a[0], 50_000), title: str(a[1], 200), url: str(a[2], 2000) }); return null;
        case 'noteRemove': this.profile.removeNote(str(a[0], 100)); return;
        case 'setSpeed': this.profile.updateSettings({ nebulaSpeed: str(a[0], 10) as never }); return;
        case 'nebulaStatus': {
          const url = this.profile.settings.get().aiGatewayUrl.replace(/\/+$/, '');
          try {
            const r = await net.fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
            const j = await r.json() as { provider?: string };
            return { ok: r.ok, provider: j.provider ?? '', url, speed: this.profile.settings.get().nebulaSpeed };
          } catch { return { ok: false, provider: '', url, speed: this.profile.settings.get().nebulaSpeed }; }
        }
        case 'thumbnails': {
          await Promise.all(w.tabs.filter((t) => t.id === w.activeTabId).map((t) => t.captureThumbnail()));
          return w.thumbnails();
        }
        case 'permission': {
          const tabId = this.permissions.respond(str(a[0], 100), Boolean(a[1]), Boolean(a[2]), w.partitionKey);
          if (tabId !== null) w.pushState();
          return;
        }
        case 'downloadDecision': {
          const id = str(a[0], 100);
          this.downloadPrompts.delete(id);
          this.downloads.decide(id, Boolean(a[1]));
          w.pushState();
          return;
        }
        case 'downloadsSeen': this.downloads.markSeen(); return;
        case 'suggest': return this.suggest(w, str(a[0], 500));
        case 'suggestRemote': return this.suggestRemote(w, str(a[0], 500));
        case 'siteInfo': {
          if (!tab) return null;
          const url = tab.url;
          const v = this.security.check(url);
          let origin = '';
          try { origin = new URL(url).origin; } catch { /* ignore */ }
          const perms = this.profile.permissions.get().filter((p) => p.origin === origin);
          return {
            url, origin, secure: url.startsWith('https:'), internal: url.startsWith('nude:'),
            verdict: { action: v.action, confidence: v.confidence, category: v.category, signals: v.signals.map((s) => s.message) },
            trackersBlocked: tab.trackersBlocked,
            permissions: perms.map((p) => ({ ...p, label: PERMISSION_LABELS[p.permission] })),
          };
        }
        case 'revokePermission': this.profile.revokePermission(str(a[0], 500), str(a[1], 40) as never || undefined); return;
        case 'aiAsk': {
          const req = a[0] as AiRequest;
          if (!req || typeof req.requestId !== 'string' || !Array.isArray(req.messages)) return;
          const clean: AiRequest = {
            mode: this.profile.settings.get().mode,
            requestId: req.requestId.slice(0, 80),
            messages: req.messages.slice(-20).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 100_000) })),
            share: {
              page: Boolean(req.share?.page), selection: Boolean(req.share?.selection),
              tabIds: Array.isArray(req.share?.tabIds) ? req.share.tabIds.filter((x) => typeof x === 'number') : [],
              files: Array.isArray(req.share?.files) ? req.share.files.slice(0, 5).map((f) => ({ name: String(f.name), text: String(f.text) })) : [],
              image: req.share?.image && typeof req.share.image.src === 'string' && /^https:\/\//.test(req.share.image.src)
                ? { src: req.share.image.src.slice(0, 4000), alt: String(req.share.image.alt ?? '').slice(0, 200) } : undefined,
            },
            speed: req.speed === 'fast' || req.speed === 'thorough' ? req.speed : undefined,
          };
          void this.ai.ask(e.sender, tab ? { wc: tab.wc, id: tab.id } : undefined, (id) => w.tabById(id)?.wc, clean);
          return;
        }
        case 'aiCancel': this.ai.cancel(str(a[0], 80)); return;
        case 'setMode': this.profile.updateSettings({ mode: str(a[0], 20) }); return;
        case 'setTheme': this.profile.updateSettings({ theme: str(a[0], 10) }); return;
        case 'signOut': this.accounts.signOut(); w.openInternal('welcome'); return;
        case 'accounts': return { current: this.accounts.current(), all: this.accounts.list() };
        case 'pageContext': {
          if (!tab || !/^https?:/.test(tab.url)) return null;
          const products = await ReaderStore.pageProducts(tab.wc).catch(() => []);
          return { title: tab.title, url: tab.url, favicon: tab.favicon, products };
        }
        case 'nebulaHighlight': {
          if (!tab || !/^https?:/.test(tab.url)) return { found: 0 };
          const texts = (Array.isArray(a[0]) ? a[0] : []).map((x) => str(x, 200)).filter(Boolean).slice(0, 8);
          return ReaderStore.highlight(tab.wc, texts);
        }
        case 'nebulaGlow': if (tab && /^https?:/.test(tab.url)) await ReaderStore.glow(tab.wc).catch(() => {}); return;
        case 'tabsForAi': return w.tabs.filter((t) => /^https?:/.test(t.url)).map((t) => ({ id: t.id, title: t.title, url: t.url, favicon: t.favicon }));
        case 'openUrlInNewTab': {
          const url = str(a[0]);
          if (/^https?:\/\//.test(url)) w.addTab({ url });
          return;
        }
        default: throw new Error(`Unknown command ${cmd}`);
      }
    });

    ipcMain.handle('internal', async (e, cmd: string, ...a: unknown[]) => {
      const frameUrl = e.senderFrame?.url ?? '';
      if (!frameUrl.startsWith('nude://') || e.senderFrame !== e.sender.mainFrame) throw new Error('Unauthorized');
      const page = new URL(frameUrl).hostname;
      const found = this.findTab(e.sender);
      const isPrivate = found?.win.isPrivate ?? false;
      const str = (x: unknown, max = 8192) => (typeof x === 'string' ? x.slice(0, max) : '');
      const p = this.profile;
      // The warning page may only read its own verdict and continue/go back.
      if (page === 'blocked' && !cmd.startsWith('blocked.') && cmd !== 'settings.get') throw new Error('Unauthorized');
      switch (cmd) {
        case 'account.get': return { current: this.accounts.current(), all: this.accounts.list(), needsWelcome: this.accounts.needsWelcome() };
        case 'account.signUp': {
          if (page !== 'welcome' && page !== 'account') throw new Error('Unauthorized');
          return this.accounts.signUp(str(a[0], 100), str(a[1], 260), str(a[2], 500));
        }
        case 'account.signIn': {
          if (page !== 'welcome' && page !== 'account') throw new Error('Unauthorized');
          return this.accounts.signIn(str(a[0], 260), str(a[1], 500));
        }
        case 'account.guest': this.accounts.continueAsGuest(); return { ok: true };
        case 'account.signOut': this.accounts.signOut(); return { ok: true };
        case 'account.update': return this.accounts.update((a[0] ?? {}) as { name?: string; photo?: string | null });
        case 'account.password': return this.accounts.changePassword(str(a[0], 500), str(a[1], 500));
        case 'account.delete': return this.accounts.deleteCurrent(str(a[0], 500));
        case 'account.done': {
          if (found) void found.tab.load(NEW_TAB_URL);
          return;
        }
        case 'settings.get': return { settings: p.settings.get(), engines: Object.values(SEARCH_ENGINES).map((x) => ({ id: x.id, name: x.name })), levels: PROTECTION_LEVELS, private: isPrivate, version: app.getVersion(), chrome: process.versions.chrome, electron: process.versions.electron, platform: process.platform, isDefault: app.isDefaultProtocolClient('https'), shortcuts: SHORTCUT_HELP };
        case 'settings.set': return p.updateSettings(a[0]);
        case 'settings.makeDefault': app.setAsDefaultProtocolClient('http'); app.setAsDefaultProtocolClient('https'); return app.isDefaultProtocolClient('https');
        case 'settings.chooseDownloads': {
          const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
          if (!r.canceled && r.filePaths[0]) p.updateSettings({ downloadsDirectory: r.filePaths[0] });
          return p.settings.get().downloadsDirectory;
        }
        case 'newtab.data': return {
          shortcuts: p.shortcuts.get(),
          topSites: isPrivate ? [] : p.topSites(8).map((h) => ({ url: h.url, title: h.title, favicon: h.favicon })),
          recent: isPrivate ? [] : p.queryHistory({ limit: 6 }).map((h) => ({ url: h.url, title: h.title, favicon: h.favicon, lastVisit: h.lastVisit })),
          engine: SEARCH_ENGINES[p.settings.get().searchEngine].name,
          private: isPrivate,
          security: this.security.summary().stats,
          account: this.accounts.current(),
          mode: p.settings.get().mode,
        };
        case 'search': {
          const q = str(a[0], 500).trim();
          if (q && found) void found.tab.load(searchUrl(p.settings.get().searchEngine, q), true);
          return;
        }
        case 'open': {
          const url = str(a[0]);
          if (!found || !/^(https?:\/\/|nude:\/\/)/.test(url)) return;
          if (a[1]) found.win.addTab({ url }, false);
          else void found.tab.load(url);
          return;
        }
        case 'shortcuts.add': return p.addShortcut(str(a[0], 100), str(a[1]));
        case 'shortcuts.remove': p.removeShortcut(str(a[0], 100)); return;
        case 'bookmarks.list': return p.bookmarks.get();
        case 'bookmarks.add': return p.addBookmark({ url: str(a[0]), title: str(a[1], 500), folder: str(a[2], 200) });
        case 'bookmarks.update': p.updateBookmark(str(a[0], 100), (a[1] ?? {}) as never); return;
        case 'bookmarks.remove': p.removeBookmark(str(a[0], 100)); return;
        case 'bookmarks.move': p.moveBookmark(str(a[0], 100), Number(a[1])); return;
        case 'history.query': return p.queryHistory({ query: str(a[0], 200), limit: Number(a[1]) || 200, before: Number(a[2]) || undefined });
        case 'history.remove': p.removeHistory((Array.isArray(a[0]) ? a[0] : []).map((x) => str(x)).slice(0, 1000)); return;
        case 'downloads.list': return this.downloads.list(isPrivate);
        case 'downloads.action': return this.downloads.action(str(a[0], 100), str(a[1], 20));
        case 'downloads.clear': this.downloads.clearFinished(); return;
        case 'downloads.retry': {
          const url = this.downloads.urlFor(str(a[0], 100));
          if (url && found) found.tab.wc.downloadURL(url);
          return;
        }
        case 'permissions.list': return p.permissions.get().map((x) => ({ ...x, label: PERMISSION_LABELS[x.permission] }));
        case 'permissions.revoke': p.revokePermission(str(a[0], 500), (str(a[1], 40) || undefined) as never); return;
        case 'permissions.set': p.setPermission(str(a[0], 500), str(a[1], 40) as never, a[2] === 'allow' ? 'allow' : 'block'); return;
        case 'clearData': return this.clearData(a[0] as ClearDataOptions);
        case 'security.summary': return this.security.summary();
        case 'security.update': return this.security.updateLists();
        case 'security.trust': this.security.trust(str(a[0], 300)); this.broadcast({ topic: 'security' }); return;
        case 'security.untrust': this.security.untrust(str(a[0], 300)); this.broadcast({ topic: 'security' }); return;
        case 'security.check': {
          const v = this.security.check(str(a[0]));
          return { action: v.action, confidence: v.confidence, category: v.category, score: v.score, signals: v.signals.map((s) => s.message) };
        }
        case 'blocked.get': {
          const b = this.blockedPages.get(new URL(frameUrl).searchParams.get('id') ?? '');
          if (!b) return null;
          const info = CATEGORY_INFO[b.verdict.category ?? 'suspicious'];
          const canBypass = !(b.verdict.confidence === 'confirmed' && p.settings.get().protectionLevel === 'maximum');
          return { url: b.url, host: b.verdict.host, category: b.verdict.category, confidence: b.verdict.confidence, ...info,
            signals: b.verdict.signals.map((s) => s.message), intendedSite: b.verdict.intendedSite, canBypass, action: b.verdict.action };
        }
        case 'blocked.back': {
          if (!found) return;
          const nav = found.tab.wc.navigationHistory;
          if (nav.canGoBack()) nav.goBack();
          else void found.tab.load(NEW_TAB_URL);
          return;
        }
        case 'blocked.continue': {
          const b = this.blockedPages.get(new URL(frameUrl).searchParams.get('id') ?? '');
          if (!b || !found || found.tab.id !== b.tabId) return false;
          if (!this.security.allowOnce(found.tab.id, b.url)) return false;
          void found.tab.load(b.url);
          return true;
        }
        case 'blocked.goIntended': {
          const b = this.blockedPages.get(new URL(frameUrl).searchParams.get('id') ?? '');
          if (b?.verdict.intendedSite && found) void found.tab.load(b.verdict.intendedSite);
          return;
        }
        case 'reader.get': return this.reader.get(new URL(frameUrl).searchParams.get('id') ?? '');
        case 'openExternal': {
          const url = str(a[0]);
          if (/^https:\/\//.test(url)) await shell.openExternal(url);
          return;
        }
        case 'services.test': return this.testServices();
        default: throw new Error(`Unknown command ${cmd}`);
      }
    });
  }

  /** Local suggestions answer instantly; remote ones arrive separately so typing never waits on the network. */
  private suggest(w: BrowserWindowController, q: string) {
    const p = this.profile;
    const tabs = w.tabs.filter((t) => t.id !== w.activeTabId).map((t) => ({ id: t.id, url: t.url, title: t.title, favicon: t.favicon }));
    const local = rankLocalSuggestions(q, w.isPrivate ? [] : p.history.get(), p.bookmarks.get(), tabs, 6);
    const inline = w.isPrivate ? null : inlineCompletion(q, p.history.get());
    const engine = SEARCH_ENGINES[p.settings.get().searchEngine];
    return { local, remote: [] as string[], inline, engine: engine.name };
  }

  private async suggestRemote(w: BrowserWindowController, q: string): Promise<string[]> {
    const s = this.profile.settings.get();
    const engine = SEARCH_ENGINES[s.searchEngine];
    // Remote suggestions send what you type to the search engine: off in private windows.
    if (!s.searchSuggestions || w.isPrivate || !engine.suggestUrl || !q.trim() || q.length >= 120) return [];
    try {
      const res = await net.fetch(engine.suggestUrl.replace('{q}', encodeURIComponent(q)), { signal: AbortSignal.timeout(900), headers: { accept: 'application/json' } });
      return res.ok ? parseRemoteSuggestions(await res.json(), 5) : [];
    } catch { return []; /* offline or slow: local suggestions only */ }
  }

  private async clearData(o: ClearDataOptions) {
    const ranges = { hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000, all: Infinity };
    const since = o.range === 'all' ? 0 : Date.now() - (ranges[o.range] ?? Infinity);
    if (o.history) {
      this.profile.clearHistorySince(since);
      this.closed = [];
    }
    if (o.downloads) this.profile.clearDownloadsSince(since);
    if (o.cookies) await this.persistSession.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'filesystem', 'shadercache'] });
    if (o.cache) {
      await this.persistSession.clearCache();
      await this.persistSession.clearCodeCaches({});
    }
    if (o.permissions) this.profile.permissions.set([]);
    return { ok: true };
  }

  private async testServices() {
    const s = this.profile.settings.get();
    const probe = async (base: string) => {
      if (!base) return 'not configured';
      try {
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 2500);
        const r = await net.fetch(`${base.replace(/\/+$/, '')}/health`, { signal: ctrl.signal });
        return r.ok ? 'online' : `error ${r.status}`;
      } catch {
        return 'offline';
      }
    };
    const [search, ai, threat] = await Promise.all([probe(s.searchServerUrl), probe(s.aiGatewayUrl), probe(s.threatIntelUrl)]);
    return { search, ai, threat };
  }
}
