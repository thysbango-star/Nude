import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInput, displayUrl, extractSearchQuery, looksLikeHost, searchUrl } from '../../src/shared/omnibox';
import { rankLocalSuggestions, inlineCompletion, matchScore, parseRemoteSuggestions } from '../../src/shared/suggest';
import { matchShortcut } from '../../src/shared/shortcuts';
import { sanitizeSettingsPatch } from '../../src/main/profile';
import { uniquePath, sanitizeFilename } from '../../src/main/downloads-util';

const nav = (input: string) => resolveInput(input, 'duckduckgo');

test('omnibox: hostnames become HTTPS URLs', () => {
  assert.deepEqual(nav('example.com'), { type: 'navigate', url: 'https://example.com/' });
  assert.deepEqual(nav('news24.co.za/sport'), { type: 'navigate', url: 'https://news24.co.za/sport' });
  assert.deepEqual(nav('https://github.com/x'), { type: 'navigate', url: 'https://github.com/x' });
});

test('omnibox: local hosts use HTTP', () => {
  assert.deepEqual(nav('localhost:3000'), { type: 'navigate', url: 'http://localhost:3000/' });
  assert.deepEqual(nav('192.168.1.1'), { type: 'navigate', url: 'http://192.168.1.1/' });
});

test('omnibox: everything else is a search', () => {
  const r = nav('best braai recipes');
  assert.equal(r?.type, 'search');
  assert.equal(r?.type === 'search' && r.url, searchUrl('duckduckgo', 'best braai recipes'));
  assert.equal(nav('hello')?.type, 'search');
  assert.equal(nav('?example.com')?.type, 'search');
  assert.equal(nav('what is 2.5 + 3')?.type, 'search');
});

test('omnibox: dangerous schemes are refused, internal pages allowed', () => {
  assert.equal(nav('javascript:alert(1)')?.type, 'blocked');
  assert.equal(nav('data:text/html,hi')?.type, 'blocked');
  assert.deepEqual(nav('nude://settings'), { type: 'navigate', url: 'nude://settings/' });
  assert.equal(nav('nude://evil')?.type, 'blocked');
  assert.equal(nav('   '), null);
});

test('omnibox: display and query extraction', () => {
  assert.equal(displayUrl('https://www.example.com/'), 'example.com');
  assert.equal(displayUrl('https://example.com/a?b=1'), 'example.com/a?b=1');
  assert.equal(displayUrl('http://example.com/'), 'http://example.com/');
  assert.equal(displayUrl('nude://newtab/'), '');
  assert.equal(displayUrl('nude://settings/'), 'nude://settings');
  assert.equal(extractSearchQuery('https://duckduckgo.com/?q=nude+os', 'duckduckgo'), 'nude os');
  assert.equal(extractSearchQuery('https://example.com/?q=x', 'duckduckgo'), null);
  assert.equal(looksLikeHost('notatld.zzz'), false);
  assert.equal(looksLikeHost('intranet.corp/home'), true);
});

test('suggestions rank by match and frecency, include open tabs', () => {
  const now = Date.now();
  const history = [
    { url: 'https://github.com/', title: 'GitHub', lastVisit: now, visitCount: 30, typedCount: 5 },
    { url: 'https://gitlab.com/', title: 'GitLab', lastVisit: now - 90 * 86400000, visitCount: 2, typedCount: 0 },
  ];
  const r = rankLocalSuggestions('git', history, [], [{ id: 9, url: 'https://github.com/nude', title: 'Nude repo' }], 6, now);
  assert.equal(r[0].value, 'https://github.com/');
  assert.ok(r.some((s) => s.kind === 'tab' && s.tabId === 9));
  assert.equal(inlineCompletion('git', history, now), 'github.com');
  assert.equal(inlineCompletion('git ', history, now), null);
  assert.equal(matchScore('zzz', 'https://a.com', 'A'), 0);
  assert.deepEqual(parseRemoteSuggestions(['q', ['a', 'b']]), ['a', 'b']);
  assert.deepEqual(parseRemoteSuggestions([{ phrase: 'x' }]), ['x']);
});

test('shortcuts map per platform', () => {
  const k = (key: string, mods: Partial<{ control: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}) =>
    ({ type: 'keyDown', key, control: false, meta: false, shift: false, alt: false, ...mods });
  assert.equal(matchShortcut(k('t', { control: true }), 'win32'), 'new-tab');
  assert.equal(matchShortcut(k('t', { meta: true }), 'darwin'), 'new-tab');
  assert.equal(matchShortcut(k('t', { meta: true }), 'win32'), null);
  assert.equal(matchShortcut(k('T', { control: true, shift: true }), 'linux'), 'reopen-tab');
  assert.equal(matchShortcut(k('Tab', { control: true }), 'darwin'), 'next-tab');
  assert.equal(matchShortcut(k('F5'), 'win32'), 'reload');
  assert.equal(matchShortcut(k('a'), 'win32'), null);
});

test('settings patches are validated', () => {
  assert.deepEqual(sanitizeSettingsPatch({ theme: 'dark', bogus: 1 }), { theme: 'dark' });
  assert.deepEqual(sanitizeSettingsPatch({ theme: 'neon' }), {});
  assert.deepEqual(sanitizeSettingsPatch({ protectionLevel: 'maximum', defaultZoom: 99 }), { protectionLevel: 'maximum', defaultZoom: 5 });
  assert.deepEqual(sanitizeSettingsPatch({ homepage: 'javascript:alert(1)' }), {});
  assert.deepEqual(sanitizeSettingsPatch({ toolbar: ['ai', 'nope', 'ai'] }), { toolbar: ['ai'] });
});

test('download file names are sanitized and made unique', () => {
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('in‮fdp.exe'), 'in_fdp.exe');
  const taken = new Set(['/d/a.txt', '/d/a (1).txt']);
  assert.equal(uniquePath('/d', 'a.txt', (p) => taken.has(p)), '/d/a (2).txt');
});
