const express = require('express');
const path = require('path');
const originalSend = express.response.send;
const originalGet = express.application.get;

express.application.get = function codem8sRoutes(route, ...handlers) {
  if (route === '*' && !this.__codem8sMultiRoutes) {
    this.__codem8sMultiRoutes = true;
    originalGet.call(this, '/mobile-apps/:id/', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.sendFile(path.join(__dirname, 'public', 'mobile-app-multi.html'));
    });
    originalGet.call(this, '/mobile-apps/:id/sw.js', (req, res) => {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.setHeader('Service-Worker-Allowed', `/mobile-apps/${encodeURIComponent(req.params.id)}/`);
      res.type('application/javascript').sendFile(path.join(__dirname, 'public', 'mobile-app-multi-sw.js'));
    });
    originalGet.call(this, '/mobile-apps/:id/manifest.webmanifest', (req, res) => {
      const id = String(req.params.id || 'app').replace(/[^a-z0-9_-]/gi, '-');
      const name = String(req.query.name || 'App').slice(0, 80);
      const base = `/mobile-apps/${encodeURIComponent(id)}/`;
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.type('application/manifest+json').send(JSON.stringify({
        name,
        short_name: name.slice(0, 24),
        id: base,
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#07101c',
        theme_color: '#07101c',
        icons: [{ src: `${base}icon`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }]
      }));
    });
  }
  return originalGet.call(this, route, ...handlers);
};

express.response.send = function codem8sHostSend(body) {
  if (typeof body === 'string' && body.includes('id="codem8s-app"')) {
    if (!body.includes('host-app-store-v1.js')) {
      body = body.replace('</body>', '<script src="/host-app-store-v1.js?v=10.8.4"></script></body>');
    }
    if (!body.includes('host-framework-project-safety-v1.js')) {
      body = body.replace('</body>', '<script src="/host-framework-project-safety-v1.js?v=1.0.0"></script></body>');
    }
    if (!body.includes('host-mobile-multi-v1.js')) {
      body = body.replace('</body>', '<script src="/host-mobile-multi-v1.js?v=10.9.0"></script></body>');
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