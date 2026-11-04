// Some providers (Ollama) only accept images as base64 data URLs, not links.
// inlineImages downloads each shared image (public https only, size-capped) and swaps the link for a data URL.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { ChatMessage } from './prompt';

const MAX_BYTES = 5 * 1024 * 1024;

/** Private, loopback and link-local addresses are never fetched (stops the gateway being used to probe a local network). */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function toDataUrl(url: string, fetchImpl: typeof fetch, resolve: (host: string) => Promise<string[]>): Promise<string | null> {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : await resolve(host).catch(() => []);
  if (!addrs.length || addrs.some(isPrivateAddress)) return null;
  try {
    const res = await fetchImpl(u, { redirect: 'error', signal: AbortSignal.timeout(8000) });
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!res.ok || !/^image\/(png|jpeg|gif|webp)$/.test(type)) return null;
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function inlineImages(
  messages: ChatMessage[],
  fetchImpl: typeof fetch = fetch,
  resolve: (host: string) => Promise<string[]> = async (h) => (await lookup(h, { all: true })).map((r) => r.address),
): Promise<ChatMessage[]> {
  return Promise.all(messages.map(async (m) => {
    if (!m.images?.length) return m;
    const images = (await Promise.all(m.images.map((u) => (u.startsWith('data:image/') ? u : toDataUrl(u, fetchImpl, resolve))))).filter((x): x is string => Boolean(x));
    return { ...m, images, content: images.length < m.images.length ? `${m.content}\n\n(Note: an image the user shared couldn't be loaded.)` : m.content };
  }));
}
