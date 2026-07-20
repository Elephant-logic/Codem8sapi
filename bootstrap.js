const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const originalSend = express.response.send;
const originalGet = express.application.get;
const installConfig = new Map();

const APK_GITHUB_TOKEN = process.env.GITHUB_APK_TOKEN || process.env.GITHUB_TOKEN || '';
const APK_REPO = process.env.GITHUB_APK_REPO || 'Elephant-logic/Codem8sapi';
const APK_BRANCH = process.env.GITHUB_APK_BRANCH || 'main';

function safeId(value) { return String(value || 'app').replace(/[^a-z0-9_-]/gi, '-'); }
function safeName(value) { return String(value || 'App').replace(/[<>"'&]/g, '').trim().slice(0, 80) || 'App'; }
function packagePart(value) {
  const clean = String(value || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 32);
  return clean && /^[a-z]/.test(clean) ? clean : `app${clean || '1'}`;
}
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
  const source = size === 192 ? config?.icon192 : config?.icon512;
  const match = /^data:image\/png;base64,(.+)$/i.exec(source || '');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.type('image/png').send(match ? Buffer.from(match[1], 'base64') : (size === 192 ? FALLBACK_192 : FALLBACK_512));
}
async function githubApi(endpoint, options = {}) {
  if (!APK_GITHUB_TOKEN) throw new Error('GITHUB_APK_TOKEN is not configured in Render.');
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${APK_GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Codem8s-APK-Builder',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(`GitHub APK service returned ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
    error.status = response.status;
    throw error;
  }
  return response;
}
function registerApkRoutes(app) {
  if (app.__codem8sApkRoutes) return;
  app.__codem8sApkRoutes = true;
  app.post('/api/apk-builds', async (req, res) => {
    try {
      if (!APK_GITHUB_TOKEN) return res.status(503).json({ error: { message: 'APK building needs GITHUB_APK_TOKEN in Render.' } });
      const name = safeName(req.body?.name);
      const html = String(req.body?.html || '');
      if (!html || Buffer.byteLength(html) > 3_000_000) return res.status(400).json({ error: { message: 'A finished app snapshot under 3 MB is required.' } });
      const iconMatch = /^data:image\/png;base64,(.+)$/i.exec(String(req.body?.icon512 || ''));
      const icon = iconMatch ? Buffer.from(iconMatch[1], 'base64') : FALLBACK_512;
      const id = `${safeId(req.body?.appId || 'app').slice(0, 32)}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
      const request = {
        id,
        name,
        packageId: `com.codem8s.${packagePart(req.body?.appId || name)}.${Date.now().toString(36)}`,
        htmlBase64: Buffer.from(html).toString('base64'),
        iconBase64: icon.toString('base64')
      };
      const encoded = Buffer.from(JSON.stringify(request)).toString('base64');
      const [owner, repo] = APK_REPO.split('/');
      const response = await githubApi(`/repos/${owner}/${repo}/contents/apk-build-requests/${encodeURIComponent(id)}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `apk-build:${id}`, content: encoded, branch: APK_BRANCH })
      });
      const data = await response.json();
      res.status(202).json({ id, commitSha: data?.commit?.sha || '', statusUrl: `/api/apk-builds/${encodeURIComponent(id)}` });
    } catch (error) {
      console.error('APK build request failed:', error?.message || error);
      res.status(error?.status || 502).json({ error: { message: error?.message || 'APK build request failed.' } });
    }
  });
  app.get('/api/apk-builds/:id', async (req, res) => {
    try {
      if (!APK_GITHUB_TOKEN) return res.status(503).json({ error: { message: 'APK building needs GITHUB_APK_TOKEN in Render.' } });
      const id = safeId(req.params.id);
      const [owner, repo] = APK_REPO.split('/');
      const response = await githubApi(`/repos/${owner}/${repo}/releases/tags/apk-${encodeURIComponent(id)}`);
      const release = await response.json();
      const asset = Array.isArray(release.assets) ? release.assets.find((item) => String(item.name || '').endsWith('.apk')) : null;
      if (!asset) return res.json({ id, state: 'building', ready: false });
      res.json({ id, state: 'ready', ready: true, downloadUrl: `/api/apk-builds/${encodeURIComponent(id)}/download`, fileName: asset.name });
    } catch (error) {
      if (error?.status === 404) return res.json({ id: safeId(req.params.id), state: 'building', ready: false });
      res.status(error?.status || 502).json({ error: { message: error?.message || 'Could not check APK status.' } });
    }
  });
  app.get('/api/apk-builds/:id/download', async (req, res) => {
    try {
      const id = safeId(req.params.id);
      const [owner, repo] = APK_REPO.split('/');
      const releaseResponse = await githubApi(`/repos/${owner}/${repo}/releases/tags/apk-${encodeURIComponent(id)}`);
      const release = await releaseResponse.json();
      const asset = Array.isArray(release.assets) ? release.assets.find((item) => String(item.name || '').endsWith('.apk')) : null;
      if (!asset) return res.status(404).json({ error: { message: 'APK is not ready yet.' } });
      const assetResponse = await githubApi(`/repos/${owner}/${repo}/releases/assets/${asset.id}`, { headers: { Accept: 'application/octet-stream' } });
      const buffer = Buffer.from(await assetResponse.arrayBuffer());
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', `attachment; filename="${safeId(asset.name || id)}.apk"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (error) {
      res.status(error?.status || 502).json({ error: { message: error?.message || 'Could not download APK.' } });
    }
  });
}

express.application.get = function codem8sInstallRoutes(route, ...handlers) {
  if (route === '*' && !this.__codem8sInstallRoutes) {
    this.__codem8sInstallRoutes = true;
    registerApkRoutes(this);
    this.post('/mobile-apps/:id/config', express.json({ limit: '5mb' }), (req, res) => {
      const id = safeId(req.params.id);
      installConfig.set(id, { name: safeName(req.body?.name), icon192: String(req.body?.icon192 || ''), icon512: String(req.body?.icon512 || '') });
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
    if (!body.includes('host-app-store-v1.js')) body = body.replace('</body>', '<script src="/host-app-store-v1.js?v=10.13.0"></script></body>');
    if (!body.includes('host-framework-project-safety-v1.js')) body = body.replace('</body>', '<script src="/host-framework-project-safety-v1.js?v=1.1.0"></script></body>');
    if (!body.includes('host-ai-builder-v1.js')) body = body.replace('</body>', '<script src="/host-ai-builder-v1.js?v=10.14.0"></script></body>');
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