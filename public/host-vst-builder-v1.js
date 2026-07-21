(() => {
  const frame = document.getElementById('codem8s-app');
  const STORE = 'codem8s_app_store_v1';
  const appWin = () => frame?.contentWindow;
  const appDoc = () => { try { return frame?.contentDocument; } catch { return null; } };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function apps() { try { return JSON.parse(appWin()?.localStorage.getItem(STORE) || '[]'); } catch { return []; } }
  function projectFiles(item) {
    const out = {};
    for (const [name, value] of Object.entries(item?.project?.files || {})) {
      if (typeof value === 'string' && !name.startsWith('.git/') && !/(^|\/)(?:build|out|node_modules)\//i.test(name)) out[name] = value;
    }
    return out;
  }
  function hasJuceProject(files) {
    const cmake = Object.entries(files).find(([name]) => /(^|\/)CMakeLists\.txt$/i.test(name));
    return !!(cmake && /juce_add_plugin|AudioProcessor|VST3/i.test(cmake[1] + '\n' + Object.values(files).join('\n').slice(0, 300000)));
  }

  function settings(item, files) {
    return new Promise(resolve => {
      const custom = hasJuceProject(files);
      const panel = document.createElement('div');
      panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#020711ed;padding:16px;overflow:auto;color:#edf5ff;font-family:system-ui';
      panel.innerHTML = `<div style="max-width:540px;margin:28px auto;background:#0d1727;border:1px solid #365477;border-radius:20px;padding:20px;display:grid;gap:14px;box-shadow:0 25px 80px #000"><h2 style="margin:0">Build VST3 Plugin</h2><p style="margin:0;color:#9db0c8">Build the saved JUCE/CMake project for Windows, macOS and Linux.</p><label style="display:grid;gap:6px;font-weight:800">Plugin name<input data-name value="${esc(item?.name || 'Codem8s Plugin')}" style="padding:12px;border-radius:11px;border:1px solid #365477;background:#07111f;color:#edf5ff"></label><label style="display:grid;gap:6px;font-weight:800">Manufacturer<input data-maker value="Codem8s" style="padding:12px;border-radius:11px;border:1px solid #365477;background:#07111f;color:#edf5ff"></label><label style="display:grid;gap:6px;font-weight:800">Plugin type<select data-type style="padding:12px;border-radius:11px;border:1px solid #365477;background:#07111f;color:#edf5ff"><option value="instrument">Instrument / Synth</option><option value="audio-effect">Audio effect</option><option value="multiband-effect">Multiband effect</option><option value="sampler">Sampler</option><option value="drum-machine">Drum machine</option><option value="midi-effect">MIDI effect</option><option value="utility">Utility / analyser</option></select></label><label style="display:grid;gap:6px;font-weight:800">Description<textarea data-description rows="3" style="padding:12px;border-radius:11px;border:1px solid #365477;background:#07111f;color:#edf5ff">VST3 plugin built from the current saved Codem8s project.</textarea></label><div style="padding:11px;border-radius:11px;background:#07111f;color:${custom ? '#9fe7c1' : '#ffd28a'};font-size:13px">${custom ? `JUCE project detected. GitHub will compile the saved project files (${Object.keys(files).length} files).` : 'No JUCE CMake project was detected. Only the basic instrument template can be built until the project contains CMakeLists.txt and JUCE source files.'}</div><div data-error style="min-height:20px;color:#ff7892"></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:9px"><button data-cancel style="padding:12px;border-radius:11px;border:1px solid #365477;background:#142843;color:#edf5ff;font-weight:800">Cancel</button><button data-build style="padding:12px;border:0;border-radius:11px;background:linear-gradient(135deg,#64dcff,#927cff);color:#06101b;font-weight:900">Build VST3</button></div></div>`;
      document.body.appendChild(panel);
      const error = panel.querySelector('[data-error]');
      panel.querySelector('[data-cancel]').onclick = () => { panel.remove(); resolve(null); };
      panel.querySelector('[data-build]').onclick = () => {
        const value = {
          name: panel.querySelector('[data-name]').value.trim(),
          manufacturer: panel.querySelector('[data-maker]').value.trim(),
          description: panel.querySelector('[data-description]').value.trim(),
          pluginType: panel.querySelector('[data-type]').value,
          buildSource: custom ? 'saved-project' : 'template'
        };
        if (!value.name || !value.manufacturer) { error.textContent = 'Enter a plugin name and manufacturer.'; return; }
        if (!custom && value.pluginType !== 'instrument') { error.textContent = 'This project needs JUCE/CMake source files before it can build that plugin type.'; return; }
        panel.remove(); resolve(value);
      };
    });
  }

  function progress(name) {
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#020711ed;padding:16px;overflow:auto;color:#edf5ff;font-family:system-ui';
    panel.innerHTML = `<div style="max-width:540px;margin:28px auto;background:#0d1727;border:1px solid #365477;border-radius:20px;padding:20px;display:grid;gap:14px"><h2 style="margin:0">Build VST3 Plugin</h2><p style="margin:0;color:#9db0c8">${esc(name)}</p><div data-state style="padding:14px;border-radius:12px;background:#07111f;color:#b9c9dc">Preparing GitHub build…</div><div data-actions style="display:grid;gap:9px"><button data-close style="padding:12px;border-radius:11px;border:1px solid #365477;background:#142843;color:#edf5ff;font-weight:800">Close</button></div></div>`;
    document.body.appendChild(panel);
    panel.querySelector('[data-close]').onclick = () => panel.remove();
    return { state: panel.querySelector('[data-state]'), actions: panel.querySelector('[data-actions]') };
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, { ...options, cache: 'no-store' });
    const text = await response.text();
    let data = {}; try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok) throw new Error(data?.error?.message || `Request failed (${response.status}).`);
    return data;
  }

  function addWorkflowLink(ui, url) {
    if (!url || ui.actions.querySelector('[data-workflow-link]')) return;
    const link = document.createElement('a');
    link.dataset.workflowLink = '1'; link.href = url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open GitHub build log';
    link.style.cssText = 'display:block;text-align:center;padding:12px;border-radius:11px;border:1px solid #365477;background:#142843;color:#edf5ff;font-weight:800;text-decoration:none';
    ui.actions.insertBefore(link, ui.actions.lastElementChild);
  }

  async function build(id) {
    const item = apps().find(app => app.id === id);
    if (!item) return;
    const files = projectFiles(item);
    const chosen = await settings(item, files);
    if (!chosen) return;
    const ui = progress(chosen.name);
    try {
      ui.state.textContent = chosen.buildSource === 'saved-project' ? 'Packaging the saved JUCE project…' : 'Preparing the basic instrument template…';
      const started = await requestJson('/api/vst-builds', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ appId: item.id, files: chosen.buildSource === 'saved-project' ? files : {}, ...chosen }) });
      ui.state.textContent = 'GitHub workflow queued. Waiting for a build runner…';
      const begin = Date.now();
      while (Date.now() - begin < 35 * 60 * 1000) {
        await new Promise(resolve => setTimeout(resolve, 7000));
        const status = await requestJson(`/api/vst-builds/${encodeURIComponent(started.id)}`);
        addWorkflowLink(ui, status.runUrl);
        if (status.failed) throw new Error(status.message || `GitHub VST3 build ${status.conclusion || 'failed'}.`);
        if (status.ready) {
          ui.state.textContent = 'VST3 builds are ready. Download the ZIP for your computer.';
          for (const file of status.downloads || []) {
            const link = document.createElement('a'); link.href = file.url; link.textContent = `Download ${file.name}`;
            link.style.cssText = 'display:block;text-align:center;padding:13px;border-radius:11px;background:linear-gradient(135deg,#64dcff,#927cff);color:#06101b;font-weight:900;text-decoration:none';
            ui.actions.insertBefore(link, ui.actions.firstChild);
          }
          return;
        }
        if (status.workflowStarted === false) ui.state.textContent = 'Build request saved. Waiting for GitHub Actions to start…';
        else if (status.state === 'queued') ui.state.textContent = 'GitHub workflow queued. Waiting for a runner…';
        else if (status.state === 'in_progress' || status.state === 'building') ui.state.textContent = 'GitHub is compiling the Windows, macOS and Linux VST3 builds…';
        else if (status.state === 'publishing') ui.state.textContent = 'Compilation finished. Publishing downloadable ZIP files…';
      }
      throw new Error('GitHub did not finish the VST3 build within 35 minutes. Open the GitHub build log to see its current state.');
    } catch (error) {
      ui.state.textContent = error.message || 'VST3 build failed.';
      ui.state.style.color = '#ff7892';
    }
  }

  function wire() {
    const d = appDoc(); if (!d) return;
    d.querySelectorAll('#appsStoreGrid article').forEach(card => {
      if (card.querySelector('[data-build-vst]')) return;
      const id = card.querySelector('[data-open]')?.dataset.open;
      const grid = card.querySelector('div[style*="grid-template-columns"]:last-child') || card.lastElementChild;
      if (!id || !grid) return;
      const button = d.createElement('button');
      button.className = 'toolbtn'; button.dataset.buildVst = id; button.textContent = 'Build VST3'; button.style.gridColumn = '1/-1';
      grid.insertBefore(button, grid.lastElementChild);
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); build(id); });
    });
  }
  frame?.addEventListener('load', wire);
  setInterval(wire, 800);
})();