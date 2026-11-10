import { api, $, esc, host, I, on, timeAgo, toast } from './common';

interface Summary {
  level: string; checks: { id: string; label: string; on: boolean; hint: string }[]; lastScan: number; listsUpdated: number; knownThreats: number; trusted: string[];
  stats: { blockedSites: number; warnedSites: number; blockedTrackers: number; blockedDownloads: number; flaggedDownloads: number };
  events: { time: number; type: string; url?: string; category?: string; detail: string }[];
}
const LEVEL_NAMES: Record<string, string> = { standard: 'Standard Protection', enhanced: 'Enhanced Protection', maximum: 'Maximum Protection' };
const EVENT_LABEL: Record<string, [string, string]> = {
  'site-blocked': ['Blocked a dangerous site', 'danger'], 'site-warned': ['Warned about a suspicious site', 'warn'],
  'download-blocked': ['Blocked a dangerous download', 'danger'], 'download-warned': ['Warned about a download', 'warn'],
  'download-flagged': ['Flagged a downloaded file', 'danger'], bypass: ['You continued past a warning', 'warn'],
  'lists-updated': ['Threat lists updated', 'ok'], scan: ['Protection check', ''], 'tracker-summary': ['Trackers blocked', 'ok'],
};

async function render() {
  const s = await api.invoke<Summary>('security.summary');
  const on = s.checks.filter((c) => c.on).length;
  $('#root').innerHTML = `<div class="page">
    <div class="page-head"><h1><img class="rv-logo" src="rovian-mark.svg" alt=""><span class="rv-word">Rovian<i>Defender</i></span></h1>
      <button class="btn" id="check">${I.reload}Check for updates</button><a class="btn" href="nude://settings#privacy" data-open="nude://settings">${I.settings}Settings</a></div>

    <div class="hero card">
      <div class="checks"><div class="checks-head"><b>${on} of ${s.checks.length}</b><span>privacy settings on</span></div>
        ${s.checks.map((c) => `<div class="check ${c.on ? 'on' : ''}"><span class="tick">${c.on ? '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</span><div><div>${esc(c.label)}</div>${c.on ? '' : `<div class="tiny">${esc(c.hint)}</div>`}</div></div>`).join('')}</div>
      <div class="hero-text"><div class="status-line"><span class="dot-live"></span>Protection is on</div>
        <h2>${LEVEL_NAMES[s.level]}</h2>
        <p class="muted">Rovian Defender — Nude's built-in security — checks every site before it opens and every file before it's saved, and blocks trackers that follow you across the web.</p>
        <div class="tiny">Last check: ${s.lastScan ? timeAgo(s.lastScan) : 'never'} · Threat lists: ${s.listsUpdated ? `updated ${timeAgo(s.listsUpdated)}` : 'built-in checks only'} · ${s.knownThreats.toLocaleString()} known threats loaded</div>
        ${s.level === 'standard' ? '<a class="btn primary" href="nude://settings#privacy" data-open="nude://settings">Increase protection</a>' : ''}</div>
    </div>

    <div class="stats-grid">
      ${stat(I.shieldX, s.stats.blockedSites, 'Dangerous sites blocked', 'danger')}
      ${stat(I.warn, s.stats.warnedSites, 'Suspicious sites warned', 'warn')}
      ${stat(I.shield, s.stats.blockedTrackers, 'Trackers blocked', 'ok')}
      ${stat(I.download, s.stats.blockedDownloads + s.stats.flaggedDownloads, 'Risky downloads stopped', 'danger')}
    </div>

    <div class="grid2">
      <section class="card"><h2>Recent security events</h2>${s.events.length ? `<div class="events">${s.events.slice(0, 40).map((e) => {
        const [label, cls] = EVENT_LABEL[e.type] ?? [e.type, ''];
        return `<div class="event"><span class="pill ${cls}">${esc(label)}</span><div class="ev-main">${e.url ? `<b>${esc(host(e.url))}</b>` : ''}<div class="muted">${esc(e.detail)}</div></div><span class="tiny">${timeAgo(e.time)}</span></div>`;
      }).join('')}</div>` : `<div class="empty" style="padding:24px"><div class="ei">${I.shieldCheck}</div><h3>All quiet</h3><div>Rovian Defender hasn't had to step in yet.</div></div>`}</section>

      <section class="card"><h2>Check a link</h2>
        <p class="muted" style="margin-top:0">Paste a link from an email or message to see if Rovian Defender trusts it — without opening it.</p>
        <form id="check-form" class="check-form"><input class="input" id="check-url" placeholder="https://…" required><button class="btn primary">Check</button></form>
        <div id="check-result"></div>
        <h2 style="margin-top:22px">Trusted sites</h2>
        <p class="tiny" style="margin-top:0">Sites you trust are never blocked by warning-sign checks (known threats are still blocked).</p>
        <div id="trusted">${s.trusted.length ? s.trusted.map((t) => `<div class="row"><span class="main">${esc(t)}</span><button class="icon-btn" data-untrust="${esc(t)}">${I.close}</button></div>`).join('') : '<div class="muted">None</div>'}</div>
        <form id="trust-form" class="check-form"><input class="input" id="trust-domain" placeholder="example.com" required><button class="btn">Trust</button></form>
      </section>
    </div>
    <p class="tiny" style="text-align:center">Rovian Defender reduces risk but can't catch every threat. If something looks too good to be true, or asks for passwords, PINs or payment urgently, stop and check.</p>
  </div>`;
}

function stat(icon: string, n: number, label: string, cls: string) {
  return `<div class="card stat"><div class="stat-icon ${cls}">${icon}</div><b>${n.toLocaleString()}</b><span class="muted">${label}</span></div>`;
}

document.addEventListener('click', async (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('#check')) { const r = await api.invoke<{ message: string }>('security.update'); toast(r.message); void render(); }
  const un = t.closest<HTMLElement>('[data-untrust]')?.dataset.untrust;
  if (un) await api.invoke('security.untrust', un);
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target as HTMLElement;
  if (f.id === 'trust-form') { await api.invoke('security.trust', $<HTMLInputElement>('#trust-domain').value.trim()); return; }
  if (f.id === 'check-form') {
    let url = $<HTMLInputElement>('#check-url').value.trim();
    if (!/^https?:\/\//.test(url)) url = `https://${url}`;
    const v = await api.invoke<{ action: string; confidence: string; category?: string; signals: string[] }>('security.check', url);
    const cls = v.action === 'allow' ? 'ok' : v.action === 'warn' ? 'warn' : 'danger';
    const title = v.action === 'allow' ? 'No warning signs found' : v.confidence === 'confirmed' ? 'Known dangerous site' : v.action === 'block' ? 'Very likely dangerous' : 'Suspicious';
    $('#check-result').innerHTML = `<div class="result ${cls}"><b>${title}</b> <span class="tiny">(${esc(host(url))})</span>
      ${v.signals.length ? `<ul>${v.signals.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : '<div class="muted">That isn\'t a guarantee it\'s safe.</div>'}</div>`;
  }
});
on('security', render);
on('settings', render);
void render();
