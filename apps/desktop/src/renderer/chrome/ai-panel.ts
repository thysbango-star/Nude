// Nude AI side panel. Nothing from the page is shared unless the user turns a "share" chip on.
import type { AiSource, WindowState } from '../../shared/types';
import { I, esc, faviconImg } from './icons';
import { renderMarkdown } from './md';

type Bridge = { invoke<T = unknown>(cmd: string, ...a: unknown[]): Promise<T>; onAi(cb: (m: Record<string, unknown>) => void): () => void };
const nude = (window as unknown as { nude: Bridge }).nude;

interface Msg { role: 'user' | 'assistant'; content: string; sources?: AiSource[]; error?: string; notice?: string; pending?: boolean }

const SUGGESTIONS: [string, { page?: boolean; selection?: boolean }][] = [
  ['Summarise this page in five points', { page: true }],
  ['Explain this page like I\'m in Grade 8', { page: true }],
  ['Is this website safe?', {}],
  ['Find the cheapest option on this page', { page: true }],
  ['Make study notes from this page', { page: true }],
  ['Explain the selected text', { selection: true }],
];

export class AiPanel {
  private messages: Msg[] = [];
  private open = false;
  private expanded = false;
  private share = { page: false, selection: false };
  private tabIds: number[] = [];
  private files: { name: string; text: string }[] = [];
  private requestId: string | null = null;

  constructor(private el: HTMLElement, private btn: HTMLElement, private main: HTMLElement, private getState: () => WindowState | null, private toast: (m: string) => void) {
    nude.onAi((m) => this.onChunk(m));
    this.renderShell();
  }

  toggle() {
    this.open = !this.open;
    this.el.hidden = !this.open;
    this.btn.classList.toggle('on', this.open);
    if (!this.open && this.expanded) this.setExpanded(false);
    if (this.open) requestAnimationFrame(() => this.el.querySelector<HTMLTextAreaElement>('textarea')?.focus());
    window.dispatchEvent(new Event('resize'));
  }

  /** Called when the active tab changes: page sharing is per page, so it resets. */
  onTabChanged() {
    if (this.share.page || this.share.selection) {
      this.share = { page: false, selection: false };
      this.renderShare();
    }
  }

  ask(prompt: string, ctx: { page?: boolean; selection?: boolean; security?: boolean }) {
    if (!this.open) this.toggle();
    this.share = { page: Boolean(ctx.page), selection: Boolean(ctx.selection) };
    this.renderShare();
    void this.send(prompt);
  }

  private setExpanded(v: boolean) {
    this.expanded = v;
    this.el.classList.toggle('expanded', v);
    this.main.classList.toggle('ai-expanded', v);
    this.el.querySelector('[data-a=expand]')!.innerHTML = v ? I.collapse : I.expand;
    window.dispatchEvent(new Event('resize'));
  }

