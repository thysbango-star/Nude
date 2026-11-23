// Nude IDs on this computer: the welcome page, signing in and out, switching, and old accounts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from '../../src/main/accounts';

const fresh = () => { const dir = mkdtempSync(join(tmpdir(), 'nude-acc-')); return { dir, a: new Accounts(dir) }; };
const nude = (id: string, username: string, name: string) => ({ id, username, nudeId: `${username}@nude`, name, avatar: null, created: 1, passwordChanged: 1 });

test('first run needs the welcome page until you sign in or continue as guest', () => {
  const { a } = fresh();
  assert.equal(a.needsWelcome(), true);
  a.continueAsGuest();
  assert.equal(a.needsWelcome(), false);
  assert.equal(a.current(), null);
});

test('signing in keeps who you are, never a password or token', async () => {
  const { dir, a } = fresh();
  const p = a.signedIn(nude('u1', 'tsbungo', 'Simon Adamson'));
  assert.equal(p.nudeId, 'tsbungo@nude');
  assert.equal(p.firstName, 'Simon');
  assert.equal(p.initials, 'SA');
  assert.equal(a.needsWelcome(), false);
  a.store.flush();
  const disk = readFileSync(join(dir, 'accounts.json'), 'utf8');
  assert.doesNotMatch(disk, /password|token|nds_/i);
});

test('sign out keeps the Nude ID listed; switching and removing work', () => {
  const { a } = fresh();
  a.signedIn(nude('u1', 'tsbungo', 'Simon'));
  a.signedIn(nude('u2', 'work.simon', 'Simon Work'));
  assert.equal(a.current()?.username, 'work.simon');
  assert.ok(a.switchTo('u1'));
  assert.equal(a.current()?.username, 'tsbungo');
  a.signOut();
  assert.equal(a.current(), null);
  assert.equal(a.list().length, 2);
  a.remove('u2');
  assert.deepEqual(a.list().map((x) => x.username), ['tsbungo']);
});

test('accounts from before Nude IDs are dropped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nude-acc-'));
  writeFileSync(join(dir, 'accounts.json'), JSON.stringify({ accounts: [{ id: 'old', name: 'Old', email: 'a@b.c', color: '#000', created: 1, salt: 'x', hash: 'y' }], currentId: 'old', guest: false }));
  const a = new Accounts(dir);
  assert.equal(a.list().length, 0);
  assert.equal(a.current(), null);
});
