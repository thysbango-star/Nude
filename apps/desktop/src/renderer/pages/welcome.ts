import { api, $, esc } from './common';

interface Acc { id: string; name: string; firstName: string; email: string; color: string; photo?: string; initials: string }

const WORDS = ['A NEW GENERATION', 'OF BROWSING', 'PRIVATE BY DESIGN', 'INDEPENDENT SEARCH', 'MEET NEBULA', 'ROVIAN DEFENDER', 'MADE FOR NUDE OS', 'FAST. CALM. YOURS.'];

async function render(mode: 'signin' | 'signup' = 'signup') {
  const info = await api.invoke<{ current: Acc | null; all: Acc[]; needsWelcome: boolean }>('account.get');
  if (info.all.length && mode === 'signup' && !location.hash.includes('new')) mode = 'signin';
  const rows = [0, 1, 2, 3, 4, 5].map((r) => {
    const words = [...WORDS.slice(r), ...WORDS.slice(0, r)].join('  ·  ');
    return `<div class="k-row ${r % 2 ? 'rev' : ''}" style="animation-duration:${38 + r * 6}s"><span>${words}  ·  ${words}  ·  </span></div>`;
  }).join('');
  $('#root').innerHTML = `
    <div class="kinetic" aria-hidden="true">${rows}</div>
    <div class="glow" aria-hidden="true"></div>
    <main class="welcome">
      <div class="card">
        <img class="logo" src="nude-logo.svg" alt="Nude">
        <h1>${mode === 'signin' ? 'Welcome back' : 'Welcome to Nude'}</h1>
        <p class="lead">${mode === 'signin' ? 'Sign in to pick up where you left off.' : 'Create your Nude account so your browser knows you.'}</p>
        ${info.all.length && mode === 'signin' ? `<div class="known">${info.all.map((a) => `<button class="known-acc" data-email="${esc(a.email)}"><span class="av" style="background:${esc(a.color)}">${a.photo ? `<img src="${esc(a.photo)}" alt="">` : esc(a.initials)}</span><span><b>${esc(a.name)}</b><small>${esc(a.email)}</small></span></button>`).join('')}</div>` : ''}
        <form id="f" autocomplete="on" novalidate>
          ${mode === 'signup' ? '<label>Your name<input id="name" autocomplete="name" required maxlength="80" placeholder="e.g. Simon"></label>' : ''}
          <label>Email<input id="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>
          <label>Password<input id="pw" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" required minlength="8" placeholder="${mode === 'signup' ? 'At least 8 characters' : ''}"></label>
          <div id="err" class="err" role="alert" hidden></div>
          <button class="btn primary big" id="go">${mode === 'signin' ? 'Sign in' : 'Create account'}</button>
        </form>
        <div class="switch-line">${mode === 'signin' ? 'New to Nude? <button class="link" data-mode="signup">Create an account</button>' : (info.all.length ? 'Already have an account? <button class="link" data-mode="signin">Sign in</button>' : '')}</div>
        ${info.needsWelcome ? '<button class="link muted-link" id="guest">Continue without an account</button>' : ''}
        <p class="fine">Your account is stored securely on this device — your password is never saved in plain text. Syncing across devices is coming with Nude Sync.</p>
      </div>
    </main>`;
  const err = (m: string) => { const e = $('#err'); e.textContent = m; e.hidden = !m; };
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    err('');
    $('#go').setAttribute('disabled', '');
    const email = $<HTMLInputElement>('#email').value;
    const pw = $<HTMLInputElement>('#pw').value;
    const r = mode === 'signup'
      ? await api.invoke<{ ok: boolean; error?: string }>('account.signUp', $<HTMLInputElement>('#name').value, email, pw)
      : await api.invoke<{ ok: boolean; error?: string }>('account.signIn', email, pw);
    $('#go').removeAttribute('disabled');
    if (!r.ok) return err(r.error ?? 'Something went wrong.');
    document.body.classList.add('leaving');
    setTimeout(() => void api.invoke('account.done'), 420);
  });
  document.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => render(b.dataset.mode as 'signin' | 'signup')));
  document.querySelectorAll<HTMLElement>('.known-acc').forEach((b) => b.addEventListener('click', () => { $<HTMLInputElement>('#email').value = b.dataset.email!; $<HTMLInputElement>('#pw').focus(); }));
  document.getElementById('guest')?.addEventListener('click', async () => { await api.invoke('account.guest'); void api.invoke('account.done'); });
  (document.getElementById(mode === 'signup' ? 'name' : 'email') as HTMLInputElement | null)?.focus();
}
void render();
