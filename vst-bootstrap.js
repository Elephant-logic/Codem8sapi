const express = require('express');
const crypto = require('crypto');

const originalGet = express.application.get;
const originalSend = express.response.send;
const TOKEN = process.env.GITHUB_APK_TOKEN || process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_APK_REPO || 'Elephant-logic/Codem8sapi';
const BRANCH = process.env.GITHUB_APK_BRANCH || 'main';

const safeId = value => String(value || 'instrument').replace(/[^a-z0-9_-]/gi, '-').slice(0, 48);
const safeText = (value, fallback, max = 80) => String(value || fallback).replace(/[<>"'&]/g, '').trim().slice(0, max) || fallback;

async function githubApi(endpoint, options = {}) {
  if (!TOKEN) throw new Error('GITHUB_APK_TOKEN is not configured in Render. The same token is used for VST3 builds.');
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Codem8s-VST3-Builder',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(`GitHub VST3 service returned ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
    error.status = response.status;
    throw error;
  }
  return response;
}

function registerRoutes(app) {
  if (app.__codem8sVstRoutes) return;
  app.__codem8sVstRoutes = true;

  app.post('/api/vst-builds', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      if (!TOKEN) return res.status(503).json({ error: { message: 'VST3 building needs GITHUB_APK_TOKEN in Render.' } });
      const name = safeText(req.body?.name, 'Codem8s Instrument');
      const manufacturer = safeText(req.body?.manufacturer, 'Codem8s', 40);
      const description = safeText(req.body?.description, 'Generated virtual instrument', 300);
      const waveform = ['sine', 'saw', 'square', 'triangle'].includes(req.body?.waveform) ? req.body.waveform : 'saw';
      const id = `${safeId(req.body?.appId || name)}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
      const request = { id, name, manufacturer, description, waveform };
      const [owner, repo] = REPO.split('/');
      const response = await githubApi(`/repos/${owner}/${repo}/contents/vst-build-requests/${encodeURIComponent(id)}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `vst-build:${id}`, content: Buffer.from(JSON.stringify(request)).toString('base64'), branch: BRANCH })
      });
      const data = await response.json();
      res.status(202).json({ id, commitSha: data?.commit?.sha || '', statusUrl: `/api/vst-builds/${encodeURIComponent(id)}` });
    } catch (error) {
      console.error('VST3 build request failed:', error?.message || error);
      res.status(error?.status || 502).json({ error: { message: error?.message || 'VST3 build request failed.' } });
    }
  });

  app.get('/api/vst-builds/:id', async (req, res) => {
    try {
      const id = safeId(req.params.id);
      const [owner, repo] = REPO.split('/');
      const response = await githubApi(`/repos/${owner}/${repo}/releases/tags/vst-${encodeURIComponent(id)}`);
      const release = await response.json();
      const assets = Array.isArray(release.assets) ? release.assets.filter(item => /\.zip$/i.test(String(item.name || ''))) : [];
      if (!assets.length) return res.json({ id, state: 'building', ready: false });
      res.json({ id, state: 'ready', ready: true, downloads: assets.map(asset => ({ name: asset.name, url: `/api/vst-builds/${encodeURIComponent(id)}/download/${asset.id}` })) });
    } catch (error) {
      if (error?.status === 404) return res.json({ id: safeId(req.params.id), state: 'building', ready: false });
      res.status(error?.status || 502).json({ error: { message: error?.message || 'Could not check VST3 status.' } });
    }
  });

  app.get('/api/vst-builds/:id/download/:assetId', async (req, res) => {
    try {
      const [owner, repo] = REPO.split('/');
      const assetId = String(req.params.assetId || '').replace(/\D/g, '');
      if (!assetId) return res.status(400).json({ error: { message: 'Invalid VST3 artifact.' } });
      const response = await githubApi(`/repos/${owner}/${repo}/releases/assets/${assetId}`, { headers: { Accept: 'application/octet-stream' } });
      const buffer = Buffer.from(await response.arrayBuffer());
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${safeId(req.params.id)}-vst3.zip"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (error) {
      res.status(error?.status || 502).json({ error: { message: error?.message || 'Could not download VST3 artifact.' } });
    }
  });
}

express.application.get = function codem8sVstRoutes(route, ...handlers) {
  if (route === '*') registerRoutes(this);
  return originalGet.call(this, route, ...handlers);
};

express.response.send = function codem8sVstHostSend(body) {
  if (typeof body === 'string' && body.includes('id="codem8s-app"') && !body.includes('host-vst-builder-v1.js')) {
    body = body.replace('</body>', '<script src="/host-vst-builder-v1.js?v=1.0.0"></script></body>');
  }
  return originalSend.call(this, body);
};
