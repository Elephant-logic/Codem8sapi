(() => {
  const frame = document.getElementById('codem8s-app');
  const PROJECT_KEYS = ['codem8s_project_v4','codem8s_project_v7','codem8s_project_v8','codem8s_project_v3'];
  const CHAT_KEY = 'codem8s_ai_builder_chat_v1';
  const MEMORY_KEY = 'codem8s_ai_memory_v1';
  const SNAPSHOT_KEY = 'codem8s_ai_snapshots_v1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const appWin = () => frame?.contentWindow;
  const appDoc = () => { try { return frame?.contentDocument || null; } catch { return null; } };
  let pendingPatch = null;
  let busy = false;

  function readProjectRecord() {
    const w = appWin();
    if (!w) return null;
    for (const key of PROJECT_KEYS) {
      try {
        const value = JSON.parse(w.localStorage.getItem(key) || 'null');
        if (value?.files && typeof value.files === 'object') return { key, value };
      } catch {}
    }
    return null;
  }
  function writeProject(project) {
    const w = appWin();
    const record = readProjectRecord();
    if (!w || !record) throw new Error('No active project is available.');
    for (const key of PROJECT_KEYS) {
      if (w.localStorage.getItem(key) != null) w.localStorage.setItem(key, JSON.stringify(project));
    }
  }
  function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
  }
  function saveJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function chats() { return loadJson(CHAT_KEY, []); }
  function saveChats(items) { saveJson(CHAT_KEY, items.slice(-30)); }

  function extractMatches(text, regex, limit = 30) {
    const out = new Set(); let match;
    while ((match = regex.exec(text)) && out.size < limit) out.add(match[1]);
    return [...out];
  }
  function roleFor(name, content) {
    if (/index\.html?$/i.test(name)) return 'HTML entry and app shell';
    if (/\.css$/i.test(name)) return 'Styles and responsive layout';
    if (/\.(js|jsx|ts|tsx)$/i.test(name)) return 'Application logic';
    if (/package\.json$/i.test(name)) return 'Dependencies and scripts';
    if (/readme/i.test(name)) return 'Project documentation';
    if (/manifest/i.test(name)) return 'App metadata';
    return content.length ? 'Project file' : 'Empty file';
  }
  function buildMemory(project) {
    const files = project?.files || {};
    const fileMap = Object.entries(files).map(([name, raw]) => {
      const content = typeof raw === 'string' ? raw : '';
      return {
        name,
        role: roleFor(name, content),
        bytes: new Blob([content]).size,
        empty: !content.trim(),
        functions: extractMatches(content, /(?:function\s+|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)/g, 20),
        ids: extractMatches(content, /\bid=["']([^"']+)["']/g, 20),
        classes: extractMatches(content, /\bclass=["']([^"']+)["']/g, 20),
        storageKeys: extractMatches(content, /localStorage\.(?:getItem|setItem)\(["'`]([^"'`]+)["'`]/g, 20),
        routes: extractMatches(content, /fetch\(["'`]([^"'`]+)["'`]/g, 20)
      };
    });
    const d = appDoc();
    const diagnostics = (d?.body?.innerText || '').split('\n').filter(line => /error|failed|regression|runtime|warning/i.test(line)).slice(-25);
    const memory = {
      projectName: project?.name || 'Untitled project',
      updatedAt: new Date().toISOString(),
      fileCount: fileMap.length,
      files: fileMap,
      diagnostics
    };
    saveJson(MEMORY_KEY, memory);
    return memory;
  }

  async function capturePreview() {
    const d = appDoc();
    if (!d?.documentElement) return '';
    try {
      const cloneNode = d.documentElement.cloneNode(true);
      cloneNode.querySelectorAll('script').forEach(node => node.remove());
      const serialized = new XMLSerializer().serializeToString(cloneNode);
      const width = Math.max(320, Math.min(720, d.documentElement.clientWidth || 390));
      const height = Math.max(480, Math.min(1200, d.documentElement.scrollHeight || 800));
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
      const image = new Image();
      const url = URL.createObjectURL(new Blob([svg], {type:'image/svg+xml'}));
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(url);
      return canvas.toDataURL('image/jpeg', 0.58);
    } catch { return ''; }
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
      if (!parsed?.files || typeof parsed.files !== 'object') return null;
      return parsed;
    } catch { return null; }
  }

  function addMessage(role, text) {
    const items = chats(); items.push({role, text, at: Date.now()}); saveChats(items); renderMessages();
  }
  function renderMessages() {
    const d = appDoc(); const list = d?.querySelector('#aiBuilderMessages'); if (!list) return;
    const items = chats();
    list.innerHTML = items.length ? items.map(item => `<div style="align-self:${item.role === 'user' ? 'end' : 'start'};max-width:92%;padding:10px 12px;border-radius:14px;background:${item.role === 'user' ? '#173354' : '#0b1828'};border:1px solid #29425f;white-space:pre-wrap">${esc(item.text)}</div>`).join('') : '<div style="color:#8fa4c1">Ask about the current preview or request a small change. The assistant receives the project memory map and a fresh preview capture.</div>';
    list.scrollTop = list.scrollHeight;
    const apply = d.querySelector('#aiBuilderApply');
    if (apply) apply.hidden = !pendingPatch;
  }
  function setStatus(text, error = false) {
    const node = appDoc()?.querySelector('#aiBuilderStatus'); if (!node) return;
    node.textContent = text; node.style.color = error ? '#ff7892' : '#8fa4c1';
  }

  async function sendMessage() {
    if (busy) return;
    const d = appDoc(); const input = d?.querySelector('#aiBuilderInput'); const mode = d?.querySelector('#aiBuilderMode')?.value || 'ask';
    const message = String(input?.value || '').trim(); if (!message) return;
    input.value = ''; addMessage('user', message); busy = true; setStatus('Reading project, memory and preview…');
    try {
      const record = readProjectRecord(); if (!record) throw new Error('No active project was found.');
      const project = record.value; const memory = buildMemory(project); const screenshot = await capturePreview();
      const history = chats().slice(-10).map(item => `${item.role.toUpperCase()}: ${item.text}`).join('\n\n');
      const instructions = `You are Codem8s AI Builder inside a browser IDE. Use the supplied project memory, current files, diagnostics and preview image. Be concise and preserve working features. Never replace a non-empty file with empty content. In ASK mode, explain only. In BUILD mode, propose the smallest complete replacement files needed. When proposing changes, end with one fenced block exactly like:\n\n\`\`\`codem8s-patch\n{"summary":"what changes","files":{"path/file.ext":"COMPLETE replacement content"}}\n\`\`\`\n\nOnly include files that must change. Do not claim a patch was applied.`;
      const context = `MODE: ${mode.toUpperCase()}\nUSER REQUEST: ${message}\n\nMEMORY BANK:\n${JSON.stringify(memory)}\n\nCURRENT PROJECT FILES:\n${JSON.stringify(project.files)}\n\nRECENT CHAT:\n${history}`;
      const content = [{type:'input_text', text:context}];
      if (screenshot) content.push({type:'input_image', image_url:screenshot});
      setStatus('Thinking…');
      const response = await fetch('/api/openai', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({model:'gpt-5-mini', instructions, input:[{role:'user', content}]})});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || `AI request failed (${response.status}).`);
      const text = responseText(data); pendingPatch = mode === 'build' ? parsePatch(text) : null;
      addMessage('assistant', text.replace(/```codem8s-patch[\s\S]*?```/gi, '').trim());
      setStatus(pendingPatch ? `Patch ready: ${Object.keys(pendingPatch.files).join(', ')}` : 'Response ready.');
      renderMessages();
    } catch (error) { addMessage('assistant', `Error: ${error.message || error}`); setStatus(error.message || 'Request failed.', true); }
    finally { busy = false; }
  }

  function applyPatch() {
    if (!pendingPatch) return;
    try {
      const record = readProjectRecord(); if (!record) throw new Error('No active project was found.');
      const before = clone(record.value); const next = clone(record.value); next.files = {...(next.files || {})};
      for (const [name, content] of Object.entries(pendingPatch.files)) {
        if (typeof content !== 'string' || (!content.trim() && String(next.files[name] || '').trim())) throw new Error(`Refused to empty working file: ${name}`);
        next.files[name] = content;
      }
      const snapshots = loadJson(SNAPSHOT_KEY, []); snapshots.push({at:Date.now(), summary:pendingPatch.summary || 'AI patch', project:before}); saveJson(SNAPSHOT_KEY, snapshots.slice(-8));
      next.updatedAt = Date.now(); writeProject(next); addMessage('assistant', `Applied: ${pendingPatch.summary || Object.keys(pendingPatch.files).join(', ')}. Reloading preview now.`);
      pendingPatch = null; renderMessages(); setStatus('Patch applied. A rollback snapshot was saved.');
      setTimeout(() => appWin().location.reload(), 350);
    } catch (error) { setStatus(error.message || 'Could not apply patch.', true); }
  }
  function rollback() {
    const snapshots = loadJson(SNAPSHOT_KEY, []); const last = snapshots.pop();
    if (!last?.project) return setStatus('No AI snapshot is available.', true);
    writeProject(last.project); saveJson(SNAPSHOT_KEY, snapshots); addMessage('assistant', `Rolled back: ${last.summary || 'previous AI change'}.`); setStatus('Previous project snapshot restored.'); setTimeout(() => appWin().location.reload(), 350);
  }

  function wire() {
    const d = appDoc(); if (!d || d.documentElement.dataset.aiBuilder === '1') return;
    const toolbar = d.querySelector('.toolbar'), main = d.querySelector('.main'); if (!toolbar || !main) return;
    d.documentElement.dataset.aiBuilder = '1';
    const tab = d.createElement('button'); tab.className = 'tab'; tab.textContent = 'AI Builder'; toolbar.insertBefore(tab, toolbar.querySelector('.spacer'));
    const pane = d.createElement('div'); pane.id = 'aiBuilderPane'; pane.className = 'workspace';
    pane.innerHTML = `<div style="height:100%;display:grid;grid-template-rows:auto 1fr auto;gap:10px;padding:12px;overflow:hidden"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><strong style="font-size:18px">AI Builder</strong><select id="aiBuilderMode" style="margin-left:auto;padding:9px;border-radius:10px;background:#07111f;color:#edf5ff;border:1px solid #365477"><option value="ask">Ask mode</option><option value="build">Build mode</option></select><button id="aiBuilderMemory" class="toolbtn">Refresh memory</button><button id="aiBuilderRollback" class="toolbtn">Rollback AI change</button></div><div id="aiBuilderMessages" style="overflow:auto;display:flex;flex-direction:column;gap:9px;padding:10px;border:1px solid #29425f;border-radius:14px;background:#06101d"></div><div style="display:grid;gap:8px"><div id="aiBuilderStatus" style="min-height:18px;color:#8fa4c1;font-size:12px">Memory bank updates automatically before each message.</div><textarea id="aiBuilderInput" rows="3" placeholder="Example: Look at the preview and stop the player covering the buttons." style="width:100%;resize:none;padding:11px;border-radius:12px;border:1px solid #365477;background:#07111f;color:#edf5ff"></textarea><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button id="aiBuilderSend" class="toolbtn">Send</button><button id="aiBuilderApply" class="toolbtn" hidden>Apply proposed patch</button></div></div></div>`;
    main.appendChild(pane);
    tab.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); d.querySelectorAll('.tab').forEach(n => n.classList.remove('active')); d.querySelectorAll('.workspace').forEach(n => n.classList.remove('active')); tab.classList.add('active'); pane.classList.add('active'); renderMessages(); }, true);
    d.querySelector('#aiBuilderSend').onclick = sendMessage;
    d.querySelector('#aiBuilderApply').onclick = applyPatch;
    d.querySelector('#aiBuilderRollback').onclick = rollback;
    d.querySelector('#aiBuilderMemory').onclick = () => { const record = readProjectRecord(); if (!record) return setStatus('No active project was found.', true); const memory = buildMemory(record.value); setStatus(`Memory refreshed: ${memory.fileCount} files mapped.`); };
    d.querySelector('#aiBuilderInput').addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') sendMessage(); });
    renderMessages();
    const badge = document.getElementById('codem8s-version'); if (badge) badge.textContent = 'Codem8s 10.14.0';
  }
  frame?.addEventListener('load', wire);
  setInterval(wire, 800);
})();