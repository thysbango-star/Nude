// Nude Security inside the browser: pre-navigation checks, tracker blocking, HTTPS-first,
// download checks and the security event log. Built on @nude/security-engine.
import { net, type Session, type WebContents } from 'electron';
import { join } from 'node:path';
import { openSync, readSync, closeSync } from 'node:fs';
import {
  analyzeUrl, analyzeDownload, inspectFileHeader, shouldBlockRequest, emptyLists, registrableDomain,
  type ThreatLists, type UrlVerdict, type ThreatCategory,
} from '@nude/security-engine';
import { JsonStore } from './store';
import type { Profile } from './profile';
import type { SecurityEvent, SecurityStats } from '../shared/types';

interface SecurityData {
  events: SecurityEvent[];
  stats: SecurityStats;
  lastScan: number;
  listsUpdated: number;
  /** User-added trusted sites (registrable domains). */
  trusted: string[];
  /** Cached threat lists from the threat-intel service. */
  cache: { domains: [string, ThreatCategory][]; urls: [string, ThreatCategory][] };
}

const EMPTY_STATS: SecurityStats = { blockedSites: 0, warnedSites: 0, blockedTrackers: 0, blockedDownloads: 0, flaggedDownloads: 0 };

export interface TabHooks {
  /** Top-level navigation about to start. Return true to cancel it (the hook shows the warning page). */
  onMainFrame(wc: WebContents | null, url: string): boolean;
  /** Called for each blocked tracker request so the owning tab's counter can update. */
  onTrackerBlocked(wc: WebContents | null): void;
  firstPartyHost(wc: WebContents | null): string | null;
}

export class SecurityService {
  readonly store: JsonStore<SecurityData>;
  private lists: ThreatLists = emptyLists();
  /** Per-tab one-time bypasses: tabId → hosts the user chose to visit anyway. */
  private bypass = new Map<number, Set<string>>();
  private trackerTally = 0;

  constructor(private profile: Profile, dir: string, private hooks: TabHooks) {
    this.store = new JsonStore<SecurityData>(join(dir, 'security.json'), () => ({
      events: [], stats: { ...EMPTY_STATS }, lastScan: 0, listsUpdated: 0, trusted: [], cache: { domains: [], urls: [] },
    }), 1500);
    this.rebuildLists();
    setInterval(() => this.flushTrackerTally(), 60_000).unref();
  }

  get level() {
    return this.profile.settings.get().protectionLevel;
  }

  private rebuildLists() {
    const d = this.store.get();
    this.lists = { domains: new Map(d.cache.domains), urls: new Map(d.cache.urls), allow: new Set(d.trusted) };
  }

  log(e: Omit<SecurityEvent, 'time'>) {
    this.store.set((d) => ({ ...d, events: [{ ...e, time: Date.now() }, ...d.events].slice(0, 300) }));
    this.profile.emit('changed', { topic: 'security' });
  }

  private bump(k: keyof SecurityStats, n = 1) {
    this.store.set((d) => ({ ...d, stats: { ...d.stats, [k]: d.stats[k] + n } }));
  }

  private flushTrackerTally() {
    if (!this.trackerTally) return;
    this.bump('blockedTrackers', this.trackerTally);
    this.trackerTally = 0;
    this.profile.emit('changed', { topic: 'security' });
  }

  check(url: string): UrlVerdict {
    return analyzeUrl(url, this.lists, this.level);
  }

  /** Decision for a top-level navigation in a tab. */
  checkNavigation(tabId: number, url: string): UrlVerdict | null {
    const v = this.check(url);
    if (v.action === 'allow') return null;
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch { /* ignore */ }
    if (this.bypass.get(tabId)?.has(host)) return null;
    if (v.action === 'block') this.bump('blockedSites');
    else this.bump('warnedSites');
    this.log({ type: v.action === 'block' ? 'site-blocked' : 'site-warned', url, category: v.category,
      detail: v.signals[0]?.message ?? 'Suspicious site' });
    return v;
  }

  /** The user explicitly chose to continue to a flagged site (never for confirmed malware at Maximum). */
  allowOnce(tabId: number, url: string): boolean {
    const v = this.check(url);
    if (v.confidence === 'confirmed' && this.level === 'maximum') return false;
    const host = new URL(url).hostname;
    if (!this.bypass.has(tabId)) this.bypass.set(tabId, new Set());
    this.bypass.get(tabId)!.add(host);
    this.log({ type: 'bypass', url, category: v.category, detail: 'You chose to visit this site despite a warning.' });
    return true;
  }

  forgetTab(tabId: number) {
    this.bypass.delete(tabId);
  }

  trust(domain: string) {
    const reg = registrableDomain(domain);
    this.store.set((d) => ({ ...d, trusted: [...new Set([...d.trusted, reg])] }));
    this.rebuildLists();
  }

  untrust(domain: string) {
    this.store.set((d) => ({ ...d, trusted: d.trusted.filter((t) => t !== domain) }));
    this.rebuildLists();
  }

