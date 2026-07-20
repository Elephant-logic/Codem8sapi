(() => {
  const VERSION = '10.6.3';
  const frame = document.getElementById('codem8s-app');
  const badge = document.getElementById('codem8s-version');
  if (badge) badge.textContent = `Codem8s ${VERSION}`;

  const PROJECT_KEYS = ['codem8s_project_v4', 'codem8s_project_v7', 'codem8s_project_v8'];

  function appWindow() { return frame && frame.contentWindow; }
  function appDocument() {
    try { return frame && frame.contentDocument; } catch { return null; }
  }

  function readProject() {
    const win = appWindow();
    if (!win) return null;
    for (const key of PROJECT_KEYS) {
      try {
        const value = JSON.parse(win.localStorage.getItem(key) || 'null');
        if (value && value.files && typeof value.files === 'object') return value;
      } catch {}
    }
    return null;
  }

  function isFrameworkProject(project) {
    const names = Object.keys(project?.files || {});
    if (names.some((name) => /\.(tsx?|jsx)$/i.test(name))) return true;
    const packageName = names.find((name) => /(^|\/)package\.json$/i.test(name));
    const text = packageName ? project.files[packageName] : '';
    return /"(?:react|react-scripts|vite|typescript|next|webpack)"\s*:/i.test(text || '');
  }

  function previewFrame() {
    const doc = appDocument();
    return doc && doc.querySelector('#preview, iframe.preview, #previewPane iframe');
  }

  function setStatus(text, type = '') {
    const doc = appDocument();
    const node = doc && doc.querySelector('#status, .status');
    if (!node) return;
    node.textContent = text;
    node.classList.remove('ok', 'err');
    if (type) node.classList.add(type);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
  }

  function showMessage(title, body, error = false) {
    const preview = previewFrame();
    if (!preview) return;
    preview.srcdoc = `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#07101c;color:#eaf3ff;font-family:system-ui;padding:24px"><h2 style="color:${error ? '#ff7892' : '#64dcff'}">${escapeHtml(title)}</h2><pre style="white-space:pre-wrap;font:14px/1.5 system-ui">${escapeHtml(body)}</pre></body></html>`;
  }

  function guaranteeReactMount(html) {
    let output = String(html || '');
    const mountExpression = '(document.getElementById("root")||document.body.appendChild(Object.assign(document.createElement("div"),{id:"root"})))';

    output = output
      .replace(/document\.getElementById\(\s*["']root["']\s*\)/g, mountExpression)
      .replace(/document\.querySelector\(\s*["']#root["']\s*\)/g, mountExpression);

    if (!/id=["']root["']/i.test(output)) {
      const rootNode = '<div id="root"></div>';
      const bodyOpen = output.match(/<body\b[^>]*>/i);
      if (bodyOpen && typeof bodyOpen.index === 'number') {
        const at = bodyOpen.index + bodyOpen[0].length;
        output = output.slice(0, at) + rootNode + output.slice(at);
      } else {
        output = rootNode + output;
      }
    }
    return output;
  }

  let compiling = false;
  async function compileFrameworkPreview() {
    if (compiling) return;
    const project = readProject();
    if (!isFrameworkProject(project)) return;
    compiling = true;
    const doc = appDocument();
    const autoFix = doc && doc.querySelector('#autoFix');
    if (autoFix) autoFix.checked = false;
    showMessage('Compiling framework preview…', `Codem8s ${VERSION}\nReact/TypeScript project detected.`);
    setStatus('Compiling React/TypeScript preview…');
    try {
      const response = await fetch('/api/build-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: project.files })
      });
      const data = await response.json();
      if (!response.ok) {
        const details = [data?.error?.message, ...(data?.error?.details || [])].filter(Boolean).join('\n');
        throw new Error(details || 'Framework preview failed.');
      }
      const preview = previewFrame();
      if (preview) {
        preview.srcdoc = guaranteeReactMount(data.html);
        preview.addEventListener('load', () => {
          setTimeout(() => {
            try {
              const previewDoc = preview.contentDocument;
              const root = previewDoc && previewDoc.getElementById('root');
              const runtimeError = previewDoc && previewDoc.getElementById('codem8s-runtime-error');
              if (runtimeError) return;
              if (root && (root.firstElementChild || root.textContent.trim())) {
                setStatus(`Framework preview running from ${data.entry} with Demo Backend.`, 'ok');
              } else {
                setStatus('Framework compiled but did not render. See Preview.', 'err');
              }
            } catch {}
          }, 1200);
        }, { once: true });
      }
      setStatus(`Framework preview compiled from ${data.entry}; starting app…`);
    } catch (error) {
      showMessage('Framework compile error', `${error.message || error}\n\nSource preserved. Automatic repair was not started.`, true);
      setStatus('Framework compilation failed. See Preview.', 'err');
    } finally {
      compiling = false;
    }
  }

  function wireApp() {
    const doc = appDocument();
    if (!doc || doc.documentElement.dataset.codem8sHostWired) return;
    doc.documentElement.dataset.codem8sHostWired = '1';
    doc.addEventListener('click', (event) => {
      const target = event.target.closest('#runPreview, #openPreview, [data-pane="previewPane"], .tab');
      if (!target) return;
      const text = (target.textContent || '').trim().toLowerCase();
      if (target.matches('#runPreview, #openPreview, [data-pane="previewPane"]') || text === 'preview') {
        setTimeout(compileFrameworkPreview, 120);
      }
    }, true);

    const observer = new MutationObserver(() => {
      const project = readProject();
      if (!isFrameworkProject(project)) return;
      const status = doc.querySelector('#status, .status');
      if (status && /Build tested successfully/i.test(status.textContent || '')) {
        status.textContent = 'Source checks passed. Compiling framework preview…';
        status.classList.remove('ok');
        compileFrameworkPreview();
      }
    });
    observer.observe(doc.body, { subtree: true, childList: true, characterData: true });
  }

  frame.addEventListener('load', wireApp);
  setInterval(wireApp, 1000);
})();