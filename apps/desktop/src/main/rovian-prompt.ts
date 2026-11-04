// "Sign in with Rovian" on websites: when a page offers Rovian sign-in, Nude shows its own prompt at the top right
// (like Google's One Tap). Nude never signs in for the site and never sees the site's tokens: the prompt just starts
// the site's own Rovian sign-in, exactly as if you had clicked its button.
//
// How a page is recognised, strongest first:
//   1. <meta name="rovian-signin" content="/auth/rovian">  or  <link rel="rovian-signin" href="/auth/rovian">,
//      pointing at the site's own start-sign-in URL (same site only).
//   2. A link straight to Rovian Account's authorize endpoint.
//   3. A visible button or link labelled "Sign in with Rovian" / "Continue with Rovian" (clicked for you).
// Page content is untrusted: Nude re-checks every URL here, shows the site name from the address bar (never text
// from the page), and Rovian Defender still checks wherever the sign-in goes.
import { registrableDomain, isPrivateIP } from '@nude/security-engine';
import { ROVIAN } from './rovian-auth';

export const ROVIAN_AUTHORIZE = `${ROVIAN.issuer}/oauth/authorize`;

export type RovianOfferKind = 'meta' | 'link' | 'authorize' | 'button';
export interface RovianOffer { kind: RovianOfferKind; url?: string }

/** Runs in an isolated world, so the page can't tamper with it. Returns what the page offers. */
export const DETECT_SCRIPT = `(() => {
  const AUTH = ${JSON.stringify(ROVIAN_AUTHORIZE)};
  const out = [];
  const meta = document.querySelector('meta[name="rovian-signin" i]');
  if (meta && meta.content) { try { out.push({ kind: 'meta', url: new URL(meta.content, location.href).href }); } catch (e) {} }
  const link = document.querySelector('link[rel~="rovian-signin" i]');
  if (link && link.href) out.push({ kind: 'link', url: link.href });
  for (const a of document.querySelectorAll('a[href]')) { if (a.href.startsWith(AUTH + '?')) { out.push({ kind: 'authorize', url: a.href }); break; } }
  if (!out.length) {
    const re = /^(sign in|sign-in|log in|login|continue|sign up)( with)? rovian( account)?$/i;
    for (const el of document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]')) {
      const t = String(el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ');
      if (t.length > 40 || !re.test(t)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || el.disabled) continue;
      document.querySelectorAll('[data-nude-rovian]').forEach((x) => x.removeAttribute('data-nude-rovian'));
      el.setAttribute('data-nude-rovian', '1');
      out.push({ kind: 'button' });
      break;
    }
  }
  return out.slice(0, 3);
})()`;

/** Clicks the button the detector marked. Run with a user gesture so a sign-in popup is allowed. */
export const CLICK_SCRIPT = `(() => { const el = document.querySelector('[data-nude-rovian="1"]'); if (!el) return false; el.click(); return true; })()`;

function parse(u: string): URL | null { try { return new URL(u); } catch { return null; } }

/** Plain http is only allowed for local development servers. */
function okScheme(u: URL) { return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || isPrivateIP(u.hostname))); }

/**
 * Picks the offer Nude will act on, or null. The page's URL decides the site; offers must stay on that site
 * (or go straight to Rovian Account's real authorize endpoint).
 */
export function chooseOffer(pageUrl: string, raw: unknown): RovianOffer | null {
  const page = parse(pageUrl);
  if (!page || !okScheme(page)) return null;
  const issuer = new URL(ROVIAN.issuer);
  // Not on Rovian Account itself, or on the sign-in callback.
  if (page.hostname === issuer.hostname || (page.hostname === '127.0.0.1' && page.port === new URL(ROVIAN.redirectUri).port)) return null;
  if (!Array.isArray(raw)) return null;
  const site = registrableDomain(page.hostname);
  for (const o of raw.slice(0, 3) as { kind?: unknown; url?: unknown }[]) {
    if (!o || typeof o !== 'object') continue;
    if (o.kind === 'button') return { kind: 'button' };
    if (typeof o.url !== 'string' || o.url.length > 4000) continue;
    const u = parse(o.url);
    if (!u || !okScheme(u)) continue;
    if (o.kind === 'authorize') {
      if (`${u.origin}${u.pathname}` !== ROVIAN_AUTHORIZE || u.protocol !== 'https:') continue;
      if (!u.searchParams.get('client_id') || !u.searchParams.get('redirect_uri')) continue;
      return { kind: 'authorize', url: u.href };
    }
    if (o.kind === 'meta' || o.kind === 'link') {
      if (registrableDomain(u.hostname) !== site || (page.protocol === 'https:' && u.protocol !== 'https:')) continue;
      return { kind: o.kind, url: u.href };
    }
  }
  return null;
}

/** The site name shown in the prompt: from the address bar, never from the page. */
export function siteLabel(pageUrl: string) {
  const u = parse(pageUrl);
  return u ? u.hostname.replace(/^www\./, '') : '';
}
