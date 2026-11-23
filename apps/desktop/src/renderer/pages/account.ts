import { api, $, esc, I, toast } from './common';

interface Acc { id: string; name: string; firstName: string; username: string; nudeId: string; color: string; photo?: string; initials: string; created: number; lastSignIn: number }
interface Device { id: string; name: string; platform: string; app: string; created: number; lastSeen: number; ip: string | null; current: boolean }
interface Ev { t: number; kind: string; detail: string; device: string | null; ip: string | null }
type R<T> = ({ ok: true } & T) | { ok: false; error: string; code?: string };

const APP_NAMES: Record<string, string> = { browser: 'Nude browser', companion: 'Nude Companion', passgate: 'PassGate', nebula: 'Nebula', web: 'Web browser', other: 'App' };
const when = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
const av = (a: { photo?: string; initials: string; color: string }, cls = 'mini-av') =>
  `<span class="${cls}" style="background:${esc(a.color)}">${a.photo ? `<img src="${esc(a.photo)}" alt="">` : esc(a.initials)}</span>`;

async function render() {
  const info = await api.invoke<{ current: Acc | null; all: Acc[]; server: string }>('account.get');
  const a = info.current;
  if (!a) {
    $('#root').innerHTML = `<div class="page"><div class="empty"><div class="ei">${I.user}</div><h3>You're not signed in</h3><div>Sign in with your Nude ID to see your account, devices and security.</div><p><a class="btn primary" href="nude://welcome" data-open="nude://welcome/#signin">Sign in</a></p></div></div>`;
    return;
  }
  const others = info.all.filter((x) => x.id !== a.id);
  $('#root').innerHTML = `<div class="page">
    <div class="profile">
      <label class="big-av" style="background:${esc(a.color)}" title="Change picture">${a.photo ? `<img src="${esc(a.photo)}" alt="">` : esc(a.initials)}<input type="file" id="photo" accept="image/png,image/jpeg,image/webp" hidden><span class="cam">${I.camera}</span></label>
      <div><h1>${esc(a.name)}</h1><div class="nude-id-line">${esc(a.nudeId)}</div><div class="muted small">Nude ID since ${esc(new Date(a.created).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</div></div>
    </div>
    <div id="banner" class="banner" hidden></div>

    <section class="card"><h2>Your phone</h2>
      <div class="setting"><div class="text"><b>Sign in to Nude Companion</b><span>Scan a code with Nude Companion to manage your Nude ID from your phone. You'll approve the phone here before it's signed in.</span></div><button class="btn primary" id="link-phone">Show code</button></div>
      <div class="setting"><div class="text"><b>PassGate and Rovian Defender</b><span>Link PassGate (your passwords) or Rovian Defender (this PC's protection report) on your phone.</span></div><button class="btn" id="phone-page">Open</button></div>
    </section>

    <section class="card"><h2>Profile</h2>
      <div class="setting"><div class="text"><b>Name</b><span>Shown in Nude, Nude Companion and on sites you sign in to with Nude.</span></div><input class="input" id="name" value="${esc(a.name)}" maxlength="60"><button class="btn" id="save-name">Save</button></div>
      ${a.photo ? '<div class="setting"><div class="text"><b>Picture</b><span>Click your picture above to change it.</span></div><button class="btn" id="rm-photo">Remove picture</button></div>' : '<div class="setting"><div class="text"><b>Picture</b><span>Click the circle above to add a profile picture.</span></div></div>'}
    </section>

    <section class="card"><h2>Devices</h2><p class="muted small" style="margin-top:-4px">Everywhere your Nude ID is signed in. Sign out anything you don't recognise, then change your password.</p><div id="devices" class="list"><div class="muted small">Loading…</div></div></section>

    <section class="card"><h2>Sites using Sign in with Nude</h2><div id="apps" class="list"><div class="muted small">Loading…</div></div></section>

    <section class="card"><h2>Security</h2>
      <div class="setting"><div class="text"><b>Change password</b><span>Every other device is signed out when you change it.</span></div>
        <input class="input" id="old" type="password" placeholder="Current password" autocomplete="current-password">
        <input class="input" id="new" type="password" placeholder="New password (10+ characters)" autocomplete="new-password">
        <button class="btn" id="save-pw">Change</button></div>
      <h3 class="sub">Recent activity</h3><div id="events" class="list"><div class="muted small">Loading…</div></div>
    </section>

    <section class="card"><h2>Nude IDs on this computer</h2>
      ${others.map((x) => `<div class="setting">${av(x)}<div class="text"><b>${esc(x.name)}</b><span>${esc(x.nudeId)}</span></div><button class="btn" data-switch="${esc(x.id)}">Switch</button><button class="btn" data-remove="${esc(x.id)}">Remove</button></div>`).join('')}
      <div class="setting"><div class="text"><b>Add another Nude ID</b><span>Keep personal and work side by side and switch between them.</span></div><button class="btn" id="add">Add</button></div>
      <div class="setting"><div class="text"><b>Sign out</b><span>Your bookmarks and history stay on this computer.</span></div><button class="btn" id="signout">Sign out</button></div>
      <div class="setting"><div class="text"><b>Delete Nude ID</b><span>Deletes ${esc(a.nudeId)} everywhere. This can't be undone.</span></div><button class="btn danger" id="delete">Delete…</button></div>
    </section></div>

    <dialog id="del-dlg"><form method="dialog" id="del-form"><h2>Delete ${esc(a.nudeId)}?</h2>
      <p class="muted">Your Nude ID, devices and synced data are deleted from Nude Accounts. Enter your password to confirm.</p>
      <input class="input" id="del-pw" type="password" autocomplete="current-password" style="width:100%">
      <div class="btns"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn danger" value="ok">Delete Nude ID</button></div></form></dialog>

    <dialog id="link-dlg" class="link-dlg"><div id="link-body"></div><div class="btns"><button class="btn" id="link-close">Close</button></div></dialog>`;

  void api.invoke<R<{ persistent: boolean }>>('account.refresh').then((r) => {
    const b = $('#banner');
    if (!r.ok) { b.textContent = r.code === 'offline' ? r.error : r.error; b.hidden = false; if (r.code === 'signed_out') setTimeout(() => void render(), 1200); return; }
    if (r.persistent === false) { b.textContent = 'Nude Accounts is in test mode: Nude IDs are deleted when its server restarts.'; b.hidden = false; }
  });
  void loadDevices(); void loadApps(); void loadEvents();

  document.getElementById('phone-page')?.addEventListener('click', () => void api.invoke('open', 'nude://phone/'));
  $('#link-phone').addEventListener('click', () => void linkPhone());
  $('#save-name').onclick = async () => {
    const r = await api.invoke<R<object>>('account.rename', $<HTMLInputElement>('#name').value);
    toast(r.ok ? 'Saved' : r.error); if (r.ok) void render();
  };
  document.getElementById('rm-photo')?.addEventListener('click', async () => { const r = await api.invoke<R<object>>('account.removePhoto'); if (!r.ok) toast(r.error); void render(); });
  $('#photo').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    toast('Uploading…');
    const r = await api.invoke<R<object>>('account.photo', new Uint8Array(await f.arrayBuffer()));
    toast(r.ok ? 'Picture updated' : r.error);
    void render();
  });
  $('#save-pw').onclick = async () => {
    const r = await api.invoke<R<{ signedOut: number }>>('account.password', $<HTMLInputElement>('#old').value, $<HTMLInputElement>('#new').value);
    toast(r.ok ? `Password changed${r.signedOut ? `; ${r.signedOut} other device${r.signedOut === 1 ? '' : 's'} signed out` : ''}` : r.error);
    if (r.ok) { $<HTMLInputElement>('#old').value = ''; $<HTMLInputElement>('#new').value = ''; void loadDevices(); }
  };
  document.querySelectorAll<HTMLElement>('[data-switch]').forEach((b) => b.addEventListener('click', async () => {
    const r = await api.invoke<{ ok: boolean; error?: string }>('account.switch', b.dataset.switch);
    if (r.ok) { toast('Switched'); void render(); } else void api.invoke('open', 'nude://welcome/#signin');
  }));
  document.querySelectorAll<HTMLElement>('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    if (!b.classList.contains('confirm')) { b.classList.add('confirm'); b.textContent = 'Click again'; return; }
    await api.invoke('account.remove', b.dataset.remove); toast('Removed from this computer'); void render();
  }));
  $('#add').onclick = () => void api.invoke('open', 'nude://welcome/#signin');
  $('#signout').onclick = async () => { await api.invoke('account.signOut'); void api.invoke('open', 'nude://welcome/#signin'); };
  $('#delete').addEventListener('click', () => $<HTMLDialogElement>('#del-dlg').showModal());
  $('#del-form').addEventListener('submit', async () => {
    if ($<HTMLDialogElement>('#del-dlg').returnValue !== 'ok') return;
    const r = await api.invoke<R<object>>('account.delete', $<HTMLInputElement>('#del-pw').value);
    if (r.ok) void api.invoke('open', 'nude://welcome/'); else toast(r.error);
  });
}

