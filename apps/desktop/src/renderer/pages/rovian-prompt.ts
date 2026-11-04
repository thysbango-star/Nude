// The "Sign in with Rovian" prompt Nude shows at the top right of a page that offers it.
import { api, $, esc } from './common';

interface PromptData { topic: 'rovian-prompt'; site: string; account: { name: string; id: string; initials: string; color: string; photo: string | null } | null }

const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

function render(d: PromptData) {
  const first = d.account?.name.split(' ')[0] ?? '';
  $('#root').innerHTML = `
    <section class="card in" role="dialog" aria-labelledby="t">
      <header>
        <img class="mark" src="rovian-glyph.svg" alt="">
        <h1 id="t">Sign in to <b>${esc(d.site)}</b> with Rovian</h1>
        <button class="x" id="close" aria-label="Close">${X}</button>
      </header>
      <div class="who">
        ${d.account
          ? `<span class="av" style="background:${esc(d.account.color)}">${d.account.photo ? `<img src="${esc(d.account.photo)}" alt="">` : esc(d.account.initials)}</span>
             <span class="id"><b>${esc(d.account.name)}</b><span>${esc(d.account.id)}</span></span>`
          : `<span class="av rv"><img src="rovian-glyph.svg" alt=""></span>
             <span class="id"><b>Use your Rovian Account</b><span>You'll sign in on Rovian's own page.</span></span>`}
      </div>
      <button class="go" id="go">${d.account ? `Continue as ${esc(first)}` : 'Continue with Rovian'}</button>
      <p class="fine">Nude starts ${esc(d.site)}'s own Rovian sign-in. You approve what's shared on Rovian's page. <button class="never" id="never">Don't ask on this site</button></p>
    </section>`;
  const act = (a: string) => {
    $('.card').classList.add('out');
    setTimeout(() => void api.invoke(`prompt.${a}`), 170);
  };
  $('#go').addEventListener('click', () => act('continue'));
  $('#close').addEventListener('click', () => act('dismiss'));
  $('#never').addEventListener('click', () => act('never'));
}

api.onEvent((e) => { if (e.topic === 'rovian-prompt') render(e as unknown as PromptData); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('close')?.click(); });
