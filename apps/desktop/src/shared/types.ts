// Types shared by the main process, preloads and renderers.

export type ThemeSetting = 'system' | 'light' | 'dark';
export type StartupSetting = 'restore' | 'newtab' | 'homepage';
export type SearchEngineId = 'nude' | 'duckduckgo' | 'google' | 'bing' | 'brave' | 'ecosia' | 'startpage';
export type ProtectionLevel = 'standard' | 'enhanced' | 'maximum';
export type BrowseMode = 'everyday' | 'shopping' | 'research' | 'study' | 'focus';
export type ToolbarItem = 'home' | 'reader' | 'split' | 'overview' | 'downloads' | 'security' | 'ai' | 'voice' | 'bookmarks';

export interface Settings {
  theme: ThemeSetting;
  searchEngine: SearchEngineId;
  searchSuggestions: boolean;
  startup: StartupSetting;
  homepage: string;
  showHomeButton: boolean;
  showBookmarksBar: boolean;
  downloadsDirectory: string; // empty = OS default
  askWhereToSave: boolean;
  notifyOnDownloadComplete: boolean;
  /** Ctrl+Click opens link in a background tab (true) or foreground (false). */
  openLinksInBackground: boolean;
  defaultZoom: number; // zoom level, 0 = 100%
  reduceMotion: boolean;
  fontSize: 'small' | 'medium' | 'large';
  accentColor: string; // '' = Nude OS / system accent
  protectionLevel: ProtectionLevel;
  /** Nude services. Empty = local development defaults. */
  searchServerUrl: string;
  aiGatewayUrl: string;
  threatIntelUrl: string;
  serviceToken: string;
  clearHistoryOnExit: boolean;
  offerToSavePasswords: boolean;
  toolbar: ToolbarItem[];
  aiEnabled: boolean;
  voiceOutput: boolean;
  mode: BrowseMode;
  /** Nebula answer speed: auto picks fast for chat and thorough when pages or images are shared. */
  nebulaSpeed: 'auto' | 'fast' | 'thorough';
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  searchEngine: 'duckduckgo',
  searchSuggestions: true,
  startup: 'restore',
  homepage: 'nude://newtab',
  showHomeButton: true,
  showBookmarksBar: false,
  downloadsDirectory: '',
  askWhereToSave: false,
  notifyOnDownloadComplete: true,
  openLinksInBackground: true,
  defaultZoom: 0,
  reduceMotion: false,
  fontSize: 'medium',
  accentColor: '',
  protectionLevel: 'standard',
  searchServerUrl: 'http://127.0.0.1:8787',
  aiGatewayUrl: 'http://127.0.0.1:8790',
  threatIntelUrl: 'http://127.0.0.1:8791',
  serviceToken: '',
  clearHistoryOnExit: false,
  offerToSavePasswords: true,
  toolbar: ['reader', 'bookmarks', 'overview', 'security', 'downloads', 'ai'],
  aiEnabled: true,
  voiceOutput: false,
  mode: 'everyday',
  nebulaSpeed: 'auto',
};

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  folder: string; // '' = top level / bookmarks bar
  createdAt: number;
}

export interface HistoryEntry {
  url: string;
  title: string;
  favicon?: string;
  lastVisit: number;
  visitCount: number;
  typedCount: number;
}

export interface Shortcut {
  id: string;
  title: string;
  url: string;
}

export type DownloadStatus = 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted';

export interface DownloadInfo {
  id: string;
  url: string;
  filename: string;
  savePath: string;
  mimeType: string;
  totalBytes: number;
  receivedBytes: number;
  status: DownloadStatus;
  startedAt: number;
  endedAt?: number;
  private: boolean;
  risk?: 'low' | 'medium' | 'high' | 'dangerous';
  securityNotes?: string[];
  /** Waiting for the user to keep or discard after a Rovian Defender warning. */
  awaitingDecision?: boolean;
  blocked?: boolean;
  /** True if the file has since been moved or deleted. */
  missing?: boolean;
}

export type PermissionKind =
  | 'notifications' | 'geolocation' | 'camera' | 'microphone' | 'midi'
  | 'clipboard-read' | 'display-capture' | 'openExternal' | 'idle-detection' | 'storage-access';

export type PermissionDecision = 'allow' | 'block';

export interface SitePermission {
  origin: string;
  permission: PermissionKind;
  decision: PermissionDecision;
  updatedAt: number;
}

export interface PermissionPrompt {
  id: string;
  tabId: number;
  origin: string;
  permissions: PermissionKind[];
  externalUrl?: string;
}

