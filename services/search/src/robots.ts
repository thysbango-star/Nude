// robots.txt parsing and matching (RFC 9309).
export interface RobotsRules {
  allow: string[];
  disallow: string[];
  crawlDelay?: number;
  sitemaps: string[];
}

export function parseRobots(body: string, agent = 'nudebot'): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[]; delay?: number }[] = [];
  const sitemaps: string[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === 'sitemap') { if (value) sitemaps.push(value); continue; }
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], allow: [], disallow: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow') current.allow.push(value);
    else if (key === 'disallow') { if (value) current.disallow.push(value); }
    else if (key === 'crawl-delay') { const d = Number(value); if (Number.isFinite(d)) current.delay = d; }
  }
  const ua = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return {
    allow: chosen.flatMap((g) => g.allow),
    disallow: chosen.flatMap((g) => g.disallow),
    crawlDelay: chosen.find((g) => g.delay !== undefined)?.delay,
    sitemaps,
  };
}

function patternToRegex(p: string): RegExp {
  const anchored = p.endsWith('$');
  const body = (anchored ? p.slice(0, -1) : p).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

/** Longest matching rule wins; Allow wins ties. */
export function isAllowed(rules: RobotsRules, pathAndQuery: string): boolean {
  let best = { len: -1, allow: true };
  for (const [list, allow] of [[rules.allow, true], [rules.disallow, false]] as const) {
    for (const p of list) {
      if (patternToRegex(p).test(pathAndQuery) && (p.length > best.len || (p.length === best.len && allow))) best = { len: p.length, allow };
    }
  }
  return best.allow;
}
