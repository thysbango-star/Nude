// Fills a login that PassGate sent from your phone into the page's sign-in form.
// Runs in an isolated world (the page can't see it); the login goes in as an escaped JSON literal, and only if the tab is
// still on the exact origin the request was made for. Nude doesn't store or log it.
import type { WebContents } from 'electron';

const WORLD = 1002;

/** Finds the visible password field and the username field before it, and types into them like a person would. */
const FILL = `(function (cred) {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.disabled && !el.readOnly; };
  const set = (el, v) => {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    el.focus(); desc.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const pw = [...document.querySelectorAll('input[type=password]')].find(visible);
  const scope = (pw && pw.form) || document;
  const users = [...scope.querySelectorAll('input[autocomplete~=username], input[type=email], input[name*=user i], input[name*=login i], input[name*=email i], input[id*=user i], input[id*=email i], input[type=text], input[type=tel]')].filter(visible);
  const before = pw ? users.filter((u) => u.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING) : users;
  const user = before[before.length - 1] || users[0];
  if (user && cred.username) set(user, cred.username);
  if (pw) set(pw, cred.password);
  return { user: Boolean(user && cred.username), password: Boolean(pw) };
})`;

export async function fillLogin(wc: WebContents, origin: string, cred: { username: string; password: string }): Promise<{ ok: boolean; message: string }> {
  let now = '';
  try { now = new URL(wc.getURL()).origin; } catch { /* ignore */ }
  if (now !== origin) return { ok: false, message: 'The page changed, so Nude didn\'t fill in the login.' };
  try {
    const r = await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `${FILL}(${JSON.stringify(cred)})` }]) as { user: boolean; password: boolean };
    if (!r.password && !r.user) return { ok: false, message: 'Nude couldn\'t find a sign-in form on this page.' };
    return { ok: true, message: r.password ? 'Filled in your login from PassGate.' : 'Filled in your username from PassGate. Enter the password on the next page.' };
  } catch {
    return { ok: false, message: 'Nude couldn\'t fill in this page.' };
  }
}
