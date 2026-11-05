// Rovian Connect: Rovian Account's popup sign-in. The page opens ROVIAN_CONNECT/connect in a popup; Rovian says
// hello, Nude answers with its name, and after you approve Rovian posts your identity back. No tokens exist in this
// flow: the browser guarantees the message really came from Rovian's origin, and Nude checks its shape here.
//
//   popup → opener  { type: 'rovian:connect-hello' }
//   opener → popup  { type: 'rovian:site-info', name: 'Nude Browser' }
//   popup → opener  { type: 'rovian:identity', identity: { rovianId, username, name, avatarUrl } }  or  { type: 'rovian:denied' }
import type { RovianIdentity } from './rovian-auth';

export const ROVIAN_CONNECT_ORIGIN = 'https://rovianaccounts.lovable.app';
export const ROVIAN_CONNECT_URL = `${ROVIAN_CONNECT_ORIGIN}/connect`;
/** How long after opening the popup Nude accepts an identity from that page. */
export const CONNECT_TTL = 15 * 60_000;

const ROVIAN_ID = /^([a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?)@rovian\.cloud$/i;

export interface ConnectIdentity extends RovianIdentity { avatarUrl: string | null }

/** Checks what Rovian sent. Returns null if anything is off. */
export function parseConnectIdentity(raw: unknown): ConnectIdentity | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const rovianId = typeof r.rovianId === 'string' ? r.rovianId.trim().toLowerCase() : '';
  const m = ROVIAN_ID.exec(rovianId);
  if (!m) return null;
  const username = m[1];
  if (r.username !== undefined && r.username !== null && (typeof r.username !== 'string' || r.username.trim().toLowerCase() !== username)) return null;
  const name = typeof r.name === 'string' ? r.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100) : '';
  let avatarUrl: string | null = null;
  if (typeof r.avatarUrl === 'string' && r.avatarUrl.length < 2000) {
    try { const u = new URL(r.avatarUrl); if (u.protocol === 'https:') avatarUrl = u.href; } catch { /* ignore */ }
  }
  return {
    // A stable key for this Rovian identity in Nude (Connect has no OIDC subject).
    sub: `rovian-connect:${rovianId}`,
    name: name || username,
    email: rovianId,
    emailVerified: false,
    username,
    rovianId,
    picture: avatarUrl,
    authTime: null,
    avatarUrl,
  };
}
