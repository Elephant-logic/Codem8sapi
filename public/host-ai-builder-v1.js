(() => {
  const frame = document.getElementById('codem8s-app');
  const ACTIVE_KEY = 'codem8s_active_project_key';
  const CHAT_KEY = 'codem8s_ai_builder_chat_v1';
  const MEMORY_KEY = 'codem8s_ai_memory_v1';
  const SNAPSHOT_KEY = 'codem8s_ai_snapshots_v1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const appWin = () => frame?.contentWindow || null;
  const appDoc = () => { try { return frame?.contentDocument || null; } catch { return null; } };
  let pendingPatch = null;
  let busy = false;

  function parse(value) {
    try { return JSON.parse(String(value || 'null')); } catch { return null; }
  }

  function projectRecords() {
    const w = appWin();
    if (!w) return [];
    const out = [];
    for (let i = 0; i < w.localStorage.length; i++) {
      const key = w.localStorage.key(i);
      if (!/^codem8s_project_/i.test(key || '')) continue;
      const value = parse(w.localStorage.getItem(key));
      if (value?.files && typeof value.files === 'object') out.push({ key, value });
    }
    return out.sort((a, b) => Number(b.value.updatedAt || b.value.createdAt || 0) - Number(a.value.updatedAt || a.value.createdAt || 0));
  }

  function readProjectRecord() {
    const w = appWin();
    if (!w) return null;
    const records = projectRecords();
    const active = w.localStorage.getItem(ACTIVE_KEY) || '';
    const record = records.find(item => item.key === active) || records[0] || null;
    if (record && active !== record.key) w.localStorage.setItem(ACTIVE_KEY, record.key);
    return record;
  }

  function findIndex(files) {
    const name = Object.keys(files || {}).find(path => /(^|\/)index\.html?$/i.test(path));
    return { name: name || 'index.html', content: name ? String(files[name] || '') : '' };
  }

  function validateProject(project, previous) {
    if (!project?.files || typeof project.files !== 'object') throw new Error('Refused to save a project without files.');
    const nextIndex = findIndex(project.files);
    const oldIndex = findIndex(previous?.files || {});
    if (!nextIndex.content.trim()) {
      if (oldIndex.content.trim()) throw new Error('Refused to remove or empty index.html. The patch was not saved.');
      throw new Error('The project has no non-empty index.html.');
    }
  }

  function writeProject(project, expectedKey) {
    const w = appWin();
    if (!w) throw new Error('No project storage is available.');
    const active = w.localStorage.getItem(ACTIVE_KEY) || '';
    const key = expectedKey || active;
    if (!key || !/^codem8s_project_/i.test(key)) throw new Error('No active project is available.');
    if (active && active !== key) throw new Error('The active project changed before the patch was saved. Nothing was written.');
    const before = parse(w.localStorage.getItem(key));
    validateProject(project, before);
    const text = JSON.stringify(project);
    w.localStorage.setItem(key, text);
    w.localStorage.setItem(ACTIVE_KEY, key);
    const saved = parse(w.localStorage.getItem(key));
    validateProject(saved, before);
    if (JSON.stringify(saved?.files || {}) !== JSON.stringify(project.files || {})) throw new Error('The active project did not persist correctly. The patch was not confirmed.');
    return key;
  }

  function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
  }
  function saveJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function chats() { return loadJson(CHAT_KEY, []); }
  function saveChats(items) { saveJson(CHAT_KEY, items.slice(-30)); }

  function addMessage(role, text) {
    const items = chats();
    items.push({ role, text, at: Date.now() });
    saveChats(items);
    renderMessages();
  }

  function setStatus(text, error = false) {
    const node = appDoc()?.querySelector('#aiBuilderStatus');
    if (!node) return;
    node.textContent = text;
    node.style.color = error ? '#ff7892' : '#8fa4c1';
  }

  function renderMessages() {
    const d = appDoc();
    const list = d?.querySelector('#aiBuilderMessages');
    if (!list) return;
    const items = chats();
    list.innerHTML = items.length
      ? items.map(item => `<div style="align-self:${item.role === 'user' ? 'end' : 'start'};max-width:92%;padding:10px 12px;border-radius:14px;background:${item.role === 'user' ? '#173354' : '#0b1828'};border:1px solid #29425f;white-space:pre-wrap">${esc(item.text)}</div>`).join('')
      : '<div style="color:#8fa4c1">Ask for a repair or code change. The assistant reads only the active project.</div>';
    list.scrollTop = list.scrollHeight;
    const apply = d.querySelector('#aiBuilderApply');
    if (apply) apply.hidden = !pendingPatch;
  }

  function buildMemory(project, key) {
    const files = project?.files || {};
    const memory = {
      projectKey: key,
      projectName: project?.name || 'Untitled project',
      updatedAt: new Date().toISOString(),
      fileCount: Object.keys(files).length,
      files: Object.entries(files).map(([name, content]) => ({ name, bytes: String(content || '').length, empty: !String(content || '').trim() }))
    };
    saveJson(MEMORY_KEY, memory);
    return memory;
  }

  function responseText(data) {
    if (typeof data?.output_text === 'string') return data.output_text;
    const pieces = [];
    for (const item of data?.output || []) for (const part of item?.content || []) if (typeof part?.text === 'string') pieces.push(part.text);
    return pieces.join('\n') || data?.error?.message || 'No response was returned.';
  }

  function parsePatch(text) {
    const fenced = text.match(/```codem8s-patch\s*([\s\S]*?)```/i) || text.match(/```json\s*([\s\S]*?"files"[\s\S]*?)```/i);
    if (!fenced) return null;
    try {
      const parsed = JSON.parse(fenced[1]);
      return parsed?.files && typeof parsed.files === 'object' ? parsed : null;
    } catch { return null; }
  }

  async function sendMessage() {
    if (busy) return;
    const d = appDoc();
    const input = d?.querySelector('#aiBuilderInput');
    const mode = d?.querySelector('#aiBuilderMode')?.value || 'ask';
    const message = String(input?.value || '').trim();
    if (!message) return;
    input.value = '';
    addMessage('user', message);
    busy = true;
    setStatus('Reading the active project…');
    try {
      const record = readProjectRecord();
      if (!record) throw new Error('No active project was found.');
      const memory = buildMemory(record.value, record.key);
      const history = chats().slice(-10).map(item => `${item.role.toUpperCase()}: ${item.text}`).join('\n\n');
      const instructions = `You are Codem8s AI Builder inside a browser IDE. Inspect the supplied active project files and make the smallest safe repair. Never remove or empty index.html. Never return empty replacement content. In ASK mode explain only. In BUILD mode end with exactly one fenced block:\n\n\`\`\`codem8s-patch\n{"summary":"what changes","files":{"path/file.ext":"COMPLETE replacement content"}}\n\`\`\`\n\nOnly include changed files. Do not claim the patch was applied.`;
      const context = `MODE: ${mode.toUpperCase()}\nACTIVE PROJECT KEY: ${record.key}\nUSER REQUEST: ${message}\n\nMEMORY:\n${JSON.stringify(memory)}\n\nCURRENT PROJECT FILES:\n${JSON.stringify(record.value.files)}\n\nRECENT CHAT:\n${history}`;
      setStatus('Thinking…');
      const response = await fetch('/api/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-5-mini', instructions, input: [{ role: 'user', content: [{ type: 'input_text', text: context }] }] })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || `AI request failed (${response.status}).`);
      const text = responseText(data);
      pendingPatch = mode === 'build' ? parsePatch(text) : null;
      addMessage('assistant', text.replace(/```codem8s-patch[\s\S]*?```/gi, '').trim());
      setStatus(pendingPatch ? `Patch ready for active project ${record.key}: ${Object.keys(pendingPatch.files).join(', ')}` : 'No patch was produced. Nothing was changed.', !pendingPatch && mode === 'build');
      renderMessages();
    } catch (error) {
      addMessage('assistant', `Error: ${error.message || error}`);
      setStatus(error.message || 'Request failed.', true);
    } finally { busy = false; }
  }

  function applyPatch() {
    if (!pendingPatch) return;
    try {
      const record = readProjectRecord();
      if (!record) throw new Error('No active project was found.');
      const before = clone(record.value);
      const next = clone(record.value);
      next.files = { ...(next.files || {}) };
      for (const [name, content] of Object.entries(pendingPatch.files)) {
        if (typeof content !== 'string' || !content.trim()) throw new Error(`Refused empty replacement content: ${name}`);
        next.files[name] = content;
      }
      validateProject(next, before);
      const snapshots = loadJson(SNAPSHOT_KEY, []);
      snapshots.push({ at: Date.now(), key: record.key, summary: pendingPatch.summary || 'AI patch', project: before });
      saveJson(SNAPSHOT_KEY, snapshots.slice(-8));
      next.updatedAt = Date.now();
      const savedKey = writeProject(next, record.key);
      addMessage('assistant', `Applied to ${savedKey}: ${pendingPatch.summary || Object.keys(pendingPatch.files).join(', ')}. The project was verified and kept in cache. Preview was not reloaded automatically.`);
      pendingPatch = null;
      renderMessages();
      setStatus('Patch saved and verified. Open Preview or tap Reload preview when ready.');
    } catch (error) {
      setStatus(error.message || 'Could not apply patch.', true);
    }
  }

  function rollback() {
    const snapshots = loadJson(SNAPSHOT_KEY, []);
    const last = snapshots.pop();
    if (!last?.project || !last?.key) return setStatus('No AI snapshot is available.', true);
    try {
      writeProject(last.project, last.key);
      saveJson(SNAPSHOT_KEY, snapshots);
      addMessage('assistant', `Rolled back ${last.key}: ${last.summary || 'previous AI change'}. Preview was not reloaded automatically.`);
      setStatus('Previous project snapshot restored and verified.');
    } catch (error) { setStatus(error.message || 'Rollback failed.', true); }
  }

  function reloadPreview() {
    const record = readProjectRecord();
    if (!record) return setStatus('No active project was found.', true);
    try {
      validateProject(record.value, record.value);
      appWin().location.reload();
    } catch (error) { setStatus(error.message || 'Reload was blocked.', true); }
  }

  function wire() {
    const d = appDoc();
    if (!d || d.documentElement.dataset.aiBuilder === '1') return;
    const toolbar = d.querySelector('.toolbar');
    const main = d.querySelector('.main');
    if (!toolbar || !main) return;
    d.documentElement.dataset.aiBuilder = '1';
    const tab = d.createElement('button');
    tab.className = 'tab';
    tab.textContent = 'AI Builder';
    toolbar.insertBefore(tab, toolbar.querySelector('.spacer'));
    const pane = d.createElement('div');
    pane.id = 'aiBuilderPane';
    pane.className = 'workspace';
    pane.innerHTML = `<div style="height:100%;display:grid;grid-template-rows:auto 1fr auto;gap:10px;padding:12px;overflow:hidden"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><strong style="font-size:18px">AI Builder</strong><select id="aiBuilderMode" style="margin-left:auto;padding:9px;border-radius:10px;background:#07111f;color:#edf5ff;border:1px solid #365477"><option value="ask">Ask mode</option><option value="build">Build mode</option></select><button id="aiBuilderMemory" class="toolbtn">Refresh memory</button><button id="aiBuilderRollback" class="toolbtn">Rollback AI change</button><button id="aiBuilderReload" class="toolbtn">Reload preview</button></div><div id="aiBuilderMessages" style="overflow:auto;display:flex;flex-direction:column;gap:9px;padding:10px;border:1px solid #29425f;border-radius:14px;background:#06101d"></div><div style="display:grid;gap:8px"><div id="aiBuilderStatus" style="min-height:18px;color:#8fa4c1;font-size:12px">Only the active project will be read or changed.</div><textarea id="aiBuilderInput" rows="3" placeholder="Ask for a repair or code change." style="width:100%;resize:none;padding:11px;border-radius:12px;border:1px solid #365477;background:#07111f;color:#edf5ff"></textarea><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button id="aiBuilderSend" class="toolbtn">Send</button><button id="aiBuilderApply" class="toolbtn" hidden>Apply proposed patch</button></div></div></div>`;
    main.appendChild(pane);
    tab.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      d.querySelectorAll('.tab').forEach(node => node.classList.remove('active'));
      d.querySelectorAll('.workspace').forEach(node => node.classList.remove('active'));
      tab.classList.add('active');
      pane.classList.add('active');
      renderMessages();
    }, true);
    d.querySelector('#aiBuilderSend').onclick = sendMessage;
    d.querySelector('#aiBuilderApply').onclick = applyPatch;
    d.querySelector('#aiBuilderRollback').onclick = rollback;
    d.querySelector('#aiBuilderReload').onclick = reloadPreview;
    d.querySelector('#aiBuilderMemory').onclick = () => {
      const record = readProjectRecord();
      if (!record) return setStatus('No active project was found.', true);
      const memory = buildMemory(record.value, record.key);
      setStatus(`Memory refreshed for ${record.key}: ${memory.fileCount} files mapped.`);
    };
    d.querySelector('#aiBuilderInput').addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') sendMessage();
    });
    renderMessages();
  }

  frame?.addEventListener('load', wire);
  setInterval(wire, 800);
})();