import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

/** Picks "name (1).ext", "name (2).ext"… if the file already exists. */
export function uniquePath(dir: string, filename: string, exists: (p: string) => boolean = existsSync): string {
  const safe = sanitizeFilename(filename) || 'download';
  const ext = extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  let candidate = join(dir, safe);
  for (let i = 1; exists(candidate) && i < 10_000; i++) candidate = join(dir, `${stem} (${i})${ext}`);
  return candidate;
}

export function sanitizeFilename(name: string): string {
  return basename(name)
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*‪-‮⁦-⁩]/g, '_') // control, reserved and bidi-override chars
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 200);
}

