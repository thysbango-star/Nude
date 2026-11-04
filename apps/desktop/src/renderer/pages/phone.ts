// nude://phone — QR codes that link PassGate and Rovian Defender on your phone to Nude on this PC.
import { api, $, esc, on, timeAgo } from './common';

type LinkApp = 'passgate' | 'defender';
interface Device { id: string; app: LinkApp; name: string; created: number; lastSeen: number }
interface Offer { ok: boolean; error?: string; svg?: string; expires?: number; hosts?: string[]; port?: number }

const APPS: Record<LinkApp, { name: string; icon: string; verb: string; steps: string[]; shares: string }> = {
  passgate: {
    name: 'PassGate', icon: '<span class="app-ic pg"><img src="passgate-mark.svg" alt=""></span>', verb: 'Sign in to PassGate',
    steps: ['Open PassGate on your phone.', 'Tap <b>Scan code on your PC</b>.', 'Point your camera at this code.'],
    shares: 'Your verified name, email and Rovian ID, the accounts on this PC and Nude’s sign-in activity. Never passwords, sign-in tokens or browsing history.',
  },
  defender: {
    name: 'Rovian Defender', icon: '<span class="app-ic rd"><img src="rovian-mark.svg" alt=""></span>', verb: 'Link Rovian Defender',
    steps: ['Open Rovian Defender on your phone.', 'Tap <b>Link your PC</b>.', 'Point your camera at this code.'],
    shares: 'Your protection level, what Rovian Defender blocked on this PC and recent security events (site names only). Never your browsing history.',
  },
};

let current: LinkApp = location.hash === '#defender' ? 'defender' : 'passgate';
let expires = 0;
let known = new Set<string>();
let tick: number | undefined;

async function devices() { return api.invoke<{ devices: Device[]; listening: boolean }>('phone.devices'); }

async function render() {
  const d = await devices();
  known = new Set(d.devices.map((x) => x.id));
  const a = APPS[current];
  $('#root').innerHTML = `
    <div class="page phone">
      <div class="page-head"><h1>Connect your phone</h1></div>
      <p class="lead muted">PassGate and Rovian Defender on your Android phone get their information from Nude on this PC, over your own Wi-Fi. Scan a code once and they stay linked.</p>
      <div class="seg" role="tablist">
        ${(Object.keys(APPS) as LinkApp[]).map((k) => `<button role="tab" class="seg-b${k === current ? ' on' : ''}" data-app="${k}" aria-selected="${k === current}">${APPS[k].icon}${APPS[k].name}</button>`).join('')}
        <span class="seg-ink" aria-hidden="true"></span>
      </div>
      <section class="card link-card">
        <div class="steps">
          <h2>${a.verb}</h2>
          <ol>${a.steps.map((s) => `<li><span>${s}</span></li>`).join('')}</ol>
          <p class="tiny">Your phone needs to be on the same Wi-Fi as this PC. If Windows asks whether Nude may use private networks, choose <b>Allow</b>.</p>
          <p class="tiny share"><b>What’s shared:</b> ${a.shares}</p>
        </div>
        <div class="qr-col">
          <div class="qr" id="qr"><div class="qr-skel"></div></div>
          <div class="qr-meta" id="qr-meta">Making a code…</div>
          <button class="btn" id="renew" hidden>New code</button>
        </div>
      </section>
      <div id="linked-msg" class="linked" hidden></div>
      <section class="card">
        <h2>Linked phones</h2>
        <div id="devs">${devList(d.devices)}</div>
      </section>
    </div>`;
  document.querySelectorAll<HTMLElement>('[data-app]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.app === current) return;
    current = b.dataset.app as LinkApp;
    history.replaceState(null, '', current === 'defender' ? '#defender' : '#passgate');
    void render();
  }));
  $('#renew').addEventListener('click', () => void makeCode());
  wireDevs();
  moveInk();
  await makeCode();
}

function devList(list: Device[]) {
  if (!list.length) return '<p class="muted none">No phones linked yet.</p>';
  return list.map((x) => `<div class="row dev">${APPS[x.app].icon}<div class="main"><div class="title">${esc(x.name)}</div>
    <div class="sub">${APPS[x.app].name} · linked ${esc(timeAgo(x.created))} · last checked in ${esc(timeAgo(x.lastSeen))}</div></div>
    <button class="btn" data-remove="${esc(x.id)}">Unlink</button></div>`).join('');
}

function wireDevs() {
  document.querySelectorAll<HTMLElement>('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    if (!b.classList.contains('confirm')) { b.classList.add('confirm', 'danger'); b.textContent = 'Click again to unlink'; return; }
    await api.invoke('phone.remove', b.dataset.remove);
  }));
}

function moveInk() {
  const on = document.querySelector<HTMLElement>('.seg-b.on');
  const ink = document.querySelector<HTMLElement>('.seg-ink');
  if (on && ink) { ink.style.width = `${on.offsetWidth}px`; ink.style.transform = `translateX(${on.offsetLeft - 4}px)`; }
}

async function makeCode() {
  const qr = $('#qr');
  qr.classList.remove('expired');
  $('#renew').hidden = true;
  const r = await api.invoke<Offer>('phone.offer', current);
  if (!r.ok || !r.svg) {
    qr.innerHTML = '<div class="qr-err">!</div>';
    $('#qr-meta').textContent = r.error ?? 'Nude couldn’t make a code.';
    $('#renew').hidden = false;
    return;
  }
  qr.innerHTML = r.svg;
  qr.classList.add('fresh');
  setTimeout(() => qr.classList.remove('fresh'), 700);
  expires = r.expires!;
  const hosts = (r.hosts ?? []).join(', ');
  clearInterval(tick);
  const upd = () => {
    const left = Math.max(0, expires - Date.now());
    if (!left) {
      clearInterval(tick);
      qr.classList.add('expired');
      $('#qr-meta').textContent = 'This code has expired.';
      $('#renew').hidden = false;
      return;
    }
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    $('#qr-meta').innerHTML = `Expires in ${m}:${String(s).padStart(2, '0')}<br><span class="tiny">This PC: ${esc(hosts)}</span>`;
  };
  upd();
  tick = window.setInterval(upd, 1000);
}

on('phone', async () => {
  const d = await devices();
  const fresh = d.devices.filter((x) => !known.has(x.id));
  known = new Set(d.devices.map((x) => x.id));
  const devs = document.getElementById('devs');
  if (devs) { devs.innerHTML = devList(d.devices); wireDevs(); }
  const mine = fresh.find((x) => x.app === current);
  if (mine) {
    const m = $('#linked-msg');
    m.innerHTML = `<span class="tick">✓</span><div><b>${esc(APPS[mine.app].name)} is linked to ${esc(mine.name)}</b><span>${mine.app === 'passgate' ? 'You’re signed in to PassGate on your phone.' : 'Your phone now shows how Rovian Defender is protecting this PC.'}</span></div>`;
    m.hidden = false;
    m.classList.remove('pop'); void m.offsetWidth; m.classList.add('pop');
    await makeCode(); // the old code was used up
  }
});
addEventListener('resize', moveInk);
addEventListener('beforeunload', () => void api.invoke('phone.end'));
void render();
