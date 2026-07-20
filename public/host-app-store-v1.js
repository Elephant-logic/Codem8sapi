(() => {
  const frame = document.getElementById('codem8s-app');
  const STORE = 'codem8s_app_store_v1';
  const appWin = () => frame?.contentWindow;
  const appDoc = () => { try { return frame?.contentDocument || null; } catch { return null; } };
  const copy = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeId = value => String(value || 'app').replace(/[^a-z0-9_-]/gi, '-');

  function projectRecords() {
    const w = appWin();
    const out = [];
    if (!w) return out;
    for (let i = 0; i < w.localStorage.length; i++) {
      const key = w.localStorage.key(i);
      if (!/^codem8s_project_/i.test(key || '')) continue;
      try {
        const value = JSON.parse(w.localStorage.getItem(key) || 'null');
        if (value?.files && typeof value.files === 'object') out.push({ key, value });
      } catch {}
    }
    return out.sort((a, b) => Number(b.value.updatedAt || b.value.createdAt || 0) - Number(a.value.updatedAt || a.value.createdAt || 0));
  }
  function project() { return projectRecords()[0]?.value || null; }
  function apps() { try { return JSON.parse(appWin().localStorage.getItem(STORE) || '[]'); } catch { return []; } }
  function put(items) { appWin().localStorage.setItem(STORE, JSON.stringify(items.slice(0, 40))); }
  function typeOf(p) {
    const names = Object.keys(p?.files || {});
    if (names.some(n => /\.(tsx?|jsx)$/i.test(n))) return 'React app';
    if (names.some(n => /\.html?$/i.test(n))) return 'Website';
    if (names.some(n => /\.py$/i.test(n))) return 'Python app';
    return 'Project';
  }
  function status(text, error = false) {
    const node = appDoc()?.querySelector('#appsStoreStatus');
    if (!node) return;
    node.textContent = text;
    node.style.color = error ? '#ff7892' : '#66e3a4';
  }
  function captureLinkedStorage() {
    const w = appWin();
    const saved = {};
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
  function restoreSnapshot(item) {
    const w = appWin();
    if (!w || !item?.project) throw new Error('This saved app has no project snapshot.');
    const linked = item.linkedStorage && typeof item.linkedStorage === 'object' ? item.linkedStorage : {};
    for (const [key, value] of Object.entries(linked)) {
      if (key === STORE || typeof value !== 'string') continue;
      w.localStorage.setItem(key, value);
    }
    const text = JSON.stringify(item.project);
    const records = projectRecords();
    if (records.length) records.forEach(({key}) => w.localStorage.setItem(key, text));
    else ['codem8s_project_v8','codem8s_project_v7','codem8s_project_v4','codem8s_project_v3'].forEach(key => w.localStorage.setItem(key, text));
    const verify = projectRecords()[0]?.value;
    if (!verify?.files || Object.keys(verify.files).length !== Object.keys(item.project.files || {}).length) throw new Error('The saved app could not be restored completely.');
  }
  function initialsIcon(name) {
    const initials = String(name || 'App').trim().split(/\s+/).slice(0,2).map(x => x[0] || '').join('').toUpperCase() || 'A';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#22d3ee"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#g)"/><text x="256" y="304" text-anchor="middle" font-family="Arial,sans-serif" font-size="190" font-weight="800" fill="#07101c">${esc(initials)}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  function save(name) {
    try {
      const p = project();
      if (!p) throw new Error('No active project was found to save.');
      const emptyEntry = Object.entries(p.files || {}).find(([n, value]) => /(^|\/)index\.html?$/i.test(n) && !String(value || '').trim());
      if (emptyEntry) throw new Error(`${emptyEntry[0]} is empty. Restore it before saving this app.`);
      const list = apps();
      const title = String(name || p.name || 'Untitled App').trim() || 'Untitled App';
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
        snapshotVersion: 2,
        project: copy({...p, name: title}),
        linkedStorage: captureLinkedStorage()
      };
      put(old ? list.map(x => x.id === old.id ? item : x) : [item, ...list]);
      render();
      status(`Saved complete snapshot “${title}” with ${item.fileCount} files.`);
    } catch (error) { status(error.message || 'App could not be saved.', true); }
  }
  function open(id) {
    try {
      const item = apps().find(x => x.id === id);
      if (!item) throw new Error('Saved app not found.');
      restoreSnapshot(item);
      status(`Restored “${item.name}”. Reloading…`);
      setTimeout(() => appWin().location.reload(), 120);
    } catch (error) { status(error.message || 'App could not be opened.', true); }
  }
  function readImage(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve('');
      if (!file.type.startsWith('image/')) return reject(new Error('Choose an image file.'));
      if (file.size > 2_000_000) return reject(new Error('Icon must be under 2 MB.'));
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('The image could not be read.'));
      reader.readAsDataURL(file);
    });
  }
  function resizePng(source, size) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => { try {
        const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#07101c'; ctx.fillRect(0,0,size,size);
        const scale = Math.min(size/image.naturalWidth,size/image.naturalHeight), width=image.naturalWidth*scale, height=image.naturalHeight*scale;
        ctx.drawImage(image,(size-width)/2,(size-height)/2,width,height); resolve(canvas.toDataURL('image/png'));
      } catch (error) { reject(error); } };
      image.onerror = () => reject(new Error('The app icon could not be prepared.'));
      image.src = source;
    });
  }
  function install(id) {
    const item = apps().find(x => x.id === id); if (!item) return;
    const overlay = document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#020711e8;overflow:auto;padding:16px;font-family:system-ui;color:#edf5ff';
    const currentIcon=item.icon||initialsIcon(item.installName||item.name);
    overlay.innerHTML=`<div style="max-width:520px;margin:28px auto;background:#0d1727;border:1px solid #365477;border-radius:20px;padding:18px;box-shadow:0 25px 80px #000;display:grid;gap:14px"><h2 style="margin:0">Install app</h2><p style="margin:0;color:#9db0c8">Choose the name and picture that will appear on your phone.</p><label style="display:grid;gap:6px;font-weight:700">App name<input data-name value="${esc(item.installName||item.name)}" style="padding:12px;border-radius:11px;border:1px solid #365477;background:#07111f;color:#edf5ff;font-size:16px"></label><div style="display:grid;grid-template-columns:82px 1fr;gap:12px;align-items:center"><img data-preview src="${currentIcon}" alt="App icon" style="width:82px;height:82px;border-radius:18px;object-fit:cover;background:#142843"><div style="display:grid;gap:8px"><label style="font-weight:700">App picture / thumbnail</label><input data-icon type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"><button data-placeholder style="padding:10px;border-radius:10px;border:1px solid #365477;background:#142843;color:#edf5ff;font-weight:800">Use generated icon</button></div></div><div data-error style="min-height:20px;color:#ff7892"></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:9px"><button data-cancel style="padding:12px;border-radius:11px;border:1px solid #365477;background:#142843;color:#edf5ff;font-weight:800">Cancel</button><button data-continue style="padding:12px;border:0;border-radius:11px;background:linear-gradient(135deg,#64dcff,#927cff);color:#06101b;font-weight:900">Continue to install</button></div></div>`;
    document.body.appendChild(overlay);
    const nameInput=overlay.querySelector('[data-name]'), iconInput=overlay.querySelector('[data-icon]'), preview=overlay.querySelector('[data-preview]'), continueButton=overlay.querySelector('[data-continue]'), errorNode=overlay.querySelector('[data-error]');
    let selectedIcon=item.icon||'';
    overlay.querySelector('[data-cancel]').onclick=()=>overlay.remove();
    overlay.querySelector('[data-placeholder]').onclick=()=>{selectedIcon='';preview.src=initialsIcon(nameInput.value||item.name);};
    nameInput.oninput=()=>{if(!selectedIcon)preview.src=initialsIcon(nameInput.value||item.name);};
    iconInput.onchange=async()=>{try{selectedIcon=await readImage(iconInput.files?.[0]);if(selectedIcon)preview.src=selectedIcon;errorNode.textContent='';}catch(error){errorNode.textContent=error.message;iconInput.value='';}};
    continueButton.onclick=async()=>{const installName=String(nameInput.value||'').trim();if(!installName){errorNode.textContent='Enter an app name.';return;}continueButton.disabled=true;errorNode.textContent='Preparing proper app package…';try{const iconSource=selectedIcon||initialsIcon(installName);const [icon192,icon512]=await Promise.all([resizePng(iconSource,192),resizePng(iconSource,512)]);const safe=safeId(id);const response=await fetch(`/mobile-apps/${encodeURIComponent(safe)}/config`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:installName,icon192,icon512})});if(!response.ok)throw new Error('The app package could not be prepared.');put(apps().map(x=>x.id===id?{...x,installName,icon:iconSource,updatedAt:Date.now()}:x));overlay.remove();render();window.open(`/mobile-apps/${encodeURIComponent(safe)}/?v=${Date.now()}`,'_blank','noopener');status(`Opened installer for “${installName}”.`);}catch(error){continueButton.disabled=false;errorNode.textContent=error.message||'The app package could not be prepared.';}};
  }
  function duplicate(id){const list=apps(),source=list.find(x=>x.id===id);if(!source)return;const item=copy(source);item.id=`app-${Date.now()}`;item.name+=' Copy';item.installName=item.name;item.project.name=item.name;item.createdAt=item.updatedAt=Date.now();put([item,...list]);render();status(`Duplicated “${source.name}”.`);}
  function remove(id){put(apps().filter(x=>x.id!==id));render();status('App removed.');}
  function exportApp(id){const item=apps().find(x=>x.id===id);if(!item)return;const blob=new Blob([JSON.stringify({format:'codem8s-app',version:2,app:item},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${item.name.replace(/[^a-z0-9_-]+/gi,'-')||'app'}.codem8s.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function render(){const d=appDoc(),grid=d?.querySelector('#appsStoreGrid');if(!grid)return;const q=(d.querySelector('#appsStoreSearch')?.value||'').toLowerCase();const list=apps().filter(x=>!q||`${x.name} ${x.type}`.toLowerCase().includes(q));grid.innerHTML=list.length?list.map(x=>{const icon=x.icon||initialsIcon(x.installName||x.name);return `<article style="border:1px solid #29425f;background:#091626;border-radius:14px;padding:12px;display:grid;gap:10px"><div style="display:grid;grid-template-columns:54px 1fr;gap:10px;align-items:center"><img src="${icon}" alt="" style="width:54px;height:54px;border-radius:13px;object-fit:cover;background:#142843"><div><strong>${esc(x.name)}</strong><div style="color:#8fa4c1;font-size:11px">${esc(x.type)} · ${x.fileCount} files · snapshot v${x.snapshotVersion||1}</div></div></div><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px"><button class="toolbtn" data-open="${x.id}">Open</button><button class="toolbtn" data-install="${x.id}">Install</button><button class="toolbtn" data-copy="${x.id}">Duplicate</button><button class="toolbtn" data-export="${x.id}">Export</button><button class="toolbtn dangerbtn" style="grid-column:1/-1" data-remove="${x.id}">Delete</button></div></article>`;}).join(''):'<div class="empty">No saved apps yet. Enter a name and tap Save current app.</div>';}
  function activate(tab,pane){const d=appDoc();if(!d)return;d.querySelectorAll('.tab').forEach(n=>n.classList.remove('active'));d.querySelectorAll('.workspace').forEach(n=>n.classList.remove('active'));tab.classList.add('active');pane.classList.add('active');const current=project(),name=d.querySelector('#appsStoreName');if(current?.name&&name)name.value=current.name;render();}
  function wire(){const d=appDoc();if(!d||d.documentElement.dataset.appStore)return;const toolbar=d.querySelector('.toolbar'),main=d.querySelector('.main');if(!toolbar||!main)return;d.documentElement.dataset.appStore='1';const tab=d.createElement('button');tab.className='tab';tab.dataset.pane='appsPane';tab.textContent='Apps';toolbar.insertBefore(tab,toolbar.querySelector('.spacer'));const pane=d.createElement('div');pane.id='appsPane';pane.className='workspace';pane.innerHTML=`<div style="height:100%;overflow:auto;padding:14px"><div style="max-width:1100px;margin:auto"><h2 style="margin:0 0 5px">My Apps</h2><p style="color:#8fa4c1;margin:0 0 12px">Complete project snapshots saved in this browser on this device.</p><div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px"><input id="appsStoreName" placeholder="App name"><button id="appsStoreSave" class="toolbtn">Save current app</button></div><input id="appsStoreSearch" placeholder="Search apps" style="margin-top:8px"><div id="appsStoreStatus" class="status">Save a complete app snapshot, then open, install or export it.</div><div id="appsStoreGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;margin-top:10px"></div></div></div>`;main.appendChild(pane);const current=project();if(current?.name)d.querySelector('#appsStoreName').value=current.name;tab.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();activate(tab,pane);},true);d.querySelector('#appsStoreSave').onclick=()=>save(d.querySelector('#appsStoreName').value);d.querySelector('#appsStoreSearch').oninput=render;pane.onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.open)open(b.dataset.open);if(b.dataset.install)install(b.dataset.install);if(b.dataset.copy)duplicate(b.dataset.copy);if(b.dataset.export)exportApp(b.dataset.export);if(b.dataset.remove)remove(b.dataset.remove);};render();}
  frame?.addEventListener('load',wire);setInterval(wire,1000);
})();