// `npm run build` / `yarn build` at the repository root. Nude Search runs from source, so a server host
// has nothing to build; on a computer this builds the desktop browser.
import { spawnSync } from 'node:child_process';

const target = process.env.NUDE_START ?? (process.env.RENDER ? 'search' : 'desktop');
if (target !== 'desktop') { console.log(`Nothing to build for ${target}.`); process.exit(0); }
const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build', '-w', 'apps/desktop'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