  private renderShell() {
    this.el.innerHTML = `
      <div class="ai-head"><h2><span class="ai-logo">${I.sparkle}</span>Nude AI</h2>
        <button class="icon-btn small" data-a="new" title="New conversation">${I.newchat}</button>
        <button class="icon-btn small" data-a="expand" title="Full-screen workspace">${I.expand}</button>
        <button class="icon-btn small" data-a="close" title="Close">${I.close}</button></div>
      <div class="ai-log" aria-live="polite"></div>
      <div class="ai-compose">
        <div class="ai-share"></div>
        <div class="ai-input"><textarea rows="1" placeholder="Ask anything…" aria-label="Message Nude AI"></textarea>
          <button class="send" data-a="send" aria-label="Send">${I.send}</button></div>
        <div class="ai-foot">Nude AI only sees what you choose to share. It can make mistakes — check important facts.</div>
      </div>`;
    const ta = this.el.querySelector('textarea')!;
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(140, ta.scrollHeight)}px`; });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void this.send(ta.value); }
      if (e.key === 'Escape' && this.requestId) void nude.invoke('aiCancel', this.requestId);
    });
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.renderShare();
    this.renderLog();
  }

  private renderShare() {
    const box = this.el.querySelector('.ai-share')!;
    const s = this.getState();
    const tab = s?.tabs.find((t) => t.id === s.activeTabId);
    const webPage = tab && /^https?:/.test(tab.url);
    box.innerHTML = `<span class="tiny" style="align-self:center">Share:</span>
      <button class="toggle-chip${this.share.page ? ' on' : ''}" data-share="page" ${webPage ? '' : 'disabled'} title="Let Nude AI read this page">${I.page}This page</button>
      <button class="toggle-chip${this.share.selection ? ' on' : ''}" data-share="selection" title="Let Nude AI read the text you selected">${I.select}Selection</button>
      <button class="toggle-chip${this.tabIds.length ? ' on' : ''}" data-share="tabs">${I.tab}${this.tabIds.length ? `${this.tabIds.length} tabs` : 'Tabs…'}</button>
      <button class="toggle-chip${this.files.length ? ' on' : ''}" data-share="file">${I.file}${this.files.length ? esc(this.files.map((f) => f.name).join(', ').slice(0, 30)) : 'File…'}</button>`;
  }

  private async onClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
    if (a === 'close') this.toggle();
    if (a === 'expand') this.setExpanded(!this.expanded);
    if (a === 'new') { if (this.requestId) void nude.invoke('aiCancel', this.requestId); this.messages = []; this.tabIds = []; this.files = []; this.share = { page: false, selection: false }; this.renderShare(); this.renderLog(); }
    if (a === 'send') void this.send(this.el.querySelector('textarea')!.value);
    const share = t.closest<HTMLElement>('[data-share]')?.dataset.share;
    if (share === 'page' || share === 'selection') { this.share[share] = !this.share[share]; this.renderShare(); }
    if (share === 'tabs') await this.pickTabs(t.closest('[data-share]') as HTMLElement);
    if (share === 'file') this.pickFile();
    const sugg = t.closest<HTMLElement>('[data-sugg]')?.dataset.sugg;
    if (sugg !== undefined) { const [p, ctx] = SUGGESTIONS[Number(sugg)]; this.ask(p, ctx); }
    const copy = t.closest<HTMLElement>('[data-copy]')?.dataset.copy;
    if (copy !== undefined) { await navigator.clipboard.writeText(this.messages[Number(copy)].content); this.toast('Copied'); }
    const speak = t.closest<HTMLElement>('[data-speak]')?.dataset.speak;
    if (speak !== undefined) {
      if (speechSynthesis.speaking) speechSynthesis.cancel();
      else speechSynthesis.speak(new SpeechSynthesisUtterance(this.messages[Number(speak)].content.replace(/[*`#\[\]]/g, '')));
    }
    const shareMsg = t.closest<HTMLElement>('[data-sharemsg]')?.dataset.sharemsg;
    if (shareMsg !== undefined) {
      const text = this.messages[Number(shareMsg)].content;
      if ((navigator as Navigator & { share?: (d: ShareData) => Promise<void> }).share) await navigator.share({ text }).catch(() => {});
      else { await navigator.clipboard.writeText(text); this.toast('Copied to share'); }
    }
    const link = t.closest<HTMLElement>('a[data-href]')?.dataset.href;
    if (link) { e.preventDefault(); void nude.invoke('openUrlInNewTab', link); }
  }

  private async pickTabs(anchor: HTMLElement) {
    const tabs = await nude.invoke<{ id: number; title: string; url: string; favicon?: string }[]>('tabsForAi');
    const existing = this.el.querySelector('.tab-pick');
    if (existing) { existing.remove(); return; }
    const box = document.createElement('div');
    box.className = 'popover tab-pick';
    const r = anchor.getBoundingClientRect();
    Object.assign(box.style, { position: 'fixed', bottom: `${innerHeight - r.top + 6}px`, right: `${innerWidth - r.right}px`, transformOrigin: 'bottom right' });
    box.innerHTML = tabs.length ? `<div class="tiny" style="padding:4px 8px">Share these tabs with Nude AI</div>` + tabs.map((t) =>
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

  private async send(text: string) {
    const content = text.trim();
    if (!content || this.requestId) return;
    const ta = this.el.querySelector('textarea')!;
    ta.value = '';
    ta.style.height = 'auto';
    this.messages.push({ role: 'user', content });
    this.messages.push({ role: 'assistant', content: '', pending: true });
    this.requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.renderLog();
    await nude.invoke('aiAsk', {
      requestId: this.requestId,
      messages: this.messages.filter((m) => !m.pending && !m.error).map((m) => ({ role: m.role, content: m.content })),
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
      case 'error': msg.error = String(m.message); msg.pending = false; this.requestId = null; break;
      case 'done': msg.pending = false; this.requestId = null; break;
    }
    this.renderLog();
  }

  private renderLog() {
    const log = this.el.querySelector<HTMLElement>('.ai-log')!;
    if (!this.messages.length) {
      log.innerHTML = `<div class="ai-empty"><span class="ai-logo" style="width:44px;height:44px;border-radius:14px;margin:0 auto">${I.sparkle}</span>
        <h3>How can I help?</h3><div>Ask about anything, or share this page, a selection, some tabs or a file.</div>
        <div class="ai-chips">${SUGGESTIONS.map(([p], i) => `<button class="chip" data-sugg="${i}">${esc(p)}</button>`).join('')}</div></div>`;
      return;
    }
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.innerHTML = this.messages.map((m, i) => {
      if (m.role === 'user') return `<div class="msg user">${esc(m.content)}</div>`;
      if (m.error && !m.content) return `<div class="msg error">${esc(m.error)}</div>`;
      const body = m.pending && !m.content ? '<span class="typing"><i></i><i></i><i></i></span>' : renderMarkdown(m.content);
      const sources = m.sources?.length ? `<div class="msg-sources"><span class="tiny">Used:</span>${m.sources.map((s) => `<span class="src" title="${esc(s.url ?? '')}">${s.id} · ${esc(s.title)}</span>`).join('')}</div>`
        : !m.pending ? '<div class="msg-sources"><span class="tiny">No page content was shared.</span></div>' : '';
      const tools = !m.pending && m.content ? `<div class="msg-tools"><button class="icon-btn small" data-copy="${i}" title="Copy">${I.copy}</button>
        <button class="icon-btn small" data-sharemsg="${i}" title="Share">${I.share}</button><button class="icon-btn small" data-speak="${i}" title="Read aloud">${I.speaker}</button></div>` : '';
      return `<div class="msg assistant">${body}${sources}${tools}</div>${m.notice ? `<div class="notice">${esc(m.notice)}</div>` : ''}${m.error && m.content ? `<div class="msg error">${esc(m.error)}</div>` : ''}`;
    }).join('');
    if (atBottom || this.requestId) log.scrollTop = log.scrollHeight;
  }
}
