export * from './url';
export * from './downloads';
export * from './trackers';
export * from './message';
export { registrableDomain, sameSite, toUnicodeHost, levenshtein, skeleton, setPublicSuffixes } from './domains';

import type { ProtectionLevel } from './url';

/** Plain-language description of each protection level and its trade-offs (shown in Settings). */
export const PROTECTION_LEVELS: Record<ProtectionLevel, { name: string; summary: string; tradeoffs: string; features: string[] }> = {
  standard: {
    name: 'Standard Protection',
    summary: 'Blocks known dangerous sites and downloads, and advertising and fingerprinting trackers.',
    tradeoffs: 'Best compatibility. All checks run on your device; no addresses are sent to Nude. Look-alike sites are warned about, not blocked.',
    features: ['Known threat lists, checked locally', 'Warnings for look-alike and suspicious sites', 'Blocks ad, fingerprinting and cryptomining trackers', 'Warns before risky downloads'],
  },
  enhanced: {
    name: 'Enhanced Protection',
    summary: 'Stricter checks, real-time lookups and analytics-tracker blocking.',
    tradeoffs: 'Catches newer threats sooner. Addresses you visit are checked in real time with the Nude threat service (not stored with your identity). A few sites may break.',
    features: ['Everything in Standard', 'Real-time address checks with Nude threat intelligence', 'Blocks suspicious sites, not just known ones', 'Blocks analytics trackers and third-party cookies', 'Asks before opening HTTP pages'],
  },
  maximum: {
    name: 'Maximum Protection',
    summary: 'The strictest settings: HTTPS-only, social trackers blocked, risky downloads stopped.',
    tradeoffs: 'Most private and secure, but more sites will break or need you to allow them, and some downloads will be blocked until you approve them.',
    features: ['Everything in Enhanced', 'HTTPS-only browsing', 'Blocks social-media trackers and embeds', 'Blocks risky downloads by default', 'Reduces fingerprinting (trims headers, sends Global Privacy Control)'],
  },
};
