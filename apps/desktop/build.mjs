// Build script for the Nude desktop browser.
// Bundles main, preload and renderer code with esbuild and copies static assets into dist/.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const out = join(root, 'dist');
const watch = process.argv.includes('--watch');
const production = process.env.NODE_ENV === 'production';

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const common = {
  bundle: true,
  sourcemap: production ? false : 'linked',
  minify: production,
  logLevel: 'info',
  target: 'es2023',
  alias: { '@nude/security-engine': join(root, '../../packages/security-engine/src/index.ts') },
  define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
};

const pageNames = ['newtab', 'history', 'bookmarks', 'downloads', 'settings', 'security', 'blocked', 'reader'];

const configs = [
  // Main process (Node, CommonJS)
  { ...common, platform: 'node', format: 'cjs', external: ['electron'],
    entryPoints: [join(src, 'main/main.ts')], outfile: join(out, 'main/main.js') },
  // Preloads must be single CommonJS files: sandboxed preloads can only require('electron').
  { ...common, platform: 'node', format: 'cjs', external: ['electron'],
    entryPoints: { chrome: join(src, 'preload/chrome.ts'), internal: join(src, 'preload/internal.ts') },
    outdir: join(out, 'preload') },
  // Browser UI
  { ...common, platform: 'browser', format: 'iife',
    entryPoints: [join(src, 'renderer/chrome/chrome.ts')], outfile: join(out, 'renderer/chrome/chrome.js') },
  // Internal nude:// pages
  { ...common, platform: 'browser', format: 'iife',
    entryPoints: Object.fromEntries(pageNames.map((n) => [n, join(src, `renderer/pages/${n}.ts`)])),
    outdir: join(out, 'renderer/pages') },
];

function copyStatic() {
  for (const dir of ['renderer/chrome', 'renderer/pages', 'renderer/design']) {
    const from = join(src, dir);
    for (const f of readdirSync(from)) {
      if (/\.(html|css|svg|png)$/.test(f)) {
        mkdirSync(join(out, dir), { recursive: true });
        cpSync(join(from, f), join(out, dir, f));
      }
    }
  }
  // Design tokens are shared by the chrome UI and internal pages.
  cpSync(join(src, 'renderer/design/tokens.css'), join(out, 'renderer/chrome/tokens.css'));
  cpSync(join(src, 'renderer/design/tokens.css'), join(out, 'renderer/pages/tokens.css'));
}

if (watch) {
  for (const c of configs) await (await context(c)).watch();
  copyStatic();
  console.log('Watching for changes… (static files are copied at start; restart to recopy)');
} else {
  await Promise.all(configs.map((c) => build(c)));
  copyStatic();
}
