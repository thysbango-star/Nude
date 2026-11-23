// Nebula conversations, kept on this computer and, when you're signed in with a Nude ID, synced through
// Nude Accounts (sync space "nebula-chats") so the same chats show in Nude on your phone and in the Nebula app.
//
// Shared format (docs/NEBULA_SYNC.md): { id, title, updated, source, messages: [{ role, text, t }] }.
// Last write wins per chat, by `updated`.
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonStore } from './store';
import type { NudeId } from './nude-id';

export interface ChatMessage { role: 'user' | 'assistant'; text: string; t: number }
export interface Chat { id: string; title: string; updated: number; source: string; messages: ChatMessage[] }
interface Data { chats: Record<string, Chat>; deleted: Record<string, number>; since: Record<string, number> }

export const SPACE = 'nebula-chats';
const MAX_CHATS = 300;
const MAX_MESSAGES = 200;

export function cleanChat(raw: unknown, fallbackId?: string): Chat | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Chat>;
  const id = typeof r.id === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(r.id) ? r.id : fallbackId;
  if (!id || !Array.isArray(r.messages)) return null;
  const messages = r.messages.filter((m): m is ChatMessage => !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
    .slice(-MAX_MESSAGES).map((m) => ({ role: m.role, text: m.text.slice(0, 40_000), t: Number(m.t) || 0 }));
  if (!messages.length) return null;
  const firstUser = messages.find((m) => m.role === 'user')?.text ?? 'Conversation';
  return {
    id, messages, updated: Number(r.updated) || messages[messages.length - 1].t || Date.now(),
    title: (typeof r.title === 'string' && r.title.trim() ? r.title : firstUser).replace(/\s+/g, ' ').trim().slice(0, 80),
    source: typeof r.source === 'string' ? r.source.slice(0, 30) : 'unknown',
  };
}

export class NebulaChats {
  private store: JsonStore<Data>;
  private syncing: Promise<void> | null = null;

  constructor(dir: string, private nudeId: NudeId, private accountId: () => string | null) {
    this.store = new JsonStore<Data>(join(dir, 'nebula-chats.json'), () => ({ chats: {}, deleted: {}, since: {} }), 300);
  }

  list(): (Omit<Chat, 'messages'> & { count: number })[] {
    return Object.values(this.store.get().chats).sort((a, b) => b.updated - a.updated).map(({ messages: _m, ...c }) => ({ ...c, count: _m.length }));
  }

  get(id: string): Chat | null { return this.store.get().chats[id] ?? null; }

  /** Saves a conversation (new when id is null) and sends it to your other devices. */
  save(id: string | null, messages: ChatMessage[]): string {
    const chat = cleanChat({ id: id ?? randomUUID(), messages, updated: Date.now(), source: 'nude-desktop', title: this.get(id ?? '')?.title });
    if (!chat) return id ?? '';
    this.store.set((d) => {
      const chats = { ...d.chats, [chat.id]: chat };
      const ids = Object.values(chats).sort((a, b) => b.updated - a.updated).map((c) => c.id);
      for (const old of ids.slice(MAX_CHATS)) delete chats[old];
      return { ...d, chats };
    });
    void this.push(chat);
    return chat.id;
  }

  remove(id: string) {
    this.store.set((d) => { const chats = { ...d.chats }; delete chats[id]; return { ...d, chats, deleted: { ...d.deleted, [id]: Date.now() } }; });
    const acct = this.accountId();
    if (acct && this.nudeId.has(acct)) void this.nudeId.syncDelete(acct, SPACE, id).catch(() => {});
  }

  private async push(chat: Chat) {
    const acct = this.accountId();
    if (!acct || !this.nudeId.has(acct)) return;
    try { await this.nudeId.syncPut(acct, SPACE, chat.id, chat); } catch { /* sent again on the next sync */ }
  }

  /** Pulls chats made on your other devices. Safe to call often; only one runs at a time. */
  sync(): Promise<void> {
    this.syncing ??= this.doSync().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  private async doSync() {
    const acct = this.accountId();
    if (!acct || !this.nudeId.has(acct)) return;
    let since = this.store.get().since[acct] ?? 0;
    for (let page = 0; page < 10; page++) {
      const r = await this.nudeId.syncGet(acct, SPACE, since);
      this.store.set((d) => {
        const chats = { ...d.chats };
        for (const it of r.items) {
          if (it.value === null) { delete chats[it.key]; continue; }
          const c = cleanChat(it.value, it.key);
          if (c && (!chats[c.id] || chats[c.id].updated <= c.updated)) chats[c.id] = c;
        }
        return { ...d, chats };
      });
      since = r.items.length ? r.items[r.items.length - 1].t : r.now;
      if (!r.more) break;
    }
    this.store.set((d) => ({ ...d, since: { ...d.since, [acct]: since } }));
    // Chats made here before signing in go up once.
    const local = Object.values(this.store.get().chats).filter((c) => c.source === 'nude-desktop' && c.updated > (this.store.get().since[`pushed:${acct}`] ?? 0));
    for (const c of local) await this.push(c);
    this.store.set((d) => ({ ...d, since: { ...d.since, [`pushed:${acct}`]: Date.now() } }));
  }

  flush() { this.store.flush(); }
}