async function loadDevices() {
  const r = await api.invoke<R<{ sessions: Device[] }>>('account.devices');
  const box = $('#devices');
  if (!r.ok) { box.innerHTML = `<div class="muted small">${esc(r.error)}</div>`; return; }
  box.innerHTML = r.sessions.map((d) => `<div class="row">
    <span class="dev-ico">${d.app === 'browser' || d.app === 'web' ? I.globe : I.phone}</span>
    <div class="text"><b>${esc(d.name)}${d.current ? ' <span class="pill ok">This computer</span>' : ''}</b>
    <span>${esc(APP_NAMES[d.app] ?? d.app)}${d.platform ? ` · ${esc(d.platform)}` : ''} · active ${esc(when(d.lastSeen))}${d.ip ? ` · ${esc(d.ip)}` : ''}</span></div>
    ${d.current ? '' : `<button class="btn" data-revoke="${esc(d.id)}">Sign out</button>`}</div>`).join('');
  box.querySelectorAll<HTMLElement>('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
    const x = await api.invoke<R<object>>('account.revoke', b.dataset.revoke);
    toast(x.ok ? 'Signed out' : x.error); void loadDevices(); void loadEvents();
  }));
}

async function loadApps() {
  const r = await api.invoke<R<{ apps: { id: string; name: string; t: number }[] }>>('account.apps');
  const box = $('#apps');
  if (!r.ok) { box.innerHTML = `<div class="muted small">${esc(r.error)}</div>`; return; }
  box.innerHTML = r.apps.length ? r.apps.map((x) => `<div class="row"><div class="text"><b>${esc(x.name)}</b><span>Last used ${esc(when(x.t))}</span></div><button class="btn" data-app="${esc(x.id)}">Remove access</button></div>`).join('')
    : '<div class="muted small">No sites yet. When a site offers Sign in with Nude and you use it, it shows here.</div>';
  box.querySelectorAll<HTMLElement>('[data-app]').forEach((b) => b.addEventListener('click', async () => { await api.invoke('account.removeApp', b.dataset.app); void loadApps(); }));
}

