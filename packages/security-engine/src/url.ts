// URL risk analysis: list lookups (confirmed threats) + heuristics (suspected threats).
import { PROTECTED_BRANDS, PHISHING_KEYWORDS, HIGH_RISK_TLDS, URL_SHORTENERS } from './data';
import { domainLabel, isIPAddress, levenshtein, registrableDomain, scriptsIn, skeleton, toUnicodeHost } from './domains';

export type ProtectionLevel = 'standard' | 'enhanced' | 'maximum';
export type ThreatCategory = 'phishing' | 'malware' | 'scam' | 'typosquatting' | 'suspicious' | 'insecure' | 'unwanted';

export interface Signal {
  code: string;
  severity: number; // 0..100 contribution
  message: string; // plain-language explanation for users
}

export interface UrlVerdict {
  url: string;
  host: string;
  action: 'allow' | 'warn' | 'block';
  confidence: 'confirmed' | 'suspected' | 'none';
  category?: ThreatCategory;
  score: number; // 0..100
  signals: Signal[];
  /** For typosquatting: the site the user probably meant. */
  intendedSite?: string;
}

export interface ThreatLists {
  /** Registrable domains or full hosts confirmed malicious, with category. */
  domains: Map<string, ThreatCategory>;
  /** Exact URLs (normalized, without fragment) confirmed malicious. */
  urls: Map<string, ThreatCategory>;
  /** Domains the user or Nude marks as trusted (never heuristically blocked). */
  allow: Set<string>;
}

export function emptyLists(): ThreatLists {
  return { domains: new Map(), urls: new Map(), allow: new Set() };
}

export const THRESHOLDS: Record<ProtectionLevel, { warn: number; block: number }> = {
  standard: { warn: 60, block: 90 },
  enhanced: { warn: 40, block: 70 },
  maximum: { warn: 30, block: 55 },
};

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
}

/** Finds the protected brand a domain label imitates, if any. */
export function detectTyposquat(host: string): { brand: string; officialDomain: string; reason: string; kind: 'lookalike' | 'combo' } | null {
  const reg = registrableDomain(toUnicodeHost(host));
  const label = domainLabel(reg);
  if (label.length < 3) return null;
  for (const { brand, domains } of PROTECTED_BRANDS) {
    if (domains.some((d) => reg === d || reg.endsWith('.' + d))) return null; // it IS the brand
  }
  // Same name on another TLD (google.de, amazon.fr) is usually a legitimate regional site: not flagged.
  if (PROTECTED_BRANDS.some((b) => b.brand === label)) return null;
  const parts = label.split('-').filter(Boolean);
  const candidates = parts.length > 1 ? [label.replace(/-/g, ''), ...parts] : [label];
  for (const { brand, domains } of PROTECTED_BRANDS) {
    const official = domains[0];
    for (const part of candidates) {
      const exact = part === brand;
      if (exact && brand.length >= 3 && parts.length > 1) {
        // "paypal-secure-login", "secure-fnb-verify"
        return { brand, officialDomain: official, reason: `combines "${brand}" with other words on a domain ${brand} doesn't own`, kind: 'combo' };
      }
      if (exact) continue;
      if (part.length >= 4 && skeleton(part) === skeleton(brand)) {
        return { brand, officialDomain: official, reason: `uses look-alike characters to imitate ${official}`, kind: 'lookalike' };
      }
      if (brand.length >= 6 && part.length >= 5) {
        const dist = levenshtein(part, brand, 2);
        if (dist === 1 || (dist === 2 && brand.length >= 9)) {
          return { brand, officialDomain: official, reason: `is spelled almost like ${official}`, kind: 'lookalike' };
        }
      }
    }
  }
  return null;
}

