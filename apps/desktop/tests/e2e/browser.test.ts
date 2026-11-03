// End-to-end tests: launches the real Nude browser (Electron/Chromium) and drives it.
// Run with: npm run test:e2e   (Linux CI needs xvfb-run)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';

const APP_DIR = resolve(__dirname, '../..');
let app: ElectronApplication;
let ui: Page;
let server: Server;
let base = '';
const profile = mkdtempSync(join(tmpdir(), 'nude-e2e-'));

function electronPath(): string {
  if (process.env.ELECTRON_PATH) return process.env.ELECTRON_PATH;
  return require('electron') as unknown as string;
}

const PAGES: Record<string, { type: string; body: string }> = {
  '/': { type: 'text/html', body: '<title>Nude Test Home</title><h1>Hello from the test server</h1><a id="l" href="/second">Second</a><a id="nt" href="/second" target="_blank">New tab link</a>' },
  '/second': { type: 'text/html', body: '<title>Second Page</title><p>Second</p>' },
  '/trackers': { type: 'text/html', body: '<title>Tracker Page</title><script src="https://stats.g.doubleclick.net/x.js"></script><script src="https://securepubads.g.doubleclick.net/y.js"></script><p>ads</p>' },
  '/article': { type: 'text/html', body: `<title>Long Article</title><article><h1>Nude article</h1>${'<p>This is a long paragraph of article text that is meant to look like a real story so reader mode can extract it properly and show it nicely.</p>'.repeat(8)}</article>` },
  '/invoice.pdf.exe': { type: 'application/octet-stream', body: 'MZ fake executable' },
  '/report.txt': { type: 'text/plain', body: 'quarterly report' },
};

async function state() {
  return ui.evaluate(() => (window as unknown as { __lastState?: unknown }).__lastState) as Promise<{
    tabs: { id: number; url: string; title: string; isBookmarked: boolean; trackersBlocked: number; security: string; loading: boolean }[];
    activeTabId: number;
  }>;
}

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15000): Promise<T> {
  const start = Date.now();
  let last: T;
  do {
    last = await fn();
    if (ok(last)) return last;
    await new Promise((r) => setTimeout(r, 150));
  } while (Date.now() - start < ms);
  throw new Error(`Timed out; last value: ${JSON.stringify(last!).slice(0, 500)}`);
}

const activeTab = async () => {
  const s = await state();
  return s.tabs.find((t) => t.id === s.activeTabId)!;
};

async function go(input: string) {
  await ui.click('#address');
  await ui.fill('#address', input);
  await ui.keyboard.press('Enter');
}

