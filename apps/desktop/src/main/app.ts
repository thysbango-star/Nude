// Application controller: windows, sessions, the nude:// protocol, IPC and session restore.
import {
  app, ipcMain, nativeTheme, session, shell, systemPreferences, dialog, net, webContents, safeStorage, nativeImage,
  type IpcMainInvokeEvent, type Session, type WebContents,
} from 'electron';
import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { WALLPAPERS, DEFAULT_WALLPAPER } from '../shared/wallpapers';
import { resolveInput } from '../shared/omnibox';
import { join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Profile } from './profile';
import { PermissionManager, PERMISSION_LABELS } from './permissions';
import { DownloadManager } from './downloads';
import { SecurityService } from './security';
import { ReaderStore } from './reader';
import { AiBridge, type AiRequest } from './ai';
import { Accounts } from './accounts';
import { LocalNebula, RECOMMENDED } from './local-nebula';
import { NudeId, NudeIdError } from './nude-id';
import { GroqNebula } from './groq-nebula';
import { fillLogin } from './passgate-fill';
import { NebulaChats, type ChatMessage } from './nebula-chats';
import { JsonStore } from './store';
import { PhoneLink, lanAddresses, type LinkApp, type PublicDevice } from './phone-link';
import { qrSvg } from '../shared/qr';
import { hostname } from 'node:os';
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
  readonly localNebula: LocalNebula;
  /** Nude ID sign-in for this computer (tokens stay in the main process, encrypted). */
  nudeId!: NudeId;
  /** Phone sign-ins waiting for this computer's approval, by Nude ID. */
  private pendingLinks = new Map<string, string>();
  private introPlayed = false;
  /** The PassGate login request showing in a window, if any. */
  private passgateCancel: (() => void) | null = null;
  /** Nebula on Groq (the Nebula app's engine) and the synced conversations. */
  groq!: GroqNebula;
  chats!: NebulaChats;
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
    this.localNebula = new LocalNebula(dir, () => this.broadcast({ topic: 'nebula' }));
    this.accounts = new Accounts(dir);
    this.groq = new GroqNebula(dir, (url, init) => net.fetch(String(url), init as RequestInit) as never);
    this.nudeId = new NudeId(dir, () => process.env.NUDE_ACCOUNTS_URL || this.profile.settings.get().accountsServerUrl, (url, init) => net.fetch(url, init as RequestInit));
    this.chats = new NebulaChats(dir, this.nudeId, () => this.accounts.currentRaw()?.id ?? null);
    this.phoneLink = new PhoneLink(dir, { identity: (d) => this.phoneIdentity(d), report: (d) => this.phoneReport(d) },
      safeStorage.isEncryptionAvailable()
        ? { seal: (x) => safeStorage.encryptString(x).toString('base64'), open: (x) => safeStorage.decryptString(Buffer.from(x, 'base64')) }
        : undefined);
    this.phoneLink.onChange = () => this.broadcast({ topic: 'phone' });
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
    // The launch animation: once per launch, in the first window, unless turned off or motion is reduced.
    const st = this.profile.settings.get();
    const intro = !this.introPlayed && !isPrivate && st.launchIntro && !st.reduceMotion;
    this.introPlayed = true;
    const w = new BrowserWindowController(this, ses, isPrivate, saved, key ?? undefined, intro);
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
    this.phoneLink.flush();
    this.chats?.flush();
    this.groq?.stop();
    this.phoneLink.stop();
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

  /** Where Nebula's requests go: Ollama on this computer (free) or the Nebula gateway. */
  async nebulaEndpoint(): Promise<{ url: string; token: string; local: boolean } | null> {
    const s = this.profile.settings.get();
    if (s.nebulaEngine === 'groq') return this.groqEndpoint();
    if (s.nebulaEngine !== 'gateway') {
      const local = await this.localNebula.endpoint(s);
      if (local) return { url: local.url, token: local.token, local: true };
      if (s.nebulaEngine === 'ollama') return null;
      // Automatic: Nebula on Groq next, when you've added your Groq key.
      const g = await this.groqEndpoint();
      if (g) return g;
    } else this.localNebula.stop();
    return { url: s.aiGatewayUrl.replace(/\/+$/, ''), token: s.serviceToken, local: false };
  }

  private async groqEndpoint() {
    const g = await this.groq.endpoint();
    return g ? { url: g.url, token: g.token, local: true } : null;
  }

  identityLog(kind: string, detail: string) { this.accounts.logEvent(kind, detail); }

  // ------------------------------------------------------------------ homepage wallpaper
  private get customWallpaperPath() { return join(app.getPath('userData'), 'wallpaper', 'custom.jpg'); }

  /** Your own wallpaper: checked to be a real image, scaled to at most 3840 px wide, saved as JPEG in your profile. */
  private async setCustomWallpaper(bytes: unknown): Promise<{ ok: boolean; error?: string }> {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) return { ok: false, error: 'Nude couldn\'t read that file.' };
    if (bytes.length > 25 * 1024 * 1024) return { ok: false, error: 'That image is larger than 25 MB.' };
    let img = nativeImage.createFromBuffer(Buffer.from(bytes));
    if (img.isEmpty()) return { ok: false, error: 'That file isn\'t a picture Nude can use (try a JPEG or PNG).' };
    const { width, height } = img.getSize();
    if (width < 640 || height < 360) return { ok: false, error: 'That picture is too small for a wallpaper (it needs at least 640 × 360).' };
    if (width > 3840) img = img.resize({ width: 3840, quality: 'best' });
    await mkdir(join(app.getPath('userData'), 'wallpaper'), { recursive: true });
    await writeFile(this.customWallpaperPath, img.toJPEG(90));
    this.profile.updateSettings({ wallpaper: 'custom' });
    return { ok: true };
  }

  private async hasCustomWallpaper() { try { return (await stat(this.customWallpaperPath)).size > 0; } catch { return false; } }

  /** Is the chosen search engine reachable? Only checked for Nude Search, which may run on your own computer. */
  private async searchStatus(): Promise<{ engine: string; id: string; ok: boolean; detail?: string }> {
    const s = this.profile.settings.get();
    const engine = SEARCH_ENGINES[s.searchEngine];
    if (s.searchEngine !== 'nude') return { engine: engine.name, id: s.searchEngine, ok: true };
    const base = (s.searchServerUrl || 'http://127.0.0.1:8787').replace(/\/+$/, '');
    try {
      const r = await net.fetch(`${base}/api/stats`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return { engine: engine.name, id: 'nude', ok: true };
      return { engine: engine.name, id: 'nude', ok: false, detail: `Nude Search answered with an error (${r.status}).` };
    } catch {
      return { engine: engine.name, id: 'nude', ok: false, detail: `Nude Search isn't reachable at ${base}. It needs its server running (see docs/SETUP.md).` };
    }
  }


  /** Downloads a profile picture (HTTPS images only, small) and returns it as a data: URL. */
  private async fetchAvatar(url: string): Promise<string | undefined> {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      const r = await net.fetch(url, { signal: ctl.signal, credentials: 'omit' } as RequestInit);
      clearTimeout(timer);
      const type = (r.headers.get('content-type') ?? '').split(';')[0].trim();
      if (!r.ok || !/^image\/(png|jpeg|webp|gif)$/.test(type)) return undefined;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 200_000) return undefined;
      return `data:${type};base64,${buf.toString('base64')}`;
    } catch { return undefined; }
  }

  phoneLink!: PhoneLink;

  private pcInfo() { return { name: (hostname() || 'This PC').slice(0, 40), platform: process.platform, nude: app.getVersion() }; }

  /** What PassGate on a linked phone sees: your verified identity and sign-in activity. Never passwords or tokens. */
  private phoneIdentity(_d: PublicDevice) {
    const cur = this.accounts.current();
    return {
      pc: this.pcInfo(),
      account: cur ? {
        name: cur.name, email: cur.nudeId, provider: cur.provider, nudeId: cur.nudeId, username: cur.username,
        emailVerified: false, initials: cur.initials, color: cur.color, lastSignIn: cur.lastSignIn, linkedAt: cur.created,
      } : null,
      accounts: this.accounts.list().map((a) => ({ name: a.name, id: a.nudeId, provider: a.provider, current: a.id === cur?.id })),
      events: this.accounts.events().slice(0, 50),
      devices: this.phoneLink.devices().map((x) => ({ app: x.app, name: x.name, lastSeen: x.lastSeen })),
      protection: { level: this.profile.settings.get().protectionLevel },
      time: Date.now(),
    };
  }

  /** What Rovian Defender on a linked phone sees: how protection is working on this PC. Real counts only. */
  private phoneReport(_d: PublicDevice) {
    const s = this.security.summary();
    const settings = this.profile.settings.get();
    const host = (u?: string) => { try { return u ? new URL(u).hostname : null; } catch { return null; } };
    const cur = this.accounts.current();
    return {
      pc: this.pcInfo(),
      user: cur ? { firstName: cur.firstName, initials: cur.initials, color: cur.color } : null,
      level: s.level,
      levelName: PROTECTION_LEVELS[s.level].name,
      levelSummary: PROTECTION_LEVELS[s.level].summary,
      stats: s.stats,
      lastScan: s.lastScan,
      listsUpdated: s.listsUpdated,
      knownThreats: s.knownThreats,
      threatService: Boolean(settings.threatIntelUrl),
      httpsOnly: s.level === 'maximum',
      trustedSites: s.trusted.length,
      events: s.events.slice(0, 60).map((e) => ({ t: e.time, type: e.type, host: host(e.url), category: e.category ?? null, detail: e.detail })),
      time: Date.now(),
    };
  }

  // ------------------------------------------------------------------ Nude ID
  /** Everything the welcome and account pages can ask about your Nude ID. Tokens never leave this process. */
  private async accountCommand(cmd: string, a: unknown[], str: (x: unknown, max?: number) => string): Promise<unknown> {
    const cur = () => this.accounts.currentRaw();
    const need = () => { const c = cur(); if (!c) throw new NudeIdError('Sign in first.', 'signed_out'); return c.id; };
    const ok = <T>(p: Promise<T>) => p.then((v) => ({ ok: true as const, ...(v as object) })).catch((e: unknown) => {
      if (e instanceof NudeIdError) {
        if (e.code === 'signed_out' && cur() && !this.nudeId.has(cur()!.id)) this.accounts.signOut();
        return { ok: false as const, error: e.message, code: e.code };
      }
      console.error(e);
      return { ok: false as const, error: 'Something went wrong. Please try again.' };
    });
    const photoOf = async (url: string | null) => (url ? (await this.fetchAvatar(url)) ?? undefined : null);
    switch (cmd) {
      case 'account.status': return ok(this.nudeId.status().then((x) => ({ persistent: x.persistent, server: this.nudeId.base })));
      case 'account.available': return ok(this.nudeId.available(str(a[0], 40).toLowerCase()));
      case 'account.signUp': return ok((async () => {
        const n = await this.nudeId.signUp(str(a[0], 40).trim().toLowerCase(), str(a[1], 60), str(a[2], 200));
        const acct = this.accounts.signedIn(n, null);
        this.accounts.setRemember(a[3] !== false);
        this.identityLog('signup', `Created ${acct.nudeId}`);
        return { account: acct };
      })());
      case 'account.signIn': return ok((async () => {
        const n = await this.nudeId.signIn(str(a[0], 60), str(a[1], 200));
        const acct = this.accounts.signedIn(n, await photoOf(n.avatar));
        this.accounts.setRemember(a[2] !== false);
        this.identityLog('signin', `Signed in as ${acct.nudeId}`);
        return { account: acct };
      })());
      case 'account.switch': {
        const id = str(a[0], 60);
        if (!this.nudeId.has(id)) return { ok: false, error: 'password', username: this.accounts.list().find((x) => x.id === id)?.username };
        return { ok: this.accounts.switchTo(id) };
      }
      case 'account.signOut': {
        const c = cur();
        if (c) await this.nudeId.signOut(c.id);
        this.accounts.signOut();
        return { ok: true };
      }
      case 'account.remove': {
        const id = str(a[0], 60);
        if (this.nudeId.has(id)) await this.nudeId.signOut(id);
        this.accounts.remove(id);
        return { ok: true };
      }
      case 'account.refresh': return ok((async () => {
        const r = await this.nudeId.me(need());
        this.accounts.refresh(r.account, await photoOf(r.account.avatar));
        return { account: this.accounts.current(), persistent: r.persistent };
      })());
      case 'account.rename': return ok(this.nudeId.rename(need(), str(a[0], 60)).then((r) => { this.accounts.refresh(r.account); return { account: this.accounts.current() }; }));
      case 'account.photo': return ok((async () => {
        if (!(a[0] instanceof Uint8Array) || a[0].length > 25 * 1024 * 1024) throw new NudeIdError('Nude couldn\'t read that picture.');
        let img = nativeImage.createFromBuffer(Buffer.from(a[0]));
        if (img.isEmpty()) throw new NudeIdError('That file isn\'t a picture Nude can use (try a JPEG or PNG).');
        const { width, height } = img.getSize();
        const side = Math.min(width, height);
        img = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side }).resize({ width: 512, height: 512, quality: 'best' });
        const jpeg = img.toJPEG(86);
        const r = await this.nudeId.setAvatar(need(), jpeg);
        this.accounts.refresh(r.account, `data:image/jpeg;base64,${img.resize({ width: 256, height: 256 }).toJPEG(85).toString('base64')}`);
        return { account: this.accounts.current() };
      })());
      case 'account.removePhoto': return ok(this.nudeId.removeAvatar(need()).then((r) => { this.accounts.refresh(r.account, null); return { account: this.accounts.current() }; }));
      case 'account.password': return ok(this.nudeId.changePassword(need(), str(a[0], 200), str(a[1], 200)));
      case 'account.delete': return ok((async () => {
        const id = need();
        await this.nudeId.deleteAccount(id, str(a[0], 200));
        this.accounts.remove(id);
        return {};
      })());
      case 'account.devices': return ok(this.nudeId.sessions(need()));
      case 'account.revoke': return ok(this.nudeId.revoke(need(), str(a[0], 60)));
      case 'account.events': return ok(this.nudeId.events(need()));
      case 'account.apps': return ok(this.nudeId.apps(need()));
      case 'account.removeApp': return ok(this.nudeId.removeApp(need(), str(a[0], 80)));
      // Nude Companion: a single-use code this computer shows; the phone that scans it waits for your approval here.
      case 'account.linkStart': return ok((async () => {
        const l = await this.nudeId.startLink(need());
        this.pendingLinks.set(need(), l.id);
        const text = `NUDEID1:${JSON.stringify({ s: l.server, i: l.id, k: l.secret })}`;
        return { id: l.id, expires: l.expires, svg: qrSvg(text, { ecc: 'M', dark: '#0b1430', light: '#ffffff' }) };
      })());
      case 'account.linkState': {
        const id = str(a[0], 60);
        if (this.pendingLinks.get(cur()?.id ?? '') !== id) return { ok: false, error: 'That code has expired.' };
        return ok(this.nudeId.linkState(need(), id));
      }
      case 'account.linkDecide': {
        const id = str(a[0], 60);
        if (this.pendingLinks.get(cur()?.id ?? '') !== id) return { ok: false, error: 'That code has expired.' };
        const r = await ok(this.nudeId.decideLink(need(), id, a[1] === true));
        this.pendingLinks.delete(cur()?.id ?? '');
        return r;
      }
    }
    throw new Error('Unknown command');
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
    // Your own homepage wallpaper lives in your profile folder, not with the app.
    if (page === 'newtab' && file === 'custom-wallpaper.jpg') {
      try {
        const body = await readFile(this.customWallpaperPath);
        return new Response(body, { headers: { 'content-type': 'image/jpeg', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' } });
      } catch { return new Response('Not found', { status: 404 }); }
    }
    if (!/^[a-z0-9_-]+\.(html|js|css|svg|png|jpg|map|woff)$/i.test(file)) return new Response('Not found', { status: 404 });
    if (file.endsWith('.html') && file !== `${page}.html`) file = `${page}.html`;
    const full = normalize(join(PAGES_DIR, file));
    if (!full.startsWith(normalize(PAGES_DIR))) return new Response('Not found', { status: 404 });
    try {
      const body = await readFile(full);
      const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8'
        : file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : file.endsWith('.jpg') ? 'image/jpeg' : file.endsWith('.woff') ? 'font/woff' : 'application/json';
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
        case 'nebulaChats.list': await this.chats.sync().catch(() => {}); return { chats: this.chats.list(), synced: Boolean(this.accounts.currentRaw() && this.nudeId.has(this.accounts.currentRaw()!.id)) };
        case 'nebulaChats.get': return this.chats.get(str(a[0], 120));
        case 'nebulaChats.save': {
          if (w.isPrivate) return null; // private windows keep nothing
          const msgs = (Array.isArray(a[1]) ? a[1] : []).map((m) => ({ role: (m as ChatMessage)?.role, text: str((m as ChatMessage)?.text, 40_000), t: Number((m as ChatMessage)?.t) || Date.now() })) as ChatMessage[];
          return this.chats.save(typeof a[0] === 'string' && a[0] ? str(a[0], 120) : null, msgs);
        }
        case 'nebulaChats.remove': this.chats.remove(str(a[0], 120)); return { ok: true };
        case 'nebulaStatus': {
          const speed = this.profile.settings.get().nebulaSpeed;
          const ep = await this.nebulaEndpoint();
          if (!ep) return { ok: false, provider: '', url: '', speed };
          try {
            const r = await net.fetch(`${ep.url}/health`, { signal: AbortSignal.timeout(3000) });
            const j = await r.json() as { provider?: string };
            return { ok: r.ok && j.provider !== 'mock', provider: j.provider ?? '', url: ep.url, speed };
          } catch { return { ok: false, provider: '', url: ep.url, speed }; }
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
        case 'setPalette': this.profile.updateSettings({ palette: str(a[0], 20) as never }); return;
        case 'setLayout': this.profile.updateSettings({ tabLayout: str(a[0], 20) as never, ...(typeof a[1] === 'boolean' ? { sidebarCollapsed: a[1] } : {}) }); return;
        case 'signOut': { const c = this.accounts.currentRaw(); if (c) await this.nudeId.signOut(c.id); this.accounts.signOut(); w.openInternal('welcome'); return; }
        case 'accounts': return { current: this.accounts.current(), all: this.accounts.list() };
        // Sign in with your phone: a single-use code for the site in this tab; PassGate sends one login back.
        case 'passgate.request': {
          if (!tab || w.isPrivate) return { ok: false, error: 'Open the site\'s sign-in page first.' };
          let origin = '';
          try { const u = new URL(tab.url); if (u.protocol === 'https:' || (u.protocol === 'http:' && isPrivateIP(u.hostname))) origin = u.origin; } catch { /* ignore */ }
          if (!origin) return { ok: false, error: 'PassGate only fills secure (https) sign-in pages.' };
          try {
            this.passgateCancel?.();
            const r = await this.phoneLink.credentialRequest(origin);
            if (!lanAddresses().length) { r.cancel(); return { ok: false, error: 'This PC isn\'t on a Wi-Fi or wired network, so your phone can\'t reach it.' }; }
            this.passgateCancel = r.cancel;
            const tabId = tab.id;
            void r.result.then(async (cred) => {
              this.passgateCancel = null;
              if (!cred) { w.sendCommand({ type: 'passgate', state: 'closed' }); return; }
              const t = w.tabById(tabId);
              const out = t ? await fillLogin(t.wc, origin, cred) : { ok: false, message: 'That tab was closed.' };
              w.sendCommand({ type: 'passgate', state: out.ok ? 'filled' : 'failed', message: out.message });
              this.security.log({ type: 'scan', detail: `PassGate ${out.ok ? 'filled a login' : 'sent a login that wasn\'t used'} on ${new URL(origin).hostname}.` });
            });
            return { ok: true, origin, expires: r.expires, svg: qrSvg(r.text, { ecc: 'M', dark: '#0b1430', light: '#ffffff' }) };
          } catch (err) { return { ok: false, error: (err as Error).message }; }
        }
        case 'passgate.cancel': this.passgateCancel?.(); this.passgateCancel = null; return;
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
      if (cmd.startsWith('account.') && cmd !== 'account.get' && cmd !== 'account.guest' && cmd !== 'account.done') {
        if (page !== 'welcome' && page !== 'account') throw new Error('Unauthorized');
        if (isPrivate && cmd !== 'account.status') return { ok: false, error: 'Nude IDs aren\'t available in private windows.' };
        return this.accountCommand(cmd, a, str);
      }
      // The warning page may only read its own verdict and continue/go back.
      if (page === 'blocked' && !cmd.startsWith('blocked.') && cmd !== 'settings.get') throw new Error('Unauthorized');
      switch (cmd) {
        case 'account.get': return { current: this.accounts.current(), all: this.accounts.list(), needsWelcome: this.accounts.needsWelcome(), server: this.nudeId.base };
        case 'phone.offer': {
          if (page !== 'phone') throw new Error('Unauthorized');
          if (isPrivate) return { ok: false, error: 'Linking a phone isn\'t available in private windows.' };
          const which: LinkApp = a[0] === 'defender' ? 'defender' : 'passgate';
          try {
            const o = await this.phoneLink.offer(which);
            if (!o.hosts.length) return { ok: false, error: 'This PC isn\'t connected to a Wi-Fi or wired network, so your phone can\'t reach it.' };
            return { ok: true, svg: qrSvg(o.text, { ecc: 'M', dark: '#17151c', light: '#ffffff' }), expires: o.expires, hosts: o.hosts, port: o.port };
          } catch (err) { return { ok: false, error: (err as Error).message }; }
        }
        case 'phone.devices': if (page !== 'phone' && page !== 'settings') throw new Error('Unauthorized'); return { devices: this.phoneLink.devices(), listening: this.phoneLink.listening, account: this.accounts.current() };
        case 'phone.remove': if (page !== 'phone' && page !== 'settings') throw new Error('Unauthorized'); this.phoneLink.remove(str(a[0], 60)); return { ok: true };
        case 'phone.end': if (page !== 'phone') throw new Error('Unauthorized'); this.phoneLink.endOffers(); return { ok: true };
        case 'account.guest': this.accounts.continueAsGuest(); return { ok: true };
        case 'account.done': {
          if (found) void found.tab.load(NEW_TAB_URL);
          return;
        }
        case 'settings.get': return { settings: p.settings.get(), engines: Object.values(SEARCH_ENGINES).map((x) => ({ id: x.id, name: x.name })), levels: PROTECTION_LEVELS, private: isPrivate, version: app.getVersion(), chrome: process.versions.chrome, electron: process.versions.electron, platform: process.platform, isDefault: app.isDefaultProtocolClient('https'), shortcuts: SHORTCUT_HELP };
        case 'settings.set': return p.updateSettings(a[0]);
        case 'nebula.groq': if (page !== 'settings') throw new Error('Unauthorized'); return { hasKey: this.groq.hasKey, hint: this.groq.hint };
        case 'nebula.groqSet': {
          if (page !== 'settings') throw new Error('Unauthorized');
          const r = await this.groq.setKey(str(a[0], 200));
          if (r.ok && p.settings.get().nebulaEngine === 'gateway') p.updateSettings({ nebulaEngine: 'groq' });
          this.broadcast({ topic: 'nebula' });
          return r;
        }
        case 'nebula.groqRemove': if (page !== 'settings') throw new Error('Unauthorized'); this.groq.removeKey(); this.broadcast({ topic: 'nebula' }); return { ok: true };
        case 'nebula.local': return { ...(await this.localNebula.status(p.settings.get())), recommended: RECOMMENDED };
        case 'nebula.pull': if (!isPrivate) void this.localNebula.pull(p.settings.get(), String(a[0] ?? '')); return;
        case 'nebula.cancelPull': this.localNebula.cancelPull(); return;
        case 'nebula.resetToken': this.localNebula.resetToken(); this.broadcast({ topic: 'nebula' }); return;
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
          engineId: p.settings.get().searchEngine,
          wallpapers: WALLPAPERS,
          wallpaper: p.settings.get().wallpaper || DEFAULT_WALLPAPER,
          wallpaperRotate: p.settings.get().wallpaperRotate,
          hasCustomWallpaper: await this.hasCustomWallpaper(),
          reduceMotion: p.settings.get().reduceMotion,
          private: isPrivate,
          security: this.security.summary().stats,
          account: this.accounts.current(),
          mode: p.settings.get().mode,
        };
        // The homepage: suggestions as you type, search or go, the wallpaper.
        case 'newtab.suggest': if (page !== 'newtab' || !found) throw new Error('Unauthorized'); return this.suggest(found.win, str(a[0], 500));
        case 'newtab.suggestRemote': if (page !== 'newtab' || !found) throw new Error('Unauthorized'); return this.suggestRemote(found.win, str(a[0], 500));
        case 'newtab.searchStatus': if (page !== 'newtab') throw new Error('Unauthorized'); return this.searchStatus();
        case 'newtab.go': {
          if (page !== 'newtab' || !found) throw new Error('Unauthorized');
          const r = resolveInput(str(a[0], 2000), p.settings.get().searchEngine);
          if (!r) return { ok: false };
          if (r.type === 'blocked') return { ok: false, error: r.reason };
          void found.tab.load(r.url, true);
          return { ok: true };
        }
        case 'wallpaper.set': {
          if (page !== 'newtab' && page !== 'settings') throw new Error('Unauthorized');
          const patch: Record<string, unknown> = {};
          if (typeof a[0] === 'string') patch.wallpaper = a[0];
          if (typeof a[1] === 'boolean') patch.wallpaperRotate = a[1];
          p.updateSettings(patch);
          return { ok: true };
        }
        case 'wallpaper.upload': if (page !== 'newtab' && page !== 'settings') throw new Error('Unauthorized'); return this.setCustomWallpaper(a[0]);
        case 'wallpaper.removeCustom': {
          if (page !== 'newtab' && page !== 'settings') throw new Error('Unauthorized');
          await rm(this.customWallpaperPath, { force: true });
          if (p.settings.get().wallpaper === 'custom') p.updateSettings({ wallpaper: DEFAULT_WALLPAPER });
          return { ok: true };
        }
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
