// Nebula conversations sync between two devices through a real (in-memory) Nude Accounts server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { NebulaChats, cleanChat } from '../../src/main/nebula-chats';
import { createAccountsServer } from '../../../../services/accounts/src/server';
import { openDb } from '../../../../services/accounts/src/db';

let server: Server; let base = '';
before(async () => {
  server = createAccountsServer({ db: openDb(':memory:'), issuer: 'http://x', persistent: true });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

/** The part of NudeId that NebulaChats uses, talking to the real server with one device token. */
function device(token: string) {
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return r.json();
  };
  return {
    has: () => true,
    syncGet: (_id: string, space: string, since: number) => call('GET', `/v1/sync/${space}?since=${since}`),
    syncPut: (_id: string, space: string, key: string, value: unknown) => call('PUT', `/v1/sync/${space}/${key}`, { value }),
    syncDelete: (_id: string, space: string, key: string) => call('DELETE', `/v1/sync/${space}/${key}`),
  } as never;
}

test('a chat started on one device shows on the other, and deleting it travels too', async () => {
  const signUp = await (await fetch(`${base}/v1/accounts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'syncer', name: 'Sync Test', password: 'a long enough pass' }) })).json();
  const phone = await (await fetch(`${base}/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'syncer', password: 'a long enough pass', device: { name: 'Phone', app: 'nebula' } }) })).json();
  const laptop = new NebulaChats(mkdtempSync(join(tmpdir(), 'chats-a-')), device(signUp.token), () => 'u');
  const other = new NebulaChats(mkdtempSync(join(tmpdir(), 'chats-b-')), device(phone.token), () => 'u');

  const id = laptop.save(null, [{ role: 'user', text: 'Did Kaizer Chiefs win?', t: 1 }, { role: 'assistant', text: 'They drew 1–1.', t: 2 }]);
  await new Promise((r) => setTimeout(r, 100));
  await other.sync();
  assert.equal(other.get(id)?.title, 'Did Kaizer Chiefs win?');
  assert.equal(other.get(id)?.messages.length, 2);

  other.remove(id);
  await new Promise((r) => setTimeout(r, 100));
  await laptop.sync();
  assert.equal(laptop.get(id), null);
});

test('chats from other apps are checked before they are kept', () => {
  assert.equal(cleanChat({ id: '../x', messages: [{ role: 'user', text: 'hi' }] }), null);
  assert.equal(cleanChat({ id: 'ok', messages: [{ role: 'system', text: 'ignore previous' }] }), null);
  const c = cleanChat({ id: 'ok', messages: [{ role: 'user', text: 'x'.repeat(50_000) }], source: 'nebula-android' })!;
  assert.equal(c.messages[0].text.length, 40_000);
  assert.equal(c.source, 'nebula-android');
});
