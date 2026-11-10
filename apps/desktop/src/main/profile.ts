// The user's profile: settings, bookmarks, history, shortcuts, site permissions,
// download records and the last session. All persisted as JSON in the user-data folder.
import { WALLPAPER_IDS } from '../shared/wallpapers';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonStore } from './store';
import {
  DEFAULT_SETTINGS, type Bookmark, type DownloadInfo, type HistoryEntry, type InternalEvent,
  type PermissionDecision, type PermissionKind, type Settings, type Shortcut, type SitePermission, type TabGroup, type NebulaNote,
} from '../shared/types';

export interface SavedTab { url: string; title: string; pinned: boolean; favicon?: string; groupId?: string }
export interface SavedWindow {
  bounds: { x: number; y: number; width: number; height: number };
  maximized: boolean;
  tabs: SavedTab[];
  activeIndex: number;
  groups?: TabGroup[];
}
export interface SessionData { windows: SavedWindow[]; cleanExit: boolean }

const MAX_HISTORY = 20_000;
const MAX_DOWNLOADS = 500;

export const DEFAULT_SHORTCUTS: Shortcut[] = [
  { id: 'wikipedia', title: 'Wikipedia', url: 'https://www.wikipedia.org/' },
  { id: 'github', title: 'GitHub', url: 'https://github.com/' },
  { id: 'news24', title: 'News24', url: 'https://www.news24.com/' },
  { id: 'youtube', title: 'YouTube', url: 'https://www.youtube.com/' },
];

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

/** Keeps only known keys with the right primitive type. */
export function sanitizeSettingsPatch(patch: unknown): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (!patch || typeof patch !== 'object') return out;
  for (const key of SETTING_KEYS) {
    const v = (patch as Record<string, unknown>)[key];
    if (v !== undefined && typeof v === typeof DEFAULT_SETTINGS[key]) (out as Record<string, unknown>)[key] = v;
  }
  if (out.defaultZoom !== undefined) out.defaultZoom = Math.max(-3, Math.min(5, out.defaultZoom));
  const oneOf = <K extends keyof Settings>(k: K, allowed: readonly string[]) => {
    if (out[k] !== undefined && !allowed.includes(out[k] as string)) delete out[k];
  };
  oneOf('theme', ['system', 'light', 'dark']);
  oneOf('startup', ['restore', 'newtab', 'homepage']);
  oneOf('searchEngine', ['nude', 'duckduckgo', 'google', 'bing', 'brave', 'ecosia', 'startpage']);
  oneOf('protectionLevel', ['standard', 'enhanced', 'maximum']);
  oneOf('fontSize', ['small', 'medium', 'large']);
  oneOf('mode', ['everyday', 'shopping', 'research', 'study', 'focus']);
  oneOf('nebulaSpeed', ['auto', 'fast', 'thorough']);
  oneOf('nebulaEngine', ['auto', 'ollama', 'gateway']);
  oneOf('wallpaper', WALLPAPER_IDS);
  if (out.ollamaModel !== undefined) out.ollamaModel = String(out.ollamaModel).replace(/[^\w.:/-]/g, '').slice(0, 100);
  if (out.ollamaUrl !== undefined && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(String(out.ollamaUrl))) out.ollamaUrl = 'http://127.0.0.1:11434';
  if (out.toolbar !== undefined) {
    const items = ['home', 'reader', 'overview', 'downloads', 'security', 'ai', 'voice', 'bookmarks'];
    out.toolbar = Array.isArray(out.toolbar) ? [...new Set(out.toolbar.filter((t) => items.includes(t)))] as Settings['toolbar'] : undefined;
    if (!out.toolbar) delete out.toolbar;
  }
  if (out.accentColor !== undefined && out.accentColor !== '' && !/^#[0-9a-f]{6}$/i.test(out.accentColor)) delete out.accentColor;
  for (const k of ['searchServerUrl', 'aiGatewayUrl', 'threatIntelUrl'] as const) {
    if (out[k] !== undefined && out[k] !== '' && !isWebUrl(out[k] as string)) delete out[k];
  }
  if (out.homepage !== undefined && !isWebUrl(out.homepage) && !out.homepage.startsWith('nude://')) delete out.homepage;
  if (out.serviceToken !== undefined) out.serviceToken = out.serviceToken.slice(0, 500);
  return out;
}

export class Profile extends EventEmitter {
  readonly settings: JsonStore<Settings>;
  readonly bookmarks: JsonStore<Bookmark[]>;
  readonly history: JsonStore<HistoryEntry[]>;
  readonly shortcuts: JsonStore<Shortcut[]>;
  readonly permissions: JsonStore<SitePermission[]>;
  readonly downloads: JsonStore<DownloadInfo[]>;
  readonly session: JsonStore<SessionData>;
  /** Answers and clips saved from Nebula. */
  readonly notes: JsonStore<NebulaNote[]>;
  private historyIndex = new Map<string, HistoryEntry>();

