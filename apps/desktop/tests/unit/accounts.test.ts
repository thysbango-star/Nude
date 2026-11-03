// Local Nude accounts: hashing, sign-in, lockout and the first-run welcome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from '../../src/main/accounts';

const fresh = () => { const dir = mkdtempSync(join(tmpdir(), 'nude-acc-')); return { dir, a: new Accounts(dir) }; };

test('first run needs the welcome page until you sign up or continue as guest', () => {
  const { a } = fresh();
  assert.equal(a.needsWelcome(), true);
  a.continueAsGuest();
  assert.equal(a.needsWelcome(), false);
  assert.equal(a.current(), null);
});

test('sign up stores a hash, never the password, and greets by first name', async () => {
  const { dir, a } = fresh();
  const r = a.signUp('Simon Adamson', 'Simon@Example.com', 'correct horse battery');
  assert.ok(r.ok);
  assert.equal(a.current()?.firstName, 'Simon');
  assert.equal(a.current()?.email, 'simon@example.com');
  await new Promise((res) => setTimeout(res, 600)); // JsonStore writes are debounced
  const raw = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('');
  assert.ok(!raw.includes('correct horse battery'));
});

test('sign in checks the password and locks after repeated failures', () => {
  const { a } = fresh();
  assert.ok(a.signUp('Ana', 'ana@example.com', 'password-123').ok);
  a.signOut();
  assert.equal(a.signIn('ana@example.com', 'wrong-password').ok, false);
  assert.ok(a.signIn('ana@example.com', 'password-123').ok);
  a.signOut();
  for (let i = 0; i < 5; i++) a.signIn('ana@example.com', 'nope-nope');
  assert.equal(a.signIn('ana@example.com', 'password-123').ok, false, 'locked out after 5 failures');
});

test('rejects weak passwords and duplicate emails', () => {
  const { a } = fresh();
  assert.equal(a.signUp('Ana', 'ana@example.com', 'short').ok, false);
  assert.ok(a.signUp('Ana', 'ana@example.com', 'long enough pw').ok);
  assert.equal(a.signUp('Ana 2', 'ana@example.com', 'long enough pw').ok, false);
});
