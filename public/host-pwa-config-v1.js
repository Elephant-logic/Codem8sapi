(() => {
  const nativeOpen = window.open.bind(window);
  function pngDataUrl(source) {
    if (!source) return Promise.resolve('');
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 512; canvas.height = 512;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#07101c'; ctx.fillRect(0, 0, 512, 512);
          const scale = Math.min(512 / image.naturalWidth, 512 / image.naturalHeight);
          const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
          ctx.drawImage(image, (512 - width) / 2, (512 - height) / 2, width, height);
          resolve(canvas.toDataURL('image/png'));
        } catch { resolve(''); }
      };
      image.onerror = () => resolve('');
      image.src = source;
    });
  }
  window.open = function codem8sPwaOpen(url, target, features) {
    const text = String(url || '');
    const match = text.match(/^\/mobile-apps\/([^/]+)\/?/);
    if (!match) return nativeOpen(url, target, features);
    const popup = nativeOpen('about:blank', target || '_blank', features || 'noopener');
    const id = decodeURIComponent(match[1]);
    let item = null;
    try {
      const frame = document.getElementById('codem8s-app');
      const list = JSON.parse(frame?.contentWindow?.localStorage?.getItem('codem8s_app_store_v1') || '[]');
      item = list.find(x => String(x.id).replace(/[^a-z0-9_-]/gi, '-') === id) || null;
    } catch {}
    const name = String(item?.installName || item?.name || id).trim() || id;
    pngDataUrl(String(item?.icon || '')).then(icon => fetch(`/mobile-apps/${encodeURIComponent(id)}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, icon })
    })).catch(() => {}).finally(() => {
      const destination = `/mobile-apps/${encodeURIComponent(id)}/?name=${encodeURIComponent(name)}`;
      if (popup && !popup.closed) popup.location.replace(destination);
      else nativeOpen(destination, target || '_blank', features || 'noopener');
    });
    return popup;
  };
})();