async function loadEvents() {
  const r = await api.invoke<R<{ events: Ev[] }>>('account.events');
  const box = $('#events');
  if (!r.ok) { box.innerHTML = `<div class="muted small">${esc(r.error)}</div>`; return; }
  const bad = (k: string) => /failed|denied/.test(k);
  box.innerHTML = r.events.slice(0, 25).map((e) => `<div class="row ev${bad(e.kind) ? ' bad' : ''}"><span class="dot"></span><div class="text"><b>${esc(e.detail)}</b><span>${esc(when(e.t))}${e.device ? ` · ${esc(e.device)}` : ''}${e.ip ? ` · ${esc(e.ip)}` : ''}</span></div></div>`).join('')
    || '<div class="muted small">Nothing yet.</div>';
}

/** Shows the Nude Companion code, then asks you to approve the phone that scanned it. */
async function linkPhone() {
  const dlg = $<HTMLDialogElement>('#link-dlg');
  const body = $('#link-body');
  let stop = false;
  const close = () => { stop = true; dlg.close(); };
  $('#link-close').onclick = close;
  dlg.addEventListener('close', () => { stop = true; }, { once: true });
  body.innerHTML = '<h2>Sign in on your phone</h2><p class="muted">Making a code…</p>';
  dlg.showModal();
  const r = await api.invoke<R<{ id: string; expires: number; svg: string }>>('account.linkStart');
  if (!r.ok) { body.innerHTML = `<h2>Sign in on your phone</h2><p class="err-text">${esc(r.error)}</p>`; return; }
  body.innerHTML = `<h2>Scan with Nude Companion</h2><p class="muted">Open Nude Companion on your phone and tap <b>Scan code</b>.</p><div class="qr">${r.svg}</div><p class="muted small" id="link-left"></p>`;
  while (!stop) {
    const left = Math.max(0, Math.round((r.expires - Date.now()) / 1000));
    const el = document.getElementById('link-left'); if (el) el.textContent = left ? `This code works once and expires in ${left} s.` : '';
    const s = await api.invoke<R<{ state: string; device: { name: string; platform: string; app: string } | null }>>('account.linkState', r.id);
    if (stop) return;
    if (!s.ok || s.state === 'expired' || left === 0) { body.innerHTML = '<h2>The code expired</h2><p class="muted">Show a new code to try again.</p>'; return; }
    if (s.state === 'claimed' && s.device) {
      const d = s.device;
      body.innerHTML = `<h2>Sign in ${esc(d.name)}?</h2><p class="muted">${esc(d.name)}${d.platform ? ` (${esc(d.platform)})` : ''} scanned your code and wants to sign in to your Nude ID with ${esc(APP_NAMES[d.app] ?? d.app)}. Only allow it if that's your phone, in your hand.</p>
        <div class="btns"><button class="btn" id="deny">Don't allow</button><button class="btn primary" id="allow">Allow</button></div>`;
      const decide = async (yes: boolean) => {
        const x = await api.invoke<R<{ state: string }>>('account.linkDecide', r.id, yes);
        body.innerHTML = x.ok && yes ? `<h2>${esc(d.name)} is signed in</h2><p class="muted">You can sign it out any time under Devices.</p>` : '<h2>Not allowed</h2><p class="muted">The phone wasn\'t signed in.</p>';
        void loadDevices(); void loadEvents();
      };
      $('#allow').onclick = () => void decide(true);
      $('#deny').onclick = () => void decide(false);
      return;
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
}

void render();
