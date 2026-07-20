(() => {
  const VERSION = '10.7.0';
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

  function demoCredentialScript() {
    return `<script>(function(){var attempts=0;function setValue(input,value){if(!input)return;var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))}function fill(){attempts++;var email=document.querySelector('input[type="email"],input[name*="email" i],input[autocomplete="email"]');var password=document.querySelector('input[type="password"],input[name*="password" i],input[autocomplete="current-password"]');if(email&&!email.value)setValue(email,'alice@example.com');if(password&&!password.value)setValue(password,'password');if((!email||!password)&&attempts<40)setTimeout(fill,150)}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fill);else fill()})();<\/script>`;
  }

  function preparePreviewHtml(html) {
    let output = String(html || '');
    const mountExpression = '(document.getElementById("root")||document.body.appendChild(Object.assign(document.createElement("div"),{id:"root"})))';

    output = output
      .replace(/document\.getElementById\(\s*["']root["']\s*\)/g, mountExpression)
      .replace(/document\.querySelector\(\s*["']#root["']\s*\)/g, mountExpression)
      .replace(/new URL\(raw\s*,\s*location\.href\)/g, "new URL(raw,'https://codem8s.preview')");

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

    const credentials = demoCredentialScript();
    const bodyClose = output.toLowerCase().lastIndexOf('</body>');
    output = bodyClose >= 0
      ? output.slice(0, bodyClose) + credentials + output.slice(bodyClose)
      : output + credentials;

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
        preview.srcdoc = preparePreviewHtml(data.html);
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

  function requirementRows(prompt, target) {
    const text = `${prompt} ${target}`.toLowerCase();
    const rows = [
      { id: 'name', title: 'App or business name', kind: 'text', placeholder: 'Use a generated project name' },
      { id: 'logo', title: 'Logo or app icon', kind: 'file', accept: 'image/*,.svg', placeholder: 'Generate a clean placeholder logo' }
    ];
    if (/image|photo|gallery|product|game|background|avatar|illustration|map|portfolio|shop|restaurant|property/.test(text)) {
      rows.push({ id: 'images', title: 'Images or artwork', kind: 'files', accept: 'image/*,.svg', placeholder: 'Use polished placeholder images' });
    }
    if (target === 'fullstack' || /api|weather|map|payment|stripe|openai|\bai\b|chat|email|sms|auth|database|backend|login|register/.test(text)) {
      rows.push({ id: 'api', title: 'API key or private service key', kind: 'secret', placeholder: 'Use safe mock data until a key is added' });
    }
    return rows;
  }

  function rowHtml(row) {
    const input = row.kind === 'text'
      ? `<input data-value="${row.id}" placeholder="Enter value">`
      : row.kind === 'file' || row.kind === 'files'
        ? `<input data-value="${row.id}" type="file" ${row.kind === 'files' ? 'multiple' : ''} accept="${row.accept || ''}">`
        : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:7px"><input data-secret-name placeholder="WEATHER_API_KEY"><input data-secret-value type="password" placeholder="Key value"></div>`;
    return `<section data-row="${row.id}" style="border:1px solid #29425f;border-radius:14px;padding:12px;background:#091626;display:grid;gap:9px"><strong>${row.title}</strong>${input}<select data-choice="${row.id}" style="width:100%;padding:10px;border-radius:10px;background:#07111f;color:#edf5ff;border:1px solid #2b4261"><option value="add">Add now</option><option value="placeholder">Use placeholder</option><option value="skip">Skip</option></select><small style="color:#8fa4c1">${row.placeholder}</small></section>`;
  }

  function transferFiles(doc, files) {
    if (!files || !files.length) return [];
    const input = doc.querySelector('#assetUpload');
    if (!input || typeof DataTransfer === 'undefined') return Array.from(files).map((file) => file.name);
    const dt = new DataTransfer();
    Array.from(files).forEach((file) => dt.items.add(file));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return Array.from(files).map((file) => file.name);
  }

  function addSecret(doc, name, value) {
    if (!name || !value) return false;
    const nameInput = doc.querySelector('#secretName');
    const valueInput = doc.querySelector('#secretValue');
    const typeInput = doc.querySelector('#secretType');
    const button = doc.querySelector('#addSecret');
    if (!nameInput || !valueInput || !button) return false;
    nameInput.value = name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    valueInput.value = value;
    if (typeInput) typeInput.value = 'private';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    valueInput.dispatchEvent(new Event('input', { bubbles: true }));
    button.click();
    return true;
  }

  function openRequirements(doc, buildButton) {
    if (document.getElementById('codem8s-requirements')) return;
    const promptInput = doc.querySelector('#prompt');
    const targetInput = doc.querySelector('#buildTarget');
    const prompt = promptInput?.value?.trim() || '';
    const target = targetInput?.value || 'browser';
    const rows = requirementRows(prompt, target);
    const overlay = document.createElement('div');
    overlay.id = 'codem8s-requirements';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#020711e8;overflow:auto;padding:14px;font-family:system-ui;color:#edf5ff';
    overlay.innerHTML = `<div style="max-width:650px;margin:20px auto;background:#0d1727;border:1px solid #365477;border-radius:18px;padding:16px;box-shadow:0 25px 80px #000"><h2 style="margin:0 0 6px">Build requirements</h2><p style="margin:0 0 14px;color:#8fa4c1">Add what the build needs now, use a placeholder, or skip it.</p><div style="display:grid;gap:10px">${rows.map(rowHtml).join('')}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px"><button data-cancel style="padding:12px;border-radius:11px;border:1px solid #385270;background:#182941;color:#edf5ff;font-weight:800">Cancel</button><button data-continue style="padding:12px;border:0;border-radius:11px;background:linear-gradient(135deg,#64dcff,#927cff);color:#06101b;font-weight:900">Continue build</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-cancel]').onclick = () => overlay.remove();
    overlay.querySelector('[data-continue]').onclick = () => {
      const manifest = {};
      rows.forEach((row) => {
        const choice = overlay.querySelector(`[data-choice="${row.id}"]`)?.value || 'skip';
        if (row.kind === 'text') {
          const value = overlay.querySelector(`[data-value="${row.id}"]`)?.value?.trim() || '';
          manifest[row.id] = choice === 'add' && value ? { status: 'provided', value } : { status: choice };
        } else if (row.kind === 'file' || row.kind === 'files') {
          const files = overlay.querySelector(`[data-value="${row.id}"]`)?.files;
          const names = choice === 'add' ? transferFiles(doc, files) : [];
          manifest[row.id] = names.length ? { status: 'provided', files: names } : { status: choice };
        } else {
          const name = overlay.querySelector('[data-secret-name]')?.value?.trim() || '';
          const value = overlay.querySelector('[data-secret-value]')?.value || '';
          const added = choice === 'add' && addSecret(doc, name, value);
          manifest[row.id] = added ? { status: 'provided', secretName: name.toUpperCase() } : { status: choice, behaviour: choice === 'placeholder' ? 'mock' : 'omit' };
        }
      });
      try { appWindow().localStorage.setItem('codem8s_build_requirements', JSON.stringify(manifest)); } catch {}
      if (promptInput) {
        promptInput.value = `${prompt}\n\nBUILD REQUIREMENTS MANIFEST:\n${JSON.stringify(manifest, null, 2)}\nUse supplied assets and secrets. For placeholders, create polished replaceable placeholders. For skipped items, omit them without blocking the build.`;
        promptInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      overlay.remove();
      buildButton.dataset.requirementsBypass = '1';
      buildButton.click();
    };
  }

  function wireApp() {
    const doc = appDocument();
    if (!doc || doc.documentElement.dataset.codem8sHostWired) return;
    doc.documentElement.dataset.codem8sHostWired = '1';
    doc.addEventListener('click', (event) => {
      const buildButton = event.target.closest('#build');
      if (buildButton) {
        if (buildButton.dataset.requirementsBypass === '1') {
          delete buildButton.dataset.requirementsBypass;
        } else {
          event.preventDefault();
          event.stopImmediatePropagation();
          openRequirements(doc, buildButton);
          return;
        }
      }
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