(() => {
  const frame = document.getElementById('codem8s-app');
  const BACKUP_PREFIX = 'codem8s_index_backup_v3:';
  const ACTIVE_KEY = 'codem8s_active_project_key';
  let nativeSetItem;
  let nativeRemoveItem;
  let nativeClear;

  const win = () => frame?.contentWindow || null;
  const doc = () => { try { return frame?.contentDocument || null; } catch { return null; } };
  const isProjectKey = key => /^codem8s_project_/i.test(String(key || ''));
  const isBackupKey = key => String(key || '').startsWith(BACKUP_PREFIX);

  function parse(value) {
    try { return JSON.parse(String(value)); } catch { return null; }
  }

  function entry(project) {
    const files = project?.files && typeof project.files === 'object' ? project.files : {};
    const path = Object.keys(files).find(name => /(^|\/)index\.html?$/i.test(name));
    return { path: path || 'index.html', html: path ? String(files[path] || '') : '' };
  }

  function backupKey(projectKey) {
    return `${BACKUP_PREFIX}${projectKey}`;
  }

  function showStatus(message, error = true) {
    const d = doc();
    const node = d?.querySelector('#status, .status, #aiBuilderStatus');
    if (!node) return;
    node.textContent = message;
    node.style.color = error ? '#ff7892' : '#8fa4c1';
    node.classList?.toggle('err', error);
    node.classList?.toggle('ok', !error);
  }

  function saveBackup(storage, projectKey, project) {
    const current = entry(project);
    if (!current.html.trim()) return;
    const backup = {
      projectKey,
      path: current.path,
      html: current.html,
      projectName: project?.name || '',
      at: Date.now()
    };
    try { nativeSetItem.call(storage, backupKey(projectKey), JSON.stringify(backup)); } catch {}
  }

  function readBackup(storage, projectKey) {
    return parse(storage.getItem(backupKey(projectKey)) || 'null');
  }

  function protectedProjectValue(storage, key, rawValue) {
    const before = parse(storage.getItem(key) || 'null');
    const after = parse(rawValue);
    const previous = entry(before);
    const saved = readBackup(storage, key);
    const fallback = previous.html.trim()
      ? { path: previous.path, html: previous.html }
      : saved?.html?.trim()
        ? { path: saved.path || 'index.html', html: saved.html }
        : null;

    if (!after || typeof after !== 'object') {
      if (fallback && before) {
        showStatus('Blocked an invalid project save. The working index.html was preserved.');
        return JSON.stringify(before);
      }
      return rawValue;
    }

    if (!after.files || typeof after.files !== 'object') {
      if (fallback) {
        after.files = { ...(before?.files || {}), [fallback.path]: fallback.html };
        after.updatedAt = Date.now();
        showStatus('Recovered project files after an unsafe save tried to remove them.');
      }
    }

    const next = entry(after);
    if (fallback && (!next.html.trim() || !Object.keys(after.files || {}).some(name => /(^|\/)index\.html?$/i.test(name)))) {
      after.files = { ...(after.files || {}), [next.path || fallback.path || 'index.html']: fallback.html };
      after.updatedAt = Date.now();
      showStatus('Blocked an unsafe save that tried to empty or remove index.html.');
    }

    const finalEntry = entry(after);
    if (finalEntry.html.trim()) saveBackup(storage, key, after);
    return JSON.stringify(after);
  }

  function scanAndRecover() {
    const w = win();
    if (!w || !nativeSetItem) return;
    const storage = w.localStorage;
    const keys = [];
    for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));

    for (const key of keys) {
      if (!isProjectKey(key)) continue;
      const project = parse(storage.getItem(key) || 'null');
      if (!project) continue;
      const current = entry(project);
      if (current.html.trim()) {
        saveBackup(storage, key, project);
        continue;
      }
      const saved = readBackup(storage, key);
      if (!saved?.html?.trim()) continue;
      project.files = { ...(project.files || {}), [saved.path || current.path || 'index.html']: saved.html };
      project.updatedAt = Date.now();
      nativeSetItem.call(storage, key, JSON.stringify(project));
      showStatus('index.html was automatically restored from its protected backup.');
    }
  }

  function installStorageGuard() {
    const w = win();
    if (!w || w.__codem8sPermanentIndexGuard) return;
    w.__codem8sPermanentIndexGuard = true;

    nativeSetItem = w.Storage.prototype.setItem;
    nativeRemoveItem = w.Storage.prototype.removeItem;
    nativeClear = w.Storage.prototype.clear;

    w.Storage.prototype.setItem = function guardedSetItem(key, value) {
      const name = String(key || '');
      if (isProjectKey(name)) return nativeSetItem.call(this, name, protectedProjectValue(this, name, value));
      return nativeSetItem.call(this, name, value);
    };

    w.Storage.prototype.removeItem = function guardedRemoveItem(key) {
      const name = String(key || '');
      if (isProjectKey(name)) {
        const project = parse(this.getItem(name) || 'null');
        if (entry(project).html.trim() || readBackup(this, name)?.html?.trim()) {
          showStatus('Project deletion was blocked because it contains a protected index.html.');
          return;
        }
      }
      return nativeRemoveItem.call(this, name);
    };

    w.Storage.prototype.clear = function guardedClear() {
      const removable = [];
      for (let i = 0; i < this.length; i++) {
        const key = this.key(i);
        if (!isProjectKey(key) && !isBackupKey(key) && key !== ACTIVE_KEY) removable.push(key);
      }
      removable.forEach(key => nativeRemoveItem.call(this, key));
      showStatus('Browser data was cleared, but Codem8s projects and protected index backups were kept.', false);
    };

    w.addEventListener('pagehide', scanAndRecover);
    w.addEventListener('beforeunload', scanAndRecover);
    document.addEventListener('visibilitychange', () => { if (document.hidden) scanAndRecover(); });
    scanAndRecover();
  }

  function readNewestProject() {
    const w = win();
    if (!w) return null;
    const records = [];
    for (let i = 0; i < w.localStorage.length; i++) {
      const key = w.localStorage.key(i);
      if (!isProjectKey(key)) continue;
      const value = parse(w.localStorage.getItem(key) || 'null');
      if (value?.files) records.push(value);
    }
    return records.sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))[0] || null;
  }

  function isFramework(project) {
    const names = Object.keys(project?.files || {});
    if (names.some(name => /\.(tsx?|jsx)$/i.test(name))) return true;
    const packageName = names.find(name => /(^|\/)package\.json$/i.test(name));
    return /"(?:react|react-scripts|vite|typescript|next|webpack)"\s*:/i.test(packageName ? project.files[packageName] || '' : '');
  }

  function enforceRepairSafety() {
    const d = doc();
    const w = win();
    if (!d || !w) return;
    if (isFramework(readNewestProject())) {
      const autoFix = d.querySelector('#autoFix');
      if (autoFix?.checked) {
        autoFix.checked = false;
        autoFix.dispatchEvent(new Event('change', { bubbles: true }));
      }
      try { w.localStorage.setItem('codem8s_auto_fix', 'false'); } catch {}
    }
  }

  function enforceAiState() {
    const d = doc();
    if (!d) return;
    const mode = d.querySelector('#aiBuilderMode');
    const status = d.querySelector('#aiBuilderStatus');
    const apply = d.querySelector('#aiBuilderApply');
    if (!mode || !status || mode.value !== 'build') return;

    const text = status.textContent.trim().toLowerCase();
    const patchVisible = apply && !apply.hidden;
    if ((text === 'response ready.' || text === 'ready.' || text === 'response ready') && !patchVisible) {
      status.textContent = 'No patch was produced. Nothing was changed.';
      status.style.color = '#ff7892';
    }
    if (patchVisible && /ready|thinking|reading/.test(text)) {
      status.textContent = 'Patch prepared. Review the files, then tap Apply proposed patch.';
      status.style.color = '#8fa4c1';
    }
  }

  function wireUiSafety() {
    const d = doc();
    if (!d || d.documentElement.dataset.projectSafetyUi === '1') return;
    d.documentElement.dataset.projectSafetyUi = '1';
    d.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      const label = `${button.id} ${button.textContent || ''}`.toLowerCase();
      if (isFramework(readNewestProject()) && /repair|auto fix|retry fix/.test(label)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        showStatus('Framework legacy repair was blocked to protect the working project.');
      }
      if (button.id === 'aiBuilderApply') {
        const status = d.querySelector('#aiBuilderStatus');
        if (status) {
          status.textContent = 'Applying the proposed patch and saving a rollback snapshot…';
          status.style.color = '#8fa4c1';
        }
      }
    }, true);
  }

  function boot() {
    installStorageGuard();
    wireUiSafety();
    enforceRepairSafety();
    enforceAiState();
    scanAndRecover();
  }

  frame?.addEventListener('load', () => setTimeout(boot, 0));
  setInterval(boot, 250);
})();

(() => {
  if (!document.querySelector('script[data-codem8s-apk-builder]')) {
    const script = document.createElement('script');
    script.src = '/host-apk-builder-v1.js?v=1.1.0';
    script.dataset.codem8sApkBuilder = '1';
    document.head.appendChild(script);
  }
  if (!document.querySelector('script[data-codem8s-ai-agent]')) {
    const script = document.createElement('script');
    script.src = '/host-ai-builder-agent-v1.js?v=1.2.0';
    script.dataset.codem8sAiAgent = '1';
    document.head.appendChild(script);
  }
})();