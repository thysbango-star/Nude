import { api, $, esc, host, I, on, bytes, timeAgo, toast } from './common';

interface D { id: string; url: string; filename: string; savePath: string; mimeType: string; totalBytes: number; receivedBytes: number;
  status: string; startedAt: number; missing?: boolean; risk?: string; securityNotes?: string[]; blocked?: boolean; awaitingDecision?: boolean }

async function load() {
  const list = await api.invoke<D[]>('downloads.list');
  if (!list.length) {
    $('#list').innerHTML = `<div class="empty"><div class="ei">${I.download}</div><h3>No downloads</h3><div>Files you download appear here. Rovian Defender checks every file before it's saved.</div></div>`;
    return;
  }
  $('#list').innerHTML = `<div class="card flush">${list.map((d) => {
    const pct = d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0;
    const active = d.status === 'progressing' || d.status === 'paused';
    const danger = d.blocked || d.risk === 'dangerous' || d.risk === 'high';
    const status = d.blocked ? '<span class="pill danger">Blocked by Rovian Defender</span>'
      : d.awaitingDecision ? '<span class="pill warn">Waiting for your decision</span>'
      : d.status === 'completed' ? (d.missing ? '<span class="pill">Deleted</span>' : danger ? '<span class="pill danger">Dangerous</span>' : d.risk === 'medium' ? '<span class="pill warn">Use caution</span>' : `<span class="tiny">${bytes(d.totalBytes)}</span>`)
      : d.status === 'progressing' ? `<span class="tiny">${bytes(d.receivedBytes)} of ${bytes(d.totalBytes) || '?'}</span>`
      : d.status === 'paused' ? '<span class="pill">Paused</span>' : d.status === 'cancelled' ? '<span class="pill">Cancelled</span>' : '<span class="pill warn">Failed</span>';
    const actions = active
      ? `${d.status === 'paused' && !d.awaitingDecision ? `<button class="btn" data-a="resume">Resume</button>` : d.awaitingDecision ? '' : `<button class="btn" data-a="pause">Pause</button>`}<button class="btn" data-a="cancel">Cancel</button>`
      : d.status === 'completed' && !d.missing ? `<button class="btn${danger ? ' danger' : ''}" data-a="open">${danger ? 'Open anyway' : 'Open'}</button><button class="btn" data-a="show">Show in folder</button>`
      : d.status !== 'completed' && !d.blocked ? `<button class="btn" data-a="retry">Retry</button>` : '';
    return `<div class="row dl" data-id="${d.id}"><div class="dl-icon${danger ? ' danger' : ''}">${danger ? I.shieldX : I.file}</div>
      <div class="main"><div class="title">${esc(d.filename)}</div><div class="sub">${esc(host(d.url))} · ${timeAgo(d.startedAt)} · ${status}</div>
      ${d.securityNotes?.length && (danger || d.risk === 'medium') ? `<div class="notes">${d.securityNotes.slice(0, 3).map((n) => `<div>${I.warn}${esc(n)}</div>`).join('')}</div>` : ''}
      ${active ? `<div class="progress"><i style="width:${pct}%"></i></div>` : ''}</div>
      <div class="dl-actions">${actions}<button class="icon-btn" data-a="remove" title="Remove from list">${I.close}</button></div></div>`;
  }).join('')}</div><p class="tiny" style="text-align:center;margin-top:16px">Rovian Defender checks file types, names and contents for known tricks. No warning doesn't guarantee a file is safe.</p>`;
}

$('#root').innerHTML = `<div class="page"><div class="page-head"><h1><span class="head-icon">${I.download}</span>Downloads</h1>
  <button class="btn" id="clear">Clear finished</button></div><div id="list"><div class="loading">Loading…</div></div></div>`;
$('#clear').onclick = () => api.invoke('downloads.clear');
$('#list').addEventListener('click', async (e) => {
  const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
  const id = (e.target as HTMLElement).closest<HTMLElement>('.row')?.dataset.id;
  if (!a || !id) return;
  if (a === 'open' && (e.target as HTMLElement).closest('.danger') && !confirm('Rovian Defender thinks this file may harm your device. Open it anyway?')) return;
  if (a === 'retry') { await api.invoke('downloads.retry', id); return; }
  const r = await api.invoke<{ ok: boolean; error?: string }>('downloads.action', id, a);
  if (!r.ok && r.error) toast(r.error);
});
on('downloads', load);
setInterval(load, 1000);
void load();
