import { api, $, esc, faviconImg, host, I, on, dayLabel, toast } from './common';

interface Entry { url: string; title: string; favicon?: string; lastVisit: number; visitCount: number }
let query = '';
let entries: Entry[] = [];

async function load() {
  entries = await api.invoke<Entry[]>('history.query', query, 1000);
  paint();
}

function paint() {
  const list = $('#list');
  if (!entries.length) {
    list.innerHTML = `<div class="empty"><div class="ei">${I.history}</div><h3>${query ? 'No matching pages' : 'No history yet'}</h3><div>${query ? 'Try a different search.' : 'Pages you visit will show up here. Private windows are never saved.'}</div></div>`;
    return;
  }
  let html = '';
  let day = '';
  for (const e of entries) {
    const d = dayLabel(e.lastVisit);
    if (d !== day) { html += `${day ? '</div>' : ''}<div class="group-label">${d}</div><div class="card flush">`; day = d; }
    html += `<div class="row" data-url="${esc(e.url)}"><input type="checkbox" class="sel" aria-label="Select">${faviconImg(e.favicon)}
      <a class="main" href="${esc(e.url)}" data-open="${esc(e.url)}"><div class="title">${esc(e.title || host(e.url))}</div><div class="sub">${esc(host(e.url))}</div></a>
      <span class="time">${new Date(e.lastVisit).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
      <div class="actions"><button class="icon-btn" data-remove title="Remove from history">${I.close}</button></div></div>`;
  }
  list.innerHTML = html + '</div>';
}

$('#root').innerHTML = `<div class="page">
  <div class="page-head"><h1><span class="head-icon">${I.history}</span>History</h1>
    <div class="search-wrap">${I.search}<input class="search-field" id="q" placeholder="Search history" type="search"></div>
    <button class="btn danger" id="delete-sel" hidden>${I.close}Delete selected</button>
    <button class="btn" id="clear">Clear browsing data…</button></div>
  <div id="list"><div class="loading">Loading…</div></div></div>`;

let t = 0;
$('#q').addEventListener('input', (e) => { clearTimeout(t); t = window.setTimeout(() => { query = (e.target as HTMLInputElement).value; void load(); }, 150); });
$('#clear').onclick = () => api.invoke('open', 'nude://settings#privacy');
$('#list').addEventListener('click', async (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('.row');
  if (row && (e.target as HTMLElement).closest('[data-remove]')) {
    await api.invoke('history.remove', [row.dataset.url]);
    toast('Removed from history');
  }
});
$('#list').addEventListener('change', () => { $('#delete-sel').hidden = !document.querySelector('.sel:checked'); });
$('#delete-sel').onclick = async () => {
  const urls = [...document.querySelectorAll<HTMLInputElement>('.sel:checked')].map((c) => c.closest<HTMLElement>('.row')!.dataset.url!);
  await api.invoke('history.remove', urls);
  $('#delete-sel').hidden = true;
  toast(`Removed ${urls.length} page${urls.length === 1 ? '' : 's'}`);
};
on('history', () => { clearTimeout(t); t = window.setTimeout(load, 300); });
void load();
