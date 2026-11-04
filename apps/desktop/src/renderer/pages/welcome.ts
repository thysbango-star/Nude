import { api, $, esc } from './common';

interface Acc { id: string; name: string; firstName: string; email: string; color: string; photo?: string; initials: string; provider: 'local' | 'rovian'; rovianId?: string | null }

/** The sunset: layered so each band can rise in on its own and the clouds can drift. */
const SCENE = `
<svg class="scene" viewBox="0 0 700 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f7875a"/><stop offset="0.42" stop-color="#fba465"/><stop offset="0.6" stop-color="#ffbf72"/><stop offset="0.75" stop-color="#ffc677"/>
    </linearGradient>
    <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe7a3"/><stop offset="1" stop-color="#ffcf78"/></linearGradient>
    <linearGradient id="slope" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b9614a"/><stop offset="1" stop-color="#8b4a3d"/></linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e97a43" stop-opacity="0"/><stop offset="0.55" stop-color="#e9773f" stop-opacity="0.85"/><stop offset="1" stop-color="#e7703a"/></linearGradient>
  </defs>
  <rect width="700" height="800" fill="url(#sky)"/>
  <g class="clouds c1"><path d="M430 96 C470 70 520 78 548 64 C590 44 640 58 700 52 L700 100 C640 104 560 100 500 102 C470 103 440 104 430 96 Z" fill="#f2845a" opacity="0.85"/></g>
  <g class="clouds c2"><path d="M0 162 C40 150 90 160 120 150 C170 132 230 150 270 170 C300 186 320 196 330 202 C250 206 120 210 0 210 Z" fill="#f28b5c" opacity="0.8"/></g>
  <g class="clouds c3"><path d="M440 286 C500 262 560 256 600 246 C640 236 680 240 700 236 L700 292 C620 294 520 294 440 286 Z" fill="#f59a60" opacity="0.8"/></g>
  <g class="clouds c4"><path d="M300 222 C360 214 430 222 470 214 C430 232 360 236 300 222 Z" fill="#f8a868" opacity="0.7"/></g>
  <circle class="sunball" cx="380" cy="420" r="72" fill="url(#sun)"/>
  <g class="layer l1"><path d="M0 430 C60 410 120 392 180 400 C240 408 280 384 340 392 C400 400 450 410 520 396 C590 382 650 390 700 380 L700 800 L0 800 Z" fill="#f5a165"/></g>
  <g class="layer l2"><path d="M0 470 C70 440 140 438 200 452 C260 466 300 430 360 440 C420 450 470 476 540 470 C610 464 660 446 700 440 L700 800 L0 800 Z" fill="#f08d55"/></g>
  <g class="layer l3"><path d="M0 468 C40 452 80 450 120 468 C180 494 240 520 300 532 C360 544 420 540 480 556 L480 800 L0 800 Z" fill="#c56a55"/></g>
  <g class="layer l4">
    <path d="M440 590 C520 540 600 470 650 440 C672 426 688 414 700 404 L700 800 L420 800 Z" fill="url(#slope)"/>
    <path d="M500 520 C560 488 620 456 700 410 L700 430 C640 470 590 500 540 524 C520 530 506 528 500 520 Z" fill="#f08850" opacity="0.9"/>
  </g>
  <g class="layer l5" fill="#b65f4b">
    <path d="M0 520 L8 500 L16 520 L22 540 L0 560 Z"/>
    <path d="M18 600 L34 512 L50 600 Z"/><path d="M40 610 L58 540 L76 610 Z"/><path d="M62 620 L76 568 L90 620 Z"/>
    <path d="M100 630 L112 586 L124 630 Z"/><path d="M120 640 L130 604 L140 640 Z"/>
    <path d="M0 560 C40 580 90 610 150 632 C200 650 260 660 320 668 L320 800 L0 800 Z"/>
  </g>
  <g class="layer l6">
    <path d="M0 640 C90 610 180 620 260 640 C340 660 420 644 520 626 C600 612 660 616 700 620 L700 800 L0 800 Z" fill="#ea7b44"/>
    <path d="M0 700 C120 680 240 690 360 704 C480 718 600 700 700 690 L700 800 L0 800 Z" fill="#e6733d"/>
  </g>
  <rect y="430" width="700" height="370" fill="url(#floor)"/>
</svg>`;

/** The asterisk flower in the wordmark. */
const BLOOM = `<svg class="bloom" viewBox="-50 -50 100 100" aria-hidden="true">${[0, 45, 90, 135].map((r) => `<rect x="-9" y="-48" width="18" height="96" rx="9" transform="rotate(${r})"/>`).join('')}</svg>`;

