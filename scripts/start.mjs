// `npm start` / `yarn start` at the repository root.
// On a server host (Render sets RENDER, or NUDE_START=search) there is no screen, so start Nude Search;
// on a computer, start the Nude desktop browser as before.
import { spawn } from 'node:child_process';

const target = process.env.NUDE_START ?? (process.env.RENDER ? 'search' : 'desktop');
const workspace = { search: 'services/search', 'ai-gateway': 'services/ai-gateway', 'threat-intel': 'services/threat-intel', desktop: 'apps/desktop' }[target];
if (!workspace) { console.error(`Unknown NUDE_START "${target}"`); process.exit(1); }
const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'start', '-w', workspace], { stdio: 'inherit' });
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
