// The pages Nude Accounts serves to people (Sign in with Nude). Everything else is JSON for the apps.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const CSS = `
:root{--bg:#eef3ff;--ink:#0b1430;--muted:#4b587a;--card:rgba(255,255,255,.72);--edge:rgba(255,255,255,.9);--line:rgba(11,20,48,.12);--accent:#2457ff;--accent2:#18b4e8;--bad:#c23a3a;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#040a1f;--ink:#eaf1ff;--muted:#9fb0d6;--card:rgba(18,32,78,.55);--edge:rgba(160,190,255,.28);--line:rgba(200,215,255,.14);--accent:#4d7cff;--accent2:#38d0ff;--bad:#ff7b7b;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(1200px 600px at 20% -10%,rgba(36,87,255,.35),transparent),radial-gradient(900px 500px at 110% 110%,rgba(24,180,232,.3),transparent),var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px max(16px,env(safe-area-inset-left))}
.card{width:100%;max-width:400px;background:var(--card);border:1px solid var(--edge);border-radius:28px;padding:32px 28px;backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);box-shadow:0 30px 80px rgba(4,10,31,.25)}
.mark{width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center;color:#fff;font-weight:700;font-size:20px;margin-bottom:18px}
h1{font-size:22px;margin:0 0 4px;font-weight:650;text-wrap:balance}p{margin:0 0 18px;color:var(--muted)}
label{display:block;font-size:13px;color:var(--muted);margin:14px 0 6px}
.field{display:flex;align-items:center;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.06);padding:0 12px}
.field input{flex:1;min-width:0;border:0;background:transparent;color:var(--ink);font:inherit;padding:12px 0;outline:none}.field span{color:var(--muted)}
.field:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px rgba(36,87,255,.2)}
button{width:100%;margin-top:22px;border:0;border-radius:14px;padding:13px;font:600 15px system-ui,sans-serif;color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent2));cursor:pointer}
button.quiet{background:transparent;color:var(--ink);border:1px solid var(--line);margin-top:10px}
.err{color:var(--bad);font-size:13.5px;margin:12px 0 0}.who{display:flex;gap:12px;align-items:center;padding:12px;border:1px solid var(--line);border-radius:16px;margin:6px 0 4px}
.av{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;display:grid;place-items:center;font-weight:600;flex-shrink:0;overflow:hidden}.av img{width:100%;height:100%;object-fit:cover}
ul{margin:10px 0 0;padding-left:18px;color:var(--muted);font-size:13.5px}.foot{font-size:12px;color:var(--muted);margin-top:18px;text-align:center}`;

function shell(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><main class="card"><div class="mark">N</div>${body}</main></body></html>`;
}

export interface AuthorizeView {
  client: string; form: string; error?: string; username?: string;
  signedIn?: { name: string; nudeId: string; avatar?: string };
}

export function authorizePage(v: AuthorizeView): string {
  if (v.signedIn) {
    const s = v.signedIn;
    return shell('Sign in with Nude', `<h1>Continue to ${esc(v.client)}?</h1><p>${esc(v.client)} will see:</p>
      <div class="who"><div class="av">${s.avatar ? `<img src="${esc(s.avatar)}" alt="">` : esc(s.name.slice(0, 1).toUpperCase())}</div><div><b>${esc(s.name)}</b><br><span style="color:var(--muted)">${esc(s.nudeId)}</span></div></div>
      <ul><li>Your name, Nude ID and profile picture</li><li>Not your password, devices or activity</li></ul>
      <form method="post"><input type="hidden" name="form" value="${esc(v.form)}"><input type="hidden" name="action" value="allow"><button>Continue as ${esc(s.name.split(' ')[0])}</button></form>
      <form method="post"><input type="hidden" name="form" value="${esc(v.form)}"><input type="hidden" name="action" value="switch"><button class="quiet">Use another Nude ID</button></form>
      <form method="post"><input type="hidden" name="form" value="${esc(v.form)}"><input type="hidden" name="action" value="deny"><button class="quiet">Cancel</button></form>`);
  }
  return shell('Sign in with Nude', `<h1>Sign in with Nude</h1><p>to continue to ${esc(v.client)}</p>
    <form method="post" autocomplete="on"><input type="hidden" name="form" value="${esc(v.form)}"><input type="hidden" name="action" value="signin">
      <label for="u">Nude ID</label><div class="field"><input id="u" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${esc(v.username ?? '')}"><span>@nude</span></div>
      <label for="p">Password</label><div class="field"><input id="p" name="password" type="password" autocomplete="current-password" required></div>
      ${v.error ? `<p class="err" role="alert">${esc(v.error)}</p>` : ''}
      <button>Sign in</button></form>
    <form method="post"><input type="hidden" name="form" value="${esc(v.form)}"><input type="hidden" name="action" value="deny"><button class="quiet">Cancel</button></form>
    <div class="foot">No Nude ID yet? Create one in the Nude browser.</div>`);
}

export function messagePage(title: string, text: string): string {
  return shell(title, `<h1>${esc(title)}</h1><p>${esc(text)}</p>`);
}

export function homePage(persistent: boolean): string {
  return shell('Nude Accounts', `<h1>Nude Accounts</h1><p>Nude IDs for the Nude browser, Nude Companion and any site with Sign in with Nude.</p>
    ${persistent ? '' : '<p class="err">Test mode: this server has no permanent storage yet, so accounts are wiped when it restarts.</p>'}
    <div class="foot">Create your Nude ID in the Nude browser.</div>`);
}
