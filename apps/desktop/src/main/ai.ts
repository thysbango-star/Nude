// Nebula (Nude's AI) bridge: gathers ONLY the context the user explicitly shared, attaches Rovian Defender
// signals, and streams answers from the AI gateway (which holds all provider keys).
import { net, type WebContents } from 'electron';
import { analyzeMessage, analyzeUrl, CATEGORY_INFO } from '@nude/security-engine';
import type { NudeApp } from './app';
import { ReaderStore } from './reader';
import type { AiSource } from '../shared/types';

export interface AiRequest {
  requestId: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  share: { page?: boolean; selection?: boolean; tabIds?: number[]; files?: { name: string; text: string }[] };
  mode?: string;
}

interface SourcePayload extends AiSource { content: string }

export class AiBridge {
  private controllers = new Map<string, AbortController>();

  constructor(private app: NudeApp) {}

  cancel(requestId: string) {
    this.controllers.get(requestId)?.abort();
  }

  async ask(ui: WebContents, activeTab: { wc: WebContents; id: number } | undefined, tabsById: (id: number) => WebContents | undefined, req: AiRequest) {
    const send = (msg: Record<string, unknown>) => { if (!ui.isDestroyed()) ui.send('chrome:ai', { requestId: req.requestId, ...msg }); };
    const sources: SourcePayload[] = [];
    try {
      if (req.share.page && activeTab && /^https?:/.test(activeTab.wc.getURL())) {
        const p = await ReaderStore.pageText(activeTab.wc);
        sources.push({ id: `S${sources.length + 1}`, kind: 'page', title: p.title, url: p.url, content: p.text });
        sources.push(this.securitySource(p.url, sources.length + 1));
        const products = await ReaderStore.pageProducts(activeTab.wc).catch(() => []);
        if (products.length) {
          sources.push({ id: `S${sources.length + 1}`, kind: 'products', title: `Products on ${new URL(p.url).hostname}`, url: p.url, content: JSON.stringify(products) });
        }
      }
      if (req.share.selection && activeTab) {
        const text = await ReaderStore.selection(activeTab.wc);
        if (text.trim()) sources.push({ id: `S${sources.length + 1}`, kind: 'selection', title: 'Selected text', url: activeTab.wc.getURL(), content: text });
      }
      for (const id of (req.share.tabIds ?? []).slice(0, 8)) {
        const wc = tabsById(id);
        if (!wc || !/^https?:/.test(wc.getURL())) continue;
        const p = await ReaderStore.pageText(wc, 30_000);
        sources.push({ id: `S${sources.length + 1}`, kind: 'tab', title: p.title, url: p.url, content: p.text });
      }
      for (const f of (req.share.files ?? []).slice(0, 5)) {
        sources.push({ id: `S${sources.length + 1}`, kind: 'file', title: f.name.slice(0, 200), content: String(f.text).slice(0, 80_000) });
      }
    } catch (err) {
      send({ type: 'error', message: `Couldn't read the shared content: ${(err as Error).message}` });
      return;
    }
    send({ type: 'sources', sources: sources.map(({ content: _c, ...s }) => s) });

    const last = req.messages[req.messages.length - 1]?.content ?? '';
    // Pasted message/email: add Rovian Defender's scam analysis as a source.
    if (/scam|phish|fraud|legit|genuine|real\??|safe\??/i.test(last) && last.length > 120) {
      const v = analyzeMessage(last);
      sources.push({ id: `S${sources.length + 1}`, kind: 'security', title: 'Rovian Defender message analysis',
        content: JSON.stringify({ assessment: v.assessment, indicators: v.indicators.map((i) => i.message), links: v.links.map((l) => ({ host: l.host, action: l.action, confidence: l.confidence })) }) });
    }

    const settings = this.app.profile.settings.get();
    const ctrl = new AbortController();
    this.controllers.set(req.requestId, ctrl);
    try {
      const res = await net.fetch(`${settings.aiGatewayUrl.replace(/\/+$/, '')}/v1/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...(settings.serviceToken ? { authorization: `Bearer ${settings.serviceToken}` } : {}) },
        body: JSON.stringify({ messages: req.messages.slice(-20), sources, stream: true, mode: req.mode ?? this.app.profile.settings.get().mode }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`gateway answered HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const event = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = event.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
          if (!data) continue;
          try {
            const msg = JSON.parse(data) as { delta?: string; error?: string; done?: boolean };
            if (msg.delta) send({ type: 'delta', text: msg.delta });
            if (msg.error) send({ type: 'error', message: msg.error });
          } catch { /* ignore malformed chunk */ }
        }
      }
      send({ type: 'done' });
    } catch (err) {
      if (ctrl.signal.aborted) {
        send({ type: 'done' });
      } else {
        // Offline fallback: security questions can still be answered on-device.
        const local = this.localAnswer(last, activeTab?.wc.getURL());
        if (local) {
          send({ type: 'delta', text: local });
          send({ type: 'notice', message: 'Answered on your device by Rovian Defender — the Nebula service isn\'t reachable.' });
          send({ type: 'done' });
        } else {
          send({ type: 'error', message: `Nebula isn't reachable (${(err as Error).message}). Start the AI gateway or set its address in Settings → Nebula.` });
        }
      }
    } finally {
      this.controllers.delete(req.requestId);
    }
  }

  private securitySource(url: string, n: number): SourcePayload {
    const v = analyzeUrl(url, undefined, this.app.profile.settings.get().protectionLevel);
    const live = this.app.security.check(url);
    return { id: `S${n}`, kind: 'security', title: 'Rovian Defender site check', url,
      content: JSON.stringify({ action: live.action, confidence: live.confidence, category: live.category ?? null, signals: (live.signals.length ? live.signals : v.signals).map((s) => s.message) }) };
  }

  /** Deterministic on-device answers for safety questions. */
  localAnswer(question: string, currentUrl?: string): string | null {
    const q = question.toLowerCase();
    if (/(is|are) (this|the) (site|website|page) (safe|legit|real|a scam)|safe to (use|visit)/.test(q) && currentUrl && /^https?:/.test(currentUrl)) {
      const v = this.app.security.check(currentUrl);
      const host = new URL(currentUrl).hostname;
      if (v.action === 'allow') {
        return `**${host}** isn't on Rovian Defender's threat lists and shows no strong warning signs.\n\nThat isn't a guarantee it's safe — Rovian Defender can only check known threats and common tricks. ${currentUrl.startsWith('https:') ? 'The connection is encrypted.' : 'The connection is **not** encrypted, so avoid entering passwords or payment details.'}`;
      }
      const info = v.category ? CATEGORY_INFO[v.category] : null;
      return `**${host}** was flagged (${v.confidence === 'confirmed' ? 'confirmed threat' : 'suspected — not confirmed'}).\n\n${info?.explanation ?? ''}\n\nWhy:\n${v.signals.map((s) => `- ${s.message}`).join('\n')}\n\n${info?.advice ?? ''}`;
    }
    if (question.length > 120 && /scam|phish|fraud|legit|genuine/.test(q)) {
      const v = analyzeMessage(question);
      const label = { 'likely-scam': 'Likely a scam', suspicious: 'Suspicious', 'no-strong-signs': 'No strong scam signs found' }[v.assessment];
      return `**${label}.**\n\n${v.indicators.length ? 'What I noticed:\n' + v.indicators.map((i) => `- ${i.message}${i.evidence ? ` ("${i.evidence.slice(0, 60)}")` : ''}`).join('\n') + '\n\n' : ''}${v.summary}`;
    }
    if (/why (was|is) (this|the|my) download blocked|why.*blocked/.test(q)) {
      const ev = this.app.security.summary().events.find((e) => e.type === 'download-blocked' || e.type === 'site-blocked');
      if (ev) return `Rovian Defender blocked ${ev.type === 'download-blocked' ? 'a download' : 'a site'}: ${ev.detail}\n\nSafe next steps: get the file or site from the official source by typing its address yourself. Nebula can't override this protection; if you're sure it's a mistake, you can review it on the Rovian Defender page.`;
    }
    return null;
  }
}