const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C6.5 5 2.7 9.2 1.5 12c1.2 2.8 5 7 10.5 7s9.3-4.2 10.5-7C21.3 9.2 17.5 5 12 5Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z"/><circle cx="12" cy="12" r="2"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.3 2 2 3.3l3.2 3.2C3.4 7.9 2.2 9.9 1.5 12c1.2 2.8 5 7 10.5 7 1.9 0 3.6-.5 5-1.2l3.7 3.7 1.3-1.3L3.3 2ZM12 16a4 4 0 0 1-3.9-4.9l5.4 5.4c-.5.3-1 .5-1.5.5Zm0-11c-1.5 0-2.9.3-4.1.8l2.2 2.2A4 4 0 0 1 16 12c0 .7-.2 1.3-.5 1.9l3.3 3.3c1.7-1.4 3-3.3 3.7-5.2C21.3 9.2 17.5 5 12 5Z"/></svg>';

async function render(mode: 'signin' | 'signup' = 'signin', first = true) {
  const info = await api.invoke<{ current: Acc | null; all: Acc[]; needsWelcome: boolean }>('account.get');
  if (first && !info.all.length && !location.hash.includes('signin')) mode = 'signup';
  const signin = mode === 'signin';
  $('#root').innerHTML = `
    <div class="split${first ? ' intro' : ''}">
      <aside class="art">
        ${SCENE}
        <div class="wordmark"><span class="wm-nude">Nude</span> <span class="wm-browser">Browser</span>${BLOOM}</div>
        <div class="tagline">
          <p class="kicker">Your Browser, Your Way</p>
          <p class="big">Smart Tools for</p>
          <p class="big row"><span class="rings" aria-hidden="true"><i></i><i><svg viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8"/></svg></i></span>Smarter Work</p>
        </div>
      </aside>
      <main class="panel">
        <div class="form-wrap">
          <h1>${signin ? 'Welcome Back!' : 'Join Nude!'}</h1>
          <p class="lead">${signin ? 'Log in to access your dashboard, manage your account, and continue securely with full control.' : 'Create your Nude account so your browser knows you. It stays on this device.'}</p>
          ${signin && info.all.length ? `<div class="known">${info.all.map((a) => `<button type="button" class="known-acc" data-email="${esc(a.email)}" data-id="${esc(a.id)}" data-provider="${a.provider}" title="${esc(a.provider === 'rovian' ? (a.rovianId ?? a.email) : a.email)}"><span class="av" style="background:${esc(a.color)}">${a.photo ? `<img src="${esc(a.photo)}" alt="">` : esc(a.initials)}</span><span class="kn">${esc(a.firstName)}</span>${a.provider === 'rovian' ? '<img class="via" src="rovian-glyph.svg" alt="Rovian">' : ''}</button>`).join('')}</div>` : ''}
          <form id="f" autocomplete="on" novalidate>
            ${signin ? '' : '<label class="field"><span>Your Name</span><input id="name" autocomplete="name" required maxlength="80" placeholder="Enter your name"></label>'}
            <label class="field"><span>Email Address</span><input id="email" type="email" autocomplete="email" required placeholder="Enter your email"></label>
            <label class="field"><span>Password</span>
              <span class="pw"><input id="pw" type="password" autocomplete="${signin ? 'current-password' : 'new-password'}" required minlength="8" placeholder="${signin ? 'Enter your password' : 'At least 8 characters'}">
              <button type="button" class="eye" id="eye" aria-label="Show password" aria-pressed="false">${EYE}</button></span>
            </label>
            <div class="row-between">
              <label class="check"><input type="checkbox" id="remember" checked><span class="box" aria-hidden="true"></span>Remember me</label>
              ${signin ? '<button type="button" class="link quiet" id="forgot">Forgot Password?</button>' : ''}
            </div>
            <div id="forgot-msg" class="note" hidden>Nude accounts live only on this device, so their password can't be reset or sent anywhere. If you signed in with Rovian, use “Forgot password” on Rovian's own sign-in page.</div>
            <div id="err" class="err" role="alert" hidden></div>
            <button class="primary" id="go">${signin ? 'Login to Nude' : 'Create account'}</button>
          </form>
          <div class="or"><span>or continue with</span></div>
          <div class="providers">
            <button type="button" class="provider" id="rovian" aria-label="Continue with Rovian" title="Continue with Rovian"><img src="rovian-glyph.svg" alt=""></button>
          </div>
          <div id="rovian-msg" class="err" role="alert" hidden></div>
          <div id="rovian-wait" class="wait" role="status" hidden>
            <span class="wait-ring" aria-hidden="true"></span>
            <div><b>Finish in your browser</b><span>Rovian Account opened in your usual web browser. Sign in and approve there, and Nude will continue on its own.</span>
            <div class="wait-actions"><button type="button" class="link" id="rovian-tab">Sign in inside Nude instead</button><button type="button" class="link quiet" id="rovian-cancel">Cancel</button></div></div>
          </div>
          <p class="switch-line">${signin ? 'New to Nude? <button type="button" class="link" data-mode="signup">Create an account</button>' : 'Already have an account? <button type="button" class="link" data-mode="signin">Log in</button>'}</p>
          ${info.needsWelcome ? '<button type="button" class="link quiet guest" id="guest">Continue without an account</button>' : ''}
          <p class="fine">With Rovian, Nude keeps only your verified name, email and Rovian ID, never your Rovian password or sign-in tokens.</p>
        </div>
      </main>
    </div>`;

  const remember = () => $<HTMLInputElement>('#remember').checked;
  const leave = () => { document.body.classList.add('leaving'); setTimeout(() => void api.invoke('account.done'), 460); };
  const show = (sel: string, m: string) => { const e = $(sel); e.textContent = m; e.hidden = !m; };

  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    show('#err', '');
    const go = $<HTMLButtonElement>('#go');
    go.disabled = true; go.classList.add('busy');
    const email = $<HTMLInputElement>('#email').value;
    const pw = $<HTMLInputElement>('#pw').value;
    const r = signin
      ? await api.invoke<{ ok: boolean; error?: string }>('account.signIn', email, pw, remember())
      : await api.invoke<{ ok: boolean; error?: string }>('account.signUp', $<HTMLInputElement>('#name').value, email, pw, remember());
    go.disabled = false; go.classList.remove('busy');
    if (!r.ok) { show('#err', r.error ?? 'Something went wrong.'); $('#f').classList.remove('shake'); void $('#f').offsetWidth; $('#f').classList.add('shake'); return; }
    leave();
  });

  $('#eye').addEventListener('click', () => {
    const pw = $<HTMLInputElement>('#pw');
    const showing = pw.type === 'text';
    pw.type = showing ? 'password' : 'text';
    $('#eye').innerHTML = showing ? EYE : EYE_OFF;
    $('#eye').setAttribute('aria-pressed', String(!showing));
    $('#eye').setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  });
  document.getElementById('forgot')?.addEventListener('click', () => { const n = $('#forgot-msg'); n.hidden = !n.hidden; });

  document.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    $('.form-wrap').classList.add('swap');
    setTimeout(() => void render(b.dataset.mode as 'signin' | 'signup', false), 180);
  }));
  document.querySelectorAll<HTMLElement>('.known-acc').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.provider === 'rovian') {
      const r = await api.invoke<{ ok: boolean; error?: string }>('account.switch', b.dataset.id);
      if (r.ok) leave(); else if (r.error && r.error !== 'password') show('#err', r.error);
      return;
    }
    $<HTMLInputElement>('#email').value = b.dataset.email!; $<HTMLInputElement>('#pw').focus();
  }));

  // Sign in with Rovian: opens Rovian Account's own sign-in and consent pages in this tab.
  const startRovian = async (where: 'browser' | 'tab') => {
    show('#rovian-msg', '');
    $('#rovian').classList.add('busy');
    const r = await api.invoke<{ ok: boolean; error?: string; external?: boolean }>('account.rovian', 'signin', remember(), where);
    if (!r.ok) { $('#rovian').classList.remove('busy'); $('#rovian-wait').hidden = true; show('#rovian-msg', r.error ?? 'Couldn\'t start signing in with Rovian.'); return; }
    $('#rovian-wait').hidden = !r.external;
  };
  $('#rovian').addEventListener('click', () => void startRovian('browser'));
  $('#rovian-tab').addEventListener('click', () => void startRovian('tab'));
  $('#rovian-cancel').addEventListener('click', async () => {
    await api.invoke('account.rovianCancel');
    $('#rovian-wait').hidden = true; $('#rovian').classList.remove('busy');
  });
  if (first) void api.invoke<{ ok: boolean; message: string } | null>('account.rovianResult').then((r) => { if (r && !r.ok) show('#rovian-msg', r.message); });
  document.getElementById('guest')?.addEventListener('click', async () => { await api.invoke('account.guest'); void api.invoke('account.done'); });
  (document.getElementById(signin ? 'email' : 'name') as HTMLInputElement | null)?.focus({ preventScroll: true });
}
void render();
