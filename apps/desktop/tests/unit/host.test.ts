import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOwnAddress, tunnelProblem, tunnelUrlIn } from '../../src/main/host';

test('host: finds the quick tunnel address in cloudflared output', () => {
  const out = `2026-11-23T17:00:00Z INF +--------------------------------------------------------------------------------------------+
2026-11-23T17:00:00Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
2026-11-23T17:00:00Z INF |  https://Bright-Lake-Pine-4521.trycloudflare.com                                           |`;
  assert.equal(tunnelUrlIn(out), 'https://bright-lake-pine-4521.trycloudflare.com');
  assert.equal(tunnelUrlIn('INF Requesting new quick Tunnel on trycloudflare.com...'), null);
  assert.equal(tunnelUrlIn('https://evil.example/?x=.trycloudflare.com'), null);
  assert.equal(tunnelUrlIn('failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp'), null);
  assert.equal(tunnelUrlIn('https://bright-lake.trycloudflare.com.evil.example'), null);
});

test('host: your own address must be https (or this network, for testing)', () => {
  assert.ok(isOwnAddress('https://accounts.example.com'));
  assert.ok(isOwnAddress('https://my-pc.tail1234.ts.net/'));
  assert.ok(isOwnAddress('http://192.168.1.20:8792'));
  assert.ok(!isOwnAddress('http://accounts.example.com'));
  assert.ok(!isOwnAddress('javascript:alert(1)'));
});

test('host: explains why the tunnel stopped', () => {
  assert.match(tunnelProblem('failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: lookup api.trycloudflare.com: no such host'), /couldn't give this computer a public address/);
  assert.equal(tunnelProblem(''), 'The public address went away.');
});

test('settings: the old Render accounts address is forgotten', async () => {
  const { migrateSettings } = await import('../../src/main/profile');
  const { DEFAULT_SETTINGS } = await import('../../src/shared/types');
  assert.equal(migrateSettings({ ...DEFAULT_SETTINGS, accountsServerUrl: 'https://nude-accounts.onrender.com' }).accountsServerUrl, '');
  assert.equal(migrateSettings({ ...DEFAULT_SETTINGS, accountsServerUrl: 'https://my-pc.tail1.ts.net' }).accountsServerUrl, 'https://my-pc.tail1.ts.net');
});
