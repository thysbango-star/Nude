// Domain helpers: registrable domain (eTLD+1) approximation and string distance.

/** Common multi-label public suffixes. A full Public Suffix List can be loaded via setPublicSuffixes(). */
let MULTI_SUFFIXES = new Set([
  'co.za', 'org.za', 'gov.za', 'ac.za', 'net.za', 'web.za',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'org.nz', 'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'co.in', 'net.in', 'org.in',
  'com.br', 'com.mx', 'com.ar', 'com.cn', 'com.hk', 'com.sg', 'com.tr', 'com.ng', 'com.eg',
  'co.ke', 'co.tz', 'co.ug', 'com.gh', 'co.zw', 'co.bw', 'com.na',
  'github.io', 'gitlab.io', 'herokuapp.com', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev',
  'web.app', 'firebaseapp.com', 'blogspot.com', 'azurewebsites.net', 'cloudfront.net', 's3.amazonaws.com',
  'appspot.com', 'glitch.me', 'repl.co', 'ngrok.io', 'ngrok-free.app', 'wixsite.com', 'weebly.com', 'square.site',
]);

export function setPublicSuffixes(suffixes: Iterable<string>) {
  MULTI_SUFFIXES = new Set([...MULTI_SUFFIXES, ...suffixes]);
}

export function isIPAddress(host: string): boolean {
  if (host.startsWith('[')) return true;
  const p = host.split('.');
  return p.length === 4 && p.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255);
}

/** "login.secure.example.co.za" → "example.co.za". */
export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (isIPAddress(h) || !h.includes('.')) return h;
  const labels = h.split('.');
  for (let n = Math.min(labels.length - 1, 3); n >= 2; n--) {
    const suffix = labels.slice(-n).join('.');
    if (MULTI_SUFFIXES.has(suffix)) return labels.slice(-(n + 1)).join('.');
  }
  return labels.slice(-2).join('.');
}

/** The registrable domain without its suffix: "example.co.za" → "example". */
export function domainLabel(host: string): string {
  const reg = registrableDomain(host);
  return reg.split('.')[0];
}

export function sameSite(a: string, b: string): boolean {
  return registrableDomain(a) === registrableDomain(b);
}

export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Maps look-alike characters to their usual letter: "paypa1" → "paypal", "rnicrosoft" → "microsoft". */
export function skeleton(s: string): string {
  return s.toLowerCase()
    .replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/cl/g, 'd')
    .replace(/[0]/g, 'o').replace(/[1|!]/g, 'l').replace(/3/g, 'e').replace(/4/g, 'a')
    .replace(/5/g, 's').replace(/7/g, 't').replace(/8/g, 'b').replace(/9/g, 'g').replace(/[-_]/g, '');
}

const SCRIPT_RANGES: [RegExp, string][] = [
  [/[a-z]/i, 'latin'], [/[Ѐ-ӿ]/, 'cyrillic'], [/[Ͱ-Ͽ]/, 'greek'],
  [/[֐-׿]/, 'hebrew'], [/[؀-ۿ]/, 'arabic'], [/[一-鿿]/, 'han'],
];

/** Returns the set of writing systems used in a (Unicode) label. */
export function scriptsIn(label: string): Set<string> {
  const out = new Set<string>();
  for (const ch of label) for (const [re, name] of SCRIPT_RANGES) if (re.test(ch)) out.add(name);
  return out;
}

/** Decodes punycode ("xn--") labels to Unicode for display/analysis. */
export function toUnicodeHost(host: string): string {
  return host.split('.').map((l) => (l.startsWith('xn--') ? punycodeDecode(l.slice(4)) ?? l : l)).join('.');
}

// RFC 3492 decoder (small, dependency-free).
function punycodeDecode(input: string): string | null {
  const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
  let n = 128, i = 0, bias = 72;
  const output: number[] = [];
  const basic = input.lastIndexOf('-');
  for (let j = 0; j < Math.max(0, basic); j++) output.push(input.charCodeAt(j));
  const adapt = (delta: number, numPoints: number, first: boolean) => {
    delta = first ? Math.floor(delta / damp) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    let k = 0;
    while (delta > ((base - tMin) * tMax) >> 1) { delta = Math.floor(delta / (base - tMin)); k += base; }
    return k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
  };
  for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length;) {
    const oldi = i;
    for (let w = 1, k = base; ; k += base) {
      if (idx >= input.length) return null;
      const c = input.charCodeAt(idx++);
      const digit = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base;
      if (digit >= base) return null;
      i += digit * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (digit < t) break;
      w *= base - t;
    }
    bias = adapt(i - oldi, output.length + 1, oldi === 0);
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    output.splice(i++, 0, n);
  }
  try {
    return String.fromCodePoint(...output);
  } catch {
    return null;
  }
}
