// Nebula gateway HTTP server. Clients never see provider keys.
import { createServer, type IncomingMessage } from 'node:http';
import { buildPrompt, pickSpeed, type ChatMessage, type Source } from './prompt';
import { inlineImages } from './images';
import { providerFromEnv, type Provider } from './providers';

export interface GatewayOptions {
  provider: Provider;
  /** If set, clients must send "Authorization: Bearer <token>". */
  token?: string;
  maxTokens?: number;
  /** Requests per minute per client IP. */
  rateLimit?: number;
  /** Most characters of page/tab text sent to the model. Lower it for small local models. */
  maxSourceChars?: number;
  /** Download shared images and send them as data URLs (needed for Ollama). */
  inlineImages?: boolean;
}

async function readJson(req: IncomingMessage, limit = 2_000_000): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

export function createGateway(o: GatewayOptions) {
  const hits = new Map<string, number[]>();
  const limit = o.rateLimit ?? 30;
  return createServer(async (req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/health') return json(200, { ok: true, service: 'nude-ai-gateway', assistant: 'Nebula', provider: o.provider.name });
      if (url.pathname !== '/v1/chat' || req.method !== 'POST') return json(404, { error: 'Not found' });
      if (o.token && req.headers.authorization !== `Bearer ${o.token}`) return json(401, { error: 'Unauthorized' });

      const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() || req.socket.remoteAddress || '?';
      const now = Date.now();
      const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
      if (recent.length >= limit) return json(429, { error: 'Too many requests. Please wait a minute.' });
      recent.push(now);
      hits.set(ip, recent);

      const body = (await readJson(req)) as { messages?: ChatMessage[]; sources?: Source[]; mode?: string; speed?: string };
      if (!Array.isArray(body.messages) || !body.messages.length) return json(400, { error: 'messages is required' });
      const sources = Array.isArray(body.sources) ? body.sources : [];
      const prompt = buildPrompt(body.messages, sources, o.maxSourceChars ?? 120_000, typeof body.mode === 'string' ? body.mode : undefined);
      if (o.inlineImages) prompt.messages = await inlineImages(prompt.messages);
      const speed = pickSpeed(body.speed, sources);
      if (!prompt.messages.length) return json(400, { error: 'No user message' });

      res.writeHead(200, { 'x-nebula-speed': speed, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      const ctrl = new AbortController();
      req.on('close', () => ctrl.abort());
      const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      try {
        for await (const delta of o.provider.stream({ ...prompt, maxTokens: o.maxTokens ?? 1500, signal: ctrl.signal, speed })) send({ delta });
        send({ done: true });
      } catch (err) {
        if (!ctrl.signal.aborted) send({ error: `The AI provider failed: ${(err as Error).message}` });
      }
      res.end();
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      if (!res.headersSent) json(status, { error: status === 500 ? 'Internal error' : (err as Error).message });
      else res.end();
      if (status === 500) console.error(err);
    }
  });
}

// Started directly (npm start), not when bundled into the desktop app, which runs its own local gateway.
if (require.main === module && !process.versions.electron) {
  const provider = providerFromEnv();
  // A local Ollama server: images must be inlined, and pages trimmed to fit a small model's memory.
  const local = provider.name.startsWith('ollama:') || /(localhost|127\.0\.0\.1|:11434)/.test(process.env.OPENAI_BASE_URL ?? '');
  const server = createGateway({
    provider, token: process.env.NUDE_SERVICE_TOKEN, maxTokens: Number(process.env.NUDE_AI_MAX_TOKENS ?? 1500), rateLimit: Number(process.env.NUDE_AI_RATE_LIMIT ?? 30),
    maxSourceChars: Number(process.env.NUDE_AI_MAX_SOURCE_CHARS ?? (local ? 24_000 : 120_000)),
    inlineImages: process.env.NUDE_AI_INLINE_IMAGES ? process.env.NUDE_AI_INLINE_IMAGES === '1' : local,
  });
  const port = Number(process.env.PORT ?? 8790);
  server.listen(port, listenHost(), () => console.log(`Nebula gateway on http://${listenHost()}:${port} (provider: ${provider.name})`));
}

/** Local runs stay on this computer; on a host such as Render (which sets RENDER) the service must listen on all interfaces. */
function listenHost(): string {
  return process.env.HOST ?? (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
}
