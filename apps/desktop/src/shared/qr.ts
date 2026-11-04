// A small QR Code encoder (ISO/IEC 18004): byte mode, versions 1–40, error correction L/M/Q/H, automatic mask.
// Written for Nude's phone-link codes, after the structure of Project Nayuki's reference QR generator (MIT).

export type Ecc = 'L' | 'M' | 'Q' | 'H';
const ECC_ORD: Record<Ecc, number> = { L: 0, M: 1, Q: 2, H: 3 };
const ECC_FORMAT: Record<Ecc, number> = { L: 1, M: 0, Q: 3, H: 2 };

const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

function rawDataModules(ver: number) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
const dataCodewords = (ver: number, e: Ecc) =>
  Math.floor(rawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[ECC_ORD[e]][ver] * NUM_ERROR_CORRECTION_BLOCKS[ECC_ORD[e]][ver];

function gfMul(x: number, y: number) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree: number) {
  const d = new Array<number>(degree).fill(0);
  d[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      d[j] = gfMul(d[j], root);
      if (j + 1 < degree) d[j] ^= d[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return d;
}
function rsRemainder(data: number[], div: number[]) {
  const r = new Array<number>(div.length).fill(0);
  for (const b of data) {
    const f = b ^ (r.shift() as number);
    r.push(0);
    div.forEach((c, i) => { r[i] ^= gfMul(c, f); });
  }
  return r;
}

/** Encodes text (UTF-8) as a QR code. Returns the module grid: true = dark. */
export function encodeQr(text: string, ecc: Ecc = 'M'): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1;
  for (; ver <= 40; ver++) {
    const cap = dataCodewords(ver, ecc) * 8;
    const used = 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8;
    if (used <= cap) break;
  }
  if (ver > 40) throw new Error('Too much data for a QR code');

  // Data bits: byte mode, count, data, terminator, padding.
  const bits: number[] = [];
  const put = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capBits = dataCodewords(ver, ecc) * 8;
  put(0, Math.min(4, capBits - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Error correction and interleaving.
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ECC_ORD[ecc]][ver];
  const eccLen = ECC_CODEWORDS_PER_BLOCK[ECC_ORD[ecc]][ver];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const e = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(e));
  }
  const codewords: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= numShort) codewords.push(b[i]); });
  }

  const size = ver * 4 + 17;
  const mod: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const setF = (x: number, y: number, dark: boolean) => { mod[y][x] = dark; fn[y][x] = true; };

  // Function patterns.
  for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const align: number[] = [];
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    align.push(6);
    for (let pos = size - 7; align.length < n; pos -= step) align.splice(1, 0, pos);
  }
  align.forEach((ax, i) => align.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const bit = (v: number, i: number) => ((v >>> i) & 1) !== 0;
  const formatBits = (mask: number) => {
    const d = (ECC_FORMAT[ecc] << 3) | mask;
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setF(8, i, bit(b, i));
    setF(8, 7, bit(b, 6)); setF(8, 8, bit(b, 7)); setF(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(b, i));
    setF(8, size - 8, true);
  };
  formatBits(0);
  if (ver >= 7) {
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (ver << 12) | r;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), c = Math.floor(i / 3);
      setF(a, c, bit(b, i)); setF(c, a, bit(b, i));
    }
  }

  // Codewords in the zig-zag order.
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j;
      const up = ((right + 1) & 2) === 0;
      const y = up ? size - 1 - vert : vert;
      if (!fn[y][x] && k < codewords.length * 8) { mod[y][x] = bit(codewords[k >>> 3], 7 - (k & 7)); k++; }
    }
  }

  const masked = (m: number, x: number, y: number) => {
    switch (m) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  };
  const applyMask = (m: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && masked(m, x, y)) mod[y][x] = !mod[y][x];
  };
  let best = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m); formatBits(m);
    const s = penalty(mod);
    if (s < bestScore) { best = m; bestScore = s; }
    applyMask(m); // undo
  }
  applyMask(best); formatBits(best);
  return mod;
}

/** The standard mask penalty (runs, 2×2 blocks, finder-like patterns, dark balance). */
function penalty(m: boolean[][]) {
  const n = m.length;
  let s = 0;
  const lines: boolean[][] = [];
  for (let i = 0; i < n; i++) { lines.push(m[i]); lines.push(m.map((row) => row[i])); }
  const finderA = [true, false, true, true, true, false, true, false, false, false, false];
  const finderB = [false, false, false, false, true, false, true, true, true, false, true];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) run++;
      else { if (run >= 5) s += 3 + (run - 5); run = 1; }
    }
    for (let i = 0; i + 11 <= n; i++) {
      if (finderA.every((v, j) => line[i + j] === v) || finderB.every((v, j) => line[i + j] === v)) s += 40;
    }
  }
  for (let y = 0; y + 1 < n; y++) for (let x = 0; x + 1 < n; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) s += 3;
  }
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const total = n * n;
  s += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return s;
}

/** An SVG of the code with a quiet zone, as a path (crisp at any size). */
export function qrSvg(text: string, opts: { ecc?: Ecc; dark?: string; light?: string; margin?: number } = {}) {
  const m = encodeQr(text, opts.ecc ?? 'M');
  const q = opts.margin ?? 4;
  const n = m.length + q * 2;
  let d = '';
  m.forEach((row, y) => row.forEach((v, x) => { if (v) d += `M${x + q} ${y + q}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="${opts.light ?? '#fff'}"/><path d="${d}" fill="${opts.dark ?? '#000'}"/></svg>`;
}
