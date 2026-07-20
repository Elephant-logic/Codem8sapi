const express = require('express');
const path = require('path');
const originalSend = express.response.send;
const originalGet = express.application.get;

function safeId(value) {
  return String(value || 'app').replace(/[^a-z0-9_-]/gi, '-');
}

express.application.get = function codem8sInstallRoutes(route, ...handlers) {
  if (route === '*' && !this.__codem8sInstallRoutes) {
    this.__codem8sInstallRoutes = true;
    originalGet.call(this, '/mobile-apps/:id/', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.sendFile(path.join(__dirname, 'public', 'mobile-app-multi.html'));
    });
    originalGet.call(this, '/mobile-apps/:id/sw.js', (req, res) => {
      const base = `/mobile-apps/${encodeURIComponent(safeId(req.params.id))}/`;
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.setHeader('Service-Worker-Allowed', base);
      res.type('application/javascript').sendFile(path.join(__dirname, 'public', 'mobile-app-multi-sw.js'));
    });
  }
  return originalGet.call(this, route, ...handlers);
};

const ROOT_PWA_CLEANUP = `<script>(async()=>{try{document.querySelectorAll('link[rel~="manifest"]').forEach(x=>x.remove());if('serviceWorker'in navigator){const root=new URL('/',location.origin).href;for(const r of await navigator.serviceWorker.getRegistrations()){if(r.scope===root)await r.unregister()}}if('caches'in window){for(const k of await caches.keys()){if(k==='codem8s-mobile-shell-v1'||k==='codem8s-mobile-shell-v2'||k==='codem8s-mobile-identities-v1')await caches.delete(k)}}}catch{}})();</script>`;

express.response.send = function codem8sHostSend(body) {
  if (typeof body === 'string' && body.includes('id="codem8s-app"')) {
    body = body.replace(/<link\b[^>]*rel=["'][^"']*manifest[^"']*["'][^>]*>/gi, '');
    body = body.replace(/<meta\b[^>]*name=["']mobile-web-app-capable["'][^>]*>/gi, '');
    body = body.replace(/<meta\b[^>]*name=["']apple-mobile-web-app-capable["'][^>]*>/gi, '');
    if (body.includes('</head>')) body = body.replace('</head>', `${ROOT_PWA_CLEANUP}</head>`);
    else body = ROOT_PWA_CLEANUP + body;
    if (!body.includes('host-app-store-v1.js')) {
      body = body.replace('</body>', '<script src="/host-app-store-v1.js?v=10.11.1"></script></body>');
    }
    if (!body.includes('host-framework-project-safety-v1.js')) {
      body = body.replace('</body>', '<script src="/host-framework-project-safety-v1.js?v=1.0.0"></script></body>');
    }
  }
  return originalSend.call(this, body);
};

const nativeFetch = global.fetch;

const UI_QUALITY_RULES = `
MANDATORY UI QUALITY PASS:
- Build a polished, production-looking, mobile-first interface rather than a raw prototype.
- Use a coherent visual system: spacing scale, typography hierarchy, accessible contrast, consistent radii, shadows and button styles.
- Prevent horizontal overflow at 320px mobile width and support tablet and desktop layouts.
- Use responsive grids, wrapping toolbars, readable forms, touch targets of at least 44px and sensible empty/loading/error states.
- Replace every placeholder, TODO, mock panel, "coming soon", unfinished Kanban, blank canvas or skeletal section with a functional component.
- Do not label unfinished areas as placeholders. Implement the requested interaction using local demo data when a real service is unavailable.
- Ensure images are responsive, long text wraps, tables scroll safely and modals fit small screens.
- Before returning files, perform a final UI review and fix cramped, clipped, unstyled or default-browser-looking elements.
- The project is not complete merely because it compiles; the main user journey must look intentional and be usable on a phone.
`;

global.fetch = async function codem8sQualityFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url || '';
  if (!url.startsWith('https://api.openai.com/v1/responses')) return nativeFetch(input, init);
  try {
    const body = JSON.parse(init.body || '{}');
    const existing = typeof body.instructions === 'string' ? body.instructions : '';
    body.instructions = `${existing}\n\n${UI_QUALITY_RULES}`.trim();
    return nativeFetch(input, { ...init, body: JSON.stringify(body) });
  } catch {
    return nativeFetch(input, init);
  }
};

require('./server');