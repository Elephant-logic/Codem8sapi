(() => {
  const frame = document.getElementById('codem8s-app');
  const STORE = 'codem8s_app_store_v1';
  const ACTIVE = 'codem8s_active_project_key';
  const appWin = () => frame?.contentWindow;
  const appDoc = () => { try { return frame?.contentDocument || null; } catch { return null; } };
  const copy = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeId = value => String(value || 'app').replace(/[^a-z0-9_-]/gi, '-');

  function records() {
    const w = appWin(), out = [];
    if (!w) return out;
    for (let i = 0; i < w.localStorage.length; i++) {
      const key = w.localStorage.key(i);
      if (!/^codem8s_project_/i.test(key || '')) continue;
      try {
        const value = JSON.parse(w.localStorage.getItem(key) || 'null');
        if (value?.files && typeof value.files === 'object') out.push({ key, value });
      } catch {}
    }
    return out.sort((a,b) => Number(b.value.updatedAt || b.value.createdAt || 0) - Number(a.value.updatedAt || a.value.createdAt || 0));
  }
  function activeRecord() {
    const w = appWin(), list = records();
    const key = w?.localStorage.getItem(ACTIVE) || '';
    return list.find(item => item.key === key) || list[0] || null;
  }
  function chooseRecord(key) {
    const w = appWin();
    if (w && key) w.localStorage.setItem(ACTIVE, key);
    return records().find(item => item.key === key) || activeRecord();
  }
  function apps() { try { return JSON.parse(appWin().localStorage.getItem(STORE) || '[]'); } catch { return []; } }
  function put(items) { appWin().localStorage.setItem(STORE, JSON.stringify(items.slice(0, 40))); }
  function typeOf(p) {
    const names = Object.keys(p?.files || {});
    if (names.some(n => /\.(tsx?|jsx)$/i.test(n))) return 'React app';
    if (names.some(n => /\.html?$/i.test(n))) return 'Website';
    if (names.some(n => /\.py$/i.test(n))) return 'Python app';
    return 'Project';
  }
  function projectName(p) {
    const direct = String(p?.name || '').trim();
    if (direct) return direct;
    const htmlName = Object.keys(p?.files || {}).find(n => /(^|\/)index\.html?$/i.test(n));
    const title = String(htmlName ? p.files[htmlName] : '').match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
    return title || 'Untitled App';
  }
  function status(text, error = false) {
    const node = appDoc()?.querySelector('#appsStoreStatus');
    if (!node) return;
    node.textContent = text;
    node.style.color = error ? '#ff7892' : '#66e3a4';
  }
  function captureStorage() {
    const w = appWin(), saved = {};
    if (!w) return saved;
    for (let i = 0; i < w.localStorage.length; i++) {
      const key = w.localStorage.key(i);
      if (!key || key === STORE || /^codem8s_ai_(?:builder_chat|memory|snapshots)/i.test(key)) continue;
      if (!/^codem8s_/i.test(key)) continue;
      const value = w.localStorage.getItem(key);
      if (value != null) saved[key] = value;
    }
    return saved;
  }
  function restore(item) {
    const w = appWin();
    if (!w || !item?.project) throw new Error('This saved app has no project snapshot.');
    for (const [key,value] of Object.entries(item.linkedStorage || {})) {
      if (key !== STORE && typeof value === 'string') w.localStorage.setItem(key, value);
    }
    const targetKey = item.projectKey || w.localStorage.getItem(ACTIVE) || 'codem8s_project_v8';
    const text = JSON.stringify(item.project);
    w.localStorage.setItem(targetKey, text);
    w.localStorage.setItem(ACTIVE, targetKey);
    for (const record of records()) {
      if (record.key !== targetKey && record.value?.name === item.project?.name) w.localStorage.setItem(record.key, text);
    }
    const check = JSON.parse(w.localStorage.getItem(targetKey) || 'null');
    if (!check?.files || Object.keys(check.files).length !== Object.keys(item.project.files || {}).length) throw new Error('The project snapshot could not be restored completely.');
  }
  function initialsIcon(name) {
    const initials = String(name || 'App').trim().split(/\s+/).slice(0,2).map(x => x[0] || '').join('').toUpperCase() || 'A';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#22d3ee"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#g)"/><text x="256" y="304" text-anchor="middle" font-family="Arial" font-size="190" font-weight="800" fill="#07101c">${esc(initials)}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  function saveSelected() {
    try {
      const d = appDoc();
      const selectedKey = d?.querySelector('#appsProjectSelect')?.value || '';
      const rec = chooseRecord(selectedKey);
      if (!rec?.value) throw new Error('Choose the project you want to save.');
      const p = rec.value;
      const emptyEntry = Object.entries(p.files || {}).find(([n,v]) => /(^|\/)index\.html?$/i.test(n) && !String(v || '').trim());
      if (emptyEntry) throw new Error(`${emptyEntry[0]} is empty. Restore it before saving.`);
      const titleInput = d.querySelector('#appsStoreName');
      const title = String(titleInput?.value || projectName(p)).trim() || projectName(p);
      const list = apps();
      const old = list.find(x => String(x.name || '').toLowerCase() === title.toLowerCase());
      const item = {
        id: old?.id || `app-${Date.now()}`,
        name: title,
        type: typeOf(p),
        fileCount: Object.keys(p.files || {}).length,
        createdAt: old?.createdAt || Date.now(),
        updatedAt: Date.now(),
        installName: old?.installName || title,
        icon: old?.icon || '',
        snapshotVersion: 3,
        projectKey: rec.key,
        project: copy({...p, name: title}),
        linkedStorage: captureStorage()
      };
      put(old ? list.map(x => x.id === old.id ? item : x) : [item, ...list]);
      render();
      status(`Saved “${title}” from ${rec.key} with ${item.fileCount} files.`);
    } catch (error) { status(error.message || 'App could not be saved.', true); }
  }
  function open(id) {
    try {
      const item = apps().find(x => x.id === id);
      if (!item) throw new Error('Saved app not found.');
      restore(item);
      status(`Restored “${item.name}”. Reloading…`);
      setTimeout(() => appWin().location.reload(), 150);
    } catch (error) { status(error.message || 'App could not be opened.', true); }
  }
  function readImage(file) {
    return new Promise((resolve,reject) => {
      if (!file) return resolve('');
      if (!file.type.startsWith('image/')) return reject(new Error('Choose an image file.'));
      if (file.size > 2000000) return reject(new Error('Icon must be under 2 MB.'));
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(new Error('The image could not be read.')); reader.readAsDataURL(file);
    });
  }
  function resizePng(source,size) {
    return new Promise((resolve,reject) => { const image = new Image(); image.onload = () => { try { const canvas=document.createElement('canvas'); canvas.width=size; canvas.height=size; const ctx=canvas.getContext('2d'); ctx.fillStyle='#07101c'; ctx.fillRect(0,0,size,size); const scale=Math.min(size/image.naturalWidth,size/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale; ctx.drawImage(image,(size-w)/2,(size-h)/2,w,h); resolve(canvas.toDataURL('image/png')); } catch(e){ reject(e); } }; image.onerror=()=>reject(new Error('The app icon could not be prepared.')); image.src=source; });
  }
  function install(id) {
    const item = apps().find(x => x.id === id); if (!item) return;
    const overlay=document.createElement('div'); overlay.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#020711e8;overflow:auto;padding:16px;font-family:system-ui;color:#edf5ff';
    const icon=item.icon||initialsIcon(item.installName||item.name);
    overlay.innerHTML=`<div style="max-width:520px;margin:28px auto;background:#0d1727;border:1px solid #365477;border-radius:20px;padding:18px;display:grid;gap:14px"><h2 style="margin:0">Install app</h2><label>App name<input data-name value="${esc(item.installName||item.name)}" style="width:100%;padding:12px"></label><img data-preview src="${icon}" style="width:82px;height:82px;border-radius:18px;object-fit:cover"><input data-icon type="file" accept="image/*"><div data-error style="color:#ff7892"></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:9px"><button data-cancel>Cancel</button><button data-continue>Continue to install</button></div></div>`;
    document.body.appendChild(overlay);
    let selected=item.icon||''; const name=overlay.querySelector('[data-name]'), preview=overlay.querySelector('[data-preview]'), error=overlay.querySelector('[data-error]');
    overlay.querySelector('[data-cancel]').onclick=()=>overlay.remove();
    overlay.querySelector('[data-icon]').onchange=async e=>{try{selected=await readImage(e.target.files?.[0]);if(selected)preview.src=selected;}catch(err){error.textContent=err.message;}};
    overlay.querySelector('[data-continue]').onclick=async()=>{try{const installName=String(name.value||'').trim();if(!installName)throw new Error('Enter an app name.');const source=selected||initialsIcon(installName);const [icon192,icon512]=await Promise.all([resizePng(source,192),resizePng(source,512)]);const safe=safeId(id);const response=await fetch(`/mobile-apps/${encodeURIComponent(safe)}/config`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:installName,icon192,icon512})});if(!response.ok)throw new Error('The app package could not be prepared.');put(apps().map(x=>x.id===id?{...x,installName,icon:source,updatedAt:Date.now()}:x));overlay.remove();render();window.open(`/mobile-apps/${encodeURIComponent(safe)}/?v=${Date.now()}`,'_blank','noopener');}catch(err){error.textContent=err.message;}};
  }
  function duplicate(id){const list=apps(),source=list.find(x=>x.id===id);if(!source)return;const item=copy(source);item.id=`app-${Date.now()}`;item.name+=' Copy';item.installName=item.name;item.project.name=item.name;item.createdAt=item.updatedAt=Date.now();put([item,...list]);render();}
  function remove(id){put(apps().filter(x=>x.id!==id));render();}
  function exportApp(id){const item=apps().find(x=>x.id===id);if(!item)return;const blob=new Blob([JSON.stringify({format:'codem8s-app',version:3,app:item},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${safeId(item.name)}.codem8s.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function fillProjectSelect() {
    const d=appDoc(), select=d?.querySelector('#appsProjectSelect'); if(!select)return;
    const list=records(), active=activeRecord();
    select.innerHTML=list.map(({key,value})=>`<option value="${esc(key)}">${esc(projectName(value))} · ${Object.keys(value.files||{}).length} files · ${esc(key)}</option>`).join('');
    if(active) select.value=active.key;
    const name=d.querySelector('#appsStoreName'); if(active?.value&&name) name.value=projectName(active.value);
    const label=d.querySelector('#appsSelectedProject'); if(label) label.textContent=active?`Current selection: ${projectName(active.value)} (${active.key})`:'No project selected';
  }
  function render(){const d=appDoc(),grid=d?.querySelector('#appsStoreGrid');if(!grid)return;const q=(d.querySelector('#appsStoreSearch')?.value||'').toLowerCase();const list=apps().filter(x=>!q||`${x.name} ${x.type}`.toLowerCase().includes(q));grid.innerHTML=list.length?list.map(x=>`<article style="border:1px solid #29425f;background:#091626;border-radius:14px;padding:12px;display:grid;gap:10px"><div><strong>${esc(x.name)}</strong><div style="color:#8fa4c1;font-size:11px">${esc(x.type)} · ${x.fileCount} files · snapshot v${x.snapshotVersion||1} · ${esc(x.projectKey||'legacy')}</div></div><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px"><button class="toolbtn" data-open="${x.id}">Open</button><button class="toolbtn" data-install="${x.id}">Install</button><button class="toolbtn" data-copy="${x.id}">Duplicate</button><button class="toolbtn" data-export="${x.id}">Export</button><button class="toolbtn dangerbtn" style="grid-column:1/-1" data-remove="${x.id}">Delete</button></div></article>`).join(''):'<div class="empty">No saved apps yet.</div>';}
  function activate(tab,pane){const d=appDoc();if(!d)return;d.querySelectorAll('.tab').forEach(n=>n.classList.remove('active'));d.querySelectorAll('.workspace').forEach(n=>n.classList.remove('active'));tab.classList.add('active');pane.classList.add('active');fillProjectSelect();render();}
  function wire(){const d=appDoc();if(!d||d.documentElement.dataset.appStore)return;const toolbar=d.querySelector('.toolbar'),main=d.querySelector('.main');if(!toolbar||!main)return;d.documentElement.dataset.appStore='1';const tab=d.createElement('button');tab.className='tab';tab.textContent='Apps';toolbar.insertBefore(tab,toolbar.querySelector('.spacer'));const pane=d.createElement('div');pane.id='appsPane';pane.className='workspace';pane.innerHTML=`<div style="height:100%;overflow:auto;padding:14px"><div style="max-width:1100px;margin:auto"><h2>My Apps</h2><label style="display:grid;gap:6px"><strong>Project to save</strong><select id="appsProjectSelect" style="padding:11px;border-radius:10px;background:#07111f;color:#edf5ff;border:1px solid #365477"></select></label><div id="appsSelectedProject" style="color:#8fa4c1;margin:8px 0"></div><div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px"><input id="appsStoreName" placeholder="App name"><button id="appsStoreSave" class="toolbtn">Save selected project</button></div><input id="appsStoreSearch" placeholder="Search apps" style="margin-top:8px"><div id="appsStoreStatus" class="status">Choose the exact current project before saving.</div><div id="appsStoreGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;margin-top:10px"></div></div></div>`;main.appendChild(pane);tab.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();activate(tab,pane);},true);d.querySelector('#appsProjectSelect').onchange=e=>{const rec=chooseRecord(e.target.value);const name=d.querySelector('#appsStoreName');if(rec?.value&&name)name.value=projectName(rec.value);const label=d.querySelector('#appsSelectedProject');if(label&&rec)label.textContent=`Current selection: ${projectName(rec.value)} (${rec.key})`;};d.querySelector('#appsStoreSave').onclick=saveSelected;d.querySelector('#appsStoreSearch').oninput=render;pane.onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.open)open(b.dataset.open);if(b.dataset.install)install(b.dataset.install);if(b.dataset.copy)duplicate(b.dataset.copy);if(b.dataset.export)exportApp(b.dataset.export);if(b.dataset.remove)remove(b.dataset.remove);};fillProjectSelect();render();}
  frame?.addEventListener('load',wire);setInterval(wire,1000);
})();