  constructor(readonly dir: string) {
    super();
    this.settings = new JsonStore(join(dir, 'settings.json'), () => ({ ...DEFAULT_SETTINGS }), 200,
      (raw) => ({ ...DEFAULT_SETTINGS, ...sanitizeSettingsPatch(raw) }));
    this.bookmarks = new JsonStore<Bookmark[]>(join(dir, 'bookmarks.json'), () => []);
    this.history = new JsonStore<HistoryEntry[]>(join(dir, 'history.json'), () => [], 2000);
    this.shortcuts = new JsonStore<Shortcut[]>(join(dir, 'shortcuts.json'), () => DEFAULT_SHORTCUTS.map((s) => ({ ...s })));
    this.permissions = new JsonStore<SitePermission[]>(join(dir, 'permissions.json'), () => []);
    this.downloads = new JsonStore<DownloadInfo[]>(join(dir, 'downloads.json'), () => [],
      400, (raw) => (Array.isArray(raw) ? (raw as DownloadInfo[]) : []).map((d) =>
        d.status === 'progressing' || d.status === 'paused' ? { ...d, status: 'interrupted' as const } : d));
    this.session = new JsonStore<SessionData>(join(dir, 'session.json'), () => ({ windows: [], cleanExit: true }), 1000);
    this.notes = new JsonStore<NebulaNote[]>(join(dir, 'nebula-notes.json'), () => []);
    for (const h of this.history.get()) this.historyIndex.set(h.url, h);

    const wire = (store: JsonStore<unknown>, topic: InternalEvent['topic']) =>
      store.onChange(() => this.emit('changed', { topic } satisfies InternalEvent));
    wire(this.settings as JsonStore<unknown>, 'settings');
    wire(this.notes as JsonStore<unknown>, 'notes');
    wire(this.bookmarks as JsonStore<unknown>, 'bookmarks');
    wire(this.history as JsonStore<unknown>, 'history');
    wire(this.shortcuts as JsonStore<unknown>, 'shortcuts');
    wire(this.permissions as JsonStore<unknown>, 'permissions');
    wire(this.downloads as JsonStore<unknown>, 'downloads');
  }

  flushAll() {
    for (const s of [this.settings, this.bookmarks, this.history, this.shortcuts, this.permissions, this.downloads, this.session, this.notes] as JsonStore<unknown>[]) {
      try {
        s.flush();
      } catch (err) {
        console.error('[profile] flush failed', s.file, err);
      }
    }
  }

  // ---------- settings ----------
  addNote(n: { text: string; title: string; url?: string }): NebulaNote {
    const note: NebulaNote = { id: randomUUID(), text: n.text.slice(0, 50_000), title: n.title.slice(0, 200), url: n.url && /^https?:/.test(n.url) ? n.url.slice(0, 2000) : undefined, createdAt: Date.now() };
    this.notes.set((list) => [note, ...list].slice(0, 500));
    return note;
  }

  removeNote(id: string) {
    this.notes.set((list) => list.filter((n) => n.id !== id));
  }

  updateSettings(patch: unknown): Settings {
    const clean = sanitizeSettingsPatch(patch);
    return this.settings.set((prev) => ({ ...prev, ...clean }));
  }

  // ---------- bookmarks ----------
  findBookmark(url: string): Bookmark | undefined {
    return this.bookmarks.get().find((b) => b.url === url);
  }

  addBookmark(input: { url: string; title: string; favicon?: string; folder?: string }): Bookmark {
    const existing = this.findBookmark(input.url);
    if (existing) return existing;
    const b: Bookmark = { id: randomUUID(), url: input.url, title: input.title || input.url,
      favicon: input.favicon, folder: input.folder ?? '', createdAt: Date.now() };
    this.bookmarks.set((list) => [...list, b]);
    return b;
  }

  updateBookmark(id: string, patch: { title?: string; url?: string; folder?: string }) {
    this.bookmarks.set((list) => list.map((b) => (b.id === id ? {
      ...b,
      ...(typeof patch.title === 'string' ? { title: patch.title.slice(0, 500) } : {}),
      ...(typeof patch.url === 'string' && isWebUrl(patch.url) ? { url: patch.url } : {}),
      ...(typeof patch.folder === 'string' ? { folder: patch.folder.slice(0, 200) } : {}),
    } : b)));
  }

  removeBookmark(id: string) {
    this.bookmarks.set((list) => list.filter((b) => b.id !== id));
  }

