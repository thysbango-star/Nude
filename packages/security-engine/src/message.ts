// Scam indicators in pasted text (emails, SMS, chat messages). Used by Nude AI and offline.
import { analyzeUrl, type ThreatLists, type UrlVerdict, emptyLists } from './url';

export interface MessageIndicator { code: string; weight: number; message: string; evidence?: string }
export interface MessageVerdict {
  assessment: 'likely-scam' | 'suspicious' | 'no-strong-signs';
  score: number;
  indicators: MessageIndicator[];
  links: UrlVerdict[];
  summary: string;
}

const RULES: { code: string; weight: number; re: RegExp; message: string }[] = [
  { code: 'urgency', weight: 15, re: /\b(urgent|immediately|within (24|48) hours|final (notice|warning)|act now|right away|expires? (today|soon))\b/i, message: 'Creates urgency to pressure you into acting before thinking.' },
  { code: 'threat', weight: 20, re: /\b(account (will be|has been) (deleted|closed|suspended|locked|disabled|terminated)|legal action|arrest|penalt(y|ies)|blocked permanently)\b/i, message: 'Threatens a consequence (account deletion, suspension, legal action).' },
  { code: 'credentials', weight: 25, re: /\b(verify your (account|identity|details)|confirm your (password|details|identity)|update your (payment|billing|banking) (details|information)|log ?in to (avoid|prevent|restore))\b/i, message: 'Asks you to verify, log in or update details via the message.' },
  { code: 'otp', weight: 30, re: /\b(otp|one[- ]time (pin|password|code)|verification code|pin number|cvv|card number)\b/i, message: 'Mentions one-time PINs, card numbers or codes — legitimate services never ask for these by message.' },
  { code: 'payment', weight: 20, re: /\b(gift ?cards?|itunes card|google play card|crypto(currency)?|bitcoin|usdt|wire transfer|western union|moneygram|e-?wallet|cash ?send)\b/i, message: 'Requests unusual payment methods (gift cards, crypto, money transfer).' },
  { code: 'prize', weight: 20, re: /\b(you('ve| have)? won|winner|lottery|prize|inheritance|unclaimed (funds|parcel)|free (iphone|gift))\b/i, message: 'Promises a prize, inheritance or windfall.' },
  { code: 'delivery', weight: 10, re: /\b(parcel|package|delivery) (is )?(on hold|held|pending|could not be delivered)|customs fee|redelivery fee\b/i, message: 'Claims a parcel is held and needs a fee — a common SMS scam.' },
  { code: 'generic-greeting', weight: 8, re: /^\s*(dear (customer|user|client|member|account holder|valued customer)|hello (customer|user))/im, message: 'Uses a generic greeting instead of your name.' },
  { code: 'secrecy', weight: 15, re: /\b(do not (tell|share with) anyone|keep this (confidential|secret)|don'?t tell)\b/i, message: 'Asks you to keep it secret.' },
  { code: 'remote-access', weight: 25, re: /\b(anydesk|teamviewer|remote access|install (this|the) app to)\b/i, message: 'Asks you to install remote-access software.' },
];

export function analyzeMessage(text: string, lists: ThreatLists = emptyLists()): MessageVerdict {
  const indicators: MessageIndicator[] = [];
  for (const r of RULES) {
    const m = r.re.exec(text);
    if (m) indicators.push({ code: r.code, weight: r.weight, message: r.message, evidence: m[0] });
  }
  const urls = [...new Set(text.match(/\bhttps?:\/\/[^\s<>"')\]]+/gi) ?? [])].slice(0, 20);
  const links = urls.map((u) => analyzeUrl(u.replace(/[.,;:!?]+$/, ''), lists, 'enhanced'));
  for (const l of links) {
    if (l.action !== 'allow') {
      indicators.push({ code: 'risky-link', weight: l.confidence === 'confirmed' ? 60 : 30,
        message: `Contains a link to ${l.host}, which Nude Security flags: ${l.signals[0]?.message ?? 'suspicious address'}`, evidence: l.url });
    }
  }
  // Display text vs real link mismatch in pasted HTML: <a href="https://evil">https://bank.com</a>
  const anchorRe = /<a[^>]+href=["']([^"']+)["'][^>]*>\s*(https?:\/\/[^<\s]+)\s*<\/a>/gi;
  for (const m of text.matchAll(anchorRe)) {
    try {
      if (new URL(m[1]).hostname !== new URL(m[2]).hostname) {
        indicators.push({ code: 'link-mismatch', weight: 35, message: `A link shows ${new URL(m[2]).hostname} but actually goes to ${new URL(m[1]).hostname}.` });
      }
    } catch { /* ignore */ }
  }
  const score = Math.min(100, indicators.reduce((s, i) => s + i.weight, 0));
  const assessment = score >= 50 ? 'likely-scam' : score >= 25 ? 'suspicious' : 'no-strong-signs';
  const summary = assessment === 'likely-scam'
    ? 'This message shows several strong signs of a scam. Don\'t click its links, reply, or share any details. Contact the company using its official website or app instead.'
    : assessment === 'suspicious'
      ? 'This message has some warning signs. Verify it through the company\'s official website or phone number before acting on it.'
      : 'No strong scam signs were found, but that doesn\'t prove the message is genuine. If it asks for money or details, verify it independently.';
  return { assessment, score, indicators, links, summary };
}
