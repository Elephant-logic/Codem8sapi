const express = require('express');
const path = require('path');
const originalSend = express.response.send;
const originalGet = express.application.get;

const ICON_192 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAAECUlEQVR4nO3d203sMBiF0eEIiVcKgC5oh+pohy4ohPNCpGgEc7X9O9lrNUAi9hdnQIiHp+eX7wOE+ld9AVBJAEQTANEEQDQBEE0ARBMA0QRANAEQTQBEEwDRBEA0ARBNAEQTANEeqy/gXu+fX9WXEO/j7bX6Em72sLU/iDH4+W0piE0EYPTbNXsMUwdg+PsxawhTBmD4+zVbCFMFYPg5ZglhigAMP1d1COW/BzD+bNXf/9IAqm+eOVTuoOQVyPD5y+hXouEngPFzyuh9DA3A+LnEyJ0MC8D4ucaovQwJwPi5xYjdlP8YFCp1D8DTn3v03k/XAIyfFnruqFsAxk9LvfbkMwDRugTg6U8PPXblBCBa8wA8/emp9b6cAERrGoCnPyO03JkTgGjNAvD0Z6RWe3MCEE0ARGsSgNcfKrTYnROAaAIgmgCIdncA3v+pdO/+nABEEwDRBEA0ARBNAEQTANEEQDQBEE0ARBMA0QRANAEQTQBEEwDRBEC0x+oL2KLq/25+ir/PuI4ALjTz6NfW1ymG8wRwxlaG/5vl2oXwN58BTtjy+Nf2ch89OAF+scfBOA1+5wQ4ssfxr+39/q4lAKIJYCXl6Zhyn5cQwI+0UaTd718EQDQBHHKfhqn3vSYAogmAaPEBpL8GpN9/fABkEwDRBEA0ARBNAEQTANEEQDQBEE0ARBMA0QRANAEQTQBEEwDRBEA0ARBNAEQTANEEQDQBEE0ARBMA0QRANAEQTQBEEwDRBEA0ARBNAEQTANEEQDQBEE0ARBMA0QRANAEQTQBEEwDR4gN4//yqvoRS6fcfHwDZBEA0ARxyXwNS73tNAEQTwI+0p2Ha/f5FACspo0i5z0sIgGgCOLL3p+Pe7+9aj9UXMKNlJB9vr8VX0o7h/84JcMJeRrOX++jBCXDGlk8Dwz9PABdaj2nmGIz+OgK4gZHth88ARBMA0QRANAEQTQBEEwDRBEA0ARBNAEQTANEEQDQBEE0ARBMA0QRAtLsDmPmPQ9i/e/fnBCCaAIgmAKI1CcDnACq02J0TgGgCIFqzALwGMVKrvTkBiNY0AKcAI7TcmROAaM0DcArQU+t9OQGI1iUApwA99NiVE4Bo3QJwCtBSrz11PQFEQAs9d9T9FUgE3KP3fnwGINqQAJwC3GLEboadACLgGqP2MvQVSARcYuROhn8GEAGnjN7Hw9Pzy/fQr7ji342yqHowlv4UyGnA4VC7g/Ifg4ogW/X3v/QV6JhXohzVw19MFcBCCPs1y/AXUwawEMJ+zDb8xdQBLISwXbMOf7GJANbEML/ZR7+2uQCOCaLelgZ/bPMBwD3Kfw8AlQRANAEQTQBEEwDRBEA0ARBNAEQTANEEQDQBEE0ARBMA0QRAtP9nMt+vEhdkxAAAAABJRU5ErkJggg==','base64');
const ICON_512 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6AAANLklEQVR4nO3d0XEbVxJA0fGWq/zrAKwslI6iUzrKQoF4P7Re0iJFAuAAM6/vORGgarq6LwaU/dsff/719wYApPzn6A8AADyeAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAEDQ70d/AM7py7fvR38EYEdfP386+iNwMr/98edffx/9ITiGIw9smzioEgARjj1wDVEwnwAYysEH9iQI5hEAgzj6wCOIgRkEwMIcfOAMBMGaBMCCHH7gjITAWgTAIhx9YCVi4PwEwMk5/MDKhMB5CYCTcviBSYTA+QiAE3H0gQIxcA4C4AQcfqBICBzL/wzoYI4/UGX/HcsbgIMYfIAn3gY8ngB4MIcf4NeEwOMIgAdx+AEuJwTuz98APIDjD3Ade/P+vAG4IwMM8HHeBtyHNwB34vgD7MM+vQ8BcAeGFWBf9ur+/ASwIwMKcH9+EtiHNwA7cfwBHsO+3YcA2IFhBHgse/fj/ATwAQYQ4Hh+EriNNwA3cvwBzsE+vo0AuIFhAzgXe/l6AuBKhgzgnOzn6wiAKxgugHOzpy8nAC5kqADWYF9fRgBcwDABrMXefp8AeIchAliT/f02AfAGwwOwNnv81wTALxgagBns89cJgFcYFoBZ7PWXBMBPDAnATPb7vwmAZwwHwGz2/BMB8D+GAqDBvv9BAGyGAaDG3hcAAJCUDwAVCNBU3//pAKg/fIC68h3IBkD5oQPwpHoPsgEAAGXJAKjWHgCvK96FXAAUHzIA76vdh1QA1B4uANcp3YlUAAAAP2QCoFR1ANyuci8SAVB5mADso3A3EgEAAPzb+AAoVBwA+5t+P8YHAADw0ugAmF5vANzX5DsyOgAAgNeNDYDJ1QbA40y9JyMDYOrDAuAYE+/KyAAAAN42LgAmVhoAx5t2X8YFAADwPgEAAEGjAmDa6xkAzmXSnRkVAADAZcYEwKQqA+C8ptybMQEAAFxuRABMqTEA1jDh7owIAADgOgIAAIKWD4AJr2EAWM/q92f5AAAArrd0AKxeXwCsbeU7tHQAAAC3EQAAECQAACBo2QBY+XcXAOZY9R4tGwAAwO0EAAAELRkAq75uAWCmFe/SkgEAAHyMAACAIAEAAEHLBcCKv7MAMN9q92m5AAAAPk4AAECQAACAIAEAAEFLBcBqf2ABQMtKd2qpAAAA9iEAACBIAABAkAAAgCABAABBAgAAgpYJgJX+aQUAXavcq2UCAADYjwAAgCABAABBAgAAggQAAAQJAAAIEgAAECQAACBIAABAkAAAgCABAABBAgAAggQAAAQJAAAIEgAAECQAACBIAABAkAAAgCABAABBAgAAggQAAAQJAAAIEgAAECQAACBIAABBAgAAggQAAAQJAAAIEgAAECQAACBIAABAkAAAgCABAABBAgAAggQAAAQJAAAIEgAAEPRfbApKMeHJNyIAAAAASUVORK5CYII=','base64');

function safeId(value) { return String(value || 'app').replace(/[^a-z0-9_-]/gi, '-'); }
function safeName(value) { return String(value || 'App').replace(/[<>"'&]/g, '').trim().slice(0, 80) || 'App'; }

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
    originalGet.call(this, '/mobile-apps/:id/icon-192.png', (_req, res) => {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.type('image/png').send(ICON_192);
    });
    originalGet.call(this, '/mobile-apps/:id/icon-512.png', (_req, res) => {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.type('image/png').send(ICON_512);
    });
    originalGet.call(this, '/mobile-apps/:id/manifest.webmanifest', (req, res) => {
      const id = safeId(req.params.id);
      const name = safeName(req.query.name);
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
        icons: [
          { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      }));
    });
  }
  return originalGet.call(this, route, ...handlers);
};

express.response.send = function codem8sHostSend(body) {
  if (typeof body === 'string' && body.includes('id="codem8s-app"')) {
    if (!body.includes('host-app-store-v1.js')) {
      body = body.replace('</body>', '<script src="/host-app-store-v1.js?v=10.10.0"></script></body>');
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