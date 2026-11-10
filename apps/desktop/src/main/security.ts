// Rovian Defender inside the browser: pre-navigation checks, tracker blocking, HTTPS-first,
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


const ROVIAN_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 230"> <defs> <linearGradient id="rvg" x1="0.1" y1="0.95" x2="0.9" y2="0.05"><stop offset="0" stop-color="#6FF0C6"/><stop offset="0.3" stop-color="#1AA8DA"/><stop offset="0.62" stop-color="#1450F0"/><stop offset="0.82" stop-color="#1AA3DC"/><stop offset="1" stop-color="#74F4C8"/></linearGradient> <clipPath id="rvs"><path d="M100 6 C132 20 162 25 192 25 C194 118 160 190 100 226 C40 190 6 118 8 25 C38 25 68 20 100 6 Z"/></clipPath> </defs> <g clip-path="url(#rvs)"> <rect width="200" height="230" fill="url(#rvg)"/> <g fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round"> <path id="arm" d="M96 118 C132 128 170 92 162 -8"/> <use href="#arm" transform="rotate(120 100 116)"/> <use href="#arm" transform="rotate(240 100 116)"/> </g> <circle cx="100" cy="116" r="9" fill="#fff"/> </g> </svg>`;

/** Rovian Defender's "advert blocked" card, shown in place of a blocked ad frame. */
export function adBlockedHtml(malicious: boolean, host: string): string {
  const esc = (x: string) => x.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const line = malicious
    ? 'This advert is suspected to download <b class="m">MALWARE</b> onto your device.'
    : 'This advert tracks you across websites, so Rovian Defender stopped it.';
  const html = `<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>
html,body,:host{margin:0;height:100%;display:block;font-family:"Segoe UI Variable Display","Segoe UI",system-ui,-apple-system,sans-serif;background:#fff;color:#0b0b0f;overflow:hidden;container-type:size}
@media (prefers-color-scheme:dark){html,body,:host{background:#0f1116;color:#f2f4f8}}
.w{position:relative;height:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:4cqw;padding:4cqh 6cqw 14cqh}
svg{height:min(70cqh,240px);width:auto;flex-shrink:0;filter:drop-shadow(0 8px 24px rgba(20,80,240,.25))}
.t{min-width:0}
h1{margin:0;font-weight:800;font-size:clamp(11px,min(6cqw,14cqh),64px);line-height:1.05;letter-spacing:-.01em}
h1 span{background:linear-gradient(90deg,#5fd8e8,#1aa3dc 45%,#1450f0);-webkit-background-clip:text;background-clip:text;color:transparent}
p{margin:.45em 0 0;font-weight:650;font-size:clamp(8px,min(2.2cqw,7cqh),22px)}
.m{font-weight:800;background:linear-gradient(90deg,#5fd8e8,#1450f0);-webkit-background-clip:text;background-clip:text;color:transparent}
.f{position:absolute;left:0;right:0;bottom:4cqh;text-align:center;font-weight:700;font-size:clamp(8px,min(1.6cqw,6cqh),16px)}
.f span{color:#9aa0aa;font-weight:600}.h{opacity:.55;font-weight:500}
@container (max-height:140px){svg,.f{display:none}.w{padding:4cqh 5cqw}}
@container (max-width:260px){svg{display:none}p{display:none}}
</style><div class="w">${ROVIAN_MARK}<div class="t"><h1>This Advert Has Been <span>Blocked</span>.</h1><p>${line}</p></div>
<div class="f">Rovian<span>Defender</span> <span class="h">· ${esc(host)}</span></div></div>`;
  return html;
}

const EMPTY_STATS: SecurityStats = { blockedSites: 0, warnedSites: 0, blockedTrackers: 0, blockedDownloads: 0, flaggedDownloads: 0 };

export interface TabHooks {
  /** Top-level navigation about to start. Return true to cancel it (the hook shows the warning page). */
  onMainFrame(wc: WebContents | null, url: string): boolean;
  /** Called for each blocked tracker request so the owning tab's counter can update. */
  onTrackerBlocked(wc: WebContents | null): void;
  /** A blocked ad frame: the page shows Rovian Defender's card in its place. */
  onAdFrameBlocked(wc: WebContents | null, frameUrl: string, html: string): void;
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
      // Ad frames flagged as dangerous are blocked even if they're not on the tracker list.
      const verdict = details.resourceType === 'subFrame' ? this.check(details.url) : null;
      const malicious = Boolean(verdict && verdict.action !== 'allow');
      if (r.block || malicious) {
        this.trackerTally++;
        this.hooks.onTrackerBlocked(wc);
        if (details.resourceType === 'subFrame') {
          if (malicious) this.log({ type: 'site-blocked', url: details.url, category: verdict?.category, detail: 'Blocked an advert suspected of spreading malware.' });
          this.hooks.onAdFrameBlocked(wc, details.url, adBlockedHtml(malicious, host));
        }
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
    // The settings that decide how private browsing is. Shown as they are, not turned into a score.
    const privateEngines = ['duckduckgo', 'brave', 'startpage', 'nude'];
    const checks = [
      { id: 'level', label: 'Enhanced or Maximum Protection', on: s.protectionLevel !== 'standard', hint: 'Settings → Privacy → Protection level' },
      { id: 'lists', label: 'Threat lists updated this week', on: !!d.listsUpdated && Date.now() - d.listsUpdated < 7 * 86_400_000, hint: 'Check for updates above' },
      { id: 'search', label: 'A search engine that doesn\'t profile you', on: privateEngines.includes(s.searchEngine), hint: 'Settings → Search' },
      { id: 'history', label: 'History cleared when Nude closes', on: !!s.clearHistoryOnExit, hint: 'Settings → Privacy' },
    ];
    return {
      level: s.protectionLevel,
      checks,
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
