// Nebula — Nude's built-in intelligence. Closed by default; it opens as a floating matte panel over the page
// (never beside it) and closes instantly. Nothing from a page is shared unless the user asks.
import type { AiSource, ClosedTabInfo, DownloadInfo, NebulaNote, PageMedia, PageProduct, TabState, WindowState } from '../../shared/types';
import { I, esc, faviconImg } from './icons';
import { renderMarkdown } from './md';

type Bridge = { invoke<T = unknown>(cmd: string, ...a: unknown[]): Promise<T>; onAi(cb: (m: Record<string, unknown>) => void): () => void };
const nude = (window as unknown as { nude: Bridge }).nude;

export type Section = 'ask' | 'spaces' | 'media' | 'downloads' | 'notes' | 'modes' | 'archived';
const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'ask', label: 'Ask', icon: I.ask },
  { id: 'spaces', label: 'Spaces', icon: I.spaces },
  { id: 'media', label: 'Media', icon: I.media },
  { id: 'downloads', label: 'Downloads', icon: I.download },
  { id: 'notes', label: 'Notes', icon: I.notes },
  { id: 'modes', label: 'Modes', icon: I.boosts },
  { id: 'archived', label: 'Archived', icon: I.archive },
];

interface Ctx { title: string; url: string; favicon?: string; product?: PageProduct; image?: string }
interface Msg { role: 'user' | 'assistant'; content: string; prompt?: string; ctx?: Ctx; sources?: AiSource[]; error?: string; notice?: string; pending?: boolean; highlights?: string[]; saved?: boolean }
interface Quick { label: string; icon: string; prompt: string; page: boolean }

export const MODES: Record<string, { label: string; icon: string; desc: string }> = {
  everyday: { label: 'Everyday', icon: I.compass, desc: 'Summaries, explanations and quick answers.' },
  shopping: { label: 'Shopping', icon: I.bag, desc: 'Smart Compare, Mix & Match and Price Pulse on product pages.' },
  research: { label: 'Research', icon: I.research, desc: 'Key facts, sources and fact-checks with citations.' },
  study: { label: 'Study', icon: I.study, desc: 'Study guides, notes and quizzes from what you read.' },
  focus: { label: 'Focus', icon: I.focus, desc: 'Short answers that stick to the page you\'re on.' },
};

const QUICK: Record<string, Quick[]> = {
  shopping: [
    { label: 'Smart Compare', icon: I.scale, prompt: 'Compare the main products on this page: price, quality signals, ratings and value. Recommend the best pick and why. Use product cards and highlight the best one.', page: true },
    { label: 'Mix & Match', icon: I.shirt, prompt: 'Give me outfit or combination ideas using the item I\'m looking at and other items on this page. Explain why each piece works, with product cards.', page: true },
    { label: 'Price Pulse', icon: I.trend, prompt: 'Find the cheapest option on this page and highlight it. Is anything on sale? Point out the best value for money.', page: true },
    { label: 'Reviews', icon: I.star, prompt: 'Summarise what the reviews and ratings on this page say. What are the common complaints?', page: true },
  ],
  research: [
    { label: 'Key facts', icon: I.list, prompt: 'List the key facts and claims on this page, with which parts are supported by evidence.', page: true },
    { label: 'Find sources', icon: I.research, prompt: 'What are the original sources for the main claims on this page? Suggest more reliable sources to check.', page: true },
    { label: 'Fact-check', icon: I.shieldCheck, prompt: 'Which claims on this page might be misleading or need verification? Highlight them.', page: true },
  ],
  study: [
    { label: 'Study guide', icon: I.study, prompt: 'Create a study guide from this page: key ideas, definitions and a short summary.', page: true },
    { label: 'Quiz me', icon: I.quiz, prompt: 'Make 5 quiz questions (with answers at the end) from this page.', page: true },
    { label: 'Notes', icon: I.list, prompt: 'Turn this page into clear, short notes with headings.', page: true },
  ],
  everyday: [
    { label: 'Summarise', icon: I.list, prompt: 'Summarise this page in five points.', page: true },
    { label: 'Explain simply', icon: I.sparkle, prompt: 'Explain this page like I\'m in Grade 8.', page: true },
    { label: 'Key details', icon: I.info, prompt: 'Extract the most important information from this page (dates, prices, names, steps).', page: true },
    { label: 'Is this safe?', icon: I.shield, prompt: 'Is this website safe?', page: false },
  ],
  focus: [
    { label: 'TL;DR', icon: I.list, prompt: 'TL;DR of this page in 2 sentences.', page: true },
    { label: 'Key points', icon: I.focus, prompt: 'The 3 points that matter most on this page.', page: true },
  ],
};

const ANALYZE: Record<string, string> = {
  shopping: 'Analyze this shopping page: what\'s on offer, price range, the best value pick and anything to watch out for. Use product cards and highlight the best value item.',
  research: 'Analyze this page as a research source: main argument, evidence quality, possible bias and what to verify.',
  study: 'Analyze this page for studying: the main topic, key concepts and what I should remember.',
  everyday: 'Analyze this page: what it is, the key points, and anything I should know (including whether it looks trustworthy).',
  focus: 'Analyze this page in three short bullet points.',
};

const SPEEDS = { auto: 'Auto', fast: 'Fast', thorough: 'Deep' } as const;
type Speed = keyof typeof SPEEDS;

export interface NebulaHost {
  getState(): WindowState | null;
  toast(m: string): void;
  /** The neon frame around the page (video 2). */
  setActivity(on: boolean, minMs?: number): void;
  /** Opens the frosted overlay; resolves false if it was closed before it opened. */
  openLayer(build: (layer: HTMLElement) => void, onClose: () => void): Promise<boolean>;
  closeLayer(): void;
  contentRect(): DOMRect;
  button: HTMLElement;
  onToggle(open: boolean): void;
}

