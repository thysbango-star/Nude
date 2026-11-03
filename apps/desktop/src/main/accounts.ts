// Nude accounts. Accounts live on this device: the password is stored only as a salted scrypt hash.
// (Cross-device sync will use the same account once the Nude Sync service exists.)
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { JsonStore } from './store';

export interface Account {
  id: string;
  name: string;
  email: string;
  color: string;
  photo?: string; // data: URL, max ~200 KB
  created: number;
  salt: string;
  hash: string;
}

export interface PublicAccount { id: string; name: string; firstName: string; email: string; color: string; photo?: string; initials: string }

interface AccountsData { accounts: Account[]; currentId: string | null; guest: boolean }

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
  };
}

export class Accounts {
  readonly store: JsonStore<AccountsData>;
  private failures = new Map<string, { count: number; until: number }>();
  onChange: () => void = () => {};

  constructor(dir: string) {
    this.store = new JsonStore<AccountsData>(join(dir, 'accounts.json'), () => ({ accounts: [], currentId: null, guest: false }), 100);
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
    this.store.set((d) => ({ accounts: [...d.accounts, account], currentId: account.id, guest: false }));
    this.onChange();
    return { ok: true, account: toPublic(account) };
  }

  signIn(emailRaw: string, password: string): { ok: true; account: PublicAccount } | { ok: false; error: string } {
    const email = String(emailRaw ?? '').trim().toLowerCase();
    const f = this.failures.get(email);
    if (f && f.until > Date.now()) return { ok: false, error: `Too many attempts. Try again in ${Math.ceil((f.until - Date.now()) / 1000)} seconds.` };
    const a = this.store.get().accounts.find((x) => x.email === email);
    const ok = a && typeof password === 'string' &&
      timingSafeEqual(Buffer.from(hashPassword(password, a.salt), 'hex'), Buffer.from(a.hash, 'hex'));
    if (!a || !ok) {
      const count = (f?.count ?? 0) + 1;
      this.failures.set(email, { count, until: count >= 5 ? Date.now() + 30_000 * (count - 4) : 0 });
      return { ok: false, error: 'That email and password don\'t match an account on this device.' };
    }
    this.failures.delete(email);
    this.store.set((d) => ({ ...d, currentId: a.id, guest: false }));
    this.onChange();
    return { ok: true, account: toPublic(a) };
  }

  signOut() {
    this.store.set((d) => ({ ...d, currentId: null, guest: false }));
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
    if (hashPassword(String(password), a.salt) !== a.hash) return { ok: false, error: 'Password is incorrect.' };
    this.store.set((x) => ({ accounts: x.accounts.filter((y) => y.id !== a.id), currentId: null, guest: false }));
    this.onChange();
    return { ok: true };
  }
}
