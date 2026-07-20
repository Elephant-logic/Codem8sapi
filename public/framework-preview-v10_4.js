(() => {
  const VERSION = '10.4.0';
  const PROJECT_KEYS = ['codem8s_project_v4', 'codem8s_project_v7', 'codem8s_project_v8'];

  function readProject() {
    for (const key of PROJECT_KEYS) {
      try {
        const value = JSON.parse(localStorage.getItem(key) || 'null');
        if (value && value.files && typeof value.files === 'object') return value;
      } catch {}
    }
    return null;
  }

  function isFrameworkProject(project) {
    const names = Object.keys(project?.files || {});
    if (names.some((name) => /\.(tsx?|jsx)$/i.test(name))) return true;
    const packageName = names.find((name) => /(^|\/)package\.json$/i.test(name));
    const packageText = packageName ? project.files[packageName] : '';
    return /"(?:react|react-scripts|vite|typescript|next|webpack)"\s*:/i.test(packageText || '');
  }

  function previewFrame() {
    return document.querySelector('#preview, iframe.preview, #previewPane iframe');
  }

  function setStatus(text, type = '') {
    const node = document.querySelector('#status, .status');
    if (!node) return;
    node.textContent = text;
    node.classList.remove('ok', 'err');
    if (type) node.classList.add(type);
  }

  function showMessage(title, body) {
    const frame = previewFrame();
    if (!frame) return;
    frame.srcdoc = `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#07101c;color:#eaf3ff;font-family:system-ui;padding:24px"><h2 style="color:#64dcff">${title}</h2><pre style="white-space:pre-wrap;font:14px/1.5 system-ui">${String(body).replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</pre></body></html>`;
  }

  async function compileFrameworkPreview() {
    const project = readProject();
    if (!isFrameworkProject(project)) return false;

    const autoFix = document.querySelector('#autoFix');
    if (autoFix) autoFix.checked = false;
    showMessage('Compiling framework preview…', `Codem8s ${VERSION}\nReact/TypeScript project detected.`);
    setStatus('Compiling React/TypeScript preview…');

    try {
      const response = await fetch('/api/build-preview', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({files: project.files})
      });
      const data = await response.json();
      if (!response.ok) {
        const details = [data?.error?.message, ...(data?.error?.details || [])].filter(Boolean).join('\n');
        throw new Error(details || 'Framework preview failed.');
      }
      const frame = previewFrame();
      if (frame) frame.srcdoc = data.html;
      setStatus(`Framework preview compiled from ${data.entry}.`, 'ok');
    } catch (error) {
      showMessage('Framework compile error', `${error.message || error}\n\nSource preserved. Automatic repair was not started.`);
      setStatus('Framework source exists, but compilation failed. See Preview.', 'err');
    }
    return true;
  }

  function wire() {
    const badge = document.createElement('div');
    badge.textContent = `Codem8s ${VERSION}`;
    badge.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:99999;background:#10243c;color:#64dcff;border:1px solid #315476;border-radius:999px;padding:5px 9px;font:11px system-ui';
    document.body.appendChild(badge);

    document.addEventListener('click', (event) => {
      const button = event.target.closest('#runPreview, #openPreview, [data-pane="previewPane"], .tab');
      if (!button) return;
      setTimeout(() => compileFrameworkPreview(), 80);
    }, true);

    const observer = new MutationObserver(() => {
      const project = readProject();
      if (!isFrameworkProject(project)) return;
      const status = document.querySelector('#status, .status');
      if (status && /Build tested successfully/i.test(status.textContent || '')) {
        status.textContent = 'Source checks passed. Compiling framework preview…';
        status.classList.remove('ok');
        compileFrameworkPreview();
      }
    });
    observer.observe(document.body, {subtree: true, childList: true, characterData: true});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
