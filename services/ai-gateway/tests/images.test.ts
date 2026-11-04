// Image inlining for providers (Ollama) that only accept base64 images.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineImages, isPrivateAddress } from '../src/images';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const fakeFetch = (async () => new Response(png, { headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch;

test('downloads public https images and sends them as data URLs', async () => {
  const out = await inlineImages([{ role: 'user', content: 'What is this?', images: ['https://shop.example/a.png'] }], fakeFetch, async () => ['93.184.216.34']);
  assert.equal(out[0].images?.[0], `data:image/png;base64,${png.toString('base64')}`);
});

test('never fetches private or local addresses, or plain http', async () => {
  let calls = 0;
  const counting = (async () => { calls++; return new Response(png, { headers: { 'content-type': 'image/png' } }); }) as unknown as typeof fetch;
  const out = await inlineImages([{ role: 'user', content: 'x', images: ['https://router.local/a.png', 'http://example.com/a.png', 'https://10.0.0.1/a.png'] }], counting, async (h) => (h === 'router.local' ? ['192.168.1.1'] : ['93.184.216.34']));
  assert.equal(calls, 0);
  assert.deepEqual(out[0].images, []);
  assert.match(out[0].content, /couldn't be loaded/);
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.5', '169.254.1.1', '::1', 'fd00::1', '::ffff:127.0.0.1']) assert.ok(isPrivateAddress(ip), ip);
  assert.ok(!isPrivateAddress('8.8.8.8'));
});

test('ignores files that are not images', async () => {
  const html = (async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
  const out = await inlineImages([{ role: 'user', content: 'x', images: ['https://example.com/page'] }], html, async () => ['93.184.216.34']);
  assert.deepEqual(out[0].images, []);
});
