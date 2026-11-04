import { api, $, esc, I, toast } from './common';

interface Acc { id: string; name: string; firstName: string; email: string; color: string; photo?: string; initials: string; provider: 'local' | 'rovian'; rovianId?: string | null; username?: string | null; lastSignIn?: number }

async function render() {
  const info = await api.invoke<{ current: Acc | null; all: Acc[] }>('account.get');
  const result = await api.invoke<{ ok: boolean; message: string } | null>('account.rovianResult');
  if (result) toast(result.message);
  const a = info.current;
  if (!a) {
    $('#root').innerHTML = `<div class="page"><div class="empty"><div class="ei">${I.user}</div><h3>You're not signed in</h3><div>Sign in so Nude can greet you by name.</div><p><a class="btn primary" href="nude://welcome" data-open="nude://welcome/">Sign in</a></p></div></div>`;
    return;
  }
  $('#root').innerHTML = `<div class="page">
    <div class="profile">
      <label class="big-av" style="background:${esc(a.color)}" title="Change photo">${a.photo ? `<img src="${esc(a.photo)}" alt="">` : esc(a.initials)}<input type="file" id="photo" accept="image/png,image/jpeg,image/webp" hidden><span class="cam">${I.camera}</span></label>
      <div><h1>${esc(a.name)}</h1><div class="muted">${esc(a.provider === 'rovian' ? (a.rovianId ?? a.email) : a.email)}</div></div>
    </div>
    <section class="card"><h2 class="rv-h"><img src="rovian-mark.svg" alt="">Rovian Account</h2>
      ${a.provider === 'rovian' ? `
      <div class="setting"><div class="text"><b>${esc(a.rovianId ?? a.email)}</b><span>Signed in with Rovian${a.lastSignIn ? ` · last sign-in ${esc(new Date(a.lastSignIn).toLocaleString())}` : ''}. Nude keeps your verified name, email and Rovian ID — not your Rovian password or sign-in tokens.</span></div><span class="pill ok">Verified</span></div>
      ${a.email && a.rovianId ? `<div class="setting"><div class="text"><b>Email</b><span>${esc(a.email)}</span></div></div>` : ''}`
      : `<div class="setting"><div class="text"><b>Connect your Rovian Account</b><span>Use your Rovian ID (name@rovian.cloud) with Nude. You'll approve it on Rovian's own page.</span></div><button class="btn primary" id="link-rovian">Continue with Rovian</button></div>`}
      ${others(info.all, a)}
      <div class="setting"><div class="text"><b>Add another Rovian account</b><span>Keep work and personal accounts side by side and switch between them.</span></div><button class="btn" id="add-rovian">Add account</button></div>
    </section>
    <section class="card"><h2>Profile</h2>
      <div class="setting"><div class="text"><b>Name</b><span>Nude greets you with this on the home page.</span></div><input class="input" id="name" value="${esc(a.name)}" maxlength="80"><button class="btn" id="save-name">Save</button></div>
      ${a.photo ? '<div class="setting"><div class="text"><b>Photo</b></div><button class="btn" id="rm-photo">Remove photo</button></div>' : ''}
    </section>
    ${a.provider === 'rovian' && !a.email ? '' : ''}<section class="card" ${a.provider === 'rovian' ? 'hidden' : ''}><h2>Password</h2>
      <div class="setting"><div class="text"><b>Change password</b></div>
        <input class="input" id="old" type="password" placeholder="Current password" autocomplete="current-password">
        <input class="input" id="new" type="password" placeholder="New password (8+ characters)" autocomplete="new-password">
        <button class="btn" id="save-pw">Change</button></div>
    </section>
    <section class="card"><h2>Account</h2>
      <p class="muted" style="margin-top:0">Your Nude account is stored on this device, with your password kept only as a secure hash. Signing in on other devices will come with Nude Sync.</p>
      <div class="setting"><div class="text"><b>Sign out</b><span>Your bookmarks and history stay on this device.</span></div><button class="btn" id="signout">Sign out</button></div>
      ${a.provider === 'rovian'
        ? `<div class="setting"><div class="text"><b>Remove from this device</b><span>Nude forgets this Rovian account here. It stays in your Rovian Account, and you can sign in again anytime.</span></div><button class="btn danger" data-forget="${esc(a.id)}">Remove</button></div>`
        : '<div class="setting"><div class="text"><b>Delete account</b><span>Removes the account from this device.</span></div><button class="btn danger" id="delete">Delete…</button></div>'}
    </section></div>
    <dialog id="del-dlg"><form method="dialog" id="del-form"><h2>Delete your Nude account?</h2>
      <p class="muted">This removes the account from this device. Enter your password to confirm.</p>
      <input class="input" id="del-pw" type="password" autocomplete="current-password" style="width:100%">
      <div class="btns"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn danger" value="ok">Delete account</button></div></form></dialog>`;
  const startRovian = async (purpose: 'signin' | 'link') => {
    const r = await api.invoke<{ ok: boolean; error?: string }>('account.rovian', purpose);
    if (!r.ok) toast(r.error ?? 'Couldn\'t start signing in with Rovian.');
  };
  document.getElementById('link-rovian')?.addEventListener('click', () => void startRovian('signin'));
  document.getElementById('add-rovian')?.addEventListener('click', () => void startRovian('link'));
  document.querySelectorAll<HTMLElement>('[data-switch]').forEach((b) => b.addEventListener('click', async () => {
    const r = await api.invoke<{ ok: boolean; error?: string }>('account.switch', b.dataset.switch);
    if (r.ok) { toast('Switched account'); void render(); } else if (r.error === 'password') void api.invoke('open', 'nude://welcome/'); else toast(r.error ?? 'Couldn\'t switch');
  }));
  document.querySelectorAll<HTMLElement>('[data-forget]').forEach((b) => b.addEventListener('click', async () => {
    if (!b.classList.contains('confirm')) { b.classList.add('confirm'); b.textContent = 'Tap again to remove'; return; }
    await api.invoke('account.forgetRovian', b.dataset.forget);
    toast('Removed from this device');
    const now = await api.invoke<{ current: Acc | null }>('account.get');
    if (!now.current) void api.invoke('open', 'nude://welcome/'); else void render();
  }));
  $('#save-name').onclick = async () => { await api.invoke('account.update', { name: $<HTMLInputElement>('#name').value }); toast('Saved'); void render(); };
  document.getElementById('rm-photo')?.addEventListener('click', async () => { await api.invoke('account.update', { photo: null }); void render(); });
  $('#photo').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const url = await shrink(f);
    await api.invoke('account.update', { photo: url });
    void render();
  });
  document.getElementById('save-pw')!.onclick = async () => {
    const r = await api.invoke<{ ok: boolean; error?: string }>('account.password', $<HTMLInputElement>('#old').value, $<HTMLInputElement>('#new').value);
    toast(r.ok ? 'Password changed' : r.error ?? 'Couldn\'t change password');
  };
  $('#signout').onclick = async () => { await api.invoke('account.signOut'); void api.invoke('open', 'nude://welcome/'); };
  document.getElementById('delete')?.addEventListener('click', () => $<HTMLDialogElement>('#del-dlg').showModal());
  $('#del-form').addEventListener('submit', async () => {
    if ($<HTMLDialogElement>('#del-dlg').returnValue !== 'ok') return;
    const r = await api.invoke<{ ok: boolean; error?: string }>('account.delete', $<HTMLInputElement>('#del-pw').value);
    if (r.ok) void api.invoke('open', 'nude://welcome/'); else toast(r.error ?? 'Couldn\'t delete');
  });
}

/** Other accounts on this device, to switch to. */
function others(all: Acc[], cur: Acc) {
  const list = all.filter((x) => x.id !== cur.id);
  if (!list.length) return '';
  return list.map((x) => `<div class="setting"><span class="mini-av" style="background:${esc(x.color)}">${x.photo ? `<img src="${esc(x.photo)}" alt="">` : esc(x.initials)}</span>
    <div class="text"><b>${esc(x.name)}</b><span>${esc(x.provider === 'rovian' ? (x.rovianId ?? x.email) : x.email)}${x.provider === 'rovian' ? ' · Rovian' : ' · Nude account'}</span></div>
    <button class="btn" data-switch="${esc(x.id)}">Switch</button>${x.provider === 'rovian' ? `<button class="btn" data-forget="${esc(x.id)}">Remove</button>` : ''}</div>`).join('');
}

/** Resizes a photo to 256px so it stays small. */
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = 256;
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const ctx = c.getContext('2d')!;
      const m = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, s, s);
      resolve(c.toDataURL('image/jpeg', 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
void render();
