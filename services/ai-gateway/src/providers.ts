// Model providers. Keys are read from the environment on the server only.
import type { ChatMessage } from './prompt';

export interface Provider {
  name: string;
  stream(input: { system: string; messages: ChatMessage[]; maxTokens: number; signal: AbortSignal }): AsyncIterable<string>;
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
export function anthropicProvider(apiKey: string, model: string, fetchImpl: typeof fetch = fetch, baseUrl = 'https://api.anthropic.com'): Provider {
  return {
    name: `anthropic:${model}`,
    async *stream({ system, messages, maxTokens, signal }) {
      const res = await fetchImpl(`${baseUrl}/v1/messages`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, stream: true }),
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
export function openAiCompatibleProvider(apiKey: string, model: string, baseUrl: string, fetchImpl: typeof fetch = fetch): Provider {
  return {
    name: `openai-compatible:${model}`,
    async *stream({ system, messages, maxTokens, signal }) {
      const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, stream: true, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...messages] }),
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
  const kind = (env.NUDE_AI_PROVIDER ?? (env.ANTHROPIC_API_KEY ? 'anthropic' : env.OPENAI_API_KEY || env.OPENAI_BASE_URL ? 'openai' : 'mock')).toLowerCase();
  if (kind === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('NUDE_AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY');
    return anthropicProvider(env.ANTHROPIC_API_KEY, env.NUDE_AI_MODEL ?? 'claude-sonnet-5-5', fetch, env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com');
  }
  if (kind === 'openai') return openAiCompatibleProvider(env.OPENAI_API_KEY ?? '', env.NUDE_AI_MODEL ?? 'gpt-4o-mini', env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1');
  return mockProvider();
}
