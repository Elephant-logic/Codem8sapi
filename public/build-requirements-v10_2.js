(() => {
  'use strict';

  const style = document.createElement('style');
  style.textContent = `
    .c8req-back{position:fixed;inset:0;z-index:100000;background:#020812dc;display:none;align-items:center;justify-content:center;padding:14px}
    .c8req-back.open{display:flex}
    .c8req-modal{width:min(760px,100%);max-height:90vh;overflow:auto;border:1px solid #355273;border-radius:18px;background:#0b1626;color:#edf5ff;box-shadow:0 30px 100px #000c}
    .c8req-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:16px;border-bottom:1px solid #263b59}
    .c8req-head h2{margin:0 0 4px}.c8req-head p{margin:0;color:#8fa4c1;font-size:12px}
    .c8req-body{padding:14px;display:grid;gap:10px}
    .c8req-item{border:1px solid #29425f;border-radius:14px;background:#081322;padding:12px;display:grid;gap:9px}
    .c8req-top{display:flex;justify-content:space-between;gap:10px}.c8req-top strong{font-size:13px}.c8req-top small{color:#8fa4c1}
    .c8req-actions{display:flex;gap:7px;flex-wrap:wrap}.c8req-actions button{padding:8px 10px;border:1px solid #365477;border-radius:9px;background:#13243a;color:#dcecff;font-weight:750}
    .c8req-actions button.active{border-color:#64dcff;background:#173652}.c8req-input{display:none}.c8req-input.open{display:block}
    .c8req-foot{display:flex;gap:8px;justify-content:flex-end;padding:14px;border-top:1px solid #263b59}.c8req-foot button{width:auto}
    .c8req-essential{color:#ffd166;font-size:10px}.c8req-note{color:#8fa4c1;font-size:10px}.c8req-done{color:#66e3a4;font-size:10px}
  `;
  document.head.appendChild(style);

  const modal = document.createElement('div');
  modal.className = 'c8req-back';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="c8req-modal" role="dialog" aria-modal="true" aria-labelledby="c8req-title">
      <div class="c8req-head">
        <div><h2 id="c8req-title">Build requirements</h2><p>Add what the project needs now, use a placeholder, or skip it.</p></div>
        <button id="c8req-close" class="tinybtn">Close</button>
      </div>
      <div id="c8req-body" class="c8req-body"></div>
      <div class="c8req-foot"><button id="c8req-cancel" class="btn secondary">Cancel build</button><button id="c8req-continue" class="btn">Continue build</button></div>
    </div>`;
  document.body.appendChild(modal);

  const body = modal.querySelector('#c8req-body');
  let requirements = [];
  let pending = false;
  const originalAskOpenAI = askOpenAI;

  function id() {
    return 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  function normalize(raw) {
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.requirements) ? raw.requirements : [];
    return list.slice(0, 10).map((item, index) => ({
      id: id(),
      key: String(item.key || item.name || `ITEM_${index + 1}`).toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
      label: String(item.label || item.name || item.key || `Item ${index + 1}`),
      type: ['image', 'file', 'text', 'secret', 'choice'].includes(item.type) ? item.type : 'text',
      reason: String(item.reason || 'Useful for this build.'),
      essential: Boolean(item.essential),
      placeholder: String(item.placeholder || 'Use a clear replaceable placeholder.'),
      secretName: String(item.secretName || item.key || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
      options: Array.isArray(item.options) ? item.options.map(String) : [],
      status: 'unresolved',
      value: '',
      assetAlias: ''
    }));
  }

  function fallback(prompt) {
    const text = prompt.toLowerCase();
    const found = [];
    if (/logo|brand|company|business|website/.test(text)) found.push({key:'LOGO',label:'Logo or brand mark',type:'image',reason:'Used in branded areas and app identity.',placeholder:'Create a simple text or SVG placeholder logo.'});
    if (/image|photo|gallery|sprite|texture|background/.test(text)) found.push({key:'VISUAL_ASSETS',label:'Images or visual assets',type:'file',reason:'Used for the requested visual content.',placeholder:'Use generated SVG, CSS, or labelled image placeholders.'});
    if (/api|weather|maps?|stripe|payment|garmin|discord|telegram/.test(text)) found.push({key:'SERVICE_API_KEY',label:'External service API key',type:'secret',reason:'Needed to connect the requested external service.',placeholder:'Use mock data and clearly mark the integration as not configured.'});
    if (/contact|booking|business|company|portfolio/.test(text)) found.push({key:'BUSINESS_DETAILS',label:'Business or contact details',type:'text',reason:'Used for realistic content and contact areas.',placeholder:'Use obvious example details that are easy to replace.'});
    return normalize(found);
  }

  async function analyse(prompt) {
    const instructions = 'Return ONLY strict JSON with shape {"requirements":[{"key":"LOGO","label":"Logo","type":"image|file|text|secret|choice","reason":"why it matters","essential":false,"placeholder":"safe fallback","secretName":"OPTIONAL_ENV_NAME","options":[]}]} . Ask only for concrete missing user inputs that materially improve or enable the requested software. Do not ask for assets or secrets already available. Maximum 8 items. Prefer optional placeholders. Private credentials must use type secret.';
    const input = `Analyse this software request before building.\nREQUEST: ${prompt}\nTARGET: ${typeof targetLabel === 'function' ? targetLabel() : 'project'}\nMODE: ${typeof mode !== 'undefined' ? mode : 'project'}\nAVAILABLE ASSETS: ${JSON.stringify(typeof assetManifest === 'function' ? assetManifest() : [])}\nAVAILABLE SECRETS: ${JSON.stringify(typeof secretManifest === 'function' ? secretManifest() : [])}`;
    try {
      const response = await fetch('/api/openai', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:els.model.value,instructions,input})});
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Requirements analysis failed');
      return normalize(JSON.parse(cleanFence(extractText(data))));
    } catch (error) {
      if (typeof log === 'function') log('warn', 'Requirements analysis used local fallback: ' + (error.message || error));
      return fallback(prompt);
    }
  }

  function summary(item) {
    if (item.status === 'provided') return item.type === 'secret' ? `Will use {{${item.secretName || item.key}}}` : `Added: ${item.value || item.assetAlias || 'provided'}`;
    if (item.status === 'placeholder') return `Placeholder: ${item.placeholder}`;
    if (item.status === 'skip') return 'Skipped';
    return 'Choose an option';
  }

  function draw() {
    body.innerHTML = '';
    if (!requirements.length) {
      body.innerHTML = '<div class="c8req-item"><strong>No extra items needed.</strong><span class="c8req-done">Ready to continue.</span></div>';
      return;
    }

    for (const item of requirements) {
      const row = document.createElement('div');
      row.className = 'c8req-item';
      row.innerHTML = `
        <div class="c8req-top"><div><strong>${escapeHtml(item.label)}</strong><div><small>${escapeHtml(item.reason)}</small></div></div><span class="${item.essential ? 'c8req-essential' : 'c8req-note'}">${item.essential ? 'Essential' : 'Optional'}</span></div>
        <div class="c8req-actions"><button data-action="provided" class="${item.status === 'provided' ? 'active' : ''}">Add now</button><button data-action="placeholder" class="${item.status === 'placeholder' ? 'active' : ''}">Use placeholder</button><button data-action="skip" class="${item.status === 'skip' ? 'active' : ''}">Skip</button></div>
        <div class="c8req-input ${item.status === 'provided' ? 'open' : ''}"></div>
        <div class="${item.status === 'unresolved' ? 'c8req-note' : 'c8req-done'}">${escapeHtml(summary(item))}</div>`;

      const inputArea = row.querySelector('.c8req-input');
      function renderInput() {
        inputArea.innerHTML = '';
        inputArea.classList.toggle('open', item.status === 'provided');
        if (item.status !== 'provided') return;

        if (item.type === 'image' || item.type === 'file') {
          const input = document.createElement('input');
          input.type = 'file';
          if (item.type === 'image') input.accept = 'image/*';
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            const data = await fileToDataUrl(file);
            const alias = item.key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            assets.push({id:crypto.randomUUID?.() || String(Date.now()),name:file.name,alias,type:file.type || 'application/octet-stream',size:file.size,data});
            item.assetAlias = `asset://${alias}`;
            item.value = file.name;
            renderAssets();
            draw();
          };
          inputArea.appendChild(input);
        } else if (item.type === 'secret') {
          const name = document.createElement('input');
          name.placeholder = 'SECRET_NAME';
          name.value = item.secretName || item.key;
          const value = document.createElement('input');
          value.type = 'password';
          value.placeholder = 'Secret value';
          value.style.marginTop = '7px';
          name.oninput = () => item.secretName = name.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
          value.oninput = () => item.value = value.value;
          inputArea.append(name, value);
        } else if (item.type === 'choice' && item.options.length) {
          const select = document.createElement('select');
          for (const option of item.options) {
            const element = document.createElement('option');
            element.value = element.textContent = option;
            select.appendChild(element);
          }
          item.value = item.value || item.options[0];
          select.value = item.value;
          select.onchange = () => item.value = select.value;
          inputArea.appendChild(select);
        } else {
          const input = document.createElement('input');
          input.placeholder = `Enter ${item.label.toLowerCase()}`;
          input.value = item.value;
          input.oninput = () => item.value = input.value;
          inputArea.appendChild(input);
        }
      }

      row.querySelectorAll('[data-action]').forEach(button => {
        button.onclick = () => {
          item.status = button.dataset.action;
          draw();
        };
      });
      renderInput();
      body.appendChild(row);
    }
  }

  function close() {
    pending = false;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function manifest() {
    return requirements.map(item => ({
      key:item.key,label:item.label,type:item.type,status:item.status,
      value:item.type === 'secret' ? undefined : item.value || undefined,
      assetAlias:item.assetAlias || undefined,
      secretName:item.type === 'secret' && item.status === 'provided' ? item.secretName || item.key : undefined,
      placeholder:item.status === 'placeholder' ? item.placeholder : undefined,
      essential:item.essential
    }));
  }

  async function begin() {
    const prompt = els.prompt.value.trim();
    if (!prompt) return status('Describe what you want to build or change.', 'err');
    if (pending) return;
    pending = true;
    els.build.disabled = true;
    status('Checking what this build needs…');
    requirements = await analyse(prompt);
    els.build.disabled = false;
    draw();
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  modal.querySelector('#c8req-close').onclick = close;
  modal.querySelector('#c8req-cancel').onclick = close;
  modal.querySelector('#c8req-continue').onclick = async () => {
    for (const item of requirements) {
      if (item.status === 'unresolved') item.status = item.essential ? 'placeholder' : 'skip';
      if (item.type === 'secret' && item.status === 'provided' && item.value) {
        secrets.push({id:crypto.randomUUID?.() || String(Date.now()),name:item.secretName || item.key,value:item.value,type:'private'});
        item.value = '';
      }
    }
    if (typeof renderSecrets === 'function') renderSecrets();
    const originalPrompt = els.prompt.value;
    els.prompt.value = `${originalPrompt}\n\nBUILD REQUIREMENTS MANIFEST:\n${JSON.stringify(manifest(), null, 2)}\n\nRespect provided items. For placeholders, create an obvious replaceable fallback. For skipped optional items, omit them safely. Never embed private secret values in frontend code.`;
    close();
    try {
      await originalAskOpenAI('build');
    } finally {
      els.prompt.value = originalPrompt;
    }
  };

  els.build.onclick = begin;
  if (typeof log === 'function') log('ok', 'Build requirements assistant loaded.');
})();
