// Third-party tracker classification.
import { TRACKER_DOMAINS } from './data';
import { registrableDomain } from './domains';
import type { ProtectionLevel } from './url';

export type TrackerCategory = (typeof TRACKER_DOMAINS)[string];

let extraTrackers = new Map<string, TrackerCategory>();
export function setExtraTrackers(entries: Iterable<[string, TrackerCategory]>) {
  extraTrackers = new Map(entries);
}

/** Returns the tracker category for a host, checking the host and each parent domain. */
export function trackerCategory(host: string): TrackerCategory | null {
  const h = host.toLowerCase();
  const labels = h.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const d = labels.slice(i).join('.');
    const c = TRACKER_DOMAINS[d] ?? extraTrackers.get(d);
    if (c) return c;
  }
  return null;
}

/** Which tracker categories each protection level blocks (third-party context only). */
export const BLOCKED_CATEGORIES: Record<ProtectionLevel, Set<TrackerCategory>> = {
  standard: new Set(['advertising', 'fingerprinting', 'cryptomining']),
  enhanced: new Set(['advertising', 'analytics', 'fingerprinting', 'cryptomining']),
  maximum: new Set(['advertising', 'analytics', 'social', 'fingerprinting', 'cryptomining']),
};

export function shouldBlockRequest(requestHost: string, firstPartyHost: string | null, level: ProtectionLevel):
  { block: boolean; category: TrackerCategory | null } {
  const category = trackerCategory(requestHost);
  if (!category) return { block: false, category: null };
  if (firstPartyHost && registrableDomain(firstPartyHost) === registrableDomain(requestHost)) return { block: false, category };
  return { block: BLOCKED_CATEGORIES[level].has(category), category };
}
