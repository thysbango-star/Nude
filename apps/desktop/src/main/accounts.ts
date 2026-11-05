// Nude accounts. Accounts live on this device: the password is stored only as a salted scrypt hash.
// (Cross-device sync will use the same account once the Nude Sync service exists.)
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { JsonStore } from './store';
import type { RovianIdentity } from './rovian-auth';

export interface Account {
  id: string;
  name: string;
  email: string;
  color: string;
  photo?: string; // data: URL, max ~200 KB
  created: number;
  /** Local accounts only. Rovian accounts have no password on this device. */
  salt?: string;
  hash?: string;
  /** Verified Rovian identity (no tokens are ever stored). */
  rovian?: { sub: string; username: string | null; rovianId: string | null; emailVerified: boolean; linkedAt: number; lastSignIn: number };
}

export interface PublicAccount {
  id: string; name: string; firstName: string; email: string; color: string; photo?: string; initials: string;
  provider: 'local' | 'rovian'; rovianId?: string | null; username?: string | null; lastSignIn?: number; emailVerified?: boolean; linkedAt?: number;
}

interface AccountsData { accounts: Account[]; currentId: string | null; guest: boolean; /** "Remember me" was off: sign out when Nude next starts. */ forgetOnQuit?: boolean; /** Sign-in activity (no secrets), newest first. */ events?: IdentityEvent[] }

/** Something that happened to your identity in Nude: shown in PassGate. */
export interface IdentityEvent { t: number; kind: string; detail: string }

const COLORS = ['#B44BD6', '#E0733A', '#3F8FB0', '#4F9A6D', '#C45B9A', '#5B6FD8', '#C9963B'];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}

export function toPublic(a: Account): PublicAccount {
  const parts = a.name.trim().split(/\s+/);
  return {
    id: a.id, name: a.name, firstName: parts[0] ?? a.name, email: a.email, color: a.color, photo: a.photo,
    initials: ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?',
    provider: a.rovian ? 'rovian' : 'local', rovianId: a.rovian?.rovianId, username: a.rovian?.username, lastSignIn: a.rovian?.lastSignIn,
    emailVerified: a.rovian?.emailVerified, linkedAt: a.rovian?.linkedAt,
  };
}

export class Accounts {
  readonly store: JsonStore<AccountsData>;
  private failures = new Map<string, { count: number; until: number }>();
  onChange: () => void = () => {};

  constructor(dir: string) {
    this.store = new JsonStore<AccountsData>(join(dir, 'accounts.json'), () => ({ accounts: [], currentId: null, guest: false }), 100);
    // Checked at startup rather than on quit, so it also holds after a crash or a forced shutdown.
    if (this.store.get().forgetOnQuit) this.store.set((d) => ({ ...d, currentId: null, forgetOnQuit: false }));
  }

  /** "Remember me": when off, this sign-in lasts until Nude is closed. */
  setRemember(remember: boolean) {
    this.store.set((d) => ({ ...d, forgetOnQuit: !remember }));
  }

  current(): PublicAccount | null {
    const d = this.store.get();
    const a = d.accounts.find((x) => x.id === d.currentId);
    return a ? toPublic(a) : null;
  }

  /** True on first run, until the user signs in or chooses to continue without an account. */
  needsWelcome(): boolean {
    const d = this.store.get();
    return !d.currentId && !d.guest;
  }

  list(): PublicAccount[] {
    return this.store.get().accounts.map(toPublic);
  }

