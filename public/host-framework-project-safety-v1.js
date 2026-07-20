(() => {
  const frame = document.getElementById('codem8s-app');
  const BACKUP = 'codem8s_index_backup_v4:';
  let nativeSet, nativeRemove, nativeClear;

  const win = () => frame?.contentWindow || null;
  const doc = () => { try { return frame?.contentDocument || null; } catch { return null; } };
  const projectKey = key => /^codem8s_project_/i.test(String(key || ''));
  const parse = value => { try { return JSON.parse(String(value)); } catch { return null; } };
  const entry = project => {
    const files = project?.files && typeof project.files === 'object' ? project.files : {};
    const path = Object.keys(files).find(name => /(^|\/)index\.html?$/i.test(name)) || 'index.html';
    return { path, html: String(files[path] || '') };
  };

  function status(message, error = true) {
    const node = doc()?.querySelector('#status,.status,#aiBuilderStatus');
    if (!node) return;
    node.textContent = message;
    node.style.color = error ? '#ff7892' : '#8fa4c1';
  }

  function backup(storage, key, project) {
    const current = entry(project);
    if (!current.html.trim()) return;
    try { nativeSet.call(storage, `${BACKUP}${key}`, JSON.stringify({ path: current.path, html: current.html, at: Date.now() })); } catch {}
  }

  function saved(storage, key) {
    return parse(storage.getItem(`${BACKUP}${key}`) || 'null');
  }

  function protect(storage, key, value) {
    const before = parse(storage.getItem(key) || 'null');
    const after = parse(value);
    const old = entry(before);
    const copy = saved(storage, key);
    const fallback = old.html.trim() ? old : copy?.html?.trim() ? copy : null;

    if (!after || typeof after !== 'object') {
      if (before && fallback) {
        status('Blocked an invalid project save. The working index.html was preserved.');
        return JSON.stringify(before);
      }
      return value;
    }

    if (!after.files || typeof after.files !== 'object') after.files = { ...(before?.files || {}) };
    const next = entry(after);
    if (fallback && !next.html.trim()) {
      after.files[next.path || fallback.path || 'index.html'] = fallback.html;
      after.updatedAt = Date.now();
      status('Blocked an unsafe save that tried to empty or remove index.html.');
    }
    if (entry(after).html.trim()) backup(storage, key, after);
    return JSON.stringify(after);
  }

  function recover() {
    const w = win();
    if (!w || !nativeSet) return;
    const storage = w.localStorage;
    const keys = [];
    for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
    for (const key of keys) {
      if (!projectKey(key)) continue;
      const project = parse(storage.getItem(key) || 'null');
      if (!project) continue;
      const current = entry(project);
      if (current.html.trim()) { backup(storage, key, project); continue; }
      const copy = saved(storage, key);
      if (!copy?.html?.trim()) continue;
      project.files = { ...(project.files || {}), [copy.path || 'index.html']: copy.html };
      project.updatedAt = Date.now();
      nativeSet.call(storage, key, JSON.stringify(project));
      status('index.html was restored from its protected backup.', false);
    }
  }

  function installStorage() {
    const w = win();
    if (!w || w.__codem8sPermanentIndexGuardV4) return;
    w.__codem8sPermanentIndexGuardV4 = true;
    nativeSet = w.Storage.prototype.setItem;
    nativeRemove = w.Storage.prototype.removeItem;
    nativeClear = w.Storage.prototype.clear;

    w.Storage.prototype.setItem = function(key, value) {
      const name = String(key || '');
      return nativeSet.call(this, name, projectKey(name) ? protect(this, name, value) : value);
    };
    w.Storage.prototype.removeItem = function(key) {
      const name = String(key || '');
      if (projectKey(name) && (entry(parse(this.getItem(name) || 'null')).html.trim() || saved(this, name)?.html?.trim())) {
        status('Project deletion was blocked because it contains a protected index.html.');
        return;
      }
      return nativeRemove.call(this, name);
    };
    w.Storage.prototype.clear = function() {
      const removable = [];
      for (let i = 0; i < this.length; i++) {
        const key = this.key(i);
        if (!projectKey(key) && !String(key || '').startsWith(BACKUP) && key !== 'codem8s_active_project_key') removable.push(key);
      }
      removable.forEach(key => nativeRemove.call(this, key));
      status('Browser data was cleared, but projects and index backups were kept.', false);
    };
    w.addEventListener('pagehide', recover);
    w.addEventListener('beforeunload', recover);
    recover();
  }

  function uiSafety() {
    const d = doc();
    if (!d) return;
    const aiStatus = d.querySelector('#aiBuilderStatus');
    const apply = d.querySelector('#aiBuilderApply');
    if (aiStatus && /^(response )?ready\.?$/i.test(aiStatus.textContent.trim()) && (!apply || apply.hidden)) {
      aiStatus.textContent = 'No patch was produced. Nothing was changed.';
      aiStatus.style.color = '#ff7892';
    }
    if (!d.documentElement.dataset.codem8sSafetyClicks) {
      d.documentElement.dataset.codem8sSafetyClicks = '1';
      d.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        const label = `${button.id} ${button.textContent || ''}`.toLowerCase();
        if (/repair|auto fix|retry fix/.test(label)) {
          const auto = d.querySelector('#autoFix');
          if (auto?.checked) auto.checked = false;
        }
      }, true);
    }
  }

  function boot() { installStorage(); recover(); uiSafety(); }
  frame?.addEventListener('load', () => setTimeout(boot, 0));
  setInterval(boot, 250);
})();

(() => {
  const scripts = [
    ['data-codem8s-apk-builder', '/host-apk-builder-v1.js?v=1.1.0'],
    ['data-codem8s-ai-agent', '/host-ai-builder-agent-v1.js?v=1.2.0'],
    ['data-codem8s-json-recovery', '/host-build-json-recovery-v1.js?v=1.0.0']
  ];
  for (const [attribute, src] of scripts) {
    if (document.querySelector(`script[${attribute}]`)) continue;
    const script = document.createElement('script');
    script.src = src;
    script.setAttribute(attribute, '1');
    document.head.appendChild(script);
  }
})();