export function analyzeUrl(rawUrl: string, lists: ThreatLists = emptyLists(), level: ProtectionLevel = 'standard'): UrlVerdict {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { url: rawUrl, host: '', action: 'allow', confidence: 'none', score: 0, signals: [] };
  }
  const base: UrlVerdict = { url: rawUrl, host: u.hostname, action: 'allow', confidence: 'none', score: 0, signals: [] };
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return base;

  const host = u.hostname.toLowerCase();
  const reg = registrableDomain(host);
  const signals: Signal[] = [];

  // 1. Confirmed threats from lists.
  const listHit = lists.urls.get(normalizeUrl(rawUrl)) ?? lists.domains.get(host) ?? lists.domains.get(reg);
  if (listHit) {
    return { ...base, action: 'block', confidence: 'confirmed', category: listHit, score: 100,
      signals: [{ code: 'threat-list', severity: 100, message: `This site is on Nude Security's list of known ${categoryNoun(listHit)} sites.` }] };
  }
  if (lists.allow.has(reg) || lists.allow.has(host)) return base;

  // 2. Heuristics.
  const unicodeHost = toUnicodeHost(host);
  const typo = detectTyposquat(host);
  let category: ThreatCategory | undefined;
  if (typo) {
    signals.push({ code: 'typosquatting', severity: typo.kind === 'combo' ? 35 : 65, message: `The address ${typo.reason}.` });
    category = 'typosquatting';
  }

  // Brand name in a subdomain of an unrelated site: "paypal.com.account-check.net"
  const subdomainPart = host.slice(0, Math.max(0, host.length - reg.length - 1));
  for (const { brand, domains } of PROTECTED_BRANDS) {
    if (brand.length < 4 || !subdomainPart) continue;
    if (domains.some((d) => reg === d)) continue;
    if (subdomainPart.split(/[.-]/).includes(brand) || domains.some((d) => subdomainPart.includes(d))) {
      signals.push({ code: 'brand-in-subdomain', severity: 50, message: `The address puts "${brand}" in front of a different website (${reg}) to look official.` });
      category ??= 'phishing';
      break;
    }
  }

  if (u.username || u.password || rawUrl.replace(/^https?:\/\//, '').split(/[/?#]/)[0].includes('@')) {
    signals.push({ code: 'credentials-in-url', severity: 45, message: 'The address hides its real destination behind an "@" sign.' });
    category ??= 'phishing';
  }
  if (isIPAddress(host) && !isPrivateIP(host)) {
    signals.push({ code: 'ip-host', severity: 25, message: 'The site uses a raw IP address instead of a name.' });
  }
  if (host.includes('xn--')) {
    const scripts = scriptsIn(unicodeHost.replace(/\./g, ''));
    if (scripts.size > 1) {
      signals.push({ code: 'mixed-scripts', severity: 60, message: `The address mixes alphabets (${[...scripts].join(' and ')}), a trick used to imitate other sites.` });
      category ??= 'phishing';
    } else {
      signals.push({ code: 'punycode', severity: 10, message: `The address uses international characters (${unicodeHost}).` });
    }
  }
  const tld = reg.split('.').pop() ?? '';
  if (HIGH_RISK_TLDS.has(tld)) signals.push({ code: 'risky-tld', severity: 12, message: `".${tld}" addresses are often used by scam sites.` });
  const keywordHits = PHISHING_KEYWORDS.filter((k) => (host + u.pathname).toLowerCase().includes(k));
  if (keywordHits.length && (typo || signals.some((s) => s.code === 'brand-in-subdomain' || s.code === 'risky-tld' || s.code === 'ip-host'))) {
    signals.push({ code: 'phishing-keywords', severity: 15 + Math.min(15, keywordHits.length * 5), message: `The address contains words like "${keywordHits.slice(0, 3).join('", "')}" that scam sites use to look official.` });
  }
  const subdomainDepth = host.split('.').length - reg.split('.').length;
  if (subdomainDepth >= 4) signals.push({ code: 'deep-subdomains', severity: 12, message: 'The address has an unusually long chain of sub-domains.' });
  if (host.split('-').length > 4) signals.push({ code: 'many-hyphens', severity: 8, message: 'The address has many hyphens, common in throwaway scam domains.' });
  if (rawUrl.length > 300) signals.push({ code: 'long-url', severity: 5, message: 'The address is unusually long.' });
  if (URL_SHORTENERS.has(reg)) signals.push({ code: 'shortener', severity: 5, message: 'This is a link shortener; the real destination is hidden until you open it.' });
  if (/\.(exe|scr|bat|cmd|msi|apk|vbs|js|jar|ps1|hta)(\?|$)/i.test(u.pathname)) {
    signals.push({ code: 'executable-link', severity: 15, message: 'The link points directly to a program file.' });
  }
  if (u.protocol === 'http:' && !isPrivateIP(host) && host !== 'localhost') {
    signals.push({ code: 'not-https', severity: level === 'maximum' ? 20 : 3, message: 'The connection is not encrypted, so others on your network could see or change it.' });
  }

  const score = Math.min(99, signals.reduce((s, x) => s + x.severity, 0));
  const t = THRESHOLDS[level];
  const action = score >= t.block ? 'block' : score >= t.warn ? 'warn' : 'allow';
  if (action !== 'allow') category ??= 'suspicious';
  return { ...base, action, confidence: action === 'allow' ? 'none' : 'suspected', category: action === 'allow' ? undefined : category,
    score, signals, intendedSite: typo ? `https://${typo.officialDomain}/` : undefined };
}

export function isPrivateIP(host: string): boolean {
  return /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === '[::1]' || host === 'localhost';
}

export function categoryNoun(c: ThreatCategory): string {
  return { phishing: 'phishing', malware: 'malware', scam: 'scam', typosquatting: 'impersonation', suspicious: 'suspicious', insecure: 'insecure', unwanted: 'unwanted-software' }[c];
}

export const CATEGORY_INFO: Record<ThreatCategory, { title: string; explanation: string; advice: string }> = {
  phishing: { title: 'Possible phishing site', explanation: 'This site may try to trick you into entering passwords, banking details or personal information.', advice: 'Don\'t enter any information. If you need the real service, type its address yourself.' },
  malware: { title: 'Dangerous site', explanation: 'This site is known to distribute harmful software that can damage your device or steal data.', advice: 'Go back. Don\'t download anything from this site.' },
  scam: { title: 'Known scam site', explanation: 'This site has been reported for scams such as fake shops, fake prizes or fake support.', advice: 'Go back. Don\'t pay or share personal details here.' },
  typosquatting: { title: 'Look-alike website', explanation: 'This address imitates a well-known site but belongs to someone else.', advice: 'Check the address carefully. Use the link to the real site instead.' },
  suspicious: { title: 'Suspicious site', explanation: 'Several warning signs suggest this site may not be what it claims.', advice: 'Only continue if you know and trust this site.' },
  insecure: { title: 'Connection not secure', explanation: 'This page isn\'t encrypted, so information you send could be read or changed.', advice: 'Avoid entering passwords or payment details here.' },
  unwanted: { title: 'Unwanted software', explanation: 'This site offers software that may change your settings or show unwanted ads.', advice: 'Go back unless you trust this software.' },
};
