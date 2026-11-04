// Nebula on this computer: finds Ollama, picks a model, and runs a protected local gateway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { LocalNebula } from '../../src/main/local-nebula';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

test('picks the best installed model', () => {
  const n = new LocalNebula(mkdtempSync(join(tmpdir(), 'nn-')), () => {});
  assert.equal(n.pickModel(['llama3.1:8b', 'gemma3:4b'], ''), 'gemma3:4b');
  assert.equal(n.pickModel(['llama3.1:8b', 'gemma3:4b'], 'llama3.1:8b'), 'llama3.1:8b');
  assert.equal(n.pickModel(['nomic-embed-text', 'mistral'], ''), 'mistral');
  assert.equal(n.pickModel([], ''), null);
});

test('answers through Ollama with a private access code', async () => {
  const ollama = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'gemma3:4b' }] })); return; }
    res.writeHead(200);
    res.end('{"message":{"content":"Hi"},"done":false}\n{"done":true}\n');
  });
  await new Promise<void>((r) => ollama.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'nn-'));
  const n = new LocalNebula(dir, () => {});
  const s = { ...DEFAULT_SETTINGS, ollamaUrl: `http://127.0.0.1:${(ollama.address() as AddressInfo).port}` };
  const ep = await n.endpoint(s);
  assert.ok(ep);
  assert.equal(ep.model, 'gemma3:4b');
  const body = JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] });
  const denied = await fetch(`${ep.url}/v1/chat`, { method: 'POST', body });
  assert.equal(denied.status, 401, 'other apps on the computer need the code');
  const ok = await fetch(`${ep.url}/v1/chat`, { method: 'POST', body, headers: { authorization: `Bearer ${ep.token}` } });
  assert.match(await ok.text(), /"delta":"Hi"/);
  // The code survives a restart so phones stay paired.
  assert.equal(new LocalNebula(dir, () => {}).token, n.token);
  n.stop(); ollama.close();
});

test('reports Ollama as not running', async () => {
  const n = new LocalNebula(mkdtempSync(join(tmpdir(), 'nn-')), () => {});
  assert.equal(await n.endpoint({ ...DEFAULT_SETTINGS, ollamaUrl: 'http://127.0.0.1:1' }), null);
});
