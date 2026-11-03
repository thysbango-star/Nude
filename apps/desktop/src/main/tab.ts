// A browser tab: one sandboxed WebContentsView running real Chromium.
import { WebContentsView, type WebContents, type WebPreferences } from 'electron';
import { NEW_TAB_URL, securityStateOf } from '../shared/omnibox';
import type { TabState } from '../shared/types';
import type { BrowserWindowController } from './window';
import { INTERNAL_PRELOAD } from './paths';

let nextTabId = 1;

/** Runs in an isolated world: the page cannot see or tamper with it. */
const READER_PROBE = `(() => {
  const ps = [...document.querySelectorAll('article p, main p, p')].filter(p => (p.innerText || '').trim().length > 80);
  return ps.length >= 4 || !!document.querySelector('article');
})()`;

export interface TabOptions {
  url?: string;
  /** Load later (restored/background tab). */
  lazy?: boolean;
  title?: string;
  favicon?: string;
  pinned?: boolean;
  groupId?: string;
  /** Provided by setWindowOpenHandler.createWindow; Electron loads the URL itself. */
  openerPreferences?: WebPreferences;
}

export class Tab {
  readonly id = nextTabId++;
  readonly view: WebContentsView;
  title: string;
  favicon?: string;
  pinned: boolean;
  groupId?: string;
  error?: TabState['error'];
  crashed = false;
  pendingUrl?: string;
  trackersBlocked = 0;
  security: TabState['security'] = 'unknown';
  readerAvailable = false;
  thumbnail?: string;
  /** Next did-navigate came from the omnibox (counts as typed in history). */
  typedNavigation = false;
  closing = false;

  constructor(readonly ctrl: BrowserWindowController, opts: TabOptions) {
    const secure: WebPreferences = {
      session: ctrl.session,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      safeDialogs: true,
      navigateOnDragDrop: false,
      spellcheck: true,
      preload: INTERNAL_PRELOAD,
    };
    this.view = new WebContentsView({ webPreferences: opts.openerPreferences ? { ...opts.openerPreferences, ...secure } : secure });
    this.view.setBorderRadius(12);
    this.view.setBackgroundColor('#00000000');
    this.title = opts.title ?? 'New Tab';
    this.favicon = opts.favicon;
    this.pinned = opts.pinned ?? false;
    this.groupId = opts.groupId;
    if (!opts.openerPreferences) {
      const url = opts.url ?? NEW_TAB_URL;
      if (opts.lazy) this.pendingUrl = url;
      else void this.load(url);
    }
  }

  get wc(): WebContents {
    return this.view.webContents;
  }

  get url(): string {
    if (this.pendingUrl) return this.pendingUrl;
    if (this.wc.isDestroyed()) return '';
    return this.wc.getURL();
  }

  async load(url: string, typed = false) {
    this.pendingUrl = undefined;
    this.error = undefined;
    this.crashed = false;
    this.typedNavigation = typed;
    try {
      await this.wc.loadURL(url);
    } catch {
      // Failures are reported through did-fail-load and rendered as an error page.
    }
  }

  /** Loads a lazily-restored tab when it is first shown. */
  ensureLoaded() {
    if (this.pendingUrl) void this.load(this.pendingUrl);
  }

  async probeReader() {
    if (this.wc.isDestroyed() || !/^https?:/.test(this.wc.getURL())) {
      this.readerAvailable = false;
      return;
    }
    try {
      this.readerAvailable = Boolean(await this.wc.executeJavaScriptInIsolatedWorld(999, [{ code: READER_PROBE }]));
    } catch {
      this.readerAvailable = false;
    }
  }

  async captureThumbnail() {
    if (this.wc.isDestroyed() || this.pendingUrl) return;
    try {
      const img = await this.wc.capturePage();
      if (!img.isEmpty()) this.thumbnail = img.resize({ width: 480 }).toDataURL();
    } catch { /* view not paintable */ }
  }

  state(hasPasswords: boolean, isBookmarked: boolean): TabState {
    const destroyed = this.wc.isDestroyed();
    const url = this.url;
    return {
      id: this.id,
      url,
      title: this.title || url,
      favicon: this.favicon,
      loading: !destroyed && !this.pendingUrl && this.wc.isLoading(),
      canGoBack: !destroyed && this.wc.navigationHistory.canGoBack(),
      canGoForward: !destroyed && this.wc.navigationHistory.canGoForward(),
      audible: !destroyed && this.wc.isCurrentlyAudible(),
      muted: !destroyed && this.wc.isAudioMuted(),
      pinned: this.pinned,
      zoom: destroyed ? 0 : this.wc.getZoomLevel(),
      error: this.error,
      crashed: this.crashed,
      discarded: Boolean(this.pendingUrl),
      isBookmarked,
      secure: securityStateOf(url),
      groupId: this.groupId,
      trackersBlocked: this.trackersBlocked,
      security: this.security,
      hasPasswords,
      readerAvailable: this.readerAvailable,
      thumbnail: undefined, // sent separately (large)
    };
  }

  destroy() {
    this.closing = true;
    if (!this.wc.isDestroyed()) this.wc.close();
  }
}