export interface TabState {
  id: number;
  url: string;
  title: string;
  favicon?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  audible: boolean;
  muted: boolean;
  pinned: boolean;
  zoom: number; // zoom level
  error?: { code: number; description: string; url: string };
  crashed?: boolean;
  /** Restored or background tab that hasn't loaded yet. */
  discarded?: boolean;
  isBookmarked: boolean;
  secure: 'secure' | 'insecure' | 'internal' | 'file' | 'none';
  groupId?: string;
  trackersBlocked: number;
  security: 'safe' | 'warning' | 'blocked' | 'unknown';
  hasPasswords: boolean;
  readerAvailable: boolean;
  thumbnail?: string;
  /** Address to display instead of url (the blocked site on Rovian Defender's warning page). */
  shownUrl?: string;
}

export interface TabGroup { id: string; name: string; color: string; collapsed: boolean }

/** A recently closed tab (newest last). */
export interface ClosedTabInfo { url: string; title: string; index: number }

/** An image or video found on the page, for Nebula's Media view. */
export interface PageMedia { src: string; alt: string; width: number; height: number; kind: 'image' | 'video' }

/** Something the user saved from Nebula. */
export interface NebulaNote { id: string; text: string; title: string; url?: string; createdAt: number }

export interface SecurityEvent {
  time: number;
  type: 'site-blocked' | 'site-warned' | 'download-blocked' | 'download-warned' | 'download-flagged' | 'bypass' | 'tracker-summary' | 'scan' | 'lists-updated';
  url?: string;
  category?: string;
  detail: string;
}

export interface SecurityStats {
  blockedSites: number;
  warnedSites: number;
  blockedTrackers: number;
  blockedDownloads: number;
  flaggedDownloads: number;
}

export interface PasswordPrompt { id: string; origin: string; username: string; update: boolean }
export interface DownloadPrompt { id: string; filename: string; risk: string; notes: string[] }

export interface AiSource { id: string; kind: 'page' | 'selection' | 'tab' | 'file' | 'security' | 'search' | 'products' | 'image'; title: string; url?: string }

export interface PageProduct { name: string; price?: string; currency?: string; image?: string; url?: string; rating?: string }

export interface AccountInfo { id: string; name: string; firstName: string; email: string; color: string; photo?: string; initials: string }

export interface FindState {
  open: boolean;
  text: string;
  activeMatch: number;
  matches: number;
}

export interface DownloadSummary {
  active: number;
  progress: number; // 0..1 across active downloads, -1 if unknown
  unseenCompleted: number;
}

export interface WindowState {
  windowId: number;
  private: boolean;
  tabs: TabState[];
  activeTabId: number | null;
  bookmarksBar: Bookmark[];
  settings: Pick<Settings, 'theme' | 'showHomeButton' | 'showBookmarksBar' | 'reduceMotion' | 'searchEngine'>;
  downloads: DownloadSummary;
  permissionPrompt: PermissionPrompt | null;
  find: FindState;
  fullscreen: boolean;
  htmlFullscreen: boolean;
  maximized: boolean;
  platform: NodeJS.Platform;
  canReopenClosedTab: boolean;
  groups: TabGroup[];
  passwordPrompt: PasswordPrompt | null;
  downloadPrompt: DownloadPrompt | null;
  protectionLevel: ProtectionLevel;
  toolbar: ToolbarItem[];
  aiEnabled: boolean;
  accentColor: string;
  mode: BrowseMode;
  account: AccountInfo | null;
  theme: ThemeSetting;
  nebulaActive: boolean;
}

export type SuggestionKind = 'url' | 'search' | 'history' | 'bookmark' | 'tab' | 'remote' | 'ai';

export interface Suggestion {
  kind: SuggestionKind;
  /** Primary text shown. */
  title: string;
  /** Secondary text (URL). */
  detail?: string;
  /** What to navigate to / the input to resolve. */
  value: string;
  favicon?: string;
  tabId?: number;
  score: number;
}

export interface ContentBounds { x: number; y: number; width: number; height: number }

/** Commands the main process sends to the chrome UI. */
export type ChromeCommand =
  | { type: 'focus-omnibox' }
  | { type: 'open-find' }
  | { type: 'open-menu' }
  | { type: 'toast'; message: string }
  | { type: 'toggle-ai' }
  | { type: 'ai-prompt'; prompt: string; context: Partial<Record<'page' | 'selection' | 'security', boolean>> }
  | { type: 'toggle-overview' }
  | { type: 'nebula-activity'; active: boolean };

export interface ClearDataOptions {
  range: 'hour' | 'day' | 'week' | 'month' | 'all';
  history: boolean;
  cookies: boolean;
  cache: boolean;
  downloads: boolean;
  permissions: boolean;
}

export interface InternalEvent {
  topic: 'settings' | 'bookmarks' | 'history' | 'downloads' | 'permissions' | 'shortcuts' | 'security' | 'passwords' | 'account' | 'notes';
}
