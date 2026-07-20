(() => {
  const frame = document.getElementById('codem8s-app');
  const nativeFetch = window.fetch.bind(window);
  let defaultApplied = false;

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

  function buildRequest(body) {
    const serialized = JSON.stringify(body?.input || []);
    return /MODE:\s*BUILD/i.test(serialized);
  }

  function strengthen(body, retry = false) {
    const rule = `\n\nCODEM8S BUILD AGENT RULES:\n- You are an autonomous coding agent, not a support chatbot.\n- Inspect the supplied CURRENT PROJECT FILES, memory bank, diagnostics and preview before answering.\n- For a report such as "it will not start", trace initialization, event listeners, screen state, canvas setup and start-run control directly in the supplied code.\n- Do not ask the user to open DevTools, run console commands, paste errors, inspect IDs or perform debugging that you can do from the supplied files.\n- Do not return a checklist of things for the user to try.\n- Produce the smallest safe complete-file repair now.\n- Preserve all working features and never empty a non-empty file.\n- Your response MUST end with one valid codem8s-patch fenced JSON block containing complete replacement contents for every changed file.\n- If the exact cause is uncertain, add safe in-app diagnostics and repair the most likely broken initialization or UI wiring in the same patch.\n- Never claim code was applied; Codem8s will present the patch for approval.${retry ? '\n- Your previous response failed because it contained no usable patch. Correct that now and return the required patch.' : ''}`;
    return { ...body, instructions: `${body.instructions || ''}${rule}` };
  }

  window.fetch = async function aiBuilderAgentFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.endsWith('/api/openai') || !init?.body) return nativeFetch(input, init);

    let body;
    try { body = JSON.parse(init.body); } catch { return nativeFetch(input, init); }
    if (!buildRequest(body)) return nativeFetch(input, init);

    const firstBody = strengthen(body, false);
    const first = await nativeFetch(input, { ...init, body: JSON.stringify(firstBody) });
    if (!first.ok) return first;

    try {
      const data = await first.clone().json();
      const text = responseText(data);
      if (/```codem8s-patch\s*[\s\S]*?```/i.test(text)) return first;

      const retryBody = strengthen(body, true);
      const retry = await nativeFetch(input, { ...init, body: JSON.stringify(retryBody) });
      return retry.ok ? retry : first;
    } catch {
      return first;
    }
  };

  function wire() {
    let d;
    try { d = frame?.contentDocument; } catch { return; }
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
      status.textContent = 'Build agent ready: it will inspect the project and prepare a repair patch.';
    }

    const inputBox = d.querySelector('#aiBuilderInput');
    if (inputBox && !inputBox.dataset.agentPlaceholder) {
      inputBox.dataset.agentPlaceholder = '1';
      inputBox.placeholder = 'Example: The game loads but will not start. Inspect the code, repair it and prepare the patch.';
    }
  }

  frame?.addEventListener('load', () => { defaultApplied = false; setTimeout(wire, 150); });
  setInterval(wire, 500);
})();