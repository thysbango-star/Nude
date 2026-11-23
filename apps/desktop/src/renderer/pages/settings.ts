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
const PALETTE_CARDS: [string, string, string, string][] = [
  ['nude', 'Nude', 'linear-gradient(#e7e7ea,#e7e7ea)', '#e8742f'], ['glass', 'Liquid Glass', 'linear-gradient(160deg,#d7e3ff,#dff4ff)', '#2457ff'],
  ['lavender', 'Lavender', 'linear-gradient(120deg,#e3d6fb,#f8e6f3)', '#8f4fe8'], ['sunset', 'Sunset', 'linear-gradient(150deg,#fbd8bf,#fdf0e3)', '#e8742f'],
  ['forest', 'Forest', 'linear-gradient(160deg,#d6e8dc,#eef4ea)', '#2f8a57'], ['mono', 'Mono', 'linear-gradient(#f4f4f5,#f4f4f5)', '#18181b'],
];
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
      <a href="#ai">${I.sparkle}Nebula</a><a href="#hosting">${I.globe}Host Nude services</a><a href="#services">${I.globe}Nude services</a><a href="#accessibility">${I.info}Accessibility</a>
      <a href="#shortcuts">${I.keyboard}Shortcuts</a><a href="#about">${I.info}About Nude</a></nav>
    <div>
      <div class="page-head"><h1><span class="head-icon">${I.settings}</span>Settings</h1></div>

      <section class="card" id="appearance"><h2>Appearance</h2>
        <div class="setting"><div class="text"><b>Theme</b><span>Follows Nude OS / your system by default.</span></div>
          <div class="seg" data-seg="theme">${['system', 'light', 'dark'].map((t) => `<button data-v="${t}" class="${s.theme === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
        <div class="setting col"><div class="text"><b>Colour theme</b><span>Each one has a light and a dark version.</span></div>
          <div class="theme-cards" data-seg="palette">${PALETTE_CARDS.map(([id, name, frame, accent]) => `<button data-v="${id}" class="theme-card${s.palette === id ? ' on' : ''}" style="--f:${frame};--a:${accent}"><span class="tc-win"><i></i><i></i><b></b></span><span>${name}</span></button>`).join('')}</div></div>
        <div class="setting col"><div class="text"><b>Tabs</b><span>Across the top, or down the side with your pinned sites as tiles.</span></div>
          <div class="layout-cards" data-seg="tabLayout">
            <button data-v="horizontal" class="layout-card${s.tabLayout !== 'vertical' ? ' on' : ''}"><span class="lc lc-top"><i></i><i></i><i></i></span><span>Top</span></button>
            <button data-v="vertical" class="layout-card${s.tabLayout === 'vertical' ? ' on' : ''}"><span class="lc lc-side"><i></i><i></i><i></i></span><span>Side</span></button></div></div>
        ${sw('launchIntro', 'Opening animation', 'Plays the Nude logo animation when Nude starts. Skipped when Reduce motion is on.')}
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
        <div class="setting"><div class="text"><b>Your phone</b><span>Sign in to PassGate and see Rovian Defender's report on your phone.</span></div><a class="btn" href="nude://phone" data-open="nude://phone">Connect</a></div>
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
        ${sel('nebulaEngine', 'Where Nebula runs', [['auto', 'Automatic: Ollama on this computer, then Groq, then the Nebula gateway'], ['groq', 'Groq, the same engine as the Nebula app (your free Groq key)'], ['ollama', 'This computer (Ollama, free and private)'], ['gateway', 'Nebula gateway (set under Nude services)']])}
        <div id="groq-box"></div>
        <div id="ollama-box"></div>
        <p class="tiny">With Ollama, the AI runs on this computer: it's free, needs no key, and nothing you share leaves your computer. The gateway option uses a hosted model; its keys stay on the server, never in the browser.</p>
      </section>

      <section class="card" id="hosting"><h2>Host Nude services</h2>
        <p class="muted" style="margin-top:0">Run Nude Accounts on this computer, so your Nude IDs live on your own machine instead of someone else's server. Your phone and other computers sign in through it while this computer is on and Nude is open.</p>
        ${sw('hostEnabled', 'Host Nude Accounts on this computer', 'Your Nude ID on this computer moves to this server. Accounts made on another server don\'t come with it.')}
        ${info.settings.hostEnabled ? `${sel('hostAddress', 'How other devices reach it', [['quick', 'Cloudflare tunnel: a free public address, no domain needed (it changes when Nude restarts)'], ['own', 'My own address (a domain, Tailscale Funnel or ngrok pointing to port 8792)']])}
        ${info.settings.hostAddress === 'own' ? txt('hostOwnUrl', 'Your address', 'The public https address that reaches http://127.0.0.1:8792 on this computer.', 'https://accounts.example.com') : ''}
        <div id="host-box"></div>` : ''}
      </section>

      <section class="card" id="services"><h2>Nude services</h2>
        <p class="muted" style="margin-top:0">Addresses of the Nude Search, Nebula and threat-intelligence servers. Defaults point to servers running on this computer.</p>
        ${txt('searchServerUrl', 'Nude Search server', '', 'https://search.example.com')}
        ${info.settings.hostEnabled ? '' : txt('accountsServerUrl', 'Nude Accounts server', 'Where your Nude ID lives: the address shown in Host Nude services on the computer that hosts it.', 'https://….trycloudflare.com')}
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
  void renderOllama();
  void renderGroq();
  void renderHost();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  if (location.hash === '#privacy') $<HTMLDialogElement>('#clear-dlg').showModal();
}

interface LocalStatus {
  running: boolean; models: string[]; model: string | null; pulling: { model: string; percent: number; status: string } | null;
  share: { url: string; localUrl: string; token: string } | null; recommended: { name: string; size: string; note: string }[];
}

/** Ollama: is it running, which model, download one, share with phones. */
/** Groq: the Nebula app's engine. The key goes to Nude's main process, encrypted; only its last 4 characters come back. */
async function renderGroq() {
  const box = document.getElementById('groq-box');
  if (!box) return;
  const g = await api.invoke<{ hasKey: boolean; hint: string | null }>('nebula.groq');
  box.innerHTML = g.hasKey
    ? `<div class="setting"><div class="text"><b>Groq key added (${esc(g.hint ?? '')})</b><span>Nebula in Nude answers with the same Groq models as the Nebula app. Use the same key in Nebula on your phone. The key stays encrypted on this computer and is only sent to Groq.</span></div>
        <span class="pill ok">Ready</span><button class="btn" data-groq-remove>Remove</button></div>`
    : `<div class="setting"><div class="text"><b>Groq key</b><span>Paste the free key you use in the Nebula app (console.groq.com → API Keys). It stays encrypted on this computer and is only sent to Groq.</span><span id="groq-msg" class="err-line"></span></div>
        <input class="input" id="groq-key" type="password" autocomplete="off" spellcheck="false" placeholder="gsk_…" style="min-width:240px"><button class="btn primary" data-groq-save>Add key</button></div>`;
}

interface HostStatus { state: string; publicUrl: string | null; localUrl: string; message: string; accounts: number | null }
/** Hosting: live status, the address to give your phone, and how many Nude IDs this computer holds. */
async function renderHost() {
  const box = document.getElementById('host-box');
  if (!box) return;
  const h = await api.invoke<HostStatus>('host.status');
  const pill = h.state === 'online' ? '<span class="pill ok">Online</span>' : h.state === 'error' ? '<span class="pill warn">Problem</span>'
    : h.state === 'local-only' ? '<span class="pill warn">This computer only</span>' : '<span class="pill">Starting…</span>';
  box.innerHTML = `<div class="setting"><div class="text"><b>Status</b><span>${esc(h.message)}${h.accounts !== null ? ` · ${h.accounts} Nude ID${h.accounts === 1 ? '' : 's'} on this computer` : ''}</span></div>${pill}</div>
    ${h.publicUrl ? `<div class="setting"><div class="text"><b>Address for your phone and other computers</b><span><code>${esc(h.publicUrl)}</code> — signed in here, open Account → Connect your phone and scan the code in Nude Companion; it carries this address. Or type it in the Nude app under Settings → Nude Accounts server.</span></div>
      <button class="btn" data-copy-host="${esc(h.publicUrl)}">Copy</button></div>` : ''}`;
}

async function renderOllama() {
  const box = document.getElementById('ollama-box');
  if (!box) return;
  if (info.settings.nebulaEngine === 'gateway') { box.innerHTML = ''; return; }
  const st = await api.invoke<LocalStatus>('nebula.local');
  if (!st.running) {
    box.innerHTML = `<div class="setting"><div class="text"><b>Ollama isn't running</b><span>Install it free from ollama.com, open it, then come back here. Nebula will find it automatically.</span></div>
      <button class="btn" data-ollama-refresh>Check again</button></div>`;
    return;
  }
  const pull = st.pulling
    ? `<div class="setting"><div class="text"><b>Downloading ${esc(st.pulling.model)} — ${st.pulling.percent}%</b><span>${esc(st.pulling.status)}</span>
        <div class="progress"><i style="width:${st.pulling.percent}%"></i></div></div><button class="btn" data-ollama-cancel>Cancel</button></div>` : '';
  const options = [...new Set([...st.models.filter((m) => !/embed/i.test(m))])];
  const missing = st.recommended.filter((r) => !st.models.includes(r.name));
  box.innerHTML = `
    <div class="setting"><div class="text"><b>Ollama is running</b><span>${st.model ? `Nebula is using ${esc(st.model)} on this computer.` : 'Download a model below to start.'}</span></div>
      <span class="pill ${st.model ? 'ok' : 'warn'}">${st.model ? 'Ready' : 'No model yet'}</span></div>
    ${options.length ? `<div class="setting"><div class="text"><b>Model</b><span>Bigger models are smarter but slower.</span></div>
      <select data-key="ollamaModel"><option value="">Best installed (${esc(st.model ?? '')})</option>${options.map((m) => `<option value="${esc(m)}" ${info.settings.ollamaModel === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>` : ''}
    ${pull}
    ${!st.pulling ? missing.map((r) => `<div class="setting"><div class="text"><b>${esc(r.name)} <span class="tiny">${esc(r.size)}</span></b><span>${esc(r.note)}</span></div>
      <button class="btn${!st.model && r === missing[0] ? ' primary' : ''}" data-ollama-pull="${esc(r.name)}">Download</button></div>`).join('') : ''}
    ${sw('nebulaShareOnNetwork', 'Let my phone use this computer\'s Nebula', 'For Nude on Android or iPhone on the same Wi-Fi. Only devices with the access code below can use it.')}
    ${st.share ? `<div class="setting"><div class="text"><b>On your phone</b><span>Settings → Nude services → <i>Nebula gateway</i>: <code class="sel">${esc(st.share.url)}</code> (Android) or <code class="sel">${esc(st.share.localUrl)}</code> (iPhone, iPad)<br>
      <i>Access token</i>: <code class="sel">${esc(st.share.token)}</code></span></div>
      <button class="btn" data-copy-share="${esc(st.share.url)}|${esc(st.share.token)}">Copy</button><button class="btn" data-reset-token title="Phones using the old code will need the new one">New code</button></div>` : ''}`;
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
  const pullModel = t.closest<HTMLElement>('[data-ollama-pull]')?.dataset.ollamaPull;
  if (pullModel) { await api.invoke('nebula.pull', pullModel); void renderOllama(); return; }
  if (t.closest('[data-ollama-cancel]')) { await api.invoke('nebula.cancelPull'); return; }
  if (t.closest('[data-ollama-refresh]')) { void renderOllama(); return; }
  if (t.closest('[data-groq-remove]')) { await api.invoke('nebula.groqRemove'); void renderGroq(); return; }
  if (t.closest('[data-groq-save]')) {
    const input = document.getElementById('groq-key') as HTMLInputElement;
    const msg = document.getElementById('groq-msg')!;
    msg.textContent = 'Checking the key with Groq…';
    const r = await api.invoke<{ ok: boolean; error?: string; model?: string }>('nebula.groqSet', input.value);
    input.value = '';
    if (r.ok) { void renderGroq(); void render(); } else msg.textContent = r.error ?? 'That key didn\'t work.';
    return;
  }
  const hostUrl = t.closest<HTMLElement>('[data-copy-host]')?.dataset.copyHost;
  if (hostUrl) { await navigator.clipboard.writeText(hostUrl).catch(() => {}); toast('Copied'); return; }
  if (t.closest('[data-reset-token]')) { await api.invoke('nebula.resetToken'); toast('New access code made'); return; }
  const share = t.closest<HTMLElement>('[data-copy-share]')?.dataset.copyShare;
  if (share) { const [u, k] = share.split('|'); await navigator.clipboard.writeText(`Nebula gateway: ${u}\nAccess token: ${k}`).catch(() => {}); toast('Copied'); return; }
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
on('nebula', () => { void renderOllama(); void renderGroq(); });
on('host', () => { void renderHost(); });
void render();
