import { join } from 'node:path';

// dist/main/main.js → dist/
const DIST = join(__dirname, '..');
export const CHROME_PRELOAD = join(DIST, 'preload/chrome.js');
export const INTERNAL_PRELOAD = join(DIST, 'preload/internal.js');
export const CHROME_HTML = join(DIST, 'renderer/chrome/index.html');
export const PAGES_DIR = join(DIST, 'renderer/pages');