  /** Tracker blocking, HTTPS-only upgrade and privacy headers for a session. */
  attach(ses: Session) {
    ses.webRequest.onBeforeRequest((details, cb) => {
      if (details.resourceType === 'mainFrame') {
        if (/^https?:/.test(details.url) && this.hooks.onMainFrame(details.webContents ?? null, details.url)) return cb({ cancel: true });
        return cb({});
      }
      let host: string;
      try {
        host = new URL(details.url).hostname;
      } catch {
        return cb({});
      }
      const wc = details.webContents ?? null;
      const fp = this.hooks.firstPartyHost(wc);
      const r = shouldBlockRequest(host, fp, this.level);
      if (r.block) {
        this.trackerTally++;
        this.hooks.onTrackerBlocked(wc);
        return cb({ cancel: true });
      }
      cb({});
    });
    ses.webRequest.onBeforeSendHeaders((details, cb) => {
      const headers = { ...details.requestHeaders };
      const level = this.level;
      headers['Sec-GPC'] = '1';
      if (level !== 'standard') {
        headers['DNT'] = '1';
        // Strip third-party cookies to known trackers.
        try {
          const host = new URL(details.url).hostname;
          const fp = this.hooks.firstPartyHost(details.webContents ?? null);
          if (fp && registrableDomain(host) !== registrableDomain(fp) && (level === 'maximum' || shouldBlockRequest(host, fp, 'maximum').category)) {
            delete headers.Cookie;
            delete headers.cookie;
          }
        } catch { /* ignore */ }
      }
      cb({ requestHeaders: headers });
    });
  }

  /** Scans the first bytes of a finished download. */
  inspectFile(path: string, filename: string): string[] {
    try {
      const fd = openSync(path, 'r');
      const buf = Buffer.alloc(16);
      readSync(fd, buf, 0, 16, 0);
      closeSync(fd);
      return inspectFileHeader(filename, buf).map((s) => s.message);
    } catch {
      return [];
    }
  }

  checkDownload(filename: string, mimeType: string, url: string, pageUrl: string) {
    const v = analyzeDownload({ filename, mimeType, url, sourceVerdict: this.check(pageUrl || url), level: this.level });
    if (v.action === 'block') {
      this.bump('blockedDownloads');
      this.log({ type: 'download-blocked', url, detail: `${filename}: ${v.signals[0]?.message ?? 'risky file'}` });
    } else if (v.action === 'warn') {
      this.bump('flaggedDownloads');
      this.log({ type: 'download-warned', url, detail: `${filename}: ${v.signals[0]?.message ?? 'risky file'}` });
    }
    return v;
  }

  /** Refreshes threat lists from the configured threat-intel service (if running). */
  async updateLists(): Promise<{ ok: boolean; message: string }> {
    const base = this.profile.settings.get().threatIntelUrl;
    this.store.set((d) => ({ ...d, lastScan: Date.now() }));
    if (!base) return { ok: false, message: 'No threat-intelligence service is configured. Built-in checks are still active.' };
    try {
      const res = await net.fetch(`${base.replace(/\/+$/, '')}/v1/lists`, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { domains?: Record<string, ThreatCategory>; urls?: Record<string, ThreatCategory> };
      const domains = Object.entries(body.domains ?? {}).slice(0, 2_000_000);
      const urls = Object.entries(body.urls ?? {}).slice(0, 2_000_000);
      this.store.set((d) => ({ ...d, listsUpdated: Date.now(), cache: { domains, urls } }));
      this.rebuildLists();
      this.log({ type: 'lists-updated', detail: `Threat lists updated: ${domains.length} domains, ${urls.length} addresses.` });
      return { ok: true, message: `Updated: ${domains.length} known dangerous domains.` };
    } catch (err) {
      this.log({ type: 'scan', detail: 'Couldn\'t reach the threat-intelligence service; using built-in checks and cached lists.' });
      return { ok: false, message: `Couldn't reach the threat service (${(err as Error).message}). Built-in checks are still active.` };
    }
  }

  summary() {
    this.flushTrackerTally();
    const d = this.store.get();
    const s = this.profile.settings.get();
    let score = 50;
    score += { standard: 10, enhanced: 25, maximum: 35 }[s.protectionLevel];
    if (s.clearHistoryOnExit) score += 5;
    if (s.searchEngine === 'duckduckgo' || s.searchEngine === 'brave' || s.searchEngine === 'startpage' || s.searchEngine === 'nude') score += 5;
    if (d.listsUpdated && Date.now() - d.listsUpdated < 7 * 86_400_000) score += 5;
    return {
      level: s.protectionLevel,
      privacyScore: Math.min(100, score),
      stats: d.stats,
      events: d.events.slice(0, 100),
      lastScan: d.lastScan,
      listsUpdated: d.listsUpdated,
      knownThreats: this.lists.domains.size + this.lists.urls.size,
      trusted: d.trusted,
    };
  }

  flush() {
    this.flushTrackerTally();
    this.store.flush();
  }
}
