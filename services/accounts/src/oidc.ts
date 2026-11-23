// Sign in with Nude: an OpenID Connect provider for other sites and apps.
// Authorization code flow only, PKCE S256 required, exact redirect URI match, single-use 60 s codes,
// ES256 ID tokens signed with a key that never leaves this service.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { Db } from './db';

export interface SigningKey { kid: string; priv: KeyObject; jwk: Record<string, string> }

export function signingKey(db: Db): SigningKey {
  const row = db.prepare('SELECT v FROM meta WHERE k = ?').get('es256') as { v: string } | undefined;
  let pem = row?.v;
  if (!pem) {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('es256', pem);
  }
  const priv = createPrivateKey(pem);
  const pub = createPublicKey(priv).export({ format: 'jwk' }) as Record<string, string>;
  const kid = createHash('sha256').update(pub.x + pub.y).digest('base64url').slice(0, 16);
  return { kid, priv, jwk: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y, use: 'sig', alg: 'ES256', kid } };
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

export function jwt(key: SigningKey, claims: Record<string, unknown>): string {
  const head = b64({ alg: 'ES256', typ: 'JWT', kid: key.kid });
  const body = b64(claims);
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: key.priv, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${head}.${body}.${sig}`;
}

export const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

export function discovery(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/jwks`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['ES256'],
    scopes_supported: ['openid', 'profile'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'nonce', 'name', 'preferred_username', 'nude_id', 'picture'],
  };
}

/** Redirect URIs must be https, or http on this computer only (for desktop apps, RFC 8252). */
export function redirectAllowed(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === '[::1]' || u.hostname === 'localhost');
  } catch { return false; }
}
