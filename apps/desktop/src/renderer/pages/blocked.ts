import { api, $, esc, I } from './common';

interface B { url: string; host: string; category: string; confidence: string; title: string; explanation: string; advice: string;
  signals: string[]; intendedSite?: string; canBypass: boolean; action: string }

async function render() {
  const b = await api.invoke<B | null>('blocked.get');
  if (!b) {
    $('#root').innerHTML = `<main class="rv-page"><img class="shield" src="rovian-block.svg" alt=""><div class="copy"><h1>This warning has <em>expired</em>.</h1><p class="sub">Go back and try again.</p><button class="back" id="back">Back to safety</button></div></main>`;
    $('#back').onclick = () => api.invoke('blocked.back');
    return;
  }
  document.title = `Not protected — ${b.host}`;
  $('#root').innerHTML = `<main class="rv-page">
    <img class="shield" src="rovian-block.svg" alt="">
    <div class="copy">
      <h1>This Website is <em>Not Protected</em>.</h1>
      <p class="sub">Proceeding could cost you your information.</p>
      ${b.canBypass
        ? `<button class="continue" id="continue">Continue to ${esc(b.host)} <em>UNSAFE</em></button>`
        : `<p class="continue static">Continuing to ${esc(b.host)} isn't allowed at Maximum Protection.</p>`}
      <div class="actions">
        <button class="back" id="back">${I.back}Back to safety</button>
        ${b.intendedSite ? `<button class="alt" id="intended">Go to ${esc(b.intendedSite.replace(/^https:\/\/|\/$/g, ''))} instead</button>` : ''}
      </div>
      <details class="why">
        <summary>Why Rovian Defender stopped this site</summary>
        <div class="facts"><span><b>${esc(b.title)}</b></span><span>${b.confidence === 'confirmed' ? 'Confirmed threat — on a known-threat list' : 'Suspected — based on warning signs, not confirmed'}</span></div>
        <p>${esc(b.explanation)}</p>
        ${b.signals.length ? `<ul>${b.signals.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
        <p><b>What to do:</b> ${esc(b.advice)}</p>
      </details>
      <div class="confirm" id="confirm" hidden>
        <p><b>Are you sure?</b> ${esc(b.host)} ${b.confidence === 'confirmed' ? 'is a known dangerous site' : 'shows signs of being unsafe'}. It may steal passwords, card details or personal information.</p>
        <div class="actions"><button class="back" id="cancel">Take me back</button><button class="danger" id="yes">I understand — continue</button></div>
      </div>
      <div class="brand"><img src="rovian-mark.svg" alt=""><b>Rovian<span>Defender</span></b></div>
    </div>
  </main>`;
  $('#back').onclick = () => api.invoke('blocked.back');
  document.getElementById('intended')?.addEventListener('click', () => api.invoke('blocked.goIntended'));
  document.getElementById('continue')?.addEventListener('click', () => {
    $('#confirm').hidden = false;
    $('#confirm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  document.getElementById('cancel')?.addEventListener('click', () => api.invoke('blocked.back'));
  document.getElementById('yes')?.addEventListener('click', () => api.invoke('blocked.continue'));
  $('#back').focus();
}
void render();
