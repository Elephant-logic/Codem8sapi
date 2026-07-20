(() => {
  const frame = document.getElementById('codem8s-app');

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

  function looksLikeProjectJson(text) {
    const value = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    return value.startsWith('{') && /"(?:files|index\.html|main\.js|styles\.css)"\s*:/.test(value);
  }

  function validJson(text) {
    const value = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    try { JSON.parse(value); return true; } catch { return false; }
  }

  function repairBody(originalBody, brokenText) {
    const instructions = `Repair the malformed JSON below. Return ONLY one valid JSON object with no markdown fences and no explanation. Preserve every complete file and all code content. Correct missing commas, quotes, escapes, braces and truncation where safely inferable. The result must contain a files object with complete string values. Never return empty index.html.\n\nMALFORMED JSON:\n${brokenText}`;
    return {
      model: originalBody?.model || 'gpt-5-mini',
      instructions,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Repair this project JSON now.' }] }]
    };
  }

  function install() {
    const w = frame?.contentWindow;
    if (!w || w.__codem8sBuildJsonRecovery) return;
    w.__codem8sBuildJsonRecovery = true;
    const nativeFetch = w.fetch.bind(w);

    w.fetch = async function buildJsonRecoveryFetch(input, init = {}) {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (!url.endsWith('/api/openai') || !init?.body) return nativeFetch(input, init);

      let originalBody = null;
      try { originalBody = JSON.parse(init.body); } catch {}
      const first = await nativeFetch(input, init);
      if (!first.ok) return first;

      try {
        const data = await first.clone().json();
        const text = responseText(data);
        if (!looksLikeProjectJson(text) || validJson(text)) return first;

        const d = frame?.contentDocument;
        const status = d?.querySelector('#status, .status');
        if (status) {
          status.textContent = 'The AI returned malformed project JSON. Repairing the response before files are saved…';
          status.classList.remove('err');
        }

        const repaired = await nativeFetch('/api/openai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(repairBody(originalBody, text))
        });
        if (!repaired.ok) return first;
        const repairedData = await repaired.clone().json();
        const repairedText = responseText(repairedData);
        if (!validJson(repairedText)) return first;
        return repaired;
      } catch {
        return first;
      }
    };
  }

  frame?.addEventListener('load', () => setTimeout(install, 0));
  setInterval(install, 300);
})();