  signUp(nameRaw: string, emailRaw: string, password: string): { ok: true; account: PublicAccount } | { ok: false; error: string } {
    const name = String(nameRaw ?? '').trim().slice(0, 80);
    const email = String(emailRaw ?? '').trim().toLowerCase().slice(0, 254);
    if (!name) return { ok: false, error: 'Please enter your name.' };
    if (!EMAIL.test(email)) return { ok: false, error: 'Please enter a valid email address.' };
    if (typeof password !== 'string' || password.length < 8) return { ok: false, error: 'Use a password with at least 8 characters.' };
    if (this.store.get().accounts.some((a) => a.email === email)) return { ok: false, error: 'An account with this email already exists on this device. Sign in instead.' };
    const salt = randomBytes(16).toString('hex');
    const account: Account = {
      id: randomUUID(), name, email, color: COLORS[this.store.get().accounts.length % COLORS.length],
      created: Date.now(), salt, hash: hashPassword(password, salt),
    };
    this.store.set((d) => ({ ...d, accounts: [...d.accounts, account], currentId: account.id, guest: false }));
    this.logEvent('signup', `Created the Nude account ${email}`);
    this.onChange();
    return { ok: true, account: toPublic(account) };
  }

  signIn(emailRaw: string, password: string): { ok: true; account: PublicAccount } | { ok: false; error: string } {
    const email = String(emailRaw ?? '').trim().toLowerCase();
    const f = this.failures.get(email);
    if (f && f.until > Date.now()) return { ok: false, error: `Too many attempts. Try again in ${Math.ceil((f.until - Date.now()) / 1000)} seconds.` };
    const a = this.store.get().accounts.find((x) => x.email === email);
    const ok = a && a.hash && a.salt && typeof password === 'string' &&
      timingSafeEqual(Buffer.from(hashPassword(password, a.salt), 'hex'), Buffer.from(a.hash, 'hex'));
    if (!a || !ok) {
      const count = (f?.count ?? 0) + 1;
      this.failures.set(email, { count, until: count >= 5 ? Date.now() + 30_000 * (count - 4) : 0 });
      if (a) this.logEvent('signin-failed', `Wrong password for ${email}`);
      return { ok: false, error: 'That email and password don\'t match an account on this device.' };
    }
    this.failures.delete(email);
    this.store.set((d) => ({ ...d, currentId: a.id, guest: false }));
    this.logEvent('signin', `Signed in to Nude as ${email}`);
    this.onChange();
    return { ok: true, account: toPublic(a) };
  }

  signOut() {
    const was = this.current();
    if (was) this.logEvent('signout', `Signed out of ${was.rovianId ?? was.email}`);
    this.store.set((d) => ({ ...d, currentId: null, guest: false, forgetOnQuit: false }));
    this.onChange();
  }

  continueAsGuest() {
    this.store.set((d) => ({ ...d, guest: true }));
    this.onChange();
  }

  update(patch: { name?: string; photo?: string | null }): PublicAccount | null {
    const d = this.store.get();
    const a = d.accounts.find((x) => x.id === d.currentId);
    if (!a) return null;
    const next = { ...a };
    if (typeof patch.name === 'string' && patch.name.trim()) next.name = patch.name.trim().slice(0, 80);
    if (patch.photo === null) delete next.photo;
    else if (typeof patch.photo === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(patch.photo) && patch.photo.length < 300_000) next.photo = patch.photo;
    this.store.set((x) => ({ ...x, accounts: x.accounts.map((y) => (y.id === a.id ? next : y)) }));
    this.onChange();
    return toPublic(next);
  }

  changePassword(oldPw: string, newPw: string): { ok: boolean; error?: string } {
    const d = this.store.get();
    const a = d.accounts.find((x) => x.id === d.currentId);
    if (!a) return { ok: false, error: 'Not signed in.' };
    if (!a.salt || !a.hash) return { ok: false, error: 'This account signs in with Rovian. Change your password in your Rovian Account.' };
    if (hashPassword(String(oldPw), a.salt) !== a.hash) return { ok: false, error: 'Your current password is incorrect.' };
    if (typeof newPw !== 'string' || newPw.length < 8) return { ok: false, error: 'Use a password with at least 8 characters.' };
    const salt = randomBytes(16).toString('hex');
    this.store.set((x) => ({ ...x, accounts: x.accounts.map((y) => (y.id === a.id ? { ...y, salt, hash: hashPassword(newPw, salt) } : y)) }));
    return { ok: true };
  }

