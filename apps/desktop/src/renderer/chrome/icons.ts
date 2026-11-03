// Stroke icons (24×24, currentColor). Original Nude icon set.
const svg = (body: string, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const I = {
  media: svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 2.5-2 4.5 3.5"/>'),
  notes: svg('<rect x="4" y="4" width="16" height="13" rx="2"/><path d="M8 21l4-4 4 4M8 9h8M8 12.5h5"/>'),
  spaces: svg('<rect x="3.5" y="6" width="12" height="14" rx="2.5"/><path d="M8.5 6V5.5A2 2 0 0 1 10.5 3.5h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3"/>'),
  boosts: svg('<path d="M14.5 3.5l6 6-9.5 9.5-6-6z"/><path d="M5 13l-1.5 7.5L11 19M12 6l6 6"/>'),
  archive: svg('<rect x="3.5" y="4" width="17" height="4.5" rx="1.2"/><path d="M5 8.5v9.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5M10 12.5h4"/>'),
  move: svg('<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>'),
  dots: svg('<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>'),
  tabs: svg('<rect x="3.5" y="7" width="13" height="13" rx="2.5"/><path d="M8 7V6a2.5 2.5 0 0 1 2.5-2.5H18A2.5 2.5 0 0 1 20.5 6v7.5A2.5 2.5 0 0 1 18 16h-1.5"/>'),
  ask: svg('<path d="M4.5 18.5V6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8z"/><path d="M9 9.5h6M9 12.5h4"/>'),
  arrowUp: svg('<path d="M12 19V5M6 11l6-6 6 6"/>', 'stroke-width="2.2"'),
  arrowLeft: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  wand: svg('<path d="M4 20l11-11M14 4v3M12.5 5.5h3M19 9v3M17.5 10.5h3M18 3.5v1.5M17.25 4.25h1.5"/>'),
  chevronDown: svg('<path d="M6 9l6 6 6-6"/>'),
  sliders: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  bag: svg('<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>'),
  compass: svg('<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>'),
  research: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M20 20l-5-5M8 10.5h5M10.5 8v5"/>'),
  study: svg('<path d="M3 9l9-4.5L21 9l-9 4.5z"/><path d="M7 11v4.5c1.5 1.3 3.2 2 5 2s3.5-.7 5-2V11"/>'),
  focus: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  user: svg('<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5"/>'),
  logout: svg('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  link: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>'),
  scale: svg('<path d="M12 4v16M6 20h12M5 8h14"/><path d="M5 8l-2.5 6a3 3 0 0 0 5 0zM19 8l-2.5 6a3 3 0 0 0 5 0z"/>'),
  shirt: svg('<path d="M8 4l-4.5 3 2 4L8 10v10h8V10l2.5 1 2-4L16 4c-.8 1.3-2.2 2-4 2s-3.2-.7-4-2z"/>'),
  trend: svg('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>'),
  quiz: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.1"/>'),
  analyze: svg('<circle cx="12" cy="12" r="8.5" stroke-dasharray="3 3"/><path d="M12 8.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" fill="currentColor"/>'),

  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  forward: svg('<path d="M9 5l7 7-7 7"/>'),
  reload: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  stop: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  home: svg('<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  close: svg('<path d="M7 7l10 10M17 7L7 17"/>', 'stroke-width="2"'),
  star: svg('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
  lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
  unlock: svg('<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2"/>'),
  warn: svg('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2v.1"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.1"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  tab: svg('<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18"/>'),
  shield: svg('<path d="M12 3l7.5 3v5.5c0 4.4-3.1 8.2-7.5 9.5-4.4-1.3-7.5-5.1-7.5-9.5V6z"/>'),
  shieldCheck: svg('<path d="M12 3l7.5 3v5.5c0 4.4-3.1 8.2-7.5 9.5-4.4-1.3-7.5-5.1-7.5-9.5V6z"/><path d="M8.8 12.2l2.2 2.2 4.4-4.6"/>'),
  shieldX: svg('<path d="M12 3l7.5 3v5.5c0 4.4-3.1 8.2-7.5 9.5-4.4-1.3-7.5-5.1-7.5-9.5V6z"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/>'),
  download: svg('<path d="M12 4v11M7 11l5 5 5-5"/><path d="M5 20h14"/>'),
  menu: svg('<circle cx="12" cy="5.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="18.5" r="1.3" fill="currentColor"/>'),
  sparkle: svg('<path d="M12 3.5l1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>'),
  reader: svg('<path d="M4 5.5h6.5a2 2 0 0 1 2 2V20a2 2 0 0 0-2-2H4z"/><path d="M20 5.5h-6.5a2 2 0 0 0-2 2V20a2 2 0 0 1 2-2H20z"/>'),
  split: svg('<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M12 4.5v15"/>'),
  grid: svg('<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>'),
  window: svg('<rect x="3" y="5" width="18" height="14" rx="3"/>'),
  private: svg('<path d="M3 10c3-1.3 6-2 9-2s6 .7 9 2"/><path d="M5 10l1.5-4.5h11L19 10"/><circle cx="8" cy="15.5" r="2.5"/><circle cx="16" cy="15.5" r="2.5"/><path d="M10.5 15.5h3"/>'),
  history: svg('<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4.5h4.5"/><path d="M12 8v4l3 2"/>'),
  bookmarks: svg('<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),
  find: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M8.5 11h5"/>'),
  print: svg('<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="2"/><path d="M7 14h10v6H7z"/>'),
  fullscreen: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  restore: svg('<path d="M9 14H4M14 9V4M14 9h5M9 14v5"/>'),
  minus: svg('<path d="M6 12h12"/>'),
  volume: svg('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  muted: svg('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 10l5 5M21 10l-5 5"/>'),
  pin: svg('<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  share: svg('<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>'),
  send: svg('<path d="M12 19V5M6 11l6-6 6 6"/>', 'stroke-width="2.2"'),
  expand: svg('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
  collapse: svg('<path d="M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7"/>'),
  newchat: svg('<path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M12 9v6M9 12h6"/>'),
  speaker: svg('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 9.5a3.5 3.5 0 0 1 0 5"/>'),
  file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
  page: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
  select: svg('<path d="M5 7V5h2M17 5h2v2M19 17v2h-2M7 19H5v-2"/><path d="M9 10h6M9 14h4"/>'),
  crash: svg('<circle cx="12" cy="12" r="9"/><path d="M9 10v.1M15 10v.1M8.5 16a5 5 0 0 1 7 0"/>'),
  offline: svg('<path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0"/><path d="M12 19.5v.1M3 3l18 18"/>'),
  keyboard: svg('<rect x="2.5" y="6" width="19" height="12" rx="3"/><path d="M6.5 10h.1M10 10h.1M13.5 10h.1M17 10h.1M7 14h10"/>'),
  external: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>'),
  reopen: svg('<path d="M9 14l-5-5 5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  camera: svg('<path d="M15 10l5-3v10l-5-3"/><rect x="3" y="6.5" width="12" height="11" rx="2.5"/>'),
  bell: svg('<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
};

export function faviconImg(src: string | undefined, fallback = I.globe): string {
  if (src && /^(https?:|data:image\/)/.test(src)) return `<img class="fav" src="${escapeAttr(src)}" alt="" referrerpolicy="no-referrer">`;
  return fallback;
}

/** Broken favicons fall back to the globe icon (no inline handlers: the UI's CSP forbids them). */
export function installFaviconFallback(root: Document = document) {
  root.addEventListener('error', (e) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLImageElement && t.classList.contains('fav')) {
      const span = root.createElement('span');
      span.innerHTML = I.globe;
      span.style.display = 'contents';
      t.replaceWith(span);
    }
  }, true);
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
export const escapeAttr = esc;
