// The Nude IDs signed in on this computer. This file keeps only who you are (name, Nude ID, a cached picture);
// the sign-in token for each one lives encrypted in NudeId, and passwords never touch this computer's disk.
import { join } from 'node:path';
import { JsonStore } from './store';
import type { NudeAccount } from './nude-id';
import type { MeditateIdentity } from './meditate-auth';

export interface Account {
  id: string; // Nude Accounts user id
  username: string;
  name: string;
  color: string;
  photo?: string; // data: URL, cached from Nude Accounts
  created: number;
  lastSignIn: number;
  /** Where this Nude ID signs in: Meditate (the Nude sign-in site) or a Nude Accounts server. Missing = 'nude'. */
  provider?: 'nude' | 'meditate';
  email?: string;
  emailVerified?: boolean;
}

export interface PublicAccount {
  id: string; name: string; firstName: string; username: string; nudeId: string; color: string; photo?: string; initials: string;
  provider: 'nude' | 'meditate'; email?: string; emailVerified?: boolean; created: number; lastSignIn: number;
}

interface AccountsData {
  accounts: Account[]; currentId: string | null; guest: boolean;
  /** "Remember me" was off: sign out when Nude next starts. */ forgetOnQuit?: boolean;
  /** Sign-in activity on this computer (no secrets), newest first. */ events?: IdentityEvent[];
}

export interface IdentityEvent { t: number; kind: string; detail: string }

const COLORS = ['#2457FF', '#18B4E8', '#5B6FD8', '#3F8FB0', '#7A5CFF', '#1F9D8A', '#C45B9A'];

export function toPublic(a: Account): PublicAccount {
  const parts = a.name.trim().split(/\s+/);
  return {
    id: a.id, name: a.name, firstName: parts[0] ?? a.name, username: a.username, nudeId: `${a.username}@nude`, color: a.color, photo: a.photo,
    initials: ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?',
    provider: a.provider ?? 'nude', email: a.email, emailVerified: a.emailVerified, created: a.created, lastSignIn: a.lastSignIn,
  };
}

export class Accounts {
  readonly store: JsonStore<AccountsData>;
  onChange: () => void = () => {};

  constructor(dir: string) {
    this.store = new JsonStore<AccountsData>(join(dir, 'accounts.json'), () => ({ accounts: [], currentId: null, guest: false }), 100);
    const d = this.store.get();
    // Accounts from before Nude IDs (on-device or Rovian) can't sign in any more: drop them, keep the browsing data.
    const kept = d.accounts.filter((a) => typeof (a as Partial<Account>).username === 'string');
    if (kept.length !== d.accounts.length) this.store.set((x) => ({ ...x, accounts: kept, currentId: kept.some((a) => a.id === x.currentId) ? x.currentId : null }));
    // Checked at startup rather than on quit, so it also holds after a crash or a forced shutdown.
    if (this.store.get().forgetOnQuit) this.store.set((x) => ({ ...x, currentId: null, forgetOnQuit: false }));
  }

  setRemember(remember: boolean) { this.store.set((d) => ({ ...d, forgetOnQuit: !remember })); }

  currentRaw(): Account | null {
    const d = this.store.get();
    return d.accounts.find((x) => x.id === d.currentId) ?? null;
  }

  current(): PublicAccount | null { const a = this.currentRaw(); return a ? toPublic(a) : null; }

  /** True on first run, until you sign in or choose to continue without an account. */
  needsWelcome(): boolean { const d = this.store.get(); return !d.currentId && !d.guest; }

  list(): PublicAccount[] { return this.store.get().accounts.map(toPublic); }

  /** After Nude Accounts confirmed who you are: remember the identity (never the password) and make it current. */
  signedIn(n: NudeAccount, photo?: string | null, makeCurrent = true): PublicAccount {
    const d = this.store.get();
    const had = d.accounts.find((x) => x.id === n.id);
    const a: Account = {
      id: n.id, username: n.username, name: n.name, color: had?.color ?? COLORS[d.accounts.length % COLORS.length],
      photo: photo === null ? undefined : photo ?? had?.photo, created: n.created, lastSignIn: Date.now(),
    };
    this.store.set((x) => ({
      ...x, accounts: had ? x.accounts.map((y) => (y.id === a.id ? a : y)) : [...x.accounts, a],
      currentId: makeCurrent ? a.id : x.currentId, guest: makeCurrent ? false : x.guest,
    }));
    this.onChange();
    return toPublic(a);
  }

  /** After Meditate's ID token was verified: remember who you are (never a token) and make it current. */
  signedInMeditate(i: MeditateIdentity, photo?: string | null): PublicAccount {
    const d = this.store.get();
    const id = `meditate:${i.sub}`;
    const had = d.accounts.find((x) => x.id === id);
    const a: Account = {
      id, username: i.username, name: i.name, color: had?.color ?? COLORS[d.accounts.length % COLORS.length],
      photo: photo ?? had?.photo, created: had?.created ?? Date.now(), lastSignIn: Date.now(),
      provider: 'meditate', email: i.email, emailVerified: i.emailVerified,
    };
    this.store.set((x) => ({ ...x, accounts: had ? x.accounts.map((y) => (y.id === id ? a : y)) : [...x.accounts, a], currentId: id, guest: false }));
    this.logEvent('signin', `Signed in with Meditate as ${a.username}@nude`);
    this.onChange();
    return toPublic(a);
  }

  /** Refreshes the cached name and picture from Nude Accounts. */
  refresh(n: NudeAccount, photo?: string | null) {
    const had = this.store.get().accounts.find((x) => x.id === n.id);
    if (!had) return;
    const next: Account = { ...had, name: n.name, username: n.username, photo: photo === null ? undefined : photo ?? had.photo };
    if (!n.avatar) delete next.photo;
    this.store.set((x) => ({ ...x, accounts: x.accounts.map((y) => (y.id === n.id ? next : y)) }));
    this.onChange();
  }

  /** Signs out of the current Nude ID on this computer; it stays listed so you can sign back in quickly. */
  signOut() {
    const was = this.current();
    if (was) this.logEvent('signout', `Signed out of ${was.nudeId}`);
    this.store.set((d) => ({ ...d, currentId: null, guest: false, forgetOnQuit: false }));
    this.onChange();
  }

  /** Removes a Nude ID from this computer's list (after signing it out). */
  remove(id: string) {
    this.store.set((x) => ({ ...x, accounts: x.accounts.filter((y) => y.id !== id), currentId: x.currentId === id ? null : x.currentId }));
    this.onChange();
  }

  continueAsGuest() { this.store.set((d) => ({ ...d, guest: true })); this.onChange(); }

  switchTo(id: string) {
    const a = this.store.get().accounts.find((x) => x.id === id);
    if (!a) return false;
    this.store.set((x) => ({ ...x, currentId: a.id, guest: false }));
    this.logEvent('switch', `Switched to ${a.username}@nude`);
    this.onChange();
    return true;
  }

  logEvent(kind: string, detail: string) {
    this.store.set((d) => ({ ...d, events: [{ t: Date.now(), kind: kind.slice(0, 40), detail: detail.slice(0, 200) }, ...(d.events ?? [])].slice(0, 100) }));
  }

  events(): IdentityEvent[] { return this.store.get().events ?? []; }
}