  deleteCurrent(password: string): { ok: boolean; error?: string } {
    const d = this.store.get();
    const a = d.accounts.find((x) => x.id === d.currentId);
    if (!a) return { ok: false, error: 'Not signed in.' };
    // Rovian accounts have no local password; removing one only forgets it on this device.
    if (a.salt && a.hash && hashPassword(String(password), a.salt) !== a.hash) return { ok: false, error: 'Password is incorrect.' };
    this.store.set((x) => ({ accounts: x.accounts.filter((y) => y.id !== a.id), currentId: null, guest: false }));
    this.onChange();
    return { ok: true };
  }

  /**
   * Signs in (or links) with a verified Rovian identity. The account is matched by Rovian's subject id. An existing
   * local account is only joined to it when Rovian has verified the same email address.
   */
  withRovian(id: RovianIdentity, makeCurrent: boolean, photo?: string): PublicAccount {
    const d = this.store.get();
    const now = Date.now();
    let a = d.accounts.find((x) => x.rovian?.sub === id.sub)
      ?? (id.rovianId ? d.accounts.find((x) => x.rovian?.rovianId === id.rovianId) : undefined)
      ?? (id.emailVerified && id.email ? d.accounts.find((x) => !x.rovian && x.email === id.email) : undefined);
    const rovian = { sub: id.sub, username: id.username, rovianId: id.rovianId, emailVerified: id.emailVerified, linkedAt: a?.rovian?.linkedAt ?? now, lastSignIn: now };
    if (a) a = { ...a, name: id.name || a.name, email: id.email || a.email, rovian };
    else a = { id: randomUUID(), name: id.name, email: id.email, color: COLORS[d.accounts.length % COLORS.length], created: now, rovian };
    if (photo && /^data:image\/(png|jpeg|webp|gif);base64,/.test(photo) && photo.length < 300_000) a = { ...a, photo };
    const next = a;
    this.store.set((x) => ({
      ...x,
      accounts: x.accounts.some((y) => y.id === next.id) ? x.accounts.map((y) => (y.id === next.id ? next : y)) : [...x.accounts, next],
      currentId: makeCurrent ? next.id : x.currentId, guest: makeCurrent ? false : x.guest,
    }));
    this.onChange();
    return toPublic(next);
  }

  /** Switch to another account already on this device. Local password accounts still need their password. */
  switchTo(id: string): { ok: boolean; error?: string } {
    const a = this.store.get().accounts.find((x) => x.id === id);
    if (!a) return { ok: false, error: 'That account isn\'t on this device any more.' };
    if (!a.rovian) return { ok: false, error: 'password' };
    this.store.set((x) => ({ ...x, currentId: a.id, guest: false }));
    this.logEvent('switch', `Switched to ${a.rovian.rovianId ?? a.email}`);
    this.onChange();
    return { ok: true };
  }

  logEvent(kind: string, detail: string) {
    this.store.set((d) => ({ ...d, events: [{ t: Date.now(), kind: kind.slice(0, 40), detail: detail.slice(0, 200) }, ...(d.events ?? [])].slice(0, 100) }));
  }

  events(): IdentityEvent[] { return this.store.get().events ?? []; }

  /** Forget a Rovian account on this device (it stays in Rovian Account). */
  forgetRovian(id: string) {
    const a = this.store.get().accounts.find((x) => x.id === id);
    if (!a?.rovian) return false;
    this.store.set((x) => ({
      ...x,
      accounts: a.salt ? x.accounts.map((y) => (y.id === id ? { ...y, rovian: undefined } : y)) : x.accounts.filter((y) => y.id !== id),
      currentId: x.currentId === id && !a.salt ? null : x.currentId, guest: x.guest,
    }));
    this.onChange();
    return true;
  }
}
