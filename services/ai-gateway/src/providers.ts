// Model providers. Keys are read from the environment on the server only.
import type { ChatMessage } from './prompt';

export interface Provider {
  name: string;
  /** speed picks the fast or the thorough model when the provider has both. */
  stream(input: { system: string; messages: ChatMessage[]; maxTokens: number; signal: AbortSignal; speed?: 'fast' | 'thorough' }): AsyncIterable<string>;
}

function anthropicMessages(messages: ChatMessage[]) {
  return messages.map((m) => m.images?.length
    ? { role: m.role, content: [...m.images.map((url) => ({ type: 'image', source: { type: 'url', url } })), { type: 'text', text: m.content }] }
    : { role: m.role, content: m.content });
}

function openAiMessages(messages: ChatMessage[]) {
  return messages.map((m) => m.images?.length
    ? { role: m.role, content: [{ type: 'text', text: m.content }, ...m.images.map((url) => ({ type: 'image_url', image_url: { url } }))] }
    : { role: m.role, content: m.content });
}

async function* sseLines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trimEnd();
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}

/** Anthropic Messages API (Claude). */
export function anthropicProvider(apiKey: string, model: string, fetchImpl: typeof fetch = fetch, baseUrl = 'https://api.anthropic.com', fastModel = model): Provider {
  return {
    name: fastModel !== model ? `anthropic:${fastModel}+${model}` : `anthropic:${model}`,
    async *stream({ system, messages, maxTokens, signal, speed }) {
      const use = speed === 'fast' ? fastModel : model;
      const res = await fetchImpl(`${baseUrl}/v1/messages`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: use, max_tokens: maxTokens, system, messages: anthropicMessages(messages), stream: true }),
      });
      if (!res.ok || !res.body) throw new Error(`Anthropic API error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
      for await (const data of sseLines(res.body)) {
        let evt: { type?: string; delta?: { type?: string; text?: string }; error?: { message?: string } };
        try { evt = JSON.parse(data); } catch { continue; }
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) yield evt.delta.text;
        if (evt.type === 'error') throw new Error(evt.error?.message ?? 'Provider error');
      }
    },
  };
}

/** Any OpenAI-compatible Chat Completions API (OpenAI, Azure OpenAI, OpenRouter, Ollama, vLLM, LM Studio…). */
export function openAiCompatibleProvider(apiKey: string, model: string, baseUrl: string, fetchImpl: typeof fetch = fetch, fastModel = model): Provider {
  return {
    name: fastModel !== model ? `openai-compatible:${fastModel}+${model}` : `openai-compatible:${model}`,
    async *stream({ system, messages, maxTokens, signal, speed }) {
      const use = speed === 'fast' ? fastModel : model;
      const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model: use, stream: true, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...openAiMessages(messages)] }),
      });
      if (!res.ok || !res.body) throw new Error(`Model API error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
      for await (const data of sseLines(res.body)) {
        if (data === '[DONE]') return;
        try {
          const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
          const t = j.choices?.[0]?.delta?.content;
          if (t) yield t;
        } catch { /* keep-alive or partial */ }
      }
    },
  };
}

/**
 * Ollama's own chat API (free, runs on your computer). Uses /api/chat rather than the OpenAI layer so Nebula can
 * set the context window (Ollama's default is small and would cut long pages) and pass images as base64.
 */
export function ollamaProvider(model: string, baseUrl = 'http://127.0.0.1:11434', fetchImpl: typeof fetch = fetch, fastModel = model, contextTokens = 16384): Provider {
  return {
    name: fastModel !== model ? `ollama:${fastModel}+${model}` : `ollama:${model}`,
    async *stream({ system, messages, maxTokens, signal, speed }) {
      const use = speed === 'fast' ? fastModel : model;
      const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}/api/chat`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: use, stream: true, keep_alive: '30m',
          options: { num_ctx: contextTokens, num_predict: maxTokens },
          messages: [{ role: 'system', content: system }, ...messages.map((m) => ({
            role: m.role, content: m.content,
            ...(m.images?.length ? { images: m.images.filter((u) => u.startsWith('data:image/')).map((u) => u.slice(u.indexOf(',') + 1)) } : {}),
          }))],
        }),
      });
      if (!res.ok || !res.body) {
        const text = (await res.text().catch(() => '')).slice(0, 300);
        if (res.status === 404 && /not found/i.test(text)) throw new Error(`The model "${use}" isn't downloaded. Run: ollama pull ${use}`);
        throw new Error(`Ollama error ${res.status}: ${text}`);
      }
      // Ollama streams one JSON object per line.
      const decoder = new TextDecoder();
      let buf = '';
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let j: { message?: { content?: string }; done?: boolean; error?: string };
          try { j = JSON.parse(line); } catch { continue; }
          if (j.error) throw new Error(`Ollama: ${j.error}`);
          if (j.message?.content) yield j.message.content;
          if (j.done) return;
        }
      }
    },
  };
}

/** Offline provider for development and tests: explains how to configure a real model. */
export function mockProvider(): Provider {
  return {
    name: 'mock',
    async *stream({ messages }) {
      const last = messages[messages.length - 1]?.content ?? '';
      const cited = /<untrusted_source id="(S\d+)"/.exec(last)?.[1];
      const words = `This is Nebula running in **development mode** with no model configured${cited ? ` (I received your sources, e.g. [${cited}])` : ''}. Set NUDE_AI_PROVIDER and an API key on the gateway to get real answers.`.split(' ');
      for (const w of words) { yield w + ' '; await new Promise((r) => setTimeout(r, 5)); }
    },
  };
}

export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): Provider {
  const kind = (env.NUDE_AI_PROVIDER ?? (env.ANTHROPIC_API_KEY ? 'anthropic' : env.OPENAI_API_KEY || env.OPENAI_BASE_URL ? 'openai' : env.OLLAMA_URL ? 'ollama' : 'mock')).toLowerCase();
  if (kind === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('NUDE_AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY');
    const model = env.NUDE_AI_MODEL ?? 'claude-sonnet-5-5';
    return anthropicProvider(env.ANTHROPIC_API_KEY, model, fetch, env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com', env.NUDE_AI_FAST_MODEL ?? 'claude-haiku-5-5');
  }
  if (kind === 'ollama') {
    const model = env.NUDE_AI_MODEL ?? 'gemma3:4b';
    return ollamaProvider(model, env.OLLAMA_URL ?? 'http://127.0.0.1:11434', fetch, env.NUDE_AI_FAST_MODEL ?? model, Number(env.NUDE_OLLAMA_CONTEXT ?? 16384));
  }
  if (kind === 'openai') {
    const model = env.NUDE_AI_MODEL ?? 'gpt-4o-mini';
    return openAiCompatibleProvider(env.OPENAI_API_KEY ?? '', model, env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1', fetch, env.NUDE_AI_FAST_MODEL ?? model);
  }
  return mockProvider();
}