export class Nebula {
  private messages: Msg[] = [];
  private openState = false;
  private section: Section = 'spaces';
  private share = { page: false, selection: false };
  private tabIds: number[] = [];
  private files: { name: string; text: string }[] = [];
  private image: PageMedia | null = null;
  private requestId: string | null = null;
  private speed: Speed = 'auto';
  private root: HTMLElement | null = null;
  private media: PageMedia[] | null = null;
  private draft = '';
  private status: { ok: boolean; provider: string } | null = null;

  constructor(private host: NebulaHost) {
    nude.onAi((m) => this.onChunk(m));
  }

  isOpen() { return this.openState; }

  toggle(section?: Section) {
    if (this.openState && (!section || section === this.section)) this.close();
    else void this.open(section);
  }

  async open(section?: Section) {
    if (section) this.section = section;
    else if (this.messages.length) this.section = 'ask';
    if (this.openState) { this.paint(); return; }
    this.openState = true;
    this.host.onToggle(true);
    // The "Nebula is called" moment: the neon frame flares around the page while the panel grows from its button.
    this.host.setActivity(true);
    this.host.setActivity(false, 700);
    this.media = null;
    const opened = await this.host.openLayer((layer) => this.build(layer), () => this.closed());
    if (!opened) { this.openState = false; this.host.onToggle(false); }
    void nude.invoke<{ ok: boolean; provider: string; speed: Speed }>('nebulaStatus').then((s) => {
      this.status = s; this.speed = s.speed ?? 'auto';
      if (this.root) { this.paintTop(); this.paintCompose(); }
    }).catch(() => {});
  }

  close() {
    if (!this.openState) return;
    const r = this.root;
    if (r && !document.documentElement.classList.contains('reduce-motion')) {
      r.classList.add('closing');
      setTimeout(() => this.host.closeLayer(), 140);
    } else this.host.closeLayer();
  }

  private closed() {
    this.saveDraft();
    this.openState = false;
    this.root = null;
    this.host.onToggle(false);
  }

  /** Called when the active tab or mode changes. Page sharing is per page, so it resets. */
  onTabChanged() {
    this.share = { page: false, selection: false };
    this.image = null;
    this.media = null;
    if (this.root) this.paint();
  }

  /** Entry points: context menu, address bar, security panel. */
  ask(prompt: string, ctx: { page?: boolean; selection?: boolean; security?: boolean }) {
    this.share = { page: Boolean(ctx.page), selection: Boolean(ctx.selection) };
    this.section = 'ask';
    const go = () => void this.send(prompt);
    if (this.openState) { this.paint(); go(); } else void this.open('ask').then(go);
  }

  private mode() { return this.host.getState()?.mode ?? 'everyday'; }
  private currentTab(): TabState | undefined { const s = this.host.getState(); return s?.tabs.find((t) => t.id === s.activeTabId); }
  private webPage() { const t = this.currentTab(); return Boolean(t && /^https?:/.test(t.url)); }

  // ---------------------------------------------------------------- layout
  private build(layer: HTMLElement) {
    const r = this.host.contentRect();
    const b = this.host.button.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = 'nebula-panel matte';
    const inset = 10;
    // Anchored to the page card's edges (not a measured size), so it always fits the window.
    Object.assign(box.style, { left: `${r.left + inset}px`, top: `${r.top + inset}px`, right: `${innerWidth - r.right + inset}px`, bottom: `${innerHeight - r.bottom + inset}px` });
    // Grow out of the Nebula button.
    box.style.setProperty('--ox', `${b.left + b.width / 2 - (r.left + inset)}px`);
    box.style.setProperty('--oy', `${b.top + b.height / 2 - (r.top + inset)}px`);
    box.innerHTML = `
      <aside class="nb-rail" aria-label="Nebula sections">
        <div class="dots" aria-hidden="true"><i></i><i></i><i></i></div>
        ${SECTIONS.map((s) => `<button class="sec" data-sec="${s.id}" aria-label="${s.label}">${s.icon}<span>${s.label}</span></button>`).join('')}
        <div class="grow"></div>
        <div class="foot"><button class="icon-btn small" data-a="close" title="Close Nebula (Esc)" aria-label="Close Nebula">${I.arrowLeft}</button>
          <button class="icon-btn small" data-a="settings" title="Nebula settings" aria-label="Nebula settings">${I.settings}</button></div>
      </aside>
      <section class="nb-main">
        <div class="nb-top"></div>
        <div class="nb-body"></div>
        <div class="nb-compose">
          <div class="nb-context"></div>
          <div class="nb-input">
            <button class="icon-btn plus" data-a="add" title="Add context" aria-label="Add context">${I.plus}</button>
            <textarea rows="1" aria-label="Message Nebula"></textarea>
            <button class="speed" data-a="speed" title="Answer speed"></button>
            <button class="send" data-a="send" aria-label="Send">${I.arrowUp}</button>
          </div>
        </div>
      </section>`;
    layer.appendChild(box);
    this.root = box;
    const ta = box.querySelector('textarea')!;
    ta.value = this.draft;
    ta.addEventListener('input', () => { this.autosize(ta); this.paintSend(); });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void this.send(ta.value); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (this.requestId) this.stop(); else this.close(); }
    });
    box.addEventListener('click', (e) => void this.onClick(e));
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape' && e.target === box) this.close(); });
    this.wireSpacesDnD(box);
    this.paint();
    requestAnimationFrame(() => ta.focus());
  }

  private autosize(ta: HTMLTextAreaElement) { ta.style.height = 'auto'; ta.style.height = `${Math.min(160, ta.scrollHeight)}px`; }
  private saveDraft() { const ta = this.root?.querySelector('textarea'); if (ta) this.draft = ta.value; }

  private paint() {
    if (!this.root) return;
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-sec]')) b.classList.toggle('on', b.dataset.sec === this.section);
    this.paintTop();
    this.paintBody();
    this.paintCompose();
  }

  private paintTop() {
    const top = this.root?.querySelector<HTMLElement>('.nb-top');
    if (!top) return;
    const t = this.currentTab();
    const title = SECTIONS.find((s) => s.id === this.section)!.label;
    const right: Record<Section, string> = {
      ask: `${this.webPage() ? `<button class="chip" data-a="analyze">${I.analyze}Analyze this page</button>` : ''}${this.messages.length ? `<button class="icon-btn small" data-a="new" title="New conversation" aria-label="New conversation">${I.edit}</button>` : ''}`,
      spaces: `<button class="chip" data-a="tidy">${I.wand}Tidy tabs into spaces</button>`,
      media: `<button class="icon-btn small" data-a="media-refresh" title="Look again" aria-label="Refresh">${I.reload}</button>`,
      downloads: `<button class="chip" data-a="all-downloads">${I.download}All downloads</button>`,
      notes: '', modes: '',
      archived: `<button class="chip" data-a="history">${I.history}History</button>`,
    };
    const offline = this.status && !this.status.ok ? `<button class="chip" data-a="setup" title="Nebula can't reach its gateway">${I.warn}Set up Nebula</button>` : '';
    top.innerHTML = `<h2>${this.section === 'ask' ? '<span class="orb xs"></span>' : ''}${title}</h2>
      <span class="page-title">${t && t.url && !t.url.startsWith('nude://newtab') ? `${esc(t.title || t.url)}` : ''}</span>${offline}${right[this.section]}`;
  }

  private paintBody() {
    const body = this.root?.querySelector<HTMLElement>('.nb-body');
    if (!body) return;
    body.classList.remove('settled'); // entering a section animates; live updates inside it don't
    body.scrollTop = 0;
    switch (this.section) {
      case 'ask': this.paintConvo(body); break;
      case 'spaces': this.paintSpaces(body); break;
      case 'media': void this.paintMedia(body); break;
      case 'downloads': void this.paintDownloads(body); break;
      case 'notes': void this.paintNotes(body); break;
      case 'modes': this.paintModes(body); break;
      case 'archived': void this.paintArchived(body); break;
    }
  }

  private paintCompose() {
    if (!this.root) return;
    const ta = this.root.querySelector('textarea')!;
    ta.placeholder = this.image ? 'Ask about this image' : this.share.page ? 'Ask about this page' : this.tabIds.length ? `Ask about ${this.tabIds.length} tabs` : 'Ask Nebula anything';
    const ctx = this.root.querySelector<HTMLElement>('.nb-context')!;
    const t = this.currentTab();
    const pills: string[] = [];
    if (this.image) pills.push(`<span class="ctx-pill"><img src="${esc(this.image.src)}" alt="" referrerpolicy="no-referrer">Image<button data-rm="image" aria-label="Remove">${I.close}</button></span>`);
    if (this.share.page && t) pills.push(`<span class="ctx-pill">${faviconImg(t.favicon)}${esc((t.title || 'This page').slice(0, 32))}<button data-rm="page" aria-label="Stop sharing this page">${I.close}</button></span>`);
    if (this.share.selection) pills.push(`<span class="ctx-pill">${I.select}Selected text<button data-rm="selection" aria-label="Remove">${I.close}</button></span>`);
    if (this.tabIds.length) pills.push(`<span class="ctx-pill">${I.tab}${this.tabIds.length} tabs<button data-rm="tabs" aria-label="Remove">${I.close}</button></span>`);
    for (const f of this.files) pills.push(`<span class="ctx-pill">${I.file}${esc(f.name.slice(0, 28))}<button data-rm="file" aria-label="Remove">${I.close}</button></span>`);
    ctx.innerHTML = pills.join('');
    this.root.querySelector<HTMLElement>('[data-a=speed]')!.innerHTML = `${this.speed === 'thorough' ? I.research : this.speed === 'fast' ? I.trend : I.sparkle}${SPEEDS[this.speed]}`;
    this.paintSend();
  }

  private paintSend() {
    const btn = this.root?.querySelector<HTMLButtonElement>('.send');
    if (!btn) return;
    const busy = Boolean(this.requestId);
    btn.classList.toggle('stop', busy);
    btn.innerHTML = busy ? I.stop : I.arrowUp;
    btn.setAttribute('aria-label', busy ? 'Stop' : 'Send');
    btn.disabled = !busy && !this.root!.querySelector('textarea')!.value.trim();
  }

  // ---------------------------------------------------------------- sections
  private paintConvo(body: HTMLElement) {
    if (!this.messages.length) {
      const name = this.host.getState()?.account?.firstName;
      const list = QUICK[this.mode()] ?? QUICK.everyday;
      body.innerHTML = `<div class="convo"><div class="hello"><span class="orb lg"></span>
        <h3>${name ? `Hi ${esc(name)}, I'm Nebula` : 'Hi, I\'m Nebula'}</h3>
        <p>${this.webPage() ? 'Ask me anything, or pick an action and I\'ll read this page for you. I only see what you share.' : 'Ask me anything. Open a page and I can read it for you when you ask.'}</p>
        <div class="chips">${list.filter((q) => !q.page || this.webPage()).map((q, i) => `<button class="chip" data-quick="${i}">${q.icon}${esc(q.label)}</button>`).join('')}</div></div></div>`;
      return;
    }
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    body.innerHTML = `<div class="convo">${this.messages.map((m, i) => this.msgHtml(m, i)).join('')}</div>`;
    if (atBottom || this.requestId) body.scrollTop = body.scrollHeight;
  }

  private msgHtml(m: Msg, i: number) {
    if (m.role === 'user') {
      const c = m.ctx;
      const chip = !c ? '' : c.image ? `<span class="ctx-chip"><img src="${esc(c.image)}" alt="" referrerpolicy="no-referrer"><span><b>Image</b><span>${esc(hostOf(c.url))}</span></span></span>`
        : c.product ? `<span class="ctx-chip">${c.product.image ? `<img src="${esc(c.product.image)}" alt="" referrerpolicy="no-referrer">` : `<span class="ph">${I.bag}</span>`}<span><b>${esc(c.product.name)}</b><span>${esc(formatPrice(c.product))}</span></span></span>`
          : `<span class="ctx-chip"><span class="ph">${faviconImg(c.favicon)}</span><span><b>${esc(c.title || c.url)}</b><span>${esc(hostOf(c.url))}</span></span></span>`;
      return `<div class="msg user">${chip}<div class="bubble">${esc(m.content)}</div></div>`;
    }
    if (m.error && !m.content) {
      return `<div class="msg assistant error"><span class="orb xs"></span><div class="body"><p>${esc(m.error)}</p>${/reach|gateway|set up/i.test(m.error) ? `<button class="chip" data-a="setup">${I.settings}How to set up Nebula</button>` : ''}</div></div>`;
    }
    const body = m.pending && !m.content ? '<span class="typing"><i></i><i></i><i></i></span>' : renderRich(m.content);
    const shared = m.sources?.filter((s) => s.kind !== 'security') ?? [];
    const hl = m.highlights?.length ? `<button class="hl-note" data-showhl="${i}"><span class="orb"></span>Show ${m.highlights.length === 1 ? 'it' : `all ${m.highlights.length}`} on the page</button>` : '';
    const foot = m.pending ? '' : `<div class="msg-foot">
        ${shared.map((s) => `<span class="src" title="${esc(s.url ?? '')}"><b>${s.id}</b><span>${esc(s.title)}</span></span>`).join('') || '<span class="tiny">No page content was shared.</span>'}
        <span style="flex:1"></span>
        <button class="icon-btn small" data-copy="${i}" title="Copy" aria-label="Copy">${I.copy}</button>
        <button class="icon-btn small" data-save="${i}" title="${m.saved ? 'Saved to Notes' : 'Save to Notes'}" aria-label="Save to Notes">${m.saved ? I.star : I.notes}</button>
        <button class="icon-btn small" data-speak="${i}" title="Read aloud" aria-label="Read aloud">${I.speaker}</button></div>`;
    return `<div class="msg assistant"><span class="orb xs"></span><div class="body">${body}${hl}${foot}</div></div>${m.notice ? `<div class="notice">${esc(m.notice)}</div>` : ''}${m.error && m.content ? `<div class="msg assistant error"><span class="orb xs"></span><div class="body">${esc(m.error)}</div></div>` : ''}`;
  }

  private paintSpaces(body: HTMLElement) {
    const s = this.host.getState();
    if (!s) return;
    const cols: { id: string | null; name: string; color: string; tabs: TabState[] }[] = [];
    const loose = s.tabs.filter((t) => !t.groupId || !s.groups.some((g) => g.id === t.groupId));
    cols.push({ id: null, name: s.private ? 'Private' : 'Open tabs', color: 'var(--text-3)', tabs: loose });
    for (const g of s.groups) cols.push({ id: g.id, name: g.name, color: g.color, tabs: s.tabs.filter((t) => t.groupId === g.id) });
    const tabRow = (t: TabState) => `<div class="space-tab${t.id === s.activeTabId ? ' active' : ''}" draggable="true" data-tab="${t.id}" title="${esc(t.url)}">
      ${t.loading ? '<span class="spinner"></span>' : faviconImg(t.favicon, t.url.startsWith('nude:') ? I.sparkle : I.globe)}<span class="t">${esc(tabTitle(t))}</span>
      <button class="x" data-closetab="${t.id}" aria-label="Close tab">${I.close}</button></div>`;
    body.innerHTML = `<div class="spaces">${cols.map((c, ci) => {
      const pinned = c.tabs.filter((t) => t.pinned);
      const rest = c.tabs.filter((t) => !t.pinned);
      const current = c.tabs.some((t) => t.id === s.activeTabId);
      return `<div class="space${current ? ' current' : ''}" data-space="${c.id ?? ''}" style="animation-delay:${ci * 40}ms">
        <div class="space-head"><i style="background:${c.color}"></i><span class="name" data-name="${c.id ?? ''}">${esc(c.name)}</span>
          ${c.id ? `<button class="icon-btn small" data-rename="${c.id}" title="Rename space" aria-label="Rename space">${I.edit}</button>` : ''}</div>
        <div class="space-list">${pinned.map(tabRow).join('')}
          ${rest.length ? `<button class="space-clear" data-clear="${c.id ?? ''}" title="Close the tabs below the line">↓ Clear</button>` : ''}
          ${rest.map(tabRow).join('')}${c.tabs.length ? '' : '<div class="tiny" style="padding:10px">Drag tabs here</div>'}</div>
        <div class="space-foot">
          <button class="icon-btn small" data-askspace="${c.id ?? ''}" title="Ask Nebula about these tabs" aria-label="Ask Nebula about this space">${I.wand}</button>
          ${c.id ? `<button class="icon-btn small" data-ungroup="${c.id}" title="Remove space (keeps its tabs)" aria-label="Remove space">${I.dots}</button>` : ''}
        </div></div>`;
    }).join('')}
      <button class="space add" data-a="newspace">${I.plus}<span>New space</span><span class="tiny">with the current tab</span></button></div>`;
  }

  private wireSpacesDnD(box: HTMLElement) {
    let dragging: number | null = null;
    box.addEventListener('dragstart', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (!row) return;
      dragging = Number(row.dataset.tab);
      e.dataTransfer!.effectAllowed = 'move';
    });
    box.addEventListener('dragover', (e) => {
      const sp = (e.target as HTMLElement).closest<HTMLElement>('.space[data-space]');
      if (dragging === null || !sp) return;
      e.preventDefault();
      for (const x of box.querySelectorAll('.space.drop')) if (x !== sp) x.classList.remove('drop');
      sp.classList.add('drop');
    });
    box.addEventListener('drop', (e) => {
      const sp = (e.target as HTMLElement).closest<HTMLElement>('.space[data-space]');
      box.querySelectorAll('.space.drop').forEach((x) => x.classList.remove('drop'));
      if (dragging === null || !sp) return;
      e.preventDefault();
      void nude.invoke('setTabGroup', dragging, sp.dataset.space || null);
      dragging = null;
    });
    box.addEventListener('dragend', () => { dragging = null; box.querySelectorAll('.space.drop').forEach((x) => x.classList.remove('drop')); });
  }

  /** Re-render live sections when the window state changes (tabs opening, loading, moving). */
  onState() {
    if (!this.root) return;
    if (this.section === 'spaces') {
      const body = this.root.querySelector<HTMLElement>('.nb-body')!;
      const editing = body.querySelector('[contenteditable="true"]');
      if (!editing) { const y = body.scrollTop; body.classList.add('settled'); this.paintSpaces(body); body.scrollTop = y; }
    }
  }

  private async paintMedia(body: HTMLElement) {
    if (!this.webPage()) { body.innerHTML = '<div class="nb-empty-hint">Open a web page to see its images here.</div>'; return; }
    if (!this.media) {
      body.innerHTML = '<div class="nb-empty-hint"><span class="typing"><i></i><i></i><i></i></span></div>';
      this.media = await nude.invoke<PageMedia[]>('pageMedia').catch(() => []);
      if (this.section !== 'media' || !this.root) return;
    }
    if (!this.media.length) { body.innerHTML = '<div class="nb-empty-hint">No large images on this page.</div>'; return; }
    body.innerHTML = `<p class="tiny" style="margin:0 0 10px">Pick an image, then ask about it below. Nebula only sees the one you pick.</p>
      <div class="media">${this.media.map((m, i) => `<figure data-media="${i}" class="${this.image?.src === m.src ? 'sel' : ''}" style="animation-delay:${Math.min(i, 16) * 25}ms">
        <img src="${esc(m.src)}" alt="${esc(m.alt)}" loading="lazy" referrerpolicy="no-referrer">${m.alt ? `<figcaption>${esc(m.alt)}</figcaption>` : ''}</figure>`).join('')}</div>`;
  }

  private async paintDownloads(body: HTMLElement) {
    const list = await nude.invoke<DownloadInfo[]>('downloadsList').catch(() => []);
    if (this.section !== 'downloads' || !this.root) return;
    if (!list.length) { body.innerHTML = '<div class="nb-empty-hint">Nothing downloaded yet. Rovian Defender checks every file before it\'s saved.</div>'; return; }
    body.innerHTML = `<div class="nb-list">${list.map((d) => {
      const risky = d.blocked || d.risk === 'high' || d.risk === 'dangerous';
      const status = d.blocked ? 'Blocked by Rovian Defender' : d.status === 'completed' ? `${bytes(d.totalBytes || d.receivedBytes)} · ${timeAgo(d.endedAt ?? d.startedAt)}` : d.status === 'progressing' ? `${bytes(d.receivedBytes)} of ${bytes(d.totalBytes)}` : d.status;
      return `<div class="nb-row"><span class="ic">${I.file}</span><span class="tx"><b>${esc(d.filename)}</b><span>${esc(status)}</span></span>
        ${d.risk && d.risk !== 'low' ? `<span class="risk${risky ? ' bad' : ''}">${risky ? 'Dangerous' : 'Check this file'}</span>` : ''}
        ${d.status === 'completed' && !d.blocked ? `<button class="btn" data-dlopen="${esc(d.id)}">Open</button><button class="icon-btn small" data-dlshow="${esc(d.id)}" title="Show in folder" aria-label="Show in folder">${I.external}</button>` : ''}</div>`;
    }).join('')}</div>`;
  }

  private async paintNotes(body: HTMLElement) {
    const notes = await nude.invoke<NebulaNote[]>('notes').catch(() => []);
    if (this.section !== 'notes' || !this.root) return;
    if (!notes.length) { body.innerHTML = `<div class="nb-empty-hint">Save Nebula's answers here with ${I.notes.replace('<svg', '<svg style="display:inline;width:14px;height:14px;vertical-align:-2px"')} under any answer.</div>`; return; }
    body.innerHTML = `<div class="cards">${notes.map((n, i) => `<div class="note" style="animation-delay:${Math.min(i, 12) * 30}ms"><h4>${esc(n.title)}</h4>
      <div class="md">${renderRich(n.text)}</div>
      <div class="row">${n.url ? `<button class="src" data-openurl="${esc(n.url)}"><span>${esc(hostOf(n.url))}</span></button>` : ''}<span class="grow"></span>${esc(timeAgo(n.createdAt))}
        <button class="icon-btn small" data-copynote="${esc(n.id)}" title="Copy" aria-label="Copy">${I.copy}</button>
        <button class="icon-btn small" data-delnote="${esc(n.id)}" title="Delete" aria-label="Delete">${I.close}</button></div></div>`).join('')}</div>`;
    (body as HTMLElement & { _notes?: NebulaNote[] })._notes = notes;
  }

  private paintModes(body: HTMLElement) {
    const cur = this.mode();
    body.innerHTML = `<p class="tiny" style="margin:0 0 12px">Modes change Nebula's quick actions and how it answers.</p>
      <div class="modes">${Object.entries(MODES).map(([k, m], i) => `<button class="mode-card${k === cur ? ' on' : ''}" data-mode="${k}" style="animation-delay:${i * 35}ms">${m.icon}<b>${m.label}</b><span>${m.desc}</span></button>`).join('')}</div>`;
  }

  private async paintArchived(body: HTMLElement) {
    const list = await nude.invoke<ClosedTabInfo[]>('closedTabs').catch(() => []);
    if (this.section !== 'archived' || !this.root) return;
    if (!list.length) { body.innerHTML = '<div class="nb-empty-hint">Tabs you close show up here so you can bring them back.</div>'; return; }
    body.innerHTML = `<div class="nb-list">${list.map((c, i) => `<div class="nb-row"><span class="ic">${I.reopen}</span><span class="tx"><b>${esc(c.title || c.url)}</b><span>${esc(hostOf(c.url))}</span></span>
      <button class="btn" data-reopen="${i}">Reopen</button></div>`).join('')}</div>`;
  }

  // ---------------------------------------------------------------- interaction
  private async onClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const pick = (attr: string) => t.closest<HTMLElement>(`[data-${attr}]`)?.dataset[attr.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())];
    const sec = pick('sec') as Section | undefined;
    if (sec) { this.saveDraft(); this.section = sec; this.paint(); return; }
    const a = pick('a');
    switch (a) {
      case 'close': this.close(); return;
      case 'settings': case 'setup': this.close(); void nude.invoke('openInternal', 'settings', '#ai'); return;
      case 'send': if (this.requestId) this.stop(); else void this.send(this.root!.querySelector('textarea')!.value); return;
      case 'new': this.stop(); this.messages = []; this.tabIds = []; this.files = []; this.image = null; this.share = { page: false, selection: false }; this.paint(); return;
      case 'analyze':
        if (!this.webPage()) { this.host.toast('Open a web page for Nebula to analyze.'); return; }
        this.share.page = true;
        void this.send(ANALYZE[this.mode()] ?? ANALYZE.everyday, 'Analyze this page');
        return;
      case 'speed': {
        const order: Speed[] = ['auto', 'fast', 'thorough'];
        this.speed = order[(order.indexOf(this.speed) + 1) % order.length];
        void nude.invoke('setSpeed', this.speed);
        this.host.toast({ auto: 'Auto: fast for chat, deep when you share pages or images', fast: 'Fast answers', thorough: 'Deep answers: slower, more careful' }[this.speed]);
        this.paintCompose();
        return;
      }
      case 'add': this.showAddMenu(); return;
      case 'tidy': {
        this.host.setActivity(true);
        const r = await nude.invoke<{ made: number; by: string }>('groupTidy').catch(() => ({ made: 0, by: 'none' }));
        this.host.setActivity(false, 300);
        this.host.toast(r.made ? `Made ${r.made} space${r.made === 1 ? '' : 's'}${r.by === 'site' ? ' by site (Nebula isn\'t set up)' : ''}` : 'Your tabs are already tidy');
        return;
      }
      case 'newspace': {
        const g = await nude.invoke<{ id: string }>('groupCreate', 'New space', []);
        setTimeout(() => this.startRename(g.id), 80);
        return;
      }
      case 'media-refresh': this.media = null; this.paintBody(); return;
      case 'all-downloads': this.close(); void nude.invoke('openInternal', 'downloads'); return;
      case 'history': this.close(); void nude.invoke('openInternal', 'history'); return;
    }
    const rm = pick('rm');
    if (rm) {
      if (rm === 'image') this.image = null;
      if (rm === 'page' || rm === 'selection') this.share[rm] = false;
      if (rm === 'tabs') this.tabIds = [];
      if (rm === 'file') this.files = [];
      this.paintCompose();
      if (this.section === 'media') this.paintBody();
      return;
    }
    const qi = pick('quick');
    if (qi !== undefined) {
      const q = (QUICK[this.mode()] ?? QUICK.everyday)[Number(qi)];
      if (q.page) this.share.page = true;
      void this.send(q.prompt, q.label);
      return;
    }
    const tab = pick('tab');
    const closeTab = pick('closetab');
    if (closeTab) { void nude.invoke('close', Number(closeTab)); return; }
    if (tab && !t.closest('[data-closetab]')) { void nude.invoke('activate', Number(tab)); this.close(); return; }
    const rename = pick('rename');
    if (rename) { this.startRename(rename); return; }
    const clear = t.closest<HTMLElement>('[data-clear]');
    if (clear) { void nude.invoke('groupClear', clear.dataset.clear || null); return; }
    const ungroup = pick('ungroup');
    if (ungroup) { void nude.invoke('groupDelete', ungroup); this.host.toast('Space removed. Its tabs are still open.'); return; }
    const askSpace = t.closest<HTMLElement>('[data-askspace]');
    if (askSpace) {
      const s = this.host.getState();
      const gid = askSpace.dataset.askspace || null;
      this.tabIds = (s?.tabs ?? []).filter((x) => (x.groupId ?? null) === gid || (!gid && !s?.groups.some((g) => g.id === x.groupId))).filter((x) => /^https?:/.test(x.url)).map((x) => x.id).slice(0, 8);
      if (!this.tabIds.length) { this.host.toast('Open some web pages in this space first.'); return; }
      void this.send('Give me a short overview of these tabs: what each one is about and how they connect.', 'What\'s in this space?');
      return;
    }
    const mi = pick('media');
    if (mi !== undefined && this.media) {
      const m = this.media[Number(mi)];
      this.image = this.image?.src === m.src ? null : m;
      this.paintBody();
      this.paintCompose();
      if (this.image) this.root!.querySelector('textarea')!.focus();
      return;
    }
    const dlopen = pick('dlopen'); if (dlopen) { void nude.invoke('downloadOpen', dlopen); return; }
    const dlshow = pick('dlshow'); if (dlshow) { void nude.invoke('downloadShow', dlshow); return; }
    const reopen = pick('reopen'); if (reopen !== undefined) { void nude.invoke('reopenClosedAt', Number(reopen)); this.close(); return; }
    const mode = pick('mode');
    if (mode) { void nude.invoke('setMode', mode); this.host.toast(`${MODES[mode].label} mode on`); setTimeout(() => this.paint(), 60); return; }
    const delnote = pick('delnote'); if (delnote) { void nude.invoke('noteRemove', delnote).then(() => this.paintBody()); return; }
    const copynote = pick('copynote');
    if (copynote) {
      const n = ((this.root!.querySelector('.nb-body') as HTMLElement & { _notes?: NebulaNote[] })._notes ?? []).find((x) => x.id === copynote);
      if (n) { await navigator.clipboard.writeText(stripDirectives(n.text)).catch(() => {}); this.host.toast('Copied'); }
      return;
    }
    const openurl = pick('openurl'); if (openurl) { void nude.invoke('openUrlInNewTab', openurl); this.close(); return; }
    const copy = pick('copy');
    if (copy !== undefined) { await navigator.clipboard.writeText(stripDirectives(this.messages[Number(copy)].content)).catch(() => {}); this.host.toast('Copied'); return; }
    const save = pick('save');
    if (save !== undefined) {
      const m = this.messages[Number(save)];
      const q = this.messages[Number(save) - 1];
      if (m && !m.saved) {
        await nude.invoke('noteAdd', m.content, (q?.content ?? 'Nebula').slice(0, 120), q?.ctx?.url ?? '');
        m.saved = true; this.paintBody(); this.host.toast('Saved to Notes');
      }
      return;
    }
    const speak = pick('speak');
    if (speak !== undefined) {
      if (speechSynthesis.speaking) speechSynthesis.cancel();
      else speechSynthesis.speak(new SpeechSynthesisUtterance(stripDirectives(this.messages[Number(speak)].content).replace(/[*`#[\]]/g, '')));
      return;
    }
    const showhl = pick('showhl');
    if (showhl !== undefined) { const m = this.messages[Number(showhl)]; if (m?.highlights) this.showOnPage(m.highlights); return; }
    const open = pick('open');
    if (open) { e.preventDefault(); void nude.invoke('openUrlInNewTab', open); this.close(); return; }
    const link = t.closest<HTMLElement>('a[data-href]')?.dataset.href;
    if (link) { e.preventDefault(); void nude.invoke('openUrlInNewTab', link); this.close(); }
  }

  private startRename(id: string) {
    const el = this.root?.querySelector<HTMLElement>(`[data-name="${CSS.escape(id)}"]`);
    if (!el) return;
    el.contentEditable = 'true';
    el.focus();
    getSelection()?.selectAllChildren(el);
    const done = (save: boolean) => {
      el.contentEditable = 'false';
      if (save && el.textContent?.trim()) void nude.invoke('groupRename', id, el.textContent.trim());
      else this.onState();
    };
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
    });
    el.addEventListener('blur', () => done(true), { once: true });
  }

  private showAddMenu() {
    const box = this.root!.querySelector('.nb-compose')!;
    const existing = box.querySelector('.add-menu');
    if (existing) { existing.remove(); return; }
    const m = document.createElement('div');
    m.className = 'popover add-menu';
    m.style.position = 'absolute';
    const web = this.webPage();
    m.innerHTML = `
      <button class="menu-item" data-add="page" ${web ? '' : 'disabled'}>${I.page}<span>This page</span>${this.share.page ? '<span class="kbd">On</span>' : ''}</button>
      <button class="menu-item" data-add="selection" ${web ? '' : 'disabled'}>${I.select}<span>Text I selected</span>${this.share.selection ? '<span class="kbd">On</span>' : ''}</button>
      <button class="menu-item" data-add="image" ${web ? '' : 'disabled'}>${I.media}<span>An image on this page…</span></button>
      <button class="menu-item" data-add="tabs">${I.tab}<span>Other tabs…</span></button>
      <button class="menu-item" data-add="file">${I.file}<span>A text file…</span></button>
      <div class="menu-sep"></div><div class="tiny" style="padding:2px 10px 6px">Nebula only sees what you add here.</div>`;
    m.addEventListener('click', (e) => {
      e.stopPropagation();
      const k = (e.target as HTMLElement).closest<HTMLElement>('[data-add]')?.dataset.add;
      if (!k) return;
      m.remove();
      if (k === 'page' || k === 'selection') { this.share[k] = !this.share[k]; this.paintCompose(); }
      if (k === 'image') { this.section = 'media'; this.paint(); }
      if (k === 'tabs') void this.pickTabs();
      if (k === 'file') this.pickFile();
    });
    box.appendChild(m);
  }

  private async pickTabs() {
    const tabs = await nude.invoke<{ id: number; title: string; url: string; favicon?: string }[]>('tabsForAi');
    const box = this.root!.querySelector('.nb-compose')!;
    const m = document.createElement('div');
    m.className = 'popover add-menu';
    m.style.position = 'absolute';
    m.innerHTML = tabs.length ? `<div class="menu-head">Share tabs with Nebula</div>` + tabs.map((t) =>
      `<label class="menu-item"><input type="checkbox" value="${t.id}" ${this.tabIds.includes(t.id) ? 'checked' : ''}>${faviconImg(t.favicon)}<span>${esc(t.title)}</span></label>`).join('') +
      `<div style="display:flex;justify-content:flex-end;padding:6px"><button class="btn primary" data-done>Done</button></div>`
      : '<div class="muted" style="padding:10px">Open some web pages first.</div>';
    m.addEventListener('click', (e) => {
      e.stopPropagation();
      if ((e.target as HTMLElement).closest('[data-done]')) {
        this.tabIds = [...m.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => Number(i.value)).slice(0, 8);
        m.remove();
        this.paintCompose();
      }
    });
    box.appendChild(m);
  }

  private pickFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md,.csv,.json,.html,.htm,.xml,.log,.eml,text/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 2_000_000) { this.host.toast('That file is too large (max 2 MB of text).'); return; }
      const text = await f.text();
      this.files = [{ name: f.name, text: /\.html?$/i.test(f.name) ? new DOMParser().parseFromString(text, 'text/html').body.innerText : text }];
      this.paintCompose();
    };
    input.click();
  }

  private stop() {
    if (this.requestId) void nude.invoke('aiCancel', this.requestId);
  }

  private async send(text: string, displayText?: string) {
    const content = text.trim();
    if (!content || this.requestId) return;
    if (this.section !== 'ask') { this.section = 'ask'; this.paint(); }
    const ta = this.root?.querySelector('textarea');
    if (ta) { ta.value = ''; this.autosize(ta); }
    this.draft = '';
    const tab = this.currentTab();
    let ctx: Ctx | undefined;
    if (this.image && tab) ctx = { title: this.image.alt, url: tab.url, image: this.image.src };
    else if (this.share.page) {
      this.host.setActivity(true);
      const pc = await nude.invoke<{ title: string; url: string; favicon?: string; products: PageProduct[] } | null>('pageContext').catch(() => null);
      if (pc) ctx = { title: pc.title, url: pc.url, favicon: pc.favicon, product: pc.products.length === 1 ? pc.products[0] : undefined };
    }
    this.messages.push({ role: 'user', content: displayText ?? content, prompt: content, ctx });
    this.messages.push({ role: 'assistant', content: '', pending: true });
    this.requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.host.setActivity(true);
    this.root?.classList.add('thinking');
    this.paintBody();
    this.paintSend();
    const history = this.messages.filter((m) => !m.pending && !m.error).map((m) => ({ role: m.role, content: m.prompt ?? m.content }));
    await nude.invoke('aiAsk', {
      requestId: this.requestId,
      messages: history,
      speed: this.speed === 'auto' ? undefined : this.speed,
      share: { page: this.share.page, selection: this.share.selection, tabIds: this.tabIds, files: this.files, image: this.image ? { src: this.image.src, alt: this.image.alt } : undefined },
    });
  }

  private onChunk(m: Record<string, unknown>) {
    if (m.requestId !== this.requestId) return;
    const msg = this.messages[this.messages.length - 1];
    if (!msg || msg.role !== 'assistant') return;
    switch (m.type) {
      case 'sources': msg.sources = m.sources as AiSource[]; break;
      case 'delta': msg.content += String(m.text); msg.pending = false; break;
      case 'notice': msg.notice = String(m.message); break;
      case 'error': msg.error = String(m.message); msg.pending = false; this.requestId = null; this.host.setActivity(false, 200); this.root?.classList.remove('thinking'); break;
      case 'done': {
        msg.pending = false; this.requestId = null;
        const hl = [...msg.content.matchAll(/\[\[highlight:\s*([^\]]+?)\s*\]\]/gi)].map((x) => x[1]).slice(0, 3);
        if (hl.length) msg.highlights = hl;
        this.host.setActivity(false, 300);
        this.root?.classList.remove('thinking');
        break;
      }
    }
    if (this.root && this.section === 'ask') {
      const body = this.root.querySelector<HTMLElement>('.nb-body')!;
      body.classList.add('settled');
      this.paintConvo(body);
      this.paintSend();
      if (m.type === 'done' || m.type === 'error') this.paintTop();
    }
  }

  /** Nebula's on-screen action: close the panel so the live page shows, then outline what it found. Visual only. */
  private showOnPage(texts: string[]) {
    this.close();
    setTimeout(async () => {
      this.host.setActivity(true);
      void nude.invoke('nebulaGlow');
      const r = await nude.invoke<{ found: number }>('nebulaHighlight', texts).catch(() => ({ found: 0 }));
      this.host.setActivity(false, 2200);
      if (!r.found) this.host.toast('Nebula couldn\'t find that on the page any more.');
    }, 180);
  }
}

function tabTitle(t: TabState) { return !t.url || t.url.startsWith('nude://newtab') ? 'New Tab' : t.title || t.url; }
function hostOf(u: string) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }
function bytes(n: number) { if (!n) return '—'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${u[i]}`; }
function timeAgo(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}
function formatPrice(p: PageProduct) {
  if (!p.price) return '';
  const sym: Record<string, string> = { USD: '$', ZAR: 'R', EUR: '€', GBP: '£' };
  return /^[\d.,\s]+$/.test(p.price) ? `${(p.currency && sym[p.currency]) ?? p.currency ?? ''}${p.price}` : p.price;
}
const safeUrl = (u?: string) => (u && /^https?:\/\//.test(u.trim()) ? u.trim() : '');
const safeImg = (u?: string) => (u && /^(https:\/\/|data:image\/)/.test(u.trim()) ? u.trim() : '');

function stripDirectives(s: string) {
  return s.replace(/\[\[product:\s*([^|\]]*)\|?\s*([^|\]]*)[^\]]*\]\]/gi, '$1 $2').replace(/\[\[highlight:[^\]]*\]\]/gi, '').trim();
}

/** Markdown plus Nebula's rich blocks: [[product: name | price | url | image]] (shown as a card grid) and [[highlight: text]]. */
export function renderRich(text: string): string {
  const out: string[] = [];
  let buf: string[] = [];
  let cards: string[] = [];
  const flush = () => { if (buf.length) { out.push(renderMarkdown(buf.join('\n'))); buf = []; } };
  const flushCards = () => { if (cards.length) { out.push(`<div class="products">${cards.join('')}</div>`); cards = []; } };
  for (const line of text.split('\n')) {
    const p = /^\s*(?:[-*]\s*)?\[\[product:\s*([^\]]+)\]\]\s*$/i.exec(line);
    const h = /^\s*\[\[highlight:\s*([^\]]+)\]\]\s*$/i.exec(line);
    if (p) {
      flush();
      const [name = '', price = '', url = '', image = ''] = p[1].split('|').map((x) => x.trim());
      const u = safeUrl(url);
      const img = safeImg(image);
      cards.push(`<div class="product-card" style="animation-delay:${cards.length * 50}ms">${img ? `<img src="${esc(img)}" alt="" referrerpolicy="no-referrer">` : `<span class="ph">${I.bag}</span>`}
        <div class="pc"><b>${esc(name)}</b><span>${esc(price)}</span></div>${u ? `<button data-open="${esc(u)}">${I.link}View</button>` : ''}</div>`);
    } else if (h) {
      continue; // offered as "Show on the page" under the answer
    } else {
      if (line.trim()) flushCards();
      buf.push(line.replace(/\[\[highlight:[^\]]*\]\]/gi, ''));
    }
  }
  flush();
  flushCards();
  return out.join('');
}
