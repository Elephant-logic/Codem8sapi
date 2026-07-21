(() => {
  const frame = document.getElementById('codem8s-app');
  const STORE = 'codem8s_app_store_v1';
  const PROJECT_KEYS = ['codem8s_project_v4','codem8s_project_v7','codem8s_project_v8','codem8s_project_v3'];
  const ACTIVE_KEY = 'codem8s_active_project_key';
  const appWin = () => frame?.contentWindow;
  const appDoc = () => { try { return frame?.contentDocument; } catch { return null; } };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function apps() { try { return JSON.parse(appWin()?.localStorage.getItem(STORE) || '[]'); } catch { return []; } }
  function saveApps(items) { appWin()?.localStorage.setItem(STORE, JSON.stringify(items.slice(0, 40))); }
  function cleanProjectFiles(project) {
    const out = {};
    for (const [name, value] of Object.entries(project?.files || {})) {
      const path = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
      if (typeof value === 'string' && path && !path.includes('..') && !path.startsWith('.git/') && !/(^|\/)(?:build|out|node_modules)\//i.test(path)) out[path] = value;
    }
    return out;
  }
  function hasJuceProject(files) {
    const cmake = Object.entries(files).find(([name]) => /(^|\/)CMakeLists\.txt$/i.test(name));
    return !!(cmake && /juce_add_plugin|AudioProcessor|VST3/i.test(cmake[1] + '\n' + Object.values(files).join('\n').slice(0, 300000)));
  }
  function cmakeMissingFiles(files) {
    const names = new Map(Object.keys(files).map(name => [name.toLowerCase(), name]));
    const missing = new Set();
    for (const [cmakeName, text] of Object.entries(files)) {
      if (!/(^|\/)CMakeLists\.txt$/i.test(cmakeName)) continue;
      const base = cmakeName.includes('/') ? cmakeName.slice(0, cmakeName.lastIndexOf('/') + 1) : '';
      const regex = /(?:^|[\s(])([A-Za-z0-9_.\/-]+\.(?:cpp|cxx|cc|h|hpp|mm|m))(?:[\s)\n\r]|$)/g;
      let match;
      while ((match = regex.exec(String(text || '')))) {
        const ref = match[1].replace(/^['"]|['"]$/g, '').replace(/^\.\//, '');
        const full = (base + ref).replace(/\/\.\//g, '/');
        if (!names.has(full.toLowerCase())) missing.add(full);
      }
    }
    return [...missing];
  }
  function activeProjects() {
    const w = appWin(); if (!w) return [];
    const keys = [];
    try { const active = String(w.localStorage.getItem(ACTIVE_KEY) || '').trim(); if (active) keys.push(active); } catch {}
    keys.push(...PROJECT_KEYS);
    const seen = new Set(), projects = [];
    for (const key of keys) {
      if (!key || seen.has(key)) continue; seen.add(key);
      try { const project = JSON.parse(w.localStorage.getItem(key) || 'null'); if (project?.files && typeof project.files === 'object') projects.push({ key, project, files: cleanProjectFiles(project) }); } catch {}
    }
    return projects;
  }
  function bestBuildFiles(item) {
    const saved = cleanProjectFiles(item?.project);
    const candidates = [{ source: 'saved app', key: '', files: saved, project: item?.project }];
    for (const entry of activeProjects()) candidates.push({ source: 'active editor', key: entry.key, files: entry.files, project: entry.project });
    const scored = candidates.filter(candidate => hasJuceProject(candidate.files)).map(candidate => {
      const missing = cmakeMissingFiles(candidate.files);
      return { ...candidate, missing, score: Object.keys(candidate.files).length * 10 - missing.length * 1000 };
    }).sort((a, b) => b.score - a.score);
    return scored[0] || { source: 'saved app', key: '', files: saved, project: item?.project, missing: [], score: 0 };
  }
  function collectFileMaps(value, maps, seen, depth = 0) {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 7) return;
    seen.add(value);
    if (value.files && typeof value.files === 'object' && !Array.isArray(value.files)) maps.push(cleanProjectFiles(value));
    if (Array.isArray(value)) for (const item of value) collectFileMaps(item, maps, seen, depth + 1);
    else for (const child of Object.values(value)) collectFileMaps(child, maps, seen, depth + 1);
  }
  function recoveryMaps() {
    const w = appWin(), maps = [], seen = new Set(); if (!w) return maps;
    for (let i = 0; i < w.localStorage.length; i++) {
      const key = w.localStorage.key(i); if (!key) continue;
      try { collectFileMaps(JSON.parse(w.localStorage.getItem(key) || 'null'), maps, seen); } catch {}
    }
    return maps;
  }
  function repairSelection(item, selection) {
    const missing = cmakeMissingFiles(selection.files);
    const maps = recoveryMaps();
    const recovered = {}, unresolved = [];
    for (const wanted of missing) {
      const exact = wanted.toLowerCase();
      const base = wanted.split('/').pop().toLowerCase();
      let value = '';
      for (const map of maps) {
        const exactName = Object.keys(map).find(name => name.toLowerCase() === exact);
        if (exactName && map[exactName].trim()) { value = map[exactName]; break; }
      }
      if (!value) {
        const matches = [];
        for (const map of maps) for (const [name, content] of Object.entries(map)) if (name.split('/').pop().toLowerCase() === base && content.trim()) matches.push(content);
        const unique = [...new Set(matches)]; if (unique.length === 1) value = unique[0];
      }
      if (value) recovered[wanted] = value; else unresolved.push(wanted);
    }
    Object.assign(selection.files, recovered);
    selection.missing = cmakeMissingFiles(selection.files);
    if (Object.keys(recovered).length) {
      const updatedApps = apps().map(app => app.id === item.id ? { ...app, project: { ...(app.project || {}), files: { ...(app.project?.files || {}), ...recovered } }, updatedAt: Date.now() } : app);
      saveApps(updatedApps);
      if (selection.key) {
        try {
          const w = appWin();
          const project = JSON.parse(w.localStorage.getItem(selection.key) || 'null');
          if (project?.files) { project.files = { ...project.files, ...recovered }; w.localStorage.setItem(selection.key, JSON.stringify(project)); }
        } catch {}
      }
    }
    return { recovered: Object.keys(recovered), unresolved };
  }
  function settings(item, selection, notice = '') {
    return new Promise(resolve => {
      const files = selection.files, custom = hasJuceProject(files), missing = selection.missing || [];
      const panel = document.createElement('div');
      panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#020711ed;padding:16px;overflow:auto;color:#edf5ff;font-family:system-ui';
      const sourceText = selection.source === 'active editor' ? 'Using the active editor project' : 'Using the saved app snapshot';
      const health = missing.length ? `Missing referenced source files: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}` : `${sourceText} (${Object.keys(files).length} files).`;
      panel.innerHTML = `<div style="max-width:540px;margin:28px auto;background:#0d1727;border:1px solid #365477;border-radius:20px;padding:20px;display:grid;gap:14px;box-shadow:0 25px 80px #000"><h2 style="margin:0">Build VST3 Plugin</h2><p style="margin:0;color:#9db0c8">Build the current JUCE/CMake project for Windows, macOS and Linux.</p><label style="display:grid;gap:6px;font-weight:800">Plugin name<input data-name value="${esc(item?.name || 'Codem8s Plugin')}" style="padding:12px;border-radius:11px;border:1px solid #365477;background:#07111f;color:#edf5ff"></label><label style="display:grid;gap:6px;font-weight:800">Manufacturer<input data-maker value="Codem8s" style="padding:12px;border-radius:11px;border:1px solid #365477;background:#07111f;color:#edf5ff"></label><label style="display:grid;gap:6px;font-weight:800">Plugin type<select data-type style="padding:12px;border-radius:11px;border:1px solid #365477;background:#07111f;color:#edf5ff"><option value="instrument">Instrument / Synth</option><option value="audio-effect">Audio effect</option><option value="multiband-effect">Multiband effect</option><option value="sampler">Sampler</option><option value="drum-machine">Drum machine</option><option value="midi-effect">MIDI effect</option><option value="utility">Utility / analyser</option></select></label><label style="display:grid;gap:6px;font-weight:800">Description<textarea data-description rows="3" style="padding:12px;border-radius:11px;border:1px solid #365477;background:#07111f;color:#edf5ff">VST3 plugin built from the current Codem8s project.</textarea></label><div style="padding:11px;border-radius:11px;background:#07111f;color:${custom && !missing.length ? '#9fe7c1' : '#ff9aae'};font-size:13px">${esc(custom ? health : 'No JUCE CMake project was detected. Only the basic instrument template can be built.')}</div>${notice ? `<div style="padding:11px;border-radius:11px;background:#07111f;color:#ffd28a;font-size:13px">${esc(notice)}</div>` : ''}<div data-error style="min-height:20px;color:#ff7892"></div>${missing.length ? '<button data-repair style="padding:12px;border-radius:11px;border:1px solid #64dcff;background:#10243c;color:#64dcff;font-weight:900">Repair missing source files</button>' : ''}<div style="display:grid;grid-template-columns:1fr 1fr;gap:9px"><button data-cancel style="padding:12px;border-radius:11px;border:1px solid #365477;background:#142843;color:#edf5ff;font-weight:800">Cancel</button><button data-build style="padding:12px;border:0;border-radius:11px;background:linear-gradient(135deg,#64dcff,#927cff);color:#06101b;font-weight:900">Build VST3</button></div></div>`;
      document.body.appendChild(panel);
      const error = panel.querySelector('[data-error]');
      panel.querySelector('[data-cancel]').onclick = () => { panel.remove(); resolve(null); };
      const repair = panel.querySelector('[data-repair]');
      if (repair) repair.onclick = () => { panel.remove(); resolve({ repair: true }); };
      panel.querySelector('[data-build]').onclick = () => {
        const value = { name: panel.querySelector('[data-name]').value.trim(), manufacturer: panel.querySelector('[data-maker]').value.trim(), description: panel.querySelector('[data-description]').value.trim(), pluginType: panel.querySelector('[data-type]').value, buildSource: custom ? 'saved-project' : 'template' };
        if (!value.name || !value.manufacturer) return void (error.textContent = 'Enter a plugin name and manufacturer.');
        if (custom && missing.length) return void (error.textContent = 'Repair the missing source files before building.');
        if (!custom && value.pluginType !== 'instrument') return void (error.textContent = 'This plugin type requires a complete JUCE/CMake project.');
        panel.remove(); resolve(value);
      };
    });
  }
  function progress(name) {
    const panel = document.createElement('div'); panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#020711ed;padding:16px;overflow:auto;color:#edf5ff;font-family:system-ui';
    panel.innerHTML = `<div style="max-width:540px;margin:28px auto;background:#0d1727;border:1px solid #365477;border-radius:20px;padding:20px;display:grid;gap:14px"><h2 style="margin:0">Build VST3 Plugin</h2><p style="margin:0;color:#9db0c8">${esc(name)}</p><div data-state style="padding:14px;border-radius:12px;background:#07111f;color:#b9c9dc">Preparing GitHub build…</div><div data-actions style="display:grid;gap:9px"><button data-close style="padding:12px;border-radius:11px;border:1px solid #365477;background:#142843;color:#edf5ff;font-weight:800">Close</button></div></div>`;
    document.body.appendChild(panel); panel.querySelector('[data-close]').onclick = () => panel.remove(); return { state: panel.querySelector('[data-state]'), actions: panel.querySelector('[data-actions]') };
  }
  async function requestJson(url, options = {}) { const response = await fetch(url, { ...options, cache: 'no-store' }); const text = await response.text(); let data = {}; try { data = text ? JSON.parse(text) : {}; } catch {} if (!response.ok) throw new Error(data?.error?.message || `Request failed (${response.status}).`); return data; }
  function addWorkflowLink(ui, url) { if (!url || ui.actions.querySelector('[data-workflow-link]')) return; const link = document.createElement('a'); link.dataset.workflowLink = '1'; link.href = url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open GitHub build log'; link.style.cssText = 'display:block;text-align:center;padding:12px;border-radius:11px;border:1px solid #365477;background:#142843;color:#edf5ff;font-weight:800;text-decoration:none'; ui.actions.insertBefore(link, ui.actions.lastElementChild); }
  async function build(id) {
    const item = apps().find(app => app.id === id); if (!item) return;
    const selection = bestBuildFiles(item); let notice = '', chosen;
    while (true) {
      chosen = await settings(item, selection, notice); if (!chosen) return;
      if (!chosen.repair) break;
      const result = repairSelection(item, selection);
      notice = result.recovered.length ? `Recovered ${result.recovered.length} file${result.recovered.length === 1 ? '' : 's'}${result.unresolved.length ? `. Still missing: ${result.unresolved.slice(0, 4).join(', ')}` : '. Project is now complete.'}` : `No matching source files were found in local projects or backups. Re-import the complete project ZIP.`;
    }
    const ui = progress(chosen.name);
    try {
      ui.state.textContent = chosen.buildSource === 'saved-project' ? `Packaging ${Object.keys(selection.files).length} JUCE project files…` : 'Preparing the basic instrument template…';
      const started = await requestJson('/api/vst-builds', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ appId: item.id, files: chosen.buildSource === 'saved-project' ? selection.files : {}, ...chosen }) });
      ui.state.textContent = 'GitHub workflow queued. Waiting for a build runner…'; const begin = Date.now();
      while (Date.now() - begin < 35 * 60 * 1000) {
        await new Promise(resolve => setTimeout(resolve, 7000)); const status = await requestJson(`/api/vst-builds/${encodeURIComponent(started.id)}`); addWorkflowLink(ui, status.runUrl);
        if (status.failed) throw new Error(status.message || `GitHub VST3 build ${status.conclusion || 'failed'}.`);
        if (status.ready) { ui.state.textContent = 'VST3 builds are ready. Download the ZIP for your computer.'; for (const file of status.downloads || []) { const link = document.createElement('a'); link.href = file.url; link.textContent = `Download ${file.name}`; link.style.cssText = 'display:block;text-align:center;padding:13px;border-radius:11px;background:linear-gradient(135deg,#64dcff,#927cff);color:#06101b;font-weight:900;text-decoration:none'; ui.actions.insertBefore(link, ui.actions.firstChild); } return; }
        if (status.workflowStarted === false) ui.state.textContent = 'Build request saved. Waiting for GitHub Actions to start…'; else if (status.state === 'queued') ui.state.textContent = 'GitHub workflow queued. Waiting for a runner…'; else if (status.state === 'in_progress' || status.state === 'building') ui.state.textContent = 'GitHub is compiling the Windows, macOS and Linux VST3 builds…'; else if (status.state === 'publishing') ui.state.textContent = 'Compilation finished. Publishing downloadable ZIP files…';
      }
      throw new Error('GitHub did not finish the VST3 build within 35 minutes. Open the GitHub build log to see its current state.');
    } catch (error) { ui.state.textContent = error.message || 'VST3 build failed.'; ui.state.style.color = '#ff7892'; }
  }
  function wire() { const d = appDoc(); if (!d) return; d.querySelectorAll('#appsStoreGrid article').forEach(card => { if (card.querySelector('[data-build-vst]')) return; const id = card.querySelector('[data-open]')?.dataset.open; const grid = card.querySelector('div[style*="grid-template-columns"]:last-child') || card.lastElementChild; if (!id || !grid) return; const button = d.createElement('button'); button.className = 'toolbtn'; button.dataset.buildVst = id; button.textContent = 'Build VST3'; button.style.gridColumn = '1/-1'; grid.insertBefore(button, grid.lastElementChild); button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); build(id); }); }); }
  frame?.addEventListener('load', wire); setInterval(wire, 800);
})();