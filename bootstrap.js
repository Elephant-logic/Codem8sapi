const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const originalSend = express.response.send;
const originalGet = express.application.get;
const installConfig = new Map();

function safeId(value) { return String(value || 'app').replace(/[^a-z0-9_-]/gi, '-'); }
function safeName(value) { return String(value || 'App').replace(/[<>"'&]/g, '').trim().slice(0, 80) || 'App'; }
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function makePng(size) {
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) {
    row[1 + x * 4] = 44; row[2 + x * 4] = 196; row[3 + x * 4] = 255; row[4 + x * 4] = 255;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}
const FALLBACK_192 = makePng(192);
const FALLBACK_512 = makePng(512);
function iconResponse(id, size, res) {
  const config = installConfig.get(id);
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(config?.icon || '');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (match) res.type(match[1]).send(Buffer.from(match[2], 'base64'));
  else res.type('image/png').send(size === 192 ? FALLBACK_192 : FALLBACK_512);
}

express.application.get = function codem8sInstallRoutes(route, ...handlers) {
  if (route === '*' && !this.__codem8sInstallRoutes) {
    this.__codem8sInstallRoutes = true;
    this.post('/mobile-apps/:id/config', express.json({ limit: '3mb' }), (req, res) => {
      const id = safeId(req.params.id);
      installConfig.set(id, { name: safeName(req.body?.name), icon: String(req.body?.icon || '') });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true });
    });
    originalGet.call(this, '/mobile-apps/:id/', (req, res) => {
      const id = safeId(req.params.id);
      const config = installConfig.get(id) || {};
      const name = safeName(req.query.name || config.name || id);
      const base = `/mobile-apps/${encodeURIComponent(id)}/`;
      let html = fs.readFileSync(path.join(__dirname, 'public', 'mobile-app-multi.html'), 'utf8');
      const head = `<link rel="manifest" href="${base}manifest.webmanifest"><link rel="apple-touch-icon" href="${base}icon-192.png"><meta name="application-name" content="${name}">`;
      html = html.replace('</head>', `${head}</head>`);
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.type('html').send(html);
    });
    originalGet.call(this, '/mobile-apps/:id/manifest.webmanifest', (req, res) => {
      const id = safeId(req.params.id);
      const config = installConfig.get(id) || {};
      const name = safeName(config.name || req.query.name || id);
      const base = `/mobile-apps/${encodeURIComponent(id)}/`;
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.type('application/manifest+json').send(JSON.stringify({
        name, short_name: name.slice(0, 24), id: base, start_url: base, scope: base,
        display: 'standalone', background_color: '#07101c', theme_color: '#07101c',
        icons: [
          { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      }));
    });
    originalGet.call(this, '/mobile-apps/:id/icon-192.png', (req, res) => iconResponse(safeId(req.params.id), 192, res));
    originalGet.call(this, '/mobile-apps/:id/icon-512.png', (req, res) => iconResponse(safeId(req.params.id), 512, res));
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
    body = body.replace(/<meta\b[^>]*name=["'](?:mobile-web-app-capable|apple-mobile-web-app-capable)["'][^>]*>/gi, '');
    body = body.replace('</head>', `${ROOT_PWA_CLEANUP}</head>`);
    if (!body.includes('host-app-store-v1.js')) body = body.replace('</body>', '<script src="/host-app-store-v1.js?v=10.12.0"></script></body>');
    if (!body.includes('host-pwa-config-v1.js')) body = body.replace('</body>', '<script src="/host-pwa-config-v1.js?v=1.0.0"></script></body>');
    if (!body.includes('host-framework-project-safety-v1.js')) body = body.replace('</body>', '<script src="/host-framework-project-safety-v1.js?v=1.0.0"></script></body>');
  }
  return originalSend.call(this, body);
};

const nativeFetch = global.fetch;
const UI_QUALITY_RULES = `MANDATORY UI QUALITY PASS:\n- Build a polished, production-looking, mobile-first interface.\n- Prevent horizontal overflow and replace unfinished placeholders with functional components.`;
global.fetch = async function codem8sQualityFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url || '';
  if (!url.startsWith('https://api.openai.com/v1/responses')) return nativeFetch(input, init);
  try { const body = JSON.parse(init.body || '{}'); body.instructions = `${body.instructions || ''}\n\n${UI_QUALITY_RULES}`.trim(); return nativeFetch(input, { ...init, body: JSON.stringify(body) }); }
  catch { return nativeFetch(input, init); }
};
require('./server');