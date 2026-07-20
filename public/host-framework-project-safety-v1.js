(() => {
  const frame = document.getElementById('codem8s-app');
  const PROJECT_KEYS = ['codem8s_project_v4','codem8s_project_v7','codem8s_project_v8','codem8s_project_v3'];
  const STORE_KEY = 'codem8s_app_store_v1';
  const clone = value => JSON.parse(JSON.stringify(value));

  function win() { return frame && frame.contentWindow; }
  function doc() { try { return frame && frame.contentDocument; } catch { return null; } }
  function readProject() {
    const w = win();
    if (!w) return null;
    for (const key of PROJECT_KEYS) {
      try {
        const value = JSON.parse(w.localStorage.getItem(key) || 'null');
        if (value && value.files && typeof value.files === 'object') return value;
      } catch {}
    }
    return null;
  }
  function isFramework(project) {
    const names = Object.keys(project?.files || {});
    if (names.some(name => /\.(tsx?|jsx)$/i.test(name))) return true;
    const packageName = names.find(name => /(^|\/)package\.json$/i.test(name));
    const text = packageName ? project.files[packageName] : '';
    return /"(?:react|react-scripts|vite|typescript|next|webpack)"\s*:/i.test(text || '');
  }
  function projectName(project) {
    const direct = String(project?.name || '').trim();
    if (direct) return direct;
    const htmlName = Object.keys(project?.files || {}).find(name => /(^|\/)index\.html?$/i.test(name));
    const html = htmlName ? project.files[htmlName] : '';
    const title = String(html || '').match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
    return title || 'Untitled App';
  }
  function typeOf(project) {
    const names = Object.keys(project?.files || {});
    if (names.some(name => /\.(tsx?|jsx)$/i.test(name))) return 'React app';
    if (names.some(name => /\.html?$/i.test(name))) return 'Website';
    return 'Project';
  }
  function setStoreStatus(text, error = false) {
    const node = doc()?.querySelector('#appsStoreStatus');
    if (!node) return;
    node.textContent = text;
    node.style.color = error ? '#ff7892' : '#66e3a4';
  }
  function saveExactCurrentProject() {
    const w = win();
    const d = doc();
    const project = readProject();
    if (!w || !d || !project) {
      setStoreStatus('No active project was found to save.', true);
      return;
    }
    const input = d.querySelector('#appsStoreName');
    const name = String(input?.value || projectName(project)).trim() || projectName(project);
    let list = [];
    try { list = JSON.parse(w.localStorage.getItem(STORE_KEY) || '[]'); } catch {}
    const existing = list.find(item => String(item.name || '').toLowerCase() === name.toLowerCase());
    const item = {
      id: existing?.id || `app-${Date.now()}`,
      name,
      type: typeOf(project),
      fileCount: Object.keys(project.files || {}).length,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
      project: clone({ ...project, name })
    };
    list = existing ? list.map(entry => entry.id === existing.id ? item : entry) : [item, ...list];
    w.localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, 40)));
    setStoreStatus(`${existing ? 'Updated' : 'Saved'} “${name}” with ${item.fileCount} files.`);
    const search = d.querySelector('#appsStoreSearch');
    if (search) search.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function enforceFrameworkSafety() {
    const w = win();
    const d = doc();
    const project = readProject();
    if (!w || !d || !isFramework(project)) return;
    const autoFix = d.querySelector('#autoFix');
    if (autoFix && autoFix.checked) {
      autoFix.checked = false;
      autoFix.dispatchEvent(new Event('change', { bubbles: true }));
    }
    try { w.localStorage.setItem('codem8s_auto_fix', 'false'); } catch {}
  }
  function wire() {
    const d = doc();
    if (!d || d.documentElement.dataset.frameworkProjectSafety === '1') return;
    d.documentElement.dataset.frameworkProjectSafety = '1';
    d.addEventListener('click', event => {
      const project = readProject();
      const button = event.target.closest('button');
      if (!button) return;
      if (button.id === 'appsStoreSave') {
        event.preventDefault();
        event.stopImmediatePropagation();
        saveExactCurrentProject();
        return;
      }
      const text = (button.textContent || '').trim().toLowerCase();
      if (isFramework(project) && (button.id === 'fixNow' || /repair|auto fix/.test(text))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const status = d.querySelector('#status, .status');
        if (status) {
          status.textContent = 'Framework project: legacy repair skipped. Use the compiled Preview result.';
          status.classList.remove('err');
          status.classList.add('ok');
        }
      }
    }, true);
    d.addEventListener('click', event => {
      const tab = event.target.closest('.tab');
      if (!tab || (tab.textContent || '').trim().toLowerCase() !== 'apps') return;
      setTimeout(() => {
        const project = readProject();
        const input = doc()?.querySelector('#appsStoreName');
        if (project && input) input.value = projectName(project);
      }, 0);
    }, true);
  }
  frame?.addEventListener('load', wire);
  setInterval(() => { wire(); enforceFrameworkSafety(); }, 300);
})();

(() => {
  if (document.querySelector('script[data-codem8s-apk-builder]')) return;
  const script = document.createElement('script');
  script.src = '/host-apk-builder-v1.js?v=1.0.0';
  script.dataset.codem8sApkBuilder = '1';
  document.head.appendChild(script);
})();

(() => {
  const frame = document.getElementById('codem8s-app');
  let locked = false;
  let observer = null;
  function appDoc(){ try { return frame?.contentDocument || null; } catch { return null; } }
  function stopRepairLoop(reason){
    if (locked) return;
    locked = true;
    const d = appDoc();
    const w = frame?.contentWindow;
    if (!d || !w) return;
    try { w.localStorage.setItem('codem8s_auto_fix','false'); } catch {}
    const autoFix = d.querySelector('#autoFix');
    if (autoFix) {
      autoFix.checked = false;
      autoFix.disabled = true;
      try { autoFix.dispatchEvent(new Event('change',{bubbles:true})); } catch {}
    }
    d.querySelectorAll('button').forEach(button => {
      const text = (button.textContent || '').trim().toLowerCase();
      if (button.id === 'fixNow' || /repair|auto fix|retry fix/.test(text)) {
        button.disabled = true;
        button.dataset.repairLocked = '1';
      }
    });
    d.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      const text = (button.textContent || '').trim().toLowerCase();
      if (button.dataset.repairLocked === '1' || button.id === 'fixNow' || /repair|auto fix|retry fix/.test(text)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    const status = d.querySelector('#status, .status');
    if (status) {
      status.textContent = reason || 'Repair stopped after a regression. The last working snapshot was kept.';
      status.classList.remove('ok');
      status.classList.add('err');
    }
  }
  function watch(){
    locked = false;
    observer?.disconnect();
    const d = appDoc();
    if (!d?.documentElement) return;
    observer = new MutationObserver(() => {
      const text = d.body?.innerText || '';
      if (/Rejected repair\b|regression detected|Previously passing check failed/i.test(text)) {
        stopRepairLoop('Repair stopped: the attempted fix introduced a regression, so no further automatic repair will run.');
      }
    });
    observer.observe(d.documentElement,{subtree:true,childList:true,characterData:true});
  }
  frame?.addEventListener('load',watch);
  setInterval(() => { if (!observer) watch(); }, 1000);
})();
