import { api, $, esc, I, toast } from './common';

interface Acc { id: string; name: string; firstName: string; email: string; color: string; photo?: string; initials: string }

async function render() {
  const info = await api.invoke<{ current: Acc | null }>('account.get');
  const a = info.current;
  if (!a) {
    $('#root').innerHTML = `<div class="page"><div class="empty"><div class="ei">${I.user}</div><h3>You're not signed in</h3><div>Sign in so Nude can greet you by name.</div><p><a class="btn primary" href="nude://welcome" data-open="nude://welcome/">Sign in</a></p></div></div>`;
    return;
  }
  $('#root').innerHTML = `<div class="page">
    <div class="profile">
      <label class="big-av" style="background:${esc(a.color)}" title="Change photo">${a.photo ? `<img src="${esc(a.photo)}" alt="">` : esc(a.initials)}<input type="file" id="photo" accept="image/png,image/jpeg,image/webp" hidden><span class="cam">${I.camera}</span></label>
      <div><h1>${esc(a.name)}</h1><div class="muted">${esc(a.email)}</div></div>
    </div>
    <section class="card"><h2>Profile</h2>
      <div class="setting"><div class="text"><b>Name</b><span>Nude greets you with this on the home page.</span></div><input class="input" id="name" value="${esc(a.name)}" maxlength="80"><button class="btn" id="save-name">Save</button></div>
      ${a.photo ? '<div class="setting"><div class="text"><b>Photo</b></div><button class="btn" id="rm-photo">Remove photo</button></div>' : ''}
    </section>
    <section class="card"><h2>Password</h2>
      <div class="setting"><div class="text"><b>Change password</b></div>
        <input class="input" id="old" type="password" placeholder="Current password" autocomplete="current-password">
        <input class="input" id="new" type="password" placeholder="New password (8+ characters)" autocomplete="new-password">
        <button class="btn" id="save-pw">Change</button></div>
    </section>
    <section class="card"><h2>Account</h2>
      <p class="muted" style="margin-top:0">Your Nude account is stored on this device, with your password kept only as a secure hash. Signing in on other devices will come with Nude Sync.</p>
      <div class="setting"><div class="text"><b>Sign out</b><span>Your bookmarks and history stay on this device.</span></div><button class="btn" id="signout">Sign out</button></div>
      <div class="setting"><div class="text"><b>Delete account</b><span>Removes the account from this device.</span></div><button class="btn danger" id="delete">Delete…</button></div>
    </section></div>
    <dialog id="del-dlg"><form method="dialog" id="del-form"><h2>Delete your Nude account?</h2>
      <p class="muted">This removes the account from this device. Enter your password to confirm.</p>
      <input class="input" id="del-pw" type="password" autocomplete="current-password" style="width:100%">
      <div class="btns"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn danger" value="ok">Delete account</button></div></form></dialog>`;
  $('#save-name').onclick = async () => { await api.invoke('account.update', { name: $<HTMLInputElement>('#name').value }); toast('Saved'); void render(); };
  document.getElementById('rm-photo')?.addEventListener('click', async () => { await api.invoke('account.update', { photo: null }); void render(); });
  $('#photo').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const url = await shrink(f);
    await api.invoke('account.update', { photo: url });
    void render();
  });
  $('#save-pw').onclick = async () => {
    const r = await api.invoke<{ ok: boolean; error?: string }>('account.password', $<HTMLInputElement>('#old').value, $<HTMLInputElement>('#new').value);
    toast(r.ok ? 'Password changed' : r.error ?? 'Couldn\'t change password');
  };
  $('#signout').onclick = async () => { await api.invoke('account.signOut'); void api.invoke('open', 'nude://welcome/'); };
  $('#delete').onclick = () => $<HTMLDialogElement>('#del-dlg').showModal();
  $('#del-form').addEventListener('submit', async () => {
    if ($<HTMLDialogElement>('#del-dlg').returnValue !== 'ok') return;
    const r = await api.invoke<{ ok: boolean; error?: string }>('account.delete', $<HTMLInputElement>('#del-pw').value);
    if (r.ok) void api.invoke('open', 'nude://welcome/'); else toast(r.error ?? 'Couldn\'t delete');
  });
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
