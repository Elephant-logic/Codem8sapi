(() => {
  const VERSION = '10.5.2';
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

  function dependencyImportMap(project) {
    const files = project?.files || {};
    const names = Object.keys(files);
    const packageName = names.find((name) => /(^|\/)frontend\/package\.json$/i.test(name))
      || names.find((name) => /(^|\/)package\.json$/i.test(name));
    if (!packageName) return { imports: {} };
    try {
      const pkg = JSON.parse(files[packageName]);
      const dependencies = {
        ...(pkg.dependencies || {}),
        ...(pkg.peerDependencies || {})
      };
      const imports = {};
      for (const [name, version] of Object.entries(dependencies)) {
        const cleanVersion = String(version || '').replace(/^[~^]/, '');
        const suffix = cleanVersion && !cleanVersion.startsWith('file:') && !cleanVersion.startsWith('workspace:')
          ? `@${cleanVersion}`
          : '';
        imports[name] = `https://esm.sh/${name}${suffix}`;
        imports[`${name}/`] = `https://esm.sh/${name}${suffix}/`;
      }
      return { imports };
    } catch {
      return { imports: {} };
    }
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

  function enhancePreviewHtml(html, project) {
    const importMap = `<script type="importmap">${JSON.stringify(dependencyImportMap(project))}<\/script>`;
    const runtimeGuard = `<script>(function(){function show(message){var old=document.getElementById('codem8s-runtime-error');if(old)old.remove();var box=document.createElement('div');box.id='codem8s-runtime-error';box.style.cssText='position:fixed;inset:0;z-index:2147483647;overflow:auto;background:#07101c;color:#eaf3ff;padding:24px;font:14px/1.5 system-ui';var h=document.createElement('h2');h.textContent='Preview runtime error';h.style.color='#ff7892';var pre=document.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.textContent=String(message||'Unknown runtime error');box.appendChild(h);box.appendChild(pre);document.body.innerHTML='';document.body.appendChild(box)}window.addEventListener('error',function(e){show(e.message||e.error||'Script failed to load')});window.addEventListener('unhandledrejection',function(e){show(e.reason&&e.reason.message||e.reason||'Unhandled promise rejection')});setTimeout(function(){var root=document.getElementById('root');if(root&&!root.firstElementChild&&!root.textContent.trim())show('The framework compiled, but nothing rendered into #root. Check the browser entry file and component imports.')},8000)})();<\/script>`;
    let output = String(html || '');
    if (/<script\b[^>]*type=["']module["']/i.test(output)) {
      output = output.replace(/<script\b[^>]*type=["']module["']/i, `${importMap}${runtimeGuard}<script type="module"`);
    } else if (/<\/head>/i.test(output)) {
      output = output.replace(/<\/head>/i, `${importMap}${runtimeGuard}</head>`);
    } else {
      output = importMap + runtimeGuard + output;
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
      if (preview) preview.srcdoc = enhancePreviewHtml(data.html, project);
      setStatus(`Framework preview compiled from ${data.entry}.`, 'ok');
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
