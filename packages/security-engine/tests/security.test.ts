import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeUrl, analyzeDownload, analyzeMessage, detectTyposquat, emptyLists, inspectFileHeader,
  registrableDomain, shouldBlockRequest, toUnicodeHost,
} from '../src/index';

test('registrable domain handles multi-part suffixes', () => {
  assert.equal(registrableDomain('online.fnb.co.za'), 'fnb.co.za');
  assert.equal(registrableDomain('a.b.example.com'), 'example.com');
  assert.equal(registrableDomain('user.github.io'), 'user.github.io');
});

test('legitimate sites are allowed', () => {
  for (const u of ['https://www.paypal.com/signin', 'https://online.fnb.co.za/login', 'https://accounts.google.com/', 'https://www.google.de/', 'https://en.wikipedia.org/wiki/Login']) {
    assert.equal(analyzeUrl(u).action, 'allow', u);
  }
});

test('typosquatting is detected and points to the real site', () => {
  assert.equal(detectTyposquat('paypa1.com')?.brand, 'paypal');
  assert.equal(detectTyposquat('rnicrosoft.com')?.brand, 'microsoft');
  assert.equal(detectTyposquat('standardbnak.co.za')?.brand, 'standardbank');
  const v = analyzeUrl('https://paypa1-login.com/verify', emptyLists(), 'standard');
  assert.notEqual(v.action, 'allow');
  assert.equal(v.intendedSite, 'https://paypal.com/');
  assert.equal(analyzeUrl('https://paypa1-login.com/verify', emptyLists(), 'enhanced').action, 'block');
});

test('brand in subdomain of unrelated domain is flagged', () => {
  const v = analyzeUrl('https://paypal.com.account-verify.top/login', emptyLists(), 'standard');
  assert.equal(v.action, 'block');
  assert.equal(v.confidence, 'suspected');
});

test('confirmed list hit always blocks', () => {
  const lists = emptyLists();
  lists.domains.set('evil.example', 'malware');
  const v = analyzeUrl('https://cdn.evil.example/x', lists);
  assert.equal(v.action, 'block');
  assert.equal(v.confidence, 'confirmed');
  assert.equal(v.category, 'malware');
});

test('mixed-script punycode is flagged', () => {
  // "аpple.com" with Cyrillic а
  const host = 'xn--pple-43d.com';
  assert.equal(toUnicodeHost(host), 'аpple.com');
  assert.notEqual(analyzeUrl(`https://${host}/`).action, 'allow');
});

test('download analysis', () => {
  assert.equal(analyzeDownload({ filename: 'invoice.pdf.exe', url: 'https://x.com/a' }).action, 'block');
  assert.equal(analyzeDownload({ filename: 'report.pdf', mimeType: 'application/pdf', url: 'https://x.com/a' }).action, 'allow');
  assert.ok(analyzeDownload({ filename: 'setup.exe', url: 'https://x.com/a' }).risk !== 'low');
  assert.equal(analyzeDownload({ filename: 'photo.jpg', mimeType: 'application/x-msdownload', url: 'https://x.com/a' }).risk, 'high');
  assert.equal(inspectFileHeader('photo.jpg', new Uint8Array([0x4d, 0x5a, 0, 0]))[0]?.code, 'disguised-executable');
  assert.equal(inspectFileHeader('setup.exe', new Uint8Array([0x4d, 0x5a])).length, 0);
});

test('tracker blocking respects first-party and level', () => {
  assert.equal(shouldBlockRequest('stats.g.doubleclick.net', 'news24.com', 'standard').block, true);
  assert.equal(shouldBlockRequest('www.google-analytics.com', 'news24.com', 'standard').block, false);
  assert.equal(shouldBlockRequest('www.google-analytics.com', 'news24.com', 'enhanced').block, true);
  assert.equal(shouldBlockRequest('connect.facebook.net', 'facebook.net', 'maximum').block, false);
  assert.equal(shouldBlockRequest('cdn.example.com', 'news24.com', 'maximum').block, false);
});

test('scam message analysis', () => {
  const scam = analyzeMessage('Dear customer, your account will be deleted within 24 hours. Verify your account now: https://paypa1-secure.com/login and enter the OTP we sent.');
  assert.equal(scam.assessment, 'likely-scam');
  assert.ok(scam.indicators.some((i) => i.code === 'risky-link'));
  const ok = analyzeMessage('Hi Sam, lunch on Friday at 1? See you then.');
  assert.equal(ok.assessment, 'no-strong-signs');
});
