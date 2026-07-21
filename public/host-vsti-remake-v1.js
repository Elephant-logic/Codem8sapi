(() => {
  const frame = document.getElementById('codem8s-app');
  const STORE = 'codem8s_app_store_v1';
  const appWin = () => frame?.contentWindow;
  const appDoc = () => { try { return frame?.contentDocument; } catch { return null; } };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function apps() {
    try { return JSON.parse(appWin()?.localStorage.getItem(STORE) || '[]'); }
    catch { return []; }
  }

  async function json(url, options = {}) {
    const response = await fetch(url, { ...options, cache: 'no-store' });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok) throw new Error(data?.error?.message || `Request failed (${response.status}).`);
    return data;
  }

  function dialog(item) {
    return new Promise(resolve => {
      const panel = document.createElement('div');
      panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#020711ed;padding:16px;overflow:auto;color:#edf5ff;font-family:system-ui';
      panel.innerHTML = `<div style="max-width:540px;margin:28px auto;background:#0d1727;border:1px solid #365477;border-radius:20px;padding:20px;display:grid;gap:14px;box-shadow:0 25px 80px #000"><h2 style="margin:0">Remake as native VSTi</h2><p style="margin:0;color:#9db0c8">Create a real JUCE instrument from this App Store project instead of compiling browser audio code.</p><label style="display:grid;gap:6px;font-weight:800">Plugin name<input data-name value="${esc(item?.name || 'Codem8s Instrument')}" style="padding:12px;border-radius:11px;border:1px solid #365477;background:#07111f;color:#edf5ff"></label><label style="display:grid;gap:6px;font-weight:800">Manufacturer<input data-maker value="Codem8s" style="padding:12px;border-radius:11px;border:1px solid #365477;background:#07111f;color:#edf5ff"></label><div style="padding:12px;border-radius:12px;background:#07111f;color:#b9c9dc;font-size:13px;line-height:1.5">The native remake includes 16-voice MIDI polyphony, pitch bend, sine/saw/square/triangle oscillators, ADSR, low-pass filter, output gain, limiting, automation and DAW state recall.</div><div data-error style="min-height:20px;color:#ff7892"></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:9px"><button data-cancel style="padding:12px;border-radius:11px;border:1px solid #365477;background:#142843;color:#edf5ff;font-weight:800">Cancel</button><button data-remake style="padding:12px;border:0;border-radius:11px;background:linear-gradient(135deg,#64dcff,#927cff);color:#06101b;font-weight:900">Remake & Build</button></div></div>`;
      document.body.appendChild(panel);
      panel.querySelector('[data-cancel]').onclick = () => { panel.remove(); resolve(null); };
      panel.querySelector('[data-remake]').onclick = () => {
        const name = panel.querySelector('[data-name]').value.trim();
        const manufacturer = panel.querySelector('[data-maker]').value.trim();
        if (!name || !manufacturer) { panel.querySelector('[data-error]').textContent = 'Enter a plugin name and manufacturer.'; return; }
        panel.remove();
        resolve({ name, manufacturer });
      };
    });
  }

  function progress(name) {
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#020711ed;padding:16px;overflow:auto;color:#edf5ff;font-family:system-ui';
    panel.innerHTML = `<div style="max-width:540px;margin:28px auto;background:#0d1727;border:1px solid #365477;border-radius:20px;padding:20px;display:grid;gap:14px"><h2 style="margin:0">Native VSTi build</h2><p style="margin:0;color:#9db0c8">${esc(name)}</p><div data-state style="padding:14px;border-radius:12px;background:#07111f;color:#b9c9dc">Creating native JUCE instrument…</div><div data-actions style="display:grid;gap:9px"><button data-close style="padding:12px;border-radius:11px;border:1px solid #365477;background:#142843;color:#edf5ff;font-weight:800">Close</button></div></div>`;
    document.body.appendChild(panel);
    panel.querySelector('[data-close]').onclick = () => panel.remove();
    return { state: panel.querySelector('[data-state]'), actions: panel.querySelector('[data-actions]') };
  }

  async function remake(id) {
    const item = apps().find(app => app.id === id);
    if (!item) return;
    const chosen = await dialog(item);
    if (!chosen) return;
    const ui = progress(chosen.name);
    try {
      const started = await json('/api/vst-builds', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          appId: item.id,
          name: chosen.name,
          manufacturer: chosen.manufacturer,
          description: 'Native JUCE VSTi remade from a Codem8s App Store project.',
          pluginType: 'instrument',
          buildSource: 'template',
          files: {}
        })
      });
      ui.state.textContent = 'GitHub is compiling native VST3 instruments for Windows, macOS and Linux…';
      const begin = Date.now();
      while (Date.now() - begin < 35 * 60 * 1000) {
        await wait(7000);
        const status = await json(`/api/vst-builds/${encodeURIComponent(started.id)}`);
        if (status.runUrl && !ui.actions.querySelector('[data-log]')) {
          const log = document.createElement('a');
          log.dataset.log = '1'; log.href = status.runUrl; log.target = '_blank'; log.rel = 'noopener'; log.textContent = 'Open GitHub build log';
          log.style.cssText = 'display:block;text-align:center;padding:12px;border-radius:11px;border:1px solid #365477;background:#142843;color:#edf5ff;font-weight:800;text-decoration:none';
          ui.actions.insertBefore(log, ui.actions.lastElementChild);
        }
        if (status.failed) throw new Error(status.message || 'Native VSTi build failed.');
        if (status.ready) {
          ui.state.textContent = 'Native VSTi builds are ready.';
          for (const file of status.downloads || []) {
            const link = document.createElement('a');
            link.href = file.url; link.textContent = `Download ${file.name}`;
            link.style.cssText = 'display:block;text-align:center;padding:13px;border-radius:11px;background:linear-gradient(135deg,#64dcff,#927cff);color:#06101b;font-weight:900;text-decoration:none';
            ui.actions.insertBefore(link, ui.actions.firstChild);
          }
          return;
        }
      }
      throw new Error('GitHub did not finish the native VSTi build within 35 minutes.');
    } catch (error) {
      ui.state.textContent = error.message || 'Native VSTi build failed.';
      ui.state.style.color = '#ff7892';
    }
  }

  function wire() {
    const d = appDoc(); if (!d) return;
    d.querySelectorAll('#appsStoreGrid article').forEach(card => {
      if (card.querySelector('[data-remake-vsti]')) return;
      const id = card.querySelector('[data-open]')?.dataset.open;
      const grid = card.querySelector('div[style*="grid-template-columns"]:last-child') || card.lastElementChild;
      if (!id || !grid) return;
      const button = d.createElement('button');
      button.className = 'toolbtn'; button.dataset.remakeVsti = id; button.textContent = 'Remake as native VSTi'; button.style.gridColumn = '1/-1';
      grid.insertBefore(button, grid.lastElementChild);
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); remake(id); });
    });
  }

  frame?.addEventListener('load', wire);
  setInterval(wire, 800);
})();
