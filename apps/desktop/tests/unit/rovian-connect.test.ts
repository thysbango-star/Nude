// Rovian Connect: what Nude accepts from Rovian's popup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConnectIdentity } from '../../src/main/rovian-connect';

test('accepts a well-formed Rovian identity', () => {
  const id = parseConnectIdentity({ rovianId: 'Simon@rovian.cloud', username: 'simon', name: 'Simon Adamson', avatarUrl: 'https://cdn.example/a.png' });
  assert.ok(id);
  assert.equal(id.rovianId, 'simon@rovian.cloud');
  assert.equal(id.username, 'simon');
  assert.equal(id.name, 'Simon Adamson');
  assert.equal(id.sub, 'rovian-connect:simon@rovian.cloud');
  assert.equal(id.avatarUrl, 'https://cdn.example/a.png');
});

test('falls back to the username for a missing name, and drops non-HTTPS avatars', () => {
  const id = parseConnectIdentity({ rovianId: 'simon@rovian.cloud', avatarUrl: 'javascript:alert(1)' });
  assert.equal(id?.name, 'simon');
  assert.equal(id?.avatarUrl, null);
});

test('refuses anything that is not a Rovian identity', () => {
  for (const bad of [null, 'x', {}, { rovianId: 'simon@gmail.com' }, { rovianId: 'simon@rovian.cloud.evil.example' },
    { rovianId: '@rovian.cloud' }, { rovianId: 'a b@rovian.cloud' }, { rovianId: 'simon@rovian.cloud', username: 'someoneelse' }]) {
    assert.equal(parseConnectIdentity(bad), null, JSON.stringify(bad));
  }
});
