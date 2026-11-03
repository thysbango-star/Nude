import { api, $, esc, I, on, toast } from './common';

type S = Record<string, unknown> & { toolbar: string[] };
interface Info {
  settings: S; engines: { id: string; name: string }[]; private: boolean; version: string; chrome: string; electron: string; platform: string; isDefault: boolean;
  levels: Record<string, { name: string; summary: string; tradeoffs: string; features: string[] }>; shortcuts: { label: string; keys: string }[];
}

let info: Info;
const set = (patch: Record<string, unknown>) => api.invoke('settings.set', patch);

const sw = (key: string, label: string, desc = '') => `<div class="setting"><div class="text"><b>${label}</b>${desc ? `<span>${desc}</span>` : ''}</div>
  <label class="switch"><input type="checkbox" data-key="${key}" ${info.settings[key] ? 'checked' : ''}><span></span></label></div>`;
const sel = (key: string, label: string, options: [string, string][], desc = '') => `<div class="setting"><div class="text"><b>${label}</b>${desc ? `<span>${desc}</span>` : ''}</div>
  <select data-key="${key}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(info.settings[key]) === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
const txt = (key: string, label: string, desc = '', placeholder = '', type = 'text') => `<div class="setting"><div class="text"><b>${label}</b>${desc ? `<span>${desc}</span>` : ''}</div>
  <input class="input" type="${type}" data-key="${key}" value="${esc(String(info.settings[key] ?? ''))}" placeholder="${esc(placeholder)}" style="min-width:260px"></div>`;

const TOOLBAR: [string, string][] = [['home', 'Home button'], ['reader', 'Reader view'], ['split', 'Split view'], ['overview', 'Tab overview'], ['security', 'Rovian Defender shield'], ['downloads', 'Downloads'], ['ai', 'Nebula']];
const ACCENTS = ['', '#b5674d', '#d4766a', '#c9963b', '#4f9a6d', '#3f8fb0', '#5b6fd8', '#8f6bd6', '#c45b9a', '#5f6368'];

async function render() {
  info = await api.invoke<Info>('settings.get');
  const s = info.settings;
  document.documentElement.classList.toggle('private', info.private);
  const lv = s.protectionLevel as string;
  $('#root').innerHTML = `<div class="layout">
    <nav class="side">
      <a href="#appearance" class="on">${I.sparkle}Appearance</a><a href="#search">${I.search}Search</a><a href="#startup">${I.home}On startup</a>
      <a href="#privacy">${I.shield}Privacy &amp; security</a><a href="#permissions">${I.camera}Site permissions</a><a href="#downloads">${I.download}Downloads</a>
      <a href="#ai">${I.sparkle}Nebula</a><a href="#services">${I.globe}Nude services</a><a href="#accessibility">${I.info}Accessibility</a>
      <a href="#shortcuts">${I.keyboard}Shortcuts</a><a href="#about">${I.info}About Nude</a></nav>
    <div>
      <div class="page-head"><h1><span class="head-icon">${I.settings}</span>Settings</h1></div>

      <section class="card" id="appearance"><h2>Appearance</h2>
        <div class="setting"><div class="text"><b>Theme</b><span>Follows Nude OS / your system by default.</span></div>
          <div class="seg" data-seg="theme">${['system', 'light', 'dark'].map((t) => `<button data-v="${t}" class="${s.theme === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
        <div class="setting"><div class="text"><b>Accent colour</b><span>The first option uses your system accent colour.</span></div>
          <div class="swatches">${ACCENTS.map((c) => `<button class="swatch${s.accentColor === c ? ' on' : ''}" data-accent="${c}" title="${c || 'System'}" style="${c ? `background:${c}` : ''}">${c ? '' : 'A'}</button>`).join('')}</div></div>
        ${sw('showBookmarksBar', 'Show bookmarks bar')}${sw('showHomeButton', 'Show home button')}
        <div class="setting"><div class="text"><b>Toolbar</b><span>Choose which buttons appear next to the address bar.</span></div>
          <div class="toolbar-pick">${TOOLBAR.map(([k, l]) => `<label class="check"><input type="checkbox" data-toolbar="${k}" ${s.toolbar.includes(k) ? 'checked' : ''}>${l}</label>`).join('')}</div></div>
      </section>

      <section class="card" id="search"><h2>Search</h2>
        ${sel('searchEngine', 'Search engine', info.engines.map((e) => [e.id, e.name]), 'Used in the address bar and on the new tab page. Nude Search needs a Nude Search server (see Nude services).')}
        ${sw('searchSuggestions', 'Search suggestions', 'Shows suggestions from your search engine as you type. Never used in private windows.')}
      </section>

      <section class="card" id="startup"><h2>On startup</h2>
        ${sel('startup', 'When Nude starts', [['restore', 'Continue where you left off'], ['newtab', 'Open the new tab page'], ['homepage', 'Open my home page']])}
        ${txt('homepage', 'Home page', 'Also used by the home button.', 'https://')}
      </section>

      <section class="card" id="privacy"><h2>Privacy &amp; security</h2>
        <p class="muted" style="margin-top:0">Choose how strongly Rovian Defender protects you. Higher levels block more, but more sites may break.</p>
        <div class="levels">${Object.entries(info.levels).map(([k, l]) => `<button class="level${lv === k ? ' on' : ''}" data-level="${k}">
          <div class="level-top">${I.shield}<b>${esc(l.name)}</b>${k === 'standard' ? '<span class="pill">Default</span>' : ''}</div>
          <div class="muted">${esc(l.summary)}</div><ul>${l.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
          <div class="tradeoff"><b>Trade-off:</b> ${esc(l.tradeoffs)}</div></button>`).join('')}</div>
        ${sw('clearHistoryOnExit', 'Clear history when Nude closes', 'Also clears the cache. Bookmarks and passwords are kept.')}
        ${sw('offerToSavePasswords', 'Offer to save passwords', 'Coming soon: Nude Passwords with Nude OS biometric unlock.')}
        <div class="setting"><div class="text"><b>Clear browsing data</b><span>History, cookies, cached files and more.</span></div><button class="btn" id="clear-btn">Clear data…</button></div>
        <div class="setting"><div class="text"><b>Security dashboard</b><span>See what Rovian Defender has blocked.</span></div><a class="btn" href="nude://security" data-open="nude://security">Open</a></div>
      </section>

      <section class="card" id="permissions"><h2>Site permissions</h2><div id="perms"><div class="loading">Loading…</div></div>
        <p class="tiny">Sites must ask before using your camera, microphone, location, notifications and more.</p></section>

      <section class="card" id="downloads"><h2>Downloads</h2>
        <div class="setting"><div class="text"><b>Save files to</b><span>${esc(String(s.downloadsDirectory || 'Your Downloads folder'))}</span></div><button class="btn" id="choose-dl">Change…</button></div>
        ${sw('askWhereToSave', 'Ask where to save each file')}${sw('notifyOnDownloadComplete', 'Notify me when a download finishes')}
      </section>

      <section class="card" id="ai"><h2>Nebula</h2>
        ${sw('aiEnabled', 'Show Nebula', 'The assistant only sees pages, selections, tabs or files you explicitly share with it.')}
        ${sw('voiceOutput', 'Read answers aloud automatically')}
        ${sel('nebulaSpeed', 'Answer speed', [['auto', 'Auto: fast for chat, deep when you share pages or images'], ['fast', 'Fast'], ['thorough', 'Deep: slower, more careful']])}
        <p class="tiny">To turn Nebula on, run the Nebula gateway with an AI key and put its address under Nude services below. The setup guide is docs/NEBULA_SETUP.md in the Nude project.</p>
        <p class="tiny">Nebula runs through the Nebula gateway. The gateway holds all AI provider keys — they're never stored in the browser.</p>
      </section>

      <section class="card" id="services"><h2>Nude services</h2>
        <p class="muted" style="margin-top:0">Addresses of the Nude Search, Nebula and threat-intelligence servers. Defaults point to servers running on this computer.</p>
        ${txt('searchServerUrl', 'Nude Search server', '', 'https://search.example.com')}
        ${txt('aiGatewayUrl', 'Nebula gateway', '', 'https://ai.example.com')}
        ${txt('threatIntelUrl', 'Threat-intelligence server', '', 'https://threats.example.com')}
        ${txt('serviceToken', 'Access token', 'Only needed if your Nude servers require one.', '', 'password')}
        <div class="setting"><div class="text"><b>Connection status</b><span id="svc-status">Not checked</span></div><button class="btn" id="test-svc">Check now</button></div>
      </section>

      <section class="card" id="accessibility"><h2>Accessibility</h2>
        ${sel('defaultZoom', 'Default page zoom', [['-1', '83%'], ['-0.5', '91%'], ['0', '100%'], ['0.5', '110%'], ['1', '120%'], ['1.5', '131%'], ['2', '144%'], ['3', '173%']])}
        ${sw('reduceMotion', 'Reduce motion', 'Turns off animations in Nude.')}
      </section>

      <section class="card" id="shortcuts"><h2>Keyboard shortcuts</h2>
        <div class="kbd-grid">${info.shortcuts.map((k) => `<div>${esc(k.label)}</div><kbd>${esc(k.keys.replace(/Mod/g, info.platform === 'darwin' ? '⌘' : 'Ctrl'))}</kbd>`).join('')}</div></section>

      <section class="card" id="about"><h2>About Nude</h2>
        <div class="about"><span class="about-mark">${I.sparkle}</span><div><b>Nude Web Browser ${esc(info.version)}</b><div class="tiny">Chromium ${esc(info.chrome)} · Electron ${esc(info.electron)} · ${esc(info.platform)}</div></div></div>
        <div class="setting"><div class="text"><b>Default browser</b><span>${info.isDefault ? 'Nude is your default browser.' : 'Open links from other apps in Nude.'}</span></div>
          ${info.isDefault ? '<span class="pill ok">Default</span>' : '<button class="btn primary" id="make-default">Make default</button>'}</div>
      </section>
    </div></div>
    <dialog id="clear-dlg"><form method="dialog" id="clear-form"><h2>Clear browsing data</h2>
      <select id="range" style="width:100%;margin-bottom:10px"><option value="hour">Last hour</option><option value="day">Last 24 hours</option><option value="week">Last 7 days</option><option value="month">Last 4 weeks</option><option value="all" selected>All time</option></select>
      <label class="check"><input type="checkbox" id="c-history" checked>Browsing history</label>
      <label class="check"><input type="checkbox" id="c-cookies" checked>Cookies and site data <span class="tiny">— signs you out of most sites</span></label>
      <label class="check"><input type="checkbox" id="c-cache" checked>Cached images and files</label>
      <label class="check"><input type="checkbox" id="c-downloads">Download history <span class="tiny">— files stay on your computer</span></label>
      <label class="check"><input type="checkbox" id="c-perms">Site permissions</label>
      <div class="btns"><button class="btn" value="cancel">Cancel</button><button class="btn primary" value="ok">Clear data</button></div></form></dialog>`;
  void renderPerms();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  if (location.hash === '#privacy') $<HTMLDialogElement>('#clear-dlg').showModal();
}

async function renderPerms() {
  const perms = await api.invoke<{ origin: string; permission: string; decision: string; label: string }[]>('permissions.list');
  const box = document.getElementById('perms');
  if (!box) return;
  box.innerHTML = perms.length ? perms.map((p) => `<div class="setting"><div class="text"><b>${esc(p.origin)}</b><span>${esc(p.label)}</span></div>
    <select data-perm="${esc(p.origin)}|${esc(p.permission)}"><option value="allow" ${p.decision === 'allow' ? 'selected' : ''}>Allow</option><option value="block" ${p.decision === 'block' ? 'selected' : ''}>Block</option></select>
    <button class="icon-btn" data-revoke="${esc(p.origin)}|${esc(p.permission)}" title="Reset (ask again)">${I.close}</button></div>`).join('')
    : '<div class="muted">No sites have asked for permissions yet.</div>';
}

document.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  const key = t.dataset.key;
  if (key) {
    const v = t.type === 'checkbox' ? t.checked : key === 'defaultZoom' ? Number(t.value) : t.value.trim();
    void set({ [key]: v }).then(() => toast('Saved'));
  }
  if (t.dataset.toolbar) {
    const items = [...document.querySelectorAll<HTMLInputElement>('[data-toolbar]:checked')].map((x) => x.dataset.toolbar);
    void set({ toolbar: items });
  }
  if (t.dataset.perm) {
    const [origin, perm] = t.dataset.perm.split('|');
    void api.invoke('permissions.set', origin, perm, t.value);
  }
});
document.addEventListener('click', async (e) => {
  const t = e.target as HTMLElement;
  const seg = t.closest<HTMLElement>('[data-seg] button');
  if (seg) { await set({ [seg.closest<HTMLElement>('[data-seg]')!.dataset.seg!]: seg.dataset.v }); return; }
  const acc = t.closest<HTMLElement>('[data-accent]');
  if (acc) { await set({ accentColor: acc.dataset.accent }); return; }
  const level = t.closest<HTMLElement>('[data-level]');
  if (level) { await set({ protectionLevel: level.dataset.level }); toast(`${info.levels[level.dataset.level!].name} on`); return; }
  const rv = t.closest<HTMLElement>('[data-revoke]')?.dataset.revoke;
  if (rv) { const [o, p] = rv.split('|'); await api.invoke('permissions.revoke', o, p); return; }
  if (t.closest('#clear-btn')) $<HTMLDialogElement>('#clear-dlg').showModal();
  if (t.closest('#choose-dl')) { await api.invoke('settings.chooseDownloads'); }
  if (t.closest('#make-default')) { await api.invoke('settings.makeDefault'); void render(); }
  if (t.closest('#test-svc')) {
    $('#svc-status').textContent = 'Checking…';
    const r = await api.invoke<Record<string, string>>('services.test');
    $('#svc-status').textContent = `Search: ${r.search} · AI: ${r.ai} · Threat intel: ${r.threat}`;
  }
  const side = t.closest<HTMLAnchorElement>('.side a');
  if (side) { e.preventDefault(); document.querySelectorAll('.side a').forEach((a) => a.classList.toggle('on', a === side)); document.querySelector(side.getAttribute('href')!)?.scrollIntoView({ behavior: 'smooth' }); }
});
document.addEventListener('submit', async (e) => {
  if ((e.target as HTMLElement).id !== 'clear-form') return;
  if ($<HTMLDialogElement>('#clear-dlg').returnValue !== 'ok') return;
  const c = (id: string) => $<HTMLInputElement>(`#${id}`).checked;
  await api.invoke('clearData', { range: $<HTMLSelectElement>('#range').value, history: c('c-history'), cookies: c('c-cookies'), cache: c('c-cache'), downloads: c('c-downloads'), permissions: c('c-perms') });
  toast('Browsing data cleared');
});
on('settings', () => { const y = scrollY; void render().then(() => scrollTo(0, y)); });
on('permissions', renderPerms);
void render();
