// Download risk analysis: before download (name, type, source) and after (file content).
import { ARCHIVE_EXTENSIONS, EXECUTABLE_EXTENSIONS, RISKY_DOCUMENT_EXTENSIONS } from './data';
import type { ProtectionLevel, Signal, UrlVerdict } from './url';

export interface DownloadVerdict {
  risk: 'low' | 'medium' | 'high' | 'dangerous';
  action: 'allow' | 'warn' | 'block';
  signals: Signal[];
  /** Always shown: Nude never claims a file is guaranteed safe. */
  disclaimer: string;
}

export const DOWNLOAD_DISCLAIMER = 'No known threats were found, but that doesn\'t guarantee the file is safe. Only open files from sources you trust.';

const MIME_FOR_EXT: Record<string, string[]> = {
  pdf: ['application/pdf'],
  jpg: ['image/jpeg'], jpeg: ['image/jpeg'], png: ['image/png'], gif: ['image/gif'], webp: ['image/webp'],
  mp3: ['audio/mpeg'], mp4: ['video/mp4'], txt: ['text/plain'], csv: ['text/csv', 'text/plain', 'application/vnd.ms-excel'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  zip: ['application/zip', 'application/x-zip-compressed'],
};
const EXECUTABLE_MIMES = ['application/x-msdownload', 'application/x-msdos-program', 'application/x-executable',
  'application/vnd.microsoft.portable-executable', 'application/x-sh', 'application/java-archive', 'application/vnd.android.package-archive',
  'application/x-msi', 'application/x-apple-diskimage'];

export function extensionsOf(filename: string): string[] {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts.slice(1) : [];
}

export function analyzeDownload(input: {
  filename: string;
  mimeType?: string;
  url: string;
  sourceVerdict?: UrlVerdict;
  level?: ProtectionLevel;
}): DownloadVerdict {
  const level = input.level ?? 'standard';
  const signals: Signal[] = [];
  const name = input.filename;
  const exts = extensionsOf(name);
  const ext = exts[exts.length - 1] ?? '';
  const mime = (input.mimeType ?? '').toLowerCase().split(';')[0].trim();

  if (/[‪-‮⁦-⁩]/.test(name)) {
    signals.push({ code: 'bidi-filename', severity: 80, message: 'The file name uses hidden characters to disguise its real type.' });
  }
  if (EXECUTABLE_EXTENSIONS.has(ext)) {
    signals.push({ code: 'executable', severity: 35, message: `This is a program (.${ext}) that can make changes to your device when opened.` });
    if (exts.length >= 2 && (MIME_FOR_EXT[exts[exts.length - 2]] || ['doc', 'docx', 'pdf', 'jpg', 'png', 'txt', 'xls', 'xlsx', 'mp4', 'mp3'].includes(exts[exts.length - 2]))) {
      signals.push({ code: 'double-extension', severity: 50, message: `The name "${name}" pretends to be a .${exts[exts.length - 2]} file but is actually a program.` });
    }
  } else if (RISKY_DOCUMENT_EXTENSIONS.has(ext)) {
    signals.push({ code: 'active-document', severity: ['docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'xlam', 'one', 'hta'].includes(ext) ? 25 : 5,
      message: `.${ext} files can contain scripts or macros.` });
  } else if (ARCHIVE_EXTENSIONS.has(ext)) {
    signals.push({ code: 'archive', severity: 5, message: 'Archives can contain programs; check what\'s inside before opening anything.' });
  }
  if (mime && EXECUTABLE_MIMES.includes(mime) && !EXECUTABLE_EXTENSIONS.has(ext)) {
    signals.push({ code: 'mime-mismatch', severity: 55, message: `The site says this is a program (${mime}), but the name ends in .${ext || 'nothing'}.` });
  } else if (mime && MIME_FOR_EXT[ext] && !MIME_FOR_EXT[ext].includes(mime) && mime !== 'application/octet-stream') {
    signals.push({ code: 'mime-mismatch', severity: 15, message: `The file type reported by the site (${mime}) doesn't match its name.` });
  }
  if (input.url.startsWith('http:')) {
    signals.push({ code: 'insecure-source', severity: EXECUTABLE_EXTENSIONS.has(ext) ? 25 : 8, message: 'The file was sent over an unencrypted connection and could have been altered.' });
  }
  const sv = input.sourceVerdict;
  if (sv && sv.action !== 'allow') {
    signals.push({ code: 'risky-source', severity: sv.confidence === 'confirmed' ? 100 : 30, message: 'The site offering this file has been flagged by Nude Security.' });
  }

  const score = Math.min(100, signals.reduce((s, x) => s + x.severity, 0));
  const risk = score >= 80 ? 'dangerous' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
  const blockAt = level === 'maximum' ? 50 : level === 'enhanced' ? 75 : 85;
  const warnAt = level === 'standard' ? 50 : 30;
  const action = score >= blockAt ? 'block' : score >= warnAt ? 'warn' : 'allow';
  return { risk, action, signals, disclaimer: DOWNLOAD_DISCLAIMER };
}

/** Inspects the first bytes of a downloaded file for a type that contradicts its name. */
export function inspectFileHeader(filename: string, head: Uint8Array): Signal[] {
  const ext = extensionsOf(filename).pop() ?? '';
  const startsWith = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  let actual: string | null = null;
  if (startsWith(0x4d, 0x5a)) actual = 'windows-executable';
  else if (startsWith(0x7f, 0x45, 0x4c, 0x46)) actual = 'linux-executable';
  else if (startsWith(0xcf, 0xfa, 0xed, 0xfe) || startsWith(0xfe, 0xed, 0xfa, 0xcf) || startsWith(0xca, 0xfe, 0xba, 0xbe)) actual = 'mac-executable';
  else if (startsWith(0x23, 0x21)) actual = 'script';
  if (!actual) return [];
  const declaredExecutable = EXECUTABLE_EXTENSIONS.has(ext);
  if (declaredExecutable) return [];
  return [{ code: 'disguised-executable', severity: 90, message: `This file is named like a .${ext || 'plain'} file, but its contents are a program (${actual.replace('-', ' ')}).` }];
}
