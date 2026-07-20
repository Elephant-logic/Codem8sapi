(() => {
  const frame = document.getElementById('codem8s-app');
  const badge = document.getElementById('codem8s-version');
  if (badge) badge.textContent = 'Codem8s 10.8.3';
  const STORE = 'codem8s_app_store_v1';
  const KEYS = ['codem8s_project_v3','codem8s_project_v4','codem8s_project_v7','codem8s_project_v8'];
  const appWin = () => frame?.contentWindow;
  const appDoc = () => { try { return frame?.contentDocument; } catch { return null; } };
  const copy = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function project() {
    for (const key of KEYS) {
      try {
        const value = JSON.parse(appWin().localStorage.getItem(key) || 'null');
        if (value?.files) return value;
      } catch {}
    }
    return null;
  }
  function apps() { try { return JSON.parse(appWin().localStorage.getItem(STORE) || '[]'); } catch { return []; } }
  function put(items) { appWin().localStorage.setItem(STORE, JSON.stringify(items.slice(0, 40))); }
  function typeOf(p) {
    const names = Object.keys(p.files || {});
    if (names.some(n => /\.(tsx?|jsx)$/i.test(n))) return 'React app';
    if (names.some(n => /\.html$/i.test(n))) return 'Website';
    if (names.some(n => /\.py$/i.test(n))) return 'Python app';
    return 'Project';
  }
  function status(text, error = false) {
    const node = appDoc()?.querySelector('#appsStoreStatus');
    if (!node) return;
    node.textContent = text;
    node.style.color = error ? '#ff7892' : '#66e3a4';
  }
  function save(name) {
    const p = project();
    if (!p) { status('No active project was found to save.', true); return; }
    const list = apps();
    const title = String(name || p.name || 'Untitled App').trim() || 'Untitled App';
    const old = list.find(x => x.name.toLowerCase() === title.toLowerCase());
    const item = { id: old?.id || `app-${Date.now()}`, name: title, type: typeOf(p), fileCount: Object.keys(p.files || {}).length, createdAt: old?.createdAt || Date.now(), updatedAt: Date.now(), project: copy({...p,name:title}) };
    put(old ? list.map(x => x.id === old.id ? item : x) : [item,...list]);
    render();
    status(`Saved “${title}” with ${item.fileCount} files on this device.`);
  }
  function open(id) {
    const item = apps().find(x => x.id === id); if (!item) return;
    const text = JSON.stringify(item.project);
    KEYS.forEach(key => appWin().localStorage.setItem(key, text));
    appWin().location.reload();
  }
  function install(id) {
    const item = apps().find(x => x.id === id); if (!item) return;
    appWin().localStorage.setItem('codem8s_mobile_selected_app', id);
    window.open(`/mobile-app.html?id=${encodeURIComponent(id)}`, '_blank', 'noopener');
    status(`Opened mobile installer for “${item.name}”.`);
  }
  function duplicate(id) {
    const list = apps(), source = list.find(x => x.id === id); if (!source) return;
    const item = copy(source); item.id = `app-${Date.now()}`; item.name += ' Copy'; item.project.name = item.name; item.createdAt = item.updatedAt = Date.now();
    put([item,...list]); render(); status(`Duplicated “${source.name}”.`);
  }
  function remove(id) { put(apps().filter(x => x.id !== id)); render(); status('App removed.'); }
  function exportApp(id) {
    const item = apps().find(x => x.id === id); if (!item) return;
    const blob = new Blob([JSON.stringify({format:'codem8s-app',version:1,app:item},null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `${item.name.replace(/[^a-z0-9_-]+/gi,'-') || 'app'}.codem8s.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function render() {
    const d = appDoc(), grid = d?.querySelector('#appsStoreGrid'); if (!grid) return;
    const q = (d.querySelector('#appsStoreSearch')?.value || '').toLowerCase();
    const list = apps().filter(x => !q || `${x.name} ${x.type}`.toLowerCase().includes(q));
    grid.innerHTML = list.length ? list.map(x => `<article style="border:1px solid #29425f;background:#091626;border-radius:14px;padding:12px;display:grid;gap:9px"><div><strong>${esc(x.name)}</strong><div style="color:#8fa4c1;font-size:11px">${esc(x.type)} · ${x.fileCount} files</div></div><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px"><button class="toolbtn" data-open="${x.id}">Open</button><button class="toolbtn" data-install="${x.id}">Install</button><button class="toolbtn" data-copy="${x.id}">Duplicate</button><button class="toolbtn" data-export="${x.id}">Export</button><button class="toolbtn dangerbtn" style="grid-column:1/-1" data-remove="${x.id}">Delete</button></div></article>`).join('') : '<div class="empty">No saved apps yet. Enter a name and tap Save current app.</div>';
  }
  function activate(tab, pane) {
    const d = appDoc(); if (!d) return;
    d.querySelectorAll('.tab').forEach(node => node.classList.remove('active'));
    d.querySelectorAll('.workspace').forEach(node => node.classList.remove('active'));
    tab.classList.add('active');
    pane.classList.add('active');
    const current = project();
    const name = d.querySelector('#appsStoreName');
    if (current?.name && name) name.value = current.name;
    render();
  }
  function wire() {
    const d = appDoc(); if (!d || d.documentElement.dataset.appStore) return;
    const toolbar = d.querySelector('.toolbar'), main = d.querySelector('.main'); if (!toolbar || !main) return;
    d.documentElement.dataset.appStore = '1';
    const tab = d.createElement('button'); tab.className = 'tab'; tab.dataset.pane = 'appsPane'; tab.textContent = 'Apps'; toolbar.insertBefore(tab, toolbar.querySelector('.spacer'));
    const pane = d.createElement('div'); pane.id = 'appsPane'; pane.className = 'workspace'; pane.innerHTML = `<div style="height:100%;overflow:auto;padding:14px"><div style="max-width:1100px;margin:auto"><h2 style="margin:0 0 5px">My Apps</h2><p style="color:#8fa4c1;margin:0 0 12px">Private project snapshots saved in this browser on this device.</p><div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px"><input id="appsStoreName" placeholder="App name"><button id="appsStoreSave" class="toolbtn">Save current app</button></div><input id="appsStoreSearch" placeholder="Search apps" style="margin-top:8px"><div id="appsStoreStatus" class="status">Save an app, then tap Install to add the mobile runner to your phone.</div><div id="appsStoreGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;margin-top:10px"></div></div></div>`; main.appendChild(pane);
    const current = project();
    if (current?.name) d.querySelector('#appsStoreName').value = current.name;
    tab.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); activate(tab, pane); }, true);
    d.querySelector('#appsStoreSave').onclick = () => save(d.querySelector('#appsStoreName').value);
    d.querySelector('#appsStoreSearch').oninput = render;
    pane.onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.open) open(b.dataset.open); if (b.dataset.install) install(b.dataset.install); if (b.dataset.copy) duplicate(b.dataset.copy); if (b.dataset.export) exportApp(b.dataset.export); if (b.dataset.remove) remove(b.dataset.remove); };
    render();
  }
  frame?.addEventListener('load', wire);
  setInterval(wire, 1000);
})();