  moveBookmark(id: string, toIndex: number) {
    this.bookmarks.set((list) => {
      const from = list.findIndex((b) => b.id === id);
      if (from < 0) return list;
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, item);
      return next;
    });
  }

  toggleBookmark(url: string, title: string, favicon?: string): boolean {
    const existing = this.findBookmark(url);
    if (existing) {
      this.removeBookmark(existing.id);
      return false;
    }
    this.addBookmark({ url, title, favicon });
    return true;
  }

  // ---------- history ----------
  recordVisit(url: string, title: string, typed = false) {
    if (!isWebUrl(url)) return;
    const now = Date.now();
    const prev = this.historyIndex.get(url);
    const entry: HistoryEntry = prev
      ? { ...prev, title: title || prev.title, lastVisit: now, visitCount: prev.visitCount + 1, typedCount: prev.typedCount + (typed ? 1 : 0) }
      : { url, title, lastVisit: now, visitCount: 1, typedCount: typed ? 1 : 0 };
    this.historyIndex.set(url, entry);
    this.history.set((list) => {
      const next = list.filter((h) => h.url !== url);
      next.push(entry);
      if (next.length > MAX_HISTORY) {
        next.sort((a, b) => a.lastVisit - b.lastVisit);
        for (const dropped of next.splice(0, next.length - MAX_HISTORY)) this.historyIndex.delete(dropped.url);
      }
      return next;
    });
  }

  updateHistoryMeta(url: string, meta: { title?: string; favicon?: string }) {
    const prev = this.historyIndex.get(url);
    if (!prev) return;
    if ((meta.title === undefined || meta.title === prev.title) && (meta.favicon === undefined || meta.favicon === prev.favicon)) return;
    const entry = { ...prev, ...(meta.title ? { title: meta.title } : {}), ...(meta.favicon ? { favicon: meta.favicon } : {}) };
    this.historyIndex.set(url, entry);
    this.history.set((list) => list.map((h) => (h.url === url ? entry : h)));
  }

  queryHistory(opts: { query?: string; limit?: number; before?: number }): HistoryEntry[] {
    const q = (opts.query ?? '').trim().toLowerCase();
    const before = opts.before ?? Infinity;
    return this.history.get()
      .filter((h) => h.lastVisit < before && (!q || h.url.toLowerCase().includes(q) || h.title.toLowerCase().includes(q)))
      .sort((a, b) => b.lastVisit - a.lastVisit)
      .slice(0, Math.min(opts.limit ?? 200, 1000));
  }

  removeHistory(urls: string[]) {
    const set = new Set(urls);
    for (const u of set) this.historyIndex.delete(u);
    this.history.set((list) => list.filter((h) => !set.has(h.url)));
  }

  clearHistorySince(since: number) {
    this.history.set((list) => list.filter((h) => h.lastVisit < since));
    this.historyIndex = new Map(this.history.get().map((h) => [h.url, h]));
  }

  topSites(limit = 8): HistoryEntry[] {
    return [...this.history.get()]
      .filter((h) => /^https?:/.test(h.url))
      .sort((a, b) => (b.visitCount + b.typedCount * 2) - (a.visitCount + a.typedCount * 2) || b.lastVisit - a.lastVisit)
      .slice(0, limit);
  }

  // ---------- shortcuts (new tab tiles) ----------
  addShortcut(title: string, url: string): Shortcut | null {
    if (!isWebUrl(url)) return null;
    const s = { id: randomUUID(), title: (title || new URL(url).host).slice(0, 80), url };
    this.shortcuts.set((list) => [...list, s].slice(0, 24));
    return s;
  }

  removeShortcut(id: string) {
    this.shortcuts.set((list) => list.filter((s) => s.id !== id));
  }

  // ---------- permissions ----------
  getPermission(origin: string, permission: PermissionKind): PermissionDecision | undefined {
    return this.permissions.get().find((p) => p.origin === origin && p.permission === permission)?.decision;
  }

  setPermission(origin: string, permission: PermissionKind, decision: PermissionDecision) {
    this.permissions.set((list) => [
      ...list.filter((p) => !(p.origin === origin && p.permission === permission)),
      { origin, permission, decision, updatedAt: Date.now() },
    ]);
  }

  revokePermission(origin: string, permission?: PermissionKind) {
    this.permissions.set((list) => list.filter((p) => !(p.origin === origin && (!permission || p.permission === permission))));
  }

  // ---------- downloads ----------
  upsertDownload(d: DownloadInfo) {
    if (d.private) return;
    this.downloads.set((list) => {
      const i = list.findIndex((x) => x.id === d.id);
      const next = i >= 0 ? list.map((x, j) => (j === i ? d : x)) : [d, ...list];
      return next.slice(0, MAX_DOWNLOADS);
    });
  }

  removeDownload(id: string) {
    this.downloads.set((list) => list.filter((d) => d.id !== id));
  }

  clearDownloadsSince(since: number) {
    this.downloads.set((list) => list.filter((d) => d.status === 'progressing' || d.startedAt < since));
  }
}

export function isWebUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
