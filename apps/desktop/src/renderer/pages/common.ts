// Shared helpers for nude:// pages.
export { I, esc, faviconImg, installFaviconFallback } from '../chrome/icons';
import { installFaviconFallback } from '../chrome/icons';

interface InternalBridge { invoke<T = unknown>(cmd: string, ...a: unknown[]): Promise<T>; onEvent(cb: (e: { topic: string }) => void): () => void }
const bridge = (window as unknown as { nudeInternal?: InternalBridge }).nudeInternal;
if (!bridge) throw new Error('Nude internal API unavailable');
export const api = bridge;
installFaviconFallback();

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

export function on(topic: string, cb: () => void) {
  api.onEvent((e) => { if (e.topic === topic) cb(); });
}

/** Follows Nude's own light/dark setting (the OS media query alone isn't reliable everywhere). */
export function applyTheme(theme: string) {
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('theme-dark', dark);
  document.documentElement.classList.toggle('theme-light', !dark);
}
const syncTheme = () => api.invoke<{ settings: { theme: string } }>('settings.get').then((r) => applyTheme(r.settings.theme)).catch(() => {});
syncTheme();
on('settings', syncTheme);

export function timeAgo(t: number): string {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function dayLabel(t: number): string {
  const d = new Date(t); const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function bytes(n: number): string {
  if (n <= 0) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function host(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
}

export function toast(msg: string) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout((t as unknown as { _h: number })._h);
  (t as unknown as { _h: number })._h = window.setTimeout(() => t!.classList.remove('show'), 2400);
}

/** Links inside nude:// pages open through the browser (pages can't navigate themselves to web URLs directly). */
document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-open]');
  if (!a) return;
  e.preventDefault();
  void api.invoke('open', a.dataset.open, e.ctrlKey || e.metaKey || e.button === 1);
});
document.addEventListener('auxclick', (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-open]');
  if (a && e.button === 1) { e.preventDefault(); void api.invoke('open', a.dataset.open, true); }
});
