// Build script for the Nude desktop browser.
// Bundles main, preload and renderer code with esbuild and copies static assets into dist/.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const pageNames = ['newtab', 'history', 'bookmarks', 'downloads', 'settings', 'security', 'blocked', 'reader', 'welcome', 'account'];

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


/**
 * Makes "@media (prefers-color-scheme: dark)" rules also follow Nude's own theme setting:
 * html.theme-dark forces dark, html.theme-light forces light, otherwise the system decides.
 */
export function themeCss(css) {
  const marker = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = marker.exec(css))) {
    let depth = 1, i = marker.lastIndex;
    while (i < css.length && depth) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; }
    const inner = css.slice(marker.lastIndex, i - 1);
    const scope = (prefix) => inner.replace(/([^{}]+)\{([^{}]*)\}/g, (_r, sel, body) => {
      const sels = sel.split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
        if (/^(:root|html)\b/.test(x)) return x.replace(/^(:root|html)/, `:root${prefix}`);
        return `:root${prefix} ${x}`;
      });
      return `${sels.join(', ')} {${body}}`;
    });
    out += css.slice(last, m.index) + `@media (prefers-color-scheme: dark) {${scope(':not(.theme-light)')}}\n${scope('.theme-dark')}`;
    last = i;
    marker.lastIndex = i;
  }
  return out + css.slice(last);
}

function copyCss(from, to) {
  writeFileSync(to, themeCss(readFileSync(from, 'utf8')));
}

function copyStatic() {
  for (const dir of ['renderer/chrome', 'renderer/pages', 'renderer/design']) {
    const from = join(src, dir);
    for (const f of readdirSync(from)) {
      if (/\.(html|css|svg|png)$/.test(f)) {
        mkdirSync(join(out, dir), { recursive: true });
        if (f.endsWith('.css')) copyCss(join(from, f), join(out, dir, f));
        else cpSync(join(from, f), join(out, dir, f));
      }
    }
  }
  // Design tokens are shared by the chrome UI and internal pages.
  copyCss(join(src, 'renderer/design/tokens.css'), join(out, 'renderer/chrome/tokens.css'));
  copyCss(join(src, 'renderer/design/tokens.css'), join(out, 'renderer/pages/tokens.css'));
  // Bundled fonts (SIL Open Font License): Poppins and Lora Italic, for the sign-in screen.
  for (const f of readdirSync(join(src, 'renderer/design/fonts'))) {
    if (f.endsWith('.woff')) cpSync(join(src, 'renderer/design/fonts', f), join(out, 'renderer/pages', f));
  }
  // Brand artwork (Nude logo, Rovian Defender marks) for the UI and nude:// pages.
  for (const f of readdirSync(join(src, 'renderer/design/brand'))) {
    cpSync(join(src, 'renderer/design/brand', f), join(out, 'renderer/chrome', f));
    cpSync(join(src, 'renderer/design/brand', f), join(out, 'renderer/pages', f));
  }
}

if (watch) {
  for (const c of configs) await (await context(c)).watch();
  copyStatic();
  console.log('Watching for changes… (static files are copied at start; restart to recopy)');
} else {
  await Promise.all(configs.map((c) => build(c)));
  copyStatic();
}
