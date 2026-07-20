(() => {
  const frame = document.getElementById('codem8s-app');
  const nativeFetch = window.fetch.bind(window);
  let defaultApplied = false;
  let pendingPrompt = '';

  function appDoc() {
    try { return frame?.contentDocument || null; } catch { return null; }
  }

  function responseText(data) {
    if (typeof data?.output_text === 'string') return data.output_text;
    const parts = [];
    for (const item of data?.output || []) {
      for (const part of item?.content || []) {
        if (typeof part?.text === 'string') parts.push(part.text);
      }
    }
    return parts.join('\n');
  }

  function serializedRequest(body) {
    return JSON.stringify(body?.input || []);
  }

  function buildRequest(body) {
    return /MODE:\s*BUILD/i.test(serializedRequest(body));
  }

  function promptRequest(body) {
    const text = serializedRequest(body);
    return /(?:give|make|create|write|improve|generate).{0,35}(?:a\s+)?prompt|put.{0,30}prompt.{0,30}(?:box|builder)|use.{0,20}(?:this|the)?\s*prompt/i.test(text);
  }

  function shouldInsert(body) {
    return /put.{0,35}(?:prompt|it).{0,35}(?:box|builder)|insert.{0,30}(?:prompt|it)|fill.{0,25}prompt/i.test(serializedRequest(body));
  }

  function shouldStart(body) {
    return /(?:use|run|start|build).{0,35}(?:the|this|it)?\s*prompt|put.{0,35}(?:prompt|it).{0,35}(?:and|then).{0,20}(?:build|start|generate)/i.test(serializedRequest(body));
  }

  function strengthenBuild(body, retry = false) {
    const rule = `\n\nCODEM8S BUILD AGENT RULES:\n- You are an autonomous coding agent, not a support chatbot.\n- Inspect the supplied CURRENT PROJECT FILES, memory bank, diagnostics and preview before answering.\n- For a report such as "it will not start", trace initialization, event listeners, screen state, canvas setup and start-run control directly in the supplied code.\n- Do not ask the user to open DevTools, run console commands, paste errors, inspect IDs or perform debugging that you can do from the supplied files.\n- Do not return a checklist of things for the user to try.\n- Produce the smallest safe complete-file repair now.\n- Preserve all working features and never empty a non-empty file.\n- Your response MUST end with one valid codem8s-patch fenced JSON block containing complete replacement contents for every changed file.\n- If the exact cause is uncertain, add safe in-app diagnostics and repair the most likely broken initialization or UI wiring in the same patch.\n- Never claim code was applied; Codem8s will present the patch for approval.${retry ? '\n- Your previous response failed because it contained no usable patch. Correct that now and return the required patch.' : ''}`;
    return { ...body, instructions: `${body.instructions || ''}${rule}` };
  }

  function strengthenPrompt(body) {
    const rule = `\n\nCODEM8S PROMPT CREATOR RULES:\n- The user is asking for a build prompt, not a source-code patch.\n- Write one complete, detailed prompt that Codem8s can use to create or improve the requested app.\n- Include required files, features, mobile behaviour, persistence, validation and regression-safety instructions where relevant.\n- Do not return generic advice or ask follow-up questions when a useful prompt can be produced.\n- Put the complete prompt inside exactly one fenced block using this format:\n\n\`\`\`codem8s-prompt\nCOMPLETE PROMPT TEXT\n\`\`\`\n\n- Do not include a codem8s-patch block.`;
    return { ...body, instructions: `${body.instructions || ''}${rule}` };
  }

  function extractPrompt(text) {
    const fenced = text.match(/```codem8s-prompt\s*([\s\S]*?)```/i);
    if (fenced?.[1]?.trim()) return fenced[1].trim();
    return '';
  }

  function fieldText(element) {
    return [element.id, element.name, element.placeholder, element.getAttribute('aria-label'), element.getAttribute('title')]
      .filter(Boolean).join(' ').toLowerCase();
  }

  function findMainPromptBox() {
    const d = appDoc();
    if (!d) return null;
    const fields = [...d.querySelectorAll('textarea, input[type="text"]')].filter(el => {
      if (el.id === 'aiBuilderInput' || el.closest('#aiBuilderPane, #directFileEditorPane')) return false;
      return !el.disabled && !el.readOnly;
    });
    let best = null;
    let bestScore = -1;
    for (const field of fields) {
      const text = fieldText(field);
      let score = 0;
      if (/prompt/.test(text)) score += 8;
      if (/idea|describe|what.*build|create.*app|app.*description/.test(text)) score += 6;
      if (field.tagName === 'TEXTAREA') score += 3;
      if (field.closest('.workspace.active')) score += 2;
      if (score > bestScore) { best = field; bestScore = score; }
    }
    return bestScore > 0 ? best : fields.find(el => el.tagName === 'TEXTAREA') || null;
  }

  function findBuildButton() {
    const d = appDoc();
    if (!d) return null;
    const buttons = [...d.querySelectorAll('button')].filter(button => {
      if (button.closest('#aiBuilderPane, #appsPane, #directFileEditorPane')) return false;
      if (button.disabled) return false;
      const text = `${button.id} ${button.textContent || ''} ${button.getAttribute('aria-label') || ''}`.toLowerCase();
      if (/apk|repair|fix|preview|test|save/.test(text)) return false;
      return /generate|build app|create app|start build|make app/.test(text);
    });
    return buttons[0] || null;
  }

  function setStatus(text, error = false) {
    const node = appDoc()?.querySelector('#aiBuilderStatus');
    if (!node) return;
    node.textContent = text;
    node.style.color = error ? '#ff7892' : '#8fa4c1';
  }

  function putPromptInBuilder(start = false) {
    if (!pendingPrompt) return setStatus('No generated prompt is ready yet.', true);
    const field = findMainPromptBox();
    if (!field) return setStatus('The main Codem8s prompt box could not be found.', true);
    field.value = pendingPrompt;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.focus();
    if (!start) return setStatus('Prompt inserted into the main builder. Review it, then start when ready.');
    const button = findBuildButton();
    if (!button) return setStatus('Prompt inserted, but the main build button could not be found.', true);
    setStatus('Prompt inserted. Starting the build…');
    setTimeout(() => button.click(), 100);
  }

  window.fetch = async function aiBuilderAgentFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.endsWith('/api/openai') || !init?.body) return nativeFetch(input, init);

    let body;
    try { body = JSON.parse(init.body); } catch { return nativeFetch(input, init); }

    if (promptRequest(body)) {
      const response = await nativeFetch(input, { ...init, body: JSON.stringify(strengthenPrompt(body)) });
      if (!response.ok) return response;
      try {
        const data = await response.clone().json();
        const prompt = extractPrompt(responseText(data));
        if (prompt) {
          pendingPrompt = prompt;
          setTimeout(() => {
            wirePromptButtons();
            if (shouldStart(body)) putPromptInBuilder(true);
            else if (shouldInsert(body)) putPromptInBuilder(false);
            else setStatus('Prompt ready. Use “Put prompt in builder” or “Put prompt & build”.');
          }, 50);
        }
      } catch {}
      return response;
    }

    if (!buildRequest(body)) return nativeFetch(input, init);
    const first = await nativeFetch(input, { ...init, body: JSON.stringify(strengthenBuild(body, false)) });
    if (!first.ok) return first;
    try {
      const data = await first.clone().json();
      const text = responseText(data);
      if (/```codem8s-patch\s*[\s\S]*?```/i.test(text)) return first;
      const retry = await nativeFetch(input, { ...init, body: JSON.stringify(strengthenBuild(body, true)) });
      return retry.ok ? retry : first;
    } catch {
      return first;
    }
  };

  function wirePromptButtons() {
    const d = appDoc();
    const send = d?.querySelector('#aiBuilderSend');
    const row = send?.parentElement;
    if (!row || row.querySelector('[data-ai-prompt-insert]')) return;
    row.style.gridTemplateColumns = 'repeat(2,minmax(0,1fr))';
    const insert = d.createElement('button');
    insert.type = 'button';
    insert.className = 'toolbtn';
    insert.dataset.aiPromptInsert = '1';
    insert.textContent = 'Put prompt in builder';
    insert.onclick = () => putPromptInBuilder(false);
    const build = d.createElement('button');
    build.type = 'button';
    build.className = 'toolbtn';
    build.dataset.aiPromptBuild = '1';
    build.textContent = 'Put prompt & build';
    build.onclick = () => putPromptInBuilder(true);
    row.append(insert, build);
    insert.hidden = build.hidden = !pendingPrompt;
  }

  function wire() {
    const d = appDoc();
    if (!d) return;
    const mode = d.querySelector('#aiBuilderMode');
    if (mode && !defaultApplied) {
      mode.value = 'build';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
      defaultApplied = true;
    }
    const status = d.querySelector('#aiBuilderStatus');
    if (status && mode?.value === 'build' && !status.dataset.agentReady) {
      status.dataset.agentReady = '1';
      status.textContent = 'Build agent ready. It can repair code or create and insert build prompts.';
    }
    const inputBox = d.querySelector('#aiBuilderInput');
    if (inputBox && !inputBox.dataset.agentPlaceholder) {
      inputBox.dataset.agentPlaceholder = '1';
      inputBox.placeholder = 'Ask for a repair, or say: Give me a prompt for a detailed game and put it in the prompt box.';
    }
    wirePromptButtons();
    const insert = d.querySelector('[data-ai-prompt-insert]');
    const build = d.querySelector('[data-ai-prompt-build]');
    if (insert) insert.hidden = !pendingPrompt;
    if (build) build.hidden = !pendingPrompt;
  }

  frame?.addEventListener('load', () => { defaultApplied = false; setTimeout(wire, 150); });
  setInterval(wire, 500);
})();