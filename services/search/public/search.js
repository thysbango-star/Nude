// Nude Search client: suggestions, recent searches (stored only in this browser), voice, AI answers, share/save.
(() => {
  const $ = (s) => document.querySelector(s);
  const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const q = $('#q'); const box = $('#suggest');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const SVG = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M20 20l-4.2-4.2" stroke="currentColor" stroke-width="1.8"/></svg>';

  // Recent searches (local only)
  const params = new URLSearchParams(location.search);
  if (params.get('q')) { const r = store.get('recent', []).filter((x) => x !== params.get('q')); r.unshift(params.get('q')); store.set('recent', r.slice(0, 8)); }
  const recent = store.get('recent', []);
  if ($('#recent') && recent.length) {
    $('#recent-wrap').hidden = false;
    $('#recent').innerHTML = recent.map((r) => `<a class="chip" href="/search?q=${encodeURIComponent(r)}">${esc(r)}</a>`).join('');
    $('#clear-recent').onclick = () => { store.set('recent', []); $('#recent-wrap').hidden = true; };
  }
  document.querySelectorAll('.cats .chip').forEach((c) => c.addEventListener('click', (e) => {
    if (!q.value.trim()) { e.preventDefault(); q.focus(); q.placeholder = `Search ${c.textContent.toLowerCase()}…`; q.form.insertAdjacentHTML('beforeend', `<input type="hidden" name="type" value="${c.dataset.type}">`); }
    else c.href = `/search?type=${c.dataset.type}&q=${encodeURIComponent(q.value)}`;
  }));

  // Suggestions
  let sel = -1; let items = []; let t = 0;
  const paint = () => { box.innerHTML = items.map((s, i) => `<div role="option" class="${i === sel ? 'sel' : ''}" data-v="${esc(s)}">${SVG}${esc(s)}</div>`).join(''); box.hidden = !items.length; };
  q?.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const v = q.value.trim();
      if (!v) { items = []; paint(); return; }
      try { const [, list] = await (await fetch(`/api/suggest?q=${encodeURIComponent(v)}`)).json(); items = list.slice(0, 8); sel = -1; paint(); } catch {}
    }, 120);
  });
  q?.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; q.value = items[sel]; paint(); }
    if (e.key === 'Escape') { items = []; paint(); }
  });
  box?.addEventListener('mousedown', (e) => { const d = e.target.closest('[data-v]'); if (d) { q.value = d.dataset.v; q.form.submit(); } });
  q?.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));

  // Voice search (where the browser supports it)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $('#voice');
  if (SR && mic) {
    mic.hidden = false;
    mic.onclick = () => {
      const r = new SR(); r.lang = navigator.language || 'en-ZA'; r.interimResults = true;
      mic.classList.add('listening');
      r.onresult = (e) => { q.value = [...e.results].map((x) => x[0].transcript).join(''); if (e.results[e.results.length - 1].isFinal) q.form.submit(); };
      r.onend = () => mic.classList.remove('listening');
      r.onerror = () => mic.classList.remove('listening');
      r.start();
    };
  }

  // Filters
  const time = $('#time'), safe = $('#safe');
  if (time) { time.value = params.get('time') || ''; safe.value = params.get('safe') || 'moderate';
    const apply = () => { const p = new URLSearchParams(location.search); time.value ? p.set('time', time.value) : p.delete('time'); p.set('safe', safe.value); p.delete('page'); location.search = p.toString(); };
    time.onchange = apply; safe.onchange = apply; }

  // AI answers toggle (remembered in this browser)
  const ai = $('#ai-mode');
  if (ai) {
    ai.checked = store.get('ai', false);
    ai.onchange = () => { store.set('ai', ai.checked); if ($('#ai-answer')) loadAnswer(); };
  }
  async function loadAnswer() {
    const card = $('#ai-answer');
    if (!card || !ai?.checked || !card.dataset.q) { if (card) card.hidden = true; return; }
    card.hidden = false;
    card.innerHTML = '<h2>✦ Nude AI</h2><div id="ai-text">Thinking…</div>';
    try {
      const res = await fetch(`/api/answer?q=${encodeURIComponent(card.dataset.q)}`);
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let text = ''; let sources = [];
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i).replace(/^data:\s*/, ''); buf = buf.slice(i + 2);
          try { const m = JSON.parse(line); if (m.delta) text += m.delta; if (m.sources) sources = m.sources; if (m.error) throw new Error(m.error); } catch (err) { if (err.message && !err.message.includes('JSON')) throw err; }
          $('#ai-text').innerHTML = esc(text).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[(S\d+)\]/g, '<sup>$1</sup>').replace(/\n/g, '<br>');
        }
      }
      if (sources.length) card.insertAdjacentHTML('beforeend', `<div class="src">Sources: ${sources.map((s) => `<a href="${esc(s.url)}">${esc(s.id)} ${esc(s.title)}</a>`).join(' · ')}</div>`);
    } catch (err) { $('#ai-text').textContent = `AI answers aren't available: ${err.message}`; }
  }
  loadAnswer();

  // Quick actions
  document.addEventListener('click', async (e) => {
    const share = e.target.closest('[data-share]'); const save = e.target.closest('[data-save]');
    if (share) { const d = { url: share.dataset.share, title: share.dataset.title }; if (navigator.share) navigator.share(d).catch(() => {}); else { await navigator.clipboard.writeText(d.url); share.textContent = 'Link copied'; } }
    if (save) { const s = store.get('saved', []); if (!s.some((x) => x.url === save.dataset.save)) s.unshift({ url: save.dataset.save, title: save.dataset.title, at: Date.now() }); store.set('saved', s.slice(0, 200)); save.textContent = 'Saved'; }
  });
})();
