import { api, $, esc, faviconImg, host, I, on, toast } from './common';

interface Bookmark { id: string; url: string; title: string; favicon?: string; folder: string; createdAt: number }
let all: Bookmark[] = [];
let query = '';
let folder: string | null = null;

async function load() { all = await api.invoke<Bookmark[]>('bookmarks.list'); paint(); }

function paint() {
  const folders = [...new Set(all.map((b) => b.folder).filter(Boolean))].sort();
  $('#folders').innerHTML = `<a class="${folder === null ? 'on' : ''}" data-folder="">${I.bookmarks}All bookmarks</a>
    <a class="${folder === '' ? 'on' : ''}" data-folder="__bar">${I.star}Bookmarks bar</a>` +
    folders.map((f) => `<a class="${folder === f ? 'on' : ''}" data-folder="${esc(f)}">${I.file}${esc(f)}</a>`).join('');
  const q = query.toLowerCase();
  const list = all.filter((b) => (folder === null || b.folder === folder) && (!q || b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)));
  $('#list').innerHTML = list.length ? `<div class="card flush">${list.map((b) => `<div class="row" data-id="${b.id}" draggable="${!q}">${faviconImg(b.favicon)}
      <a class="main" href="${esc(b.url)}" data-open="${esc(b.url)}"><div class="title">${esc(b.title)}</div><div class="sub">${esc(host(b.url))}${b.folder ? ` · ${esc(b.folder)}` : ''}</div></a>
      <div class="actions"><button class="icon-btn" data-edit title="Edit">${I.settings}</button><button class="icon-btn" data-remove title="Delete">${I.close}</button></div></div>`).join('')}</div>`
    : `<div class="empty"><div class="ei">${I.star}</div><h3>${q ? 'No matching bookmarks' : 'No bookmarks yet'}</h3><div>Press the star in the address bar or Ctrl+D to bookmark a page.</div></div>`;
}

$('#root').innerHTML = `<div class="layout"><nav class="side" id="folders"></nav><div>
  <div class="page-head"><h1><span class="head-icon">${I.bookmarks}</span>Bookmarks</h1>
    <div class="search-wrap">${I.search}<input class="search-field" id="q" placeholder="Search bookmarks" type="search"></div>
    <button class="btn primary" id="add">${I.plus}Add</button></div>
  <div id="list"></div></div></div>
  <dialog id="dlg"><form method="dialog" id="form"><h2 id="dlg-title">Edit bookmark</h2>
    <label class="tiny">Name</label><input class="input" id="f-title" required maxlength="500">
    <label class="tiny">Address</label><input class="input" id="f-url" required>
    <label class="tiny">Folder (leave empty for the bookmarks bar)</label><input class="input" id="f-folder" maxlength="200" list="folder-list"><datalist id="folder-list"></datalist>
    <div class="btns"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Save</button></div></form></dialog>`;

let editing: Bookmark | null = null;
function openDialog(b: Bookmark | null) {
  editing = b;
  $('#dlg-title').textContent = b ? 'Edit bookmark' : 'Add bookmark';
  $<HTMLInputElement>('#f-title').value = b?.title ?? '';
  $<HTMLInputElement>('#f-url').value = b?.url ?? 'https://';
  $<HTMLInputElement>('#f-folder').value = b?.folder ?? (folder && folder !== '' ? folder : '');
  $('#folder-list').innerHTML = [...new Set(all.map((x) => x.folder).filter(Boolean))].map((f) => `<option value="${esc(f)}">`).join('');
  $<HTMLDialogElement>('#dlg').showModal();
}
$('#form').addEventListener('submit', async () => {
  if ($<HTMLDialogElement>('#dlg').returnValue === 'cancel') return;
  let url = $<HTMLInputElement>('#f-url').value.trim();
  if (!/^https?:\/\//.test(url)) url = `https://${url}`;
  const title = $<HTMLInputElement>('#f-title').value.trim();
  const f = $<HTMLInputElement>('#f-folder').value.trim();
  if (editing) await api.invoke('bookmarks.update', editing.id, { title, url, folder: f });
  else await api.invoke('bookmarks.add', url, title, f);
});
$('#add').onclick = () => openDialog(null);
$('#q').addEventListener('input', (e) => { query = (e.target as HTMLInputElement).value; paint(); });
$('#folders').addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest<HTMLElement>('[data-folder]');
  if (!a) return;
  folder = a.dataset.folder === '' ? null : a.dataset.folder === '__bar' ? '' : a.dataset.folder!;
  paint();
});
$('#list').addEventListener('click', async (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('.row');
  if (!row) return;
  const b = all.find((x) => x.id === row.dataset.id)!;
  if ((e.target as HTMLElement).closest('[data-remove]')) { await api.invoke('bookmarks.remove', b.id); toast('Bookmark deleted'); }
  if ((e.target as HTMLElement).closest('[data-edit]')) openDialog(b);
});
let dragId: string | null = null;
$('#list').addEventListener('dragstart', (e) => { dragId = (e.target as HTMLElement).closest<HTMLElement>('.row')?.dataset.id ?? null; });
$('#list').addEventListener('dragover', (e) => e.preventDefault());
$('#list').addEventListener('drop', (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('.row');
  if (!dragId || !target) return;
  void api.invoke('bookmarks.move', dragId, all.findIndex((b) => b.id === target.dataset.id));
});
on('bookmarks', load);
void load();
