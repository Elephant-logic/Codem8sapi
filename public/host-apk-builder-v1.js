(() => {
  const frame = document.getElementById('codem8s-app');
  const STORE = 'codem8s_app_store_v1';
  const appWin = () => frame?.contentWindow;
  const appDoc = () => { try { return frame?.contentDocument; } catch { return null; } };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function apps() { try { return JSON.parse(appWin()?.localStorage.getItem(STORE) || '[]'); } catch { return []; } }
  function put(items) { appWin()?.localStorage.setItem(STORE, JSON.stringify(items.slice(0, 40))); }
  function framework(project) {
    const names = Object.keys(project?.files || {});
    const pkg = names.find(name => /(^|\/)package\.json$/i.test(name));
    return names.some(name => /\.(tsx?|jsx)$/i.test(name)) || !!(pkg && /"(?:react|vite|typescript|next|webpack)"\s*:/i.test(project.files[pkg] || ''));
  }
  function norm(base, ref) {
    const out = [];
    for (const part of base.split('/').slice(0, -1).concat(ref.split('/'))) {
      if (!part || part === '.') continue;
      part === '..' ? out.pop() : out.push(part);
    }
    return out.join('/');
  }
  function staticHtml(project) {
    const files = project?.files || {};
    const names = Object.keys(files);
    const entry = names.find(name => /(^|\/)index\.html?$/i.test(name)) || names.find(name => /\.html?$/i.test(name));
    if (!entry) throw new Error('No HTML entry file was found for the APK.');
    let html = String(files[entry] || '');
    if (!html.trim()) throw new Error('The HTML entry file is empty. Repair index.html before building the APK.');
    html = html.replace(/<link\b([^>]*?)href=["']([^"']+)["']([^>]*)>/gi, (all, before, ref) => {
      const local = norm(entry, ref);
      return files[local] != null && /\.css$/i.test(local) ? `<style>${files[local]}</style>` : all;
    });
    html = html.replace(/<script\b([^>]*?)src=["']([^"']+)["']([^>]*)><\/script>/gi, (all, before, ref, after) => {
      const local = norm(entry, ref);
      return files[local] != null ? `<script${before}${after}>${String(files[local]).replace(/<\/script/gi, '<\\/script')}<\/script>` : all;
    });
    return html;
  }
  function initialsIcon(name) {
    const initials = String(name || 'App').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase() || 'A';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#22d3ee"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#g)"/><text x="256" y="304" text-anchor="middle" font-family="Arial,sans-serif" font-size="190" font-weight="800" fill="#07101c">${esc(initials)}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  function readImage(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve('');
      if (!file.type.startsWith('image/')) return reject(new Error('Choose an image file.'));
      if (file.size > 4_000_000) return reject(new Error('Thumbnail must be under 4 MB.'));
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('The thumbnail could not be read.'));
      reader.readAsDataURL(file);
    });
  }
  function resizePng(source, size) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#07101c'; ctx.fillRect(0, 0, size, size);
          const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
          const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
          ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
          resolve(canvas.toDataURL('image/png'));
        } catch (error) { reject(error); }
      };
      image.onerror = () => reject(new Error('The app icon could not be prepared.'));
      image.src = source || '/codem8s-app-icon.svg';
    });
  }
  function chooseBuildSettings(item) {
    return new Promise(resolve => {
      const panel = document.createElement('div');
      panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#020711ed;padding:16px;overflow:auto;color:#edf5ff;font-family:system-ui';
      const currentName = item.installName || item.name;
      const currentIcon = item.icon || initialsIcon(currentName);
      panel.innerHTML = `<div style="max-width:520px;margin:30px auto;background:#0d1727;border:1px solid #365477;border-radius:20px;padding:20px;display:grid;gap:14px;box-shadow:0 25px 80px #000"><h2 style="margin:0">Build Android APK</h2><p style="margin:0;color:#9db0c8">Choose the app name and launcher thumbnail.</p><label style="display:grid;gap:6px;font-weight:800">App name<input data-name value="${esc(currentName)}" style="padding:12px;border-radius:11px;border:1px solid #365477;background:#07111f;color:#edf5ff;font-size:16px"></label><div style="display:grid;grid-template-columns:92px minmax(0,1fr);gap:14px;align-items:center"><img data-preview src="${currentIcon}" alt="APK thumbnail" style="width:92px;height:92px;border-radius:20px;object-fit:cover;background:#142843"><div style="display:grid;gap:9px"><label style="font-weight:800">Thumbnail / app icon</label><input data-icon type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"><button data-generated style="padding:10px;border-radius:10px;border:1px solid #365477;background:#142843;color:#edf5ff;font-weight:800">Use generated icon</button></div></div><div data-error style="min-height:20px;color:#ff7892"></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:9px"><button data-cancel style="padding:12px;border-radius:11px;border:1px solid #365477;background:#142843;color:#edf5ff;font-weight:800">Cancel</button><button data-build style="padding:12px;border:0;border-radius:11px;background:linear-gradient(135deg,#64dcff,#927cff);color:#06101b;font-weight:900">Build APK</button></div></div>`;
      document.body.appendChild(panel);
      const nameInput = panel.querySelector('[data-name]');
      const iconInput = panel.querySelector('[data-icon]');
      const preview = panel.querySelector('[data-preview]');
      const errorNode = panel.querySelector('[data-error]');
      let selectedIcon = item.icon || '';
      panel.querySelector('[data-cancel]').onclick = () => { panel.remove(); resolve(null); };
      panel.querySelector('[data-generated]').onclick = () => { selectedIcon = ''; preview.src = initialsIcon(nameInput.value || item.name); };
      nameInput.oninput = () => { if (!selectedIcon) preview.src = initialsIcon(nameInput.value || item.name); };
      iconInput.onchange = async () => {
        try { selectedIcon = await readImage(iconInput.files?.[0]); if (selectedIcon) preview.src = selectedIcon; errorNode.textContent = ''; }
        catch (error) { errorNode.textContent = error.message; iconInput.value = ''; }
      };
      panel.querySelector('[data-build]').onclick = () => {
        const name = String(nameInput.value || '').trim();
        if (!name) { errorNode.textContent = 'Enter an app name.'; return; }
        const icon = selectedIcon || initialsIcon(name);
        panel.remove();
        resolve({ name, icon });
      };
    });
  }
  function showPanel(name) {
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#020711ed;padding:16px;overflow:auto;color:#edf5ff;font-family:system-ui';
    panel.innerHTML = `<div style="max-width:520px;margin:30px auto;background:#0d1727;border:1px solid #365477;border-radius:20px;padding:20px;display:grid;gap:14px;box-shadow:0 25px 80px #000"><h2 style="margin:0">Build Android APK</h2><p style="margin:0;color:#9db0c8">${esc(name)}</p><div data-state style="padding:14px;border-radius:12px;background:#07111f;color:#b9c9dc">Preparing the saved app…</div><div data-actions style="display:grid;gap:9px"><button data-close style="padding:12px;border-radius:11px;border:1px solid #365477;background:#142843;color:#edf5ff;font-weight:800">Close</button></div></div>`;
    document.body.appendChild(panel);
    panel.querySelector('[data-close]').onclick = () => panel.remove();
    return { panel, state: panel.querySelector('[data-state]'), actions: panel.querySelector('[data-actions]') };
  }
  async function requestJson(url, options = {}, attempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetch(url, {...options, cache:'no-store'});
        const text = await response.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch { data = {error:{message:text.slice(0,300)}}; }
        if (!response.ok) throw new Error(data?.error?.message || `${url} returned ${response.status}.`);
        return data;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 2500));
      }
    }
    throw lastError || new Error('The Codem8s server could not be reached.');
  }
  async function wakeBackend() { await requestJson('/api/health', {}, 4); }
  async function finishedHtml(project) {
    if (!framework(project)) return staticHtml(project);
    await wakeBackend();
    const files = {};
    for (const [name, value] of Object.entries(project?.files || {})) if (typeof value === 'string') files[name] = value;
    const data = await requestJson('/api/build-preview', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ files }) }, 3);
    if (!data.html) throw new Error('The framework compiler returned no Android page.');
    return data.html;
  }
  async function pollBuild(id, ui) {
    const started = Date.now();
    while (Date.now() - started < 12 * 60 * 1000) {
      await new Promise(resolve => setTimeout(resolve, 6000));
      const data = await requestJson(`/api/apk-builds/${encodeURIComponent(id)}`, {}, 2);
      if (data.ready) {
        ui.state.textContent = 'APK ready. Tap Download APK, then allow installation from this browser when Android asks.';
        const link = document.createElement('a');
        link.href = data.downloadUrl; link.textContent = 'Download APK';
        link.style.cssText = 'display:block;text-align:center;padding:13px;border-radius:11px;background:linear-gradient(135deg,#64dcff,#927cff);color:#06101b;font-weight:900;text-decoration:none';
        ui.actions.insertBefore(link, ui.actions.firstChild);
        return;
      }
      ui.state.textContent = 'Building Android APK on GitHub… This normally takes a few minutes.';
    }
    throw new Error('The Android build is taking longer than expected. Close this panel and try Build APK again later.');
  }
  async function buildApk(id) {
    const item = apps().find(app => app.id === id);
    if (!item?.project) return;
    const settings = await chooseBuildSettings(item);
    if (!settings) return;
    put(apps().map(app => app.id === id ? {...app, installName: settings.name, icon: settings.icon, updatedAt: Date.now()} : app));
    const ui = showPanel(settings.name);
    try {
      ui.state.textContent = 'Waking the Codem8s build server…';
      await wakeBackend();
      ui.state.textContent = 'Compiling the saved app into one Android page…';
      const [html, icon512] = await Promise.all([finishedHtml(item.project), resizePng(settings.icon, 512)]);
      ui.state.textContent = 'Sending the Android build request…';
      const data = await requestJson('/api/apk-builds', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ appId: item.id, name: settings.name, icon512, html })
      }, 2);
      ui.state.textContent = 'Build started. GitHub is creating the APK…';
      await pollBuild(data.id, ui);
    } catch (error) {
      ui.state.textContent = error?.message || 'The Android build failed.';
      ui.state.style.color = '#ff7892';
    }
  }
  function wire() {
    const d = appDoc();
    if (!d) return;
    d.querySelectorAll('#appsStoreGrid article').forEach(card => {
      if (card.querySelector('[data-build-apk]')) return;
      const id = card.querySelector('[data-open]')?.dataset.open;
      const grid = card.querySelector('div[style*="grid-template-columns"]:last-child') || card.lastElementChild;
      if (!id || !grid) return;
      const button = d.createElement('button');
      button.className = 'toolbtn'; button.dataset.buildApk = id; button.textContent = 'Build APK'; button.style.gridColumn = '1/-1';
      grid.insertBefore(button, grid.lastElementChild);
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); buildApk(id); });
    });
  }
  frame?.addEventListener('load', wire);
  setInterval(wire, 800);
})();