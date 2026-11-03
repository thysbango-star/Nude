import { api, $, esc, I } from './common';

interface B { url: string; host: string; category: string; confidence: string; title: string; explanation: string; advice: string;
  signals: string[]; intendedSite?: string; canBypass: boolean; action: string }

async function render() {
  const b = await api.invoke<B | null>('blocked.get');
  if (!b) {
    $('#root').innerHTML = `<main class="warn-page"><div class="warn-card"><div class="warn-icon">${I.shield}</div><h1>This warning has expired</h1>
      <p>Go back and try again.</p><button class="btn primary" id="back">Go back</button></div></main>`;
    $('#back').onclick = () => api.invoke('blocked.back');
    return;
  }
  const severe = b.action === 'block';
  document.body.classList.toggle('severe', severe);
  $('#root').innerHTML = `<main class="warn-page"><div class="warn-card">
    <div class="warn-icon">${severe ? I.shieldX : I.warn}</div>
    <div class="brand-line">${I.shield} Nude Security</div>
    <h1>${esc(b.title)}</h1>
    <div class="addr">${esc(b.host)}</div>
    <p class="lead">${esc(b.explanation)}</p>
    <div class="facts">
      <div><span class="tiny">Threat type</span><b>${esc(b.title)}</b></div>
      <div><span class="tiny">Confidence</span><b>${b.confidence === 'confirmed' ? 'Confirmed threat (on a known-threat list)' : 'Suspected — based on warning signs, not confirmed'}</b></div>
    </div>
    ${b.signals.length ? `<div class="why"><b>Why Nude blocked it</b><ul>${b.signals.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
    <div class="advice">${I.info}<span><b>What to do:</b> ${esc(b.advice)}</span></div>
    <div class="btns">
      <button class="btn primary big" id="back">${I.back}Back to safety</button>
      ${b.intendedSite ? `<button class="btn big" id="intended">Go to ${esc(b.intendedSite.replace(/^https:\/\/|\/$/g, ''))} instead</button>` : ''}
    </div>
    ${b.canBypass ? `<details class="details"><summary>Advanced</summary>
      <p>If you understand the risk and are sure this site is safe, you can continue. Nude will remember this only for this tab.</p>
      <label class="check"><input type="checkbox" id="understand"> I understand this site may steal my information or harm my device</label>
      <button class="btn danger" id="continue" disabled>Continue to ${esc(b.host)} (unsafe)</button></details>`
      : '<p class="tiny" style="margin-top:18px">This site is a confirmed threat, and Maximum Protection doesn\'t allow continuing.</p>'}
  </div></main>`;
  $('#back').onclick = () => api.invoke('blocked.back');
  document.getElementById('intended')?.addEventListener('click', () => api.invoke('blocked.goIntended'));
  const u = document.getElementById('understand') as HTMLInputElement | null;
  const c = document.getElementById('continue') as HTMLButtonElement | null;
  u?.addEventListener('change', () => { if (c) c.disabled = !u.checked; });
  c?.addEventListener('click', () => api.invoke('blocked.continue'));
  $('#back').focus();
}
void render();
