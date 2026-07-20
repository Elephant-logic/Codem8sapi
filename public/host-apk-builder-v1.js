(() => {
  const frame = document.getElementById('codem8s-app');
  const STORE = 'codem8s_app_store_v1';
  const appWin = () => frame?.contentWindow;
  const appDoc = () => { try { return frame?.contentDocument; } catch { return null; } };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function apps() { try { return JSON.parse(appWin()?.localStorage.getItem(STORE) || '[]'); } catch { return []; } }
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
    if (!html.trim()) throw new Error('The saved app has an empty index.html. Open the app and regenerate or restore that file before building.');
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
  function showPanel(item) {
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#020711ed;padding:16px;overflow:auto;color:#edf5ff;font-family:system-ui';
    panel.innerHTML = `<div style="max-width:520px;margin:30px auto;background:#0d1727;border:1px solid #365477;border-radius:20px;padding:20px;display:grid;gap:14px;box-shadow:0 25px 80px #000"><h2 style="margin:0">Build Android APK</h2><p style="margin:0;color:#9db0c8">${esc(item.name)}</p><div data-state style="padding:14px;border-radius:12px;background:#07111f;color:#b9c9dc">Preparing the saved app…</div><div data-actions style="display:grid;gap:9px"><button data-close style="padding:12px;border-radius:11px;border:1px solid #365477;background:#142843;color:#edf5ff;font-weight:800">Close</button></div></div>`;
    document.body.appendChild(panel);
    panel.querySelector('[data-close]').onclick = () => panel.remove();
    return { panel, state: panel.querySelector('[data-state]'), actions: panel.querySelector('[data-actions]') };
  }
  async function requestJson(path, options = {}, attempts = 2) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120000);
        const response = await fetch(new URL(path, location.origin), {
          cache: 'no-store', credentials: 'same-origin', ...options, signal: controller.signal
        });
        clearTimeout(timer);
        const text = await response.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch {}
        if (!response.ok) {
          const message = data?.error?.message || text.slice(0, 240) || `Server returned HTTP ${response.status}.`;
          throw Object.assign(new Error(message), { noRetry: response.status < 500 });
        }
        return data;
      } catch (error) {
        lastError = error;
        if (error?.noRetry || attempt === attempts) break;
        try { await fetch(new URL('/api/health', location.origin), { cache: 'no-store', credentials: 'same-origin' }); } catch {}
        await sleep(2500);
      }
    }
    if (lastError?.name === 'AbortError') throw new Error('The server took too long to respond. Render may still be waking up; try Build APK again in a moment.');
    if (lastError instanceof TypeError) throw new Error('Could not reach the Codem8s build server. Check the Render deployment and internet connection, then try again.');
    throw lastError || new Error('The build server could not be reached.');
  }
  function textOnlyFiles(project) {
    const out = {};
    for (const [name, value] of Object.entries(project?.files || {})) {
      if (typeof value === 'string') out[name] = value;
    }
    return out;
  }
  async function finishedHtml(project, ui) {
    if (!framework(project)) return staticHtml(project);
    ui.state.textContent = 'Waking the build server and compiling the React app…';
    const files = textOnlyFiles(project);
    const data = await requestJson('/api/build-preview', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ files })
    });
    if (!data.html) throw new Error('The framework compiler returned no Android page.');
    return data.html;
  }
  async function pollBuild(id, ui) {
    const started = Date.now();
    while (Date.now() - started < 12 * 60 * 1000) {
      await sleep(6000);
      const data = await requestJson(`/api/apk-builds/${encodeURIComponent(id)}`, {}, 2);
      if (data.ready) {
        ui.state.textContent = 'APK ready. Tap Download APK, then allow installation from this browser when Android asks.';
        const link = document.createElement('a');
        link.href = data.downloadUrl;
        link.textContent = 'Download APK';
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
    const ui = showPanel(item);
    try {
      ui.state.textContent = 'Preparing the saved app…';
      const [html, icon512] = await Promise.all([finishedHtml(item.project, ui), resizePng(item.icon || '/codem8s-app-icon.svg', 512)]);
      ui.state.textContent = 'Sending the Android build request…';
      const data = await requestJson('/api/apk-builds', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ appId: item.id, name: item.installName || item.name, icon512, html })
      }, 2);
      if (!data.id) throw new Error('The Android build server did not return a build ID.');
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
    const badge = document.getElementById('codem8s-version');
    if (badge) badge.textContent = 'Codem8s 10.13.1';
    d.querySelectorAll('#appsStoreGrid article').forEach(card => {
      if (card.querySelector('[data-build-apk]')) return;
      const id = card.querySelector('[data-open]')?.dataset.open;
      const grid = card.querySelector('div[style*="grid-template-columns"]:last-child') || card.lastElementChild;
      if (!id || !grid) return;
      const button = d.createElement('button');
      button.className = 'toolbtn';
      button.dataset.buildApk = id;
      button.textContent = 'Build APK';
      button.style.gridColumn = '1/-1';
      grid.insertBefore(button, grid.lastElementChild);
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); buildApk(id); });
    });
  }
  frame?.addEventListener('load', wire);
  setInterval(wire, 800);
})();