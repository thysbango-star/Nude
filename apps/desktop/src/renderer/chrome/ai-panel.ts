// Nebula — Nude's AI assistant panel. Nothing from the page is shared unless the user asks
// (a "Share" chip, the Analyze chip, or a quick action that's clearly about the page).
import type { AiSource, PageProduct, WindowState } from '../../shared/types';
import { I, esc, faviconImg } from './icons';
import { renderMarkdown } from './md';

type Bridge = { invoke<T = unknown>(cmd: string, ...a: unknown[]): Promise<T>; onAi(cb: (m: Record<string, unknown>) => void): () => void };
const nude = (window as unknown as { nude: Bridge }).nude;

interface Ctx { title: string; url: string; favicon?: string; product?: PageProduct }
interface Msg { role: 'user' | 'assistant'; content: string; prompt?: string; ctx?: Ctx; sources?: AiSource[]; error?: string; notice?: string; pending?: boolean; highlighted?: number }
interface Quick { label: string; icon: string; prompt: string; page: boolean }

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
    { label: 'Grade 8', icon: I.study, prompt: 'Explain this page like I\'m in Grade 8.', page: true },
  ],
  study: [
    { label: 'Study guide', icon: I.study, prompt: 'Create a study guide from this page: key ideas, definitions and a short summary.', page: true },
    { label: 'Quiz me', icon: I.quiz, prompt: 'Make 5 quiz questions (with answers at the end) from this page.', page: true },
    { label: 'Notes', icon: I.list, prompt: 'Turn this page into clear, short notes with headings.', page: true },
    { label: 'Explain simply', icon: I.sparkle, prompt: 'Explain the hardest idea on this page in simple terms with an example.', page: true },
  ],
  everyday: [
    { label: 'Summarise', icon: I.list, prompt: 'Summarise this page in five points.', page: true },
    { label: 'Explain', icon: I.sparkle, prompt: 'Explain this page like I\'m in Grade 8.', page: true },
    { label: 'Is this safe?', icon: I.shield, prompt: 'Is this website safe?', page: false },
    { label: 'Key details', icon: I.info, prompt: 'Extract the most important information from this page (dates, prices, names, steps).', page: true },
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

export class AiPanel {
  private messages: Msg[] = [];
  private open = false;
  private expanded = false;
  private share = { page: false, selection: false };
  private tabIds: number[] = [];
  private files: { name: string; text: string }[] = [];
  private requestId: string | null = null;
  private activeQuick: string | null = null;
  private lastCtx: Ctx | undefined;

  constructor(
    private el: HTMLElement, private btn: HTMLElement, private main: HTMLElement, private getState: () => WindowState | null,
    private toast: (m: string) => void, private setActivity: (on: boolean) => void, private onToggle: () => void,
  ) {
    nude.onAi((m) => this.onChunk(m));
    this.renderShell();
  }

  isOpen() { return this.open; }

  toggle() {
    this.open = !this.open;
    this.el.hidden = !this.open;
    this.btn.classList.toggle('on', this.open);
    if (!this.open && this.expanded) this.setExpanded(false);
    if (this.open) { this.renderQuick(); requestAnimationFrame(() => this.el.querySelector<HTMLTextAreaElement>('textarea')?.focus()); }
    this.onToggle();
    window.dispatchEvent(new Event('resize'));
  }

  /** Called when the active tab or mode changes. Page sharing is per page, so it resets. */
  onTabChanged() {
    if (this.share.page || this.share.selection) { this.share = { page: false, selection: false }; this.renderShare(); }
    this.renderQuick();
  }

  ask(prompt: string, ctx: { page?: boolean; selection?: boolean; security?: boolean }) {
    if (!this.open) this.toggle();
    this.share = { page: Boolean(ctx.page), selection: Boolean(ctx.selection) };
    this.renderShare();
    void this.send(prompt);
  }

  private mode() { return this.getState()?.mode ?? 'everyday'; }

  private setExpanded(v: boolean) {
    this.expanded = v;
    this.el.classList.toggle('expanded', v);
    this.main.classList.toggle('ai-expanded', v);
    this.el.querySelector('[data-a=expand]')!.innerHTML = v ? I.collapse : I.expand;
    window.dispatchEvent(new Event('resize'));
  }

  private renderShell() {
    this.el.innerHTML = `
      <div class="ai-head"><h2>${I.sparkle}Nebula</h2>
        <button class="analyze-chip" data-a="analyze" title="Let Nebula read and analyze this page">${I.analyze}<span>Analyze</span></button>
        <span class="grow"></span>
        <button class="icon-btn small" data-a="expand" title="Full-screen workspace">${I.expand}</button>
        <button class="icon-btn small" data-a="new" title="New conversation">${I.edit}</button>
        <button class="icon-btn small" data-a="close" title="Close">${I.close}</button></div>
      <div class="ai-log" aria-live="polite"></div>
      <div class="ai-compose">
        <div class="ai-share"></div>
        <div class="ai-input"><textarea rows="1" placeholder="Ask Nebula anything…" aria-label="Message Nebula"></textarea>
          <button class="send" data-a="send" aria-label="Send">${I.send}</button></div>
        <div class="ai-foot">Nebula only sees what you choose to share. It can make mistakes — check important facts.</div>
      </div>
      <div class="quick-row" role="toolbar" aria-label="Quick actions"></div>`;
    const ta = this.el.querySelector('textarea')!;
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(140, ta.scrollHeight)}px`; });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void this.send(ta.value); }
      if (e.key === 'Escape' && this.requestId) void nude.invoke('aiCancel', this.requestId);
    });
    this.el.addEventListener('click', (e) => void this.onClick(e));
    this.renderShare();
    this.renderQuick();
    this.renderLog();
  }

  private renderQuick() {
    const row = this.el.querySelector('.quick-row')!;
    const list = QUICK[this.mode()] ?? QUICK.everyday;
    row.innerHTML = list.map((q, i) => `<button class="quick${this.activeQuick === q.label ? ' on' : ''}" data-quick="${i}">${q.icon}${esc(q.label)}</button>`).join('');
  }

  private renderShare() {
    const box = this.el.querySelector('.ai-share')!;
    const s = this.getState();
    const tab = s?.tabs.find((t) => t.id === s.activeTabId);
    const webPage = tab && /^https?:/.test(tab.url);
    box.innerHTML = `<span class="tiny" style="align-self:center">Share:</span>
      <button class="toggle-chip${this.share.page ? ' on' : ''}" data-share="page" ${webPage ? '' : 'disabled'} title="Let Nebula read this page">${I.page}This page</button>
      <button class="toggle-chip${this.share.selection ? ' on' : ''}" data-share="selection" title="Let Nebula read the text you selected">${I.select}Selection</button>
      <button class="toggle-chip${this.tabIds.length ? ' on' : ''}" data-share="tabs">${I.tab}${this.tabIds.length ? `${this.tabIds.length} tabs` : 'Tabs…'}</button>
      <button class="toggle-chip${this.files.length ? ' on' : ''}" data-share="file">${I.file}${this.files.length ? esc(this.files.map((f) => f.name).join(', ').slice(0, 30)) : 'File…'}</button>`;
  }

  private async onClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
    if (a === 'close') this.toggle();
    if (a === 'expand') this.setExpanded(!this.expanded);
    if (a === 'new') {
      if (this.requestId) void nude.invoke('aiCancel', this.requestId);
      this.messages = []; this.tabIds = []; this.files = []; this.share = { page: false, selection: false }; this.activeQuick = null;
      this.renderShare(); this.renderQuick(); this.renderLog();
    }
    if (a === 'send') void this.send(this.el.querySelector('textarea')!.value);
    if (a === 'analyze') {
      const tab = this.currentTab();
      if (!tab || !/^https?:/.test(tab.url)) { this.toast('Open a web page for Nebula to analyze.'); return; }
      this.share.page = true;
      this.renderShare();
      void this.send(ANALYZE[this.mode()] ?? ANALYZE.everyday, 'Analyze this page');
    }
    const qi = t.closest<HTMLElement>('[data-quick]')?.dataset.quick;
    if (qi !== undefined) {
      const q = (QUICK[this.mode()] ?? QUICK.everyday)[Number(qi)];
      if (q.page) {
        const tab = this.currentTab();
        if (!tab || !/^https?:/.test(tab.url)) { this.toast('Open a web page first.'); return; }
        this.share.page = true;
        this.renderShare();
      }
      this.activeQuick = q.label;
      this.renderQuick();
      void this.send(q.prompt, q.label);
    }
    const share = t.closest<HTMLElement>('[data-share]')?.dataset.share;
    if (share === 'page' || share === 'selection') { this.share[share] = !this.share[share]; this.renderShare(); }
    if (share === 'tabs') await this.pickTabs(t.closest('[data-share]') as HTMLElement);
    if (share === 'file') this.pickFile();
    const sugg = t.closest<HTMLElement>('[data-sugg]')?.dataset.sugg;
    if (sugg !== undefined) { const q = (QUICK[this.mode()] ?? QUICK.everyday)[Number(sugg)]; if (q) this.ask(q.prompt, { page: q.page }); }
    const copy = t.closest<HTMLElement>('[data-copy]')?.dataset.copy;
    if (copy !== undefined) { await navigator.clipboard.writeText(stripDirectives(this.messages[Number(copy)].content)); this.toast('Copied'); }
    const speak = t.closest<HTMLElement>('[data-speak]')?.dataset.speak;
    if (speak !== undefined) {
      if (speechSynthesis.speaking) speechSynthesis.cancel();
      else speechSynthesis.speak(new SpeechSynthesisUtterance(stripDirectives(this.messages[Number(speak)].content).replace(/[*`#\[\]]/g, '')));
    }
    const shareMsg = t.closest<HTMLElement>('[data-sharemsg]')?.dataset.sharemsg;
    if (shareMsg !== undefined) {
      const text = stripDirectives(this.messages[Number(shareMsg)].content);
      if ((navigator as Navigator & { share?: (d: ShareData) => Promise<void> }).share) await navigator.share({ text }).catch(() => {});
      else { await navigator.clipboard.writeText(text); this.toast('Copied to share'); }
    }
    const open = t.closest<HTMLElement>('[data-open]')?.dataset.open;
    if (open) { e.preventDefault(); void nude.invoke('openUrlInNewTab', open); }
    const link = t.closest<HTMLElement>('a[data-href]')?.dataset.href;
    if (link) { e.preventDefault(); void nude.invoke('openUrlInNewTab', link); }
    const rehl = t.closest<HTMLElement>('[data-rehl]')?.dataset.rehl;
    if (rehl !== undefined) void this.applyHighlights(this.messages[Number(rehl)]);
  }

  private currentTab() {
    const s = this.getState();
    return s?.tabs.find((t) => t.id === s.activeTabId);
  }

  private async pickTabs(anchor: HTMLElement) {
    const tabs = await nude.invoke<{ id: number; title: string; url: string; favicon?: string }[]>('tabsForAi');
    const existing = this.el.querySelector('.tab-pick');
    if (existing) { existing.remove(); return; }
    const box = document.createElement('div');
    box.className = 'popover tab-pick';
    const r = anchor.getBoundingClientRect();
    Object.assign(box.style, { position: 'fixed', bottom: `${innerHeight - r.top + 6}px`, right: `${innerWidth - r.right}px`, transformOrigin: 'bottom right' });
    box.innerHTML = tabs.length ? `<div class="tiny" style="padding:4px 8px">Share these tabs with Nebula</div>` + tabs.map((t) =>
      `<label><input type="checkbox" value="${t.id}" ${this.tabIds.includes(t.id) ? 'checked' : ''}>${faviconImg(t.favicon)}<span>${esc(t.title)}</span></label>`).join('') +
      `<div style="display:flex;justify-content:flex-end;padding:6px"><button class="btn primary" data-done>Done</button></div>`
      : '<div class="muted" style="padding:10px">Open some web pages first.</div>';
    box.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-done]')) {
        this.tabIds = [...box.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => Number(i.value));
        box.remove();
        this.renderShare();
      }
      e.stopPropagation();
    });
    this.el.appendChild(box);
  }

  private pickFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md,.csv,.json,.html,.htm,.xml,.log,.eml,text/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 2_000_000) { this.toast('That file is too large (max 2 MB of text).'); return; }
      const text = await f.text();
      this.files = [{ name: f.name, text: f.name.match(/\.html?$/i) ? new DOMParser().parseFromString(text, 'text/html').body.innerText : text }];
      this.renderShare();
    };
    input.click();
  }

  private async send(text: string, displayText?: string) {
    const content = text.trim();
    if (!content || this.requestId) return;
    const ta = this.el.querySelector('textarea')!;
    ta.value = '';
    ta.style.height = 'auto';
    let ctx: Ctx | undefined;
    if (this.share.page) {
      this.setActivity(true);
      const pc = await nude.invoke<{ title: string; url: string; favicon?: string; products: PageProduct[] } | null>('pageContext').catch(() => null);
      if (pc) {
        // On a product page (one main product), show it like the reference: thumbnail, name, price.
        ctx = { title: pc.title, url: pc.url, favicon: pc.favicon, product: pc.products.length === 1 ? pc.products[0] : undefined };
        void nude.invoke('nebulaGlow');
      }
    }
    this.lastCtx = ctx;
    this.messages.push({ role: 'user', content: displayText ?? content, prompt: content, ctx });
    this.messages.push({ role: 'assistant', content: '', pending: true });
    this.requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.renderLog();
    const history = this.messages.filter((m) => !m.pending && !m.error).map((m) => ({ role: m.role, content: m.prompt ?? m.content }));
    await nude.invoke('aiAsk', {
      requestId: this.requestId,
      messages: history,
      share: { page: this.share.page, selection: this.share.selection, tabIds: this.tabIds, files: this.files },
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
      case 'error': msg.error = String(m.message); msg.pending = false; this.requestId = null; this.setActivity(false); break;
      case 'done':
        msg.pending = false; this.requestId = null;
        void this.applyHighlights(msg).finally(() => this.setActivity(false));
        break;
    }
    this.renderLog();
  }

  /** Nebula's on-screen action: outline items it mentions with [[highlight: …]]. Visual only — it never clicks or submits. */
  private async applyHighlights(msg: Msg) {
    const texts = [...msg.content.matchAll(/\[\[highlight:\s*([^\]]+?)\s*\]\]/gi)].map((x) => x[1]).slice(0, 3);
    if (!texts.length) return;
    this.setActivity(true);
    void nude.invoke('nebulaGlow');
    const r = await nude.invoke<{ found: number }>('nebulaHighlight', texts).catch(() => ({ found: 0 }));
    msg.highlighted = r.found;
    this.renderLog();
  }

  private renderLog() {
    const log = this.el.querySelector<HTMLElement>('.ai-log')!;
    if (!this.messages.length) {
      const list = QUICK[this.mode()] ?? QUICK.everyday;
      const name = this.getState()?.account?.firstName;
      log.innerHTML = `<div class="ai-empty"><span class="orb"></span>
        <h3>${name ? `Hi ${esc(name)}, I'm Nebula` : 'Hi, I\'m Nebula'}</h3><div>Ask me anything, or tap Analyze and I'll read this page for you.</div>
        <div class="ai-chips">${list.map((q, i) => `<button class="chip" data-sugg="${i}">${q.icon}${esc(q.label)}</button>`).join('')}</div></div>`;
      return;
    }
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.innerHTML = this.messages.map((m, i) => {
      if (m.role === 'user') {
        const c = m.ctx;
        const chip = c ? (c.product
          ? `<span class="ctx-chip">${c.product.image ? `<img src="${esc(c.product.image)}" alt="" referrerpolicy="no-referrer">` : `<span class="ph">${I.bag}</span>`}<span><b>${esc(c.product.name)}</b><span>${esc(formatPrice(c.product))}</span></span></span>`
          : `<span class="ctx-chip"><span class="ph">${faviconImg(c.favicon)}</span><span><b>${esc(c.title || c.url)}</b><span>${esc(hostOf(c.url))}</span></span></span>`) : '';
        return `<div class="msg user">${chip}<div class="bubble">${esc(m.content)}</div></div>`;
      }
      if (m.error && !m.content) return `<div class="msg assistant error"><span class="orb xs"></span><div class="body">${esc(m.error)}</div></div>`;
      const body = m.pending && !m.content ? '<span class="typing"><i></i><i></i><i></i></span>' : renderRich(m.content);
      const shared = m.sources?.filter((s) => s.kind !== 'security') ?? [];
      const sources = shared.length ? `<div class="msg-sources"><span class="tiny">Used:</span>${shared.map((s) => `<span class="src" title="${esc(s.url ?? '')}">${s.id} · ${esc(s.title)}</span>`).join('')}</div>`
        : !m.pending ? '<div class="msg-sources"><span class="tiny">No page content was shared.</span></div>' : '';
      const hl = m.highlighted !== undefined ? `<button class="hl-note" data-rehl="${i}">✦ ${m.highlighted ? `Highlighted ${m.highlighted} on the page` : 'Couldn\'t find that on the page'}</button>` : '';
      const tools = !m.pending && m.content ? `<div class="msg-tools"><button class="icon-btn small" data-copy="${i}" title="Copy">${I.copy}</button>
        <button class="icon-btn small" data-sharemsg="${i}" title="Share">${I.share}</button><button class="icon-btn small" data-speak="${i}" title="Read aloud">${I.speaker}</button></div>` : '';
      return `<div class="msg assistant"><span class="orb xs"></span><div class="body">${body}${hl}${sources}${tools}</div></div>${m.notice ? `<div class="notice">${esc(m.notice)}</div>` : ''}${m.error && m.content ? `<div class="msg assistant error"><span class="orb xs"></span><div class="body">${esc(m.error)}</div></div>` : ''}`;
    }).join('');
    if (atBottom || this.requestId) log.scrollTop = log.scrollHeight;
  }
}

function hostOf(u: string) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }
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

/** Markdown plus Nebula's rich blocks: [[product: name | price | url | image]] and [[highlight: text]]. */
function renderRich(text: string): string {
  const out: string[] = [];
  let buf: string[] = [];
  const flush = () => { if (buf.length) { out.push(renderMarkdown(buf.join('\n'))); buf = []; } };
  for (const line of text.split('\n')) {
    const p = /^\s*\[\[product:\s*([^\]]+)\]\]\s*$/i.exec(line);
    const h = /^\s*\[\[highlight:\s*([^\]]+)\]\]\s*$/i.exec(line);
    if (p) {
      flush();
      const [name = '', price = '', url = '', image = ''] = p[1].split('|').map((x) => x.trim());
      const u = safeUrl(url);
      const img = safeImg(image);
      out.push(`<div class="product-card">${img ? `<img src="${esc(img)}" alt="" referrerpolicy="no-referrer">` : `<span class="ph">${I.bag}</span>`}
        <div class="pc"><b>${esc(name)}</b><span>${esc(price)}</span></div>${u ? `<button data-open="${esc(u)}" title="Open">${I.link}</button>` : ''}</div>`);
    } else if (h) {
      continue; // shown as the "Highlighted on the page" note after the answer
    } else buf.push(line.replace(/\[\[highlight:[^\]]*\]\]/gi, ''));
  }
  flush();
  return out.join('');
}