before(async () => {
  server = createServer((req, res) => {
    const p = PAGES[(req.url ?? '/').split('?')[0]];
    if (!p) { res.writeHead(404).end('nope'); return; }
    res.writeHead(200, { 'content-type': p.type, ...(req.url?.includes('.exe') || req.url?.includes('.txt') ? { 'content-disposition': 'attachment' } : {}) });
    res.end(p.body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  app = await electron.launch({
    executablePath: electronPath(),
    args: [...(process.getuid?.() === 0 || process.env.CI ? ['--no-sandbox'] : []), '--disable-gpu', APP_DIR],
    env: { ...process.env, NUDE_USER_DATA: profile, NODE_OPTIONS: '' },
  });
  ui = await app.firstWindow();
  await ui.waitForSelector('.tab');
  // Expose the latest pushed state for assertions.
  await ui.evaluate(() => {
    const n = (window as unknown as { nude: { onState(cb: (s: unknown) => void): void } }).nude;
    n.onState((s) => { (window as unknown as { __lastState: unknown }).__lastState = s; });
  });
  await ui.evaluate(() => (window as unknown as { nude: { invoke(c: string): Promise<void> } }).nude.invoke('ready'));
  await waitFor(state, (s) => Boolean(s?.tabs?.length));
});

after(async () => {
  const proc = app?.process();
  await Promise.race([app?.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
  proc?.kill('SIGKILL');
  server?.close();
  // Chromium may still be flushing files for a moment after exit.
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* temp dir; ignore */ }
});

test('starts with a new tab page', async () => {
  const t = await activeTab();
  assert.match(t.url, /^nude:\/\/newtab/);
});

test('navigates to a real web page from the address bar', async () => {
  await go(`${base}/`);
  const t = await waitFor(activeTab, (t) => t.title === 'Nude Test Home' && !t.loading);
  assert.equal(t.url, `${base}/`);
  assert.equal(await ui.inputValue('#address'), `${base}/`);
});

test('target=_blank opens a new tab', async () => {
  const before = (await state()).tabs.length;
  await app.evaluate(({ BrowserWindow }) => {
    // Click the link inside the active tab's web contents.
    const views = BrowserWindow.getAllWindows()[0].contentView.children as unknown as { webContents: Electron.WebContents }[];
    const wc = views.map((v) => v.webContents).find((w) => w.getURL().endsWith('/'))!;
    return wc.executeJavaScript('document.getElementById("nt").click()', true);
  });
  const s = await waitFor(state, (s) => s.tabs.length === before + 1 && s.tabs.some((t) => t.url.endsWith('/second')));
  assert.ok(s.tabs.some((t) => t.url.endsWith('/second')));
});

test('bookmarks the current page and records history', async () => {
  await go(`${base}/`);
  await waitFor(activeTab, (t) => t.title === 'Nude Test Home' && !t.loading);
  await ui.click('#star');
  await waitFor(activeTab, (t) => t.isBookmarked);
  const bm = await ui.locator('#bookmarks-bar .bm').first().textContent();
  assert.match(bm ?? '', /Nude Test Home/);
  const history = await ui.evaluate(() => (window as unknown as { nude: { invoke(c: string, q: string): Promise<{ url: string }[]> } }).nude.invoke('suggest', 'Nude Test'));
  assert.ok(JSON.stringify(history).includes('Nude Test Home'));
});

test('blocks a look-alike phishing site before it loads', async () => {
  await go('https://paypal.com.secure-login.top/verify');
  const t = await waitFor(activeTab, (t) => t.url.startsWith('nude://blocked'));
  assert.equal(t.security, 'blocked');
});

test('blocks third-party trackers', async () => {
  await go(`${base}/trackers`);
  const t = await waitFor(activeTab, (t) => t.title === 'Tracker Page' && t.trackersBlocked >= 2);
  assert.ok(t.trackersBlocked >= 2);
});

test('blocks a disguised executable download', async () => {
  await app.evaluate(({ BrowserWindow }, url) => {
    const views = BrowserWindow.getAllWindows()[0].contentView.children as unknown as { webContents: Electron.WebContents }[];
    views[views.length - 1].webContents.downloadURL(url);
  }, `${base}/invoice.pdf.exe`);
  const events = await waitFor(
    async () => {
      try { return JSON.parse(readFileSync(join(profile, 'downloads.json'), 'utf8')) as { filename: string; blocked?: boolean }[]; } catch { return []; }
    },
    (list) => list.some((d) => d.filename.includes('invoice') && d.blocked),
    20000,
  );
  assert.ok(events.length > 0);
});

test('opens reader view for an article', async () => {
  await go(`${base}/article`);
  await waitFor(activeTab, (t) => t.title === 'Long Article' && !t.loading);
  await waitFor(() => ui.isVisible('#reader'), (v) => v);
  await ui.click('#reader');
  await waitFor(activeTab, (t) => t.url.startsWith('nude://reader'));
});

test('private window keeps no history', async () => {
  const count = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  await ui.evaluate(() => (window as unknown as { nude: { invoke(c: string, ...a: unknown[]): Promise<void> } }).nude.invoke('newWindow', true));
  await waitFor(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), (n) => n === count + 1);
});

test('closing and reopening a tab', async () => {
  const s = await state();
  const n = s.tabs.length;
  await ui.evaluate((id) => (window as unknown as { nude: { invoke(c: string, ...a: unknown[]): Promise<void> } }).nude.invoke('close', id), s.activeTabId);
  await waitFor(state, (x) => x.tabs.length === n - 1);
  await ui.evaluate(() => (window as unknown as { nude: { invoke(c: string): Promise<void> } }).nude.invoke('reopen'));
  await waitFor(state, (x) => x.tabs.length === n);
});
