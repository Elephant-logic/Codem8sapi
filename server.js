const express = require('express');
const path = require('path');
const esbuild = require('esbuild');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PUBLIC_DIR = path.join(__dirname, 'public');
const VERSION = '10.5.4';

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '4mb' }));

const buckets = new Map();
function rateLimit(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const current = buckets.get(key) || { start: now, count: 0 };
  if (now - current.start > 60_000) {
    current.start = now;
    current.count = 0;
  }
  current.count += 1;
  buckets.set(key, current);
  if (current.count > 30) {
    return res.status(429).json({ error: { message: 'Too many requests. Try again shortly.' } });
  }
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    openaiConfigured: Boolean(OPENAI_API_KEY),
    service: 'codem8s-render',
    version: VERSION,
    frameworkPreview: 'esbuild-verified-output'
  });
});

app.post('/api/openai', rateLimit, async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(503).json({ error: { message: 'OPENAI_API_KEY is not configured in Render.' } });
  }
  const body = req.body;
  if (!body || typeof body !== 'object' || body.input == null) {
    return res.status(400).json({ error: { message: 'input is required.' } });
  }
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: typeof body.model === 'string' ? body.model : 'gpt-5-mini',
        instructions: typeof body.instructions === 'string' ? body.instructions : undefined,
        input: body.input
      })
    });
    const data = await response.json().catch(() => ({ error: { message: 'OpenAI returned an unreadable response.' } }));
    res.status(response.status).json(data);
  } catch (error) {
    console.error('OpenAI proxy request failed:', error?.message || error);
    res.status(502).json({ error: { message: 'The AI service could not be reached.' } });
  }
});

function sanitizeFiles(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Project files are required.');
  const files = {};
  let total = 0;
  for (const [rawName, rawContent] of Object.entries(value)) {
    if (typeof rawContent !== 'string') continue;
    const name = path.posix.normalize(String(rawName).replace(/^\/+/, ''));
    if (!name || name.startsWith('../') || name.includes('/../')) continue;
    total += Buffer.byteLength(rawContent);
    if (total > 3_000_000) throw new Error('Project is too large for preview.');
    files[name] = rawContent;
  }
  if (!Object.keys(files).length) throw new Error('No text files were supplied.');
  if (Object.keys(files).length > 250) throw new Error('Too many files for preview.');
  return files;
}

function findLocalFile(files, requested, importer = '') {
  const base = requested.startsWith('.')
    ? path.posix.normalize(path.posix.join(path.posix.dirname(importer), requested))
    : requested.replace(/^\/+/, '');
  const candidates = [
    base,
    `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, `${base}.css`, `${base}.json`,
    path.posix.join(base, 'index.tsx'), path.posix.join(base, 'index.ts'),
    path.posix.join(base, 'index.jsx'), path.posix.join(base, 'index.js')
  ];
  return candidates.find((name) => Object.prototype.hasOwnProperty.call(files, name)) || null;
}

function loaderFor(name) {
  const ext = path.posix.extname(name).slice(1).toLowerCase();
  return ({ tsx: 'tsx', ts: 'ts', jsx: 'jsx', js: 'js', mjs: 'js', cjs: 'js', css: 'css', json: 'json' })[ext] || 'text';
}

function findFrontend(files) {
  const names = Object.keys(files);
  const htmlName = names.find((name) => /(^|\/)public\/index\.html$/i.test(name))
    || names.find((name) => /(^|\/)index\.html$/i.test(name));
  if (!htmlName) throw new Error('No frontend index.html was found.');

  const root = htmlName.replace(/(?:public\/)?index\.html$/i, '');
  const htmlText = files[htmlName];
  const moduleMatch = htmlText.match(/<script\b[^>]*src=["']([^"']+)["'][^>]*><\/script>/i);
  let entry = moduleMatch ? findLocalFile(files, moduleMatch[1], htmlName) : null;
  if (!entry) {
    const preferred = [
      `${root}src/index.tsx`, `${root}src/main.tsx`, `${root}src/index.ts`, `${root}src/main.ts`,
      `${root}src/index.jsx`, `${root}src/main.jsx`, `${root}src/index.js`, `${root}src/main.js`
    ];
    entry = preferred.find((name) => Object.prototype.hasOwnProperty.call(files, name));
  }
  if (!entry) throw new Error('No React, TypeScript, or JavaScript frontend entry was found.');
  return { htmlText, entry, moduleMatch, root };
}

function packageVersions(files, root) {
  const packageName = Object.keys(files).find((name) => name === `${root}package.json`)
    || Object.keys(files).find((name) => /(^|\/)package\.json$/i.test(name));
  if (!packageName) return {};
  try {
    const pkg = JSON.parse(files[packageName]);
    return { ...(pkg.dependencies || {}), ...(pkg.peerDependencies || {}) };
  } catch {
    return {};
  }
}

function packageRoot(specifier) {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
}

function cdnUrl(specifier, versions) {
  const root = packageRoot(specifier);
  const subpath = specifier.slice(root.length);
  const rawVersion = String(versions[root] || '').replace(/^[~^]/, '');
  const safeVersion = /^\d+(?:\.\d+){0,2}(?:[-+][\w.-]+)?$/.test(rawVersion) ? `@${rawVersion}` : '';
  const reactVersion = String(versions.react || '').replace(/^[~^]/, '');
  const deps = root !== 'react' && /^\d+(?:\.\d+){0,2}/.test(reactVersion)
    ? `?deps=react@${encodeURIComponent(reactVersion)}`
    : '';
  return `https://esm.sh/${root}${safeVersion}${subpath}${deps}`;
}

function rewriteBareImports(js, versions) {
  const replace = (_match, before, specifier, after) => {
    if (specifier.startsWith('.') || specifier.startsWith('/') || /^https?:/.test(specifier)) return `${before}${specifier}${after}`;
    return `${before}${cdnUrl(specifier, versions)}${after}`;
  };
  return js
    .replace(/(\bfrom\s*["'])([^"']+)(["'])/g, replace)
    .replace(/(\bimport\s*["'])([^"']+)(["'])/g, replace)
    .replace(/(\bimport\s*\(\s*["'])([^"']+)(["']\s*\))/g, replace);
}

function runtimeGuard() {
  return `<script>(function(){function show(message){var box=document.getElementById('codem8s-runtime-error');if(!box){box=document.createElement('div');box.id='codem8s-runtime-error';box.style.cssText='position:fixed;inset:0;z-index:2147483647;overflow:auto;background:#07101c;color:#eaf3ff;padding:24px;font:14px/1.5 system-ui';document.body.innerHTML='';document.body.appendChild(box)}box.innerHTML='<h2 style="color:#ff7892">Preview runtime error</h2><pre style="white-space:pre-wrap"></pre>';box.querySelector('pre').textContent=String(message||'Unknown runtime error')}window.addEventListener('error',function(e){show(e.message||e.error||'Script failed to load')});window.addEventListener('unhandledrejection',function(e){show(e.reason&&e.reason.message||e.reason||'Unhandled promise rejection')});setTimeout(function(){var root=document.getElementById('root');if(root&&!root.firstElementChild&&!root.textContent.trim())show('The app compiled but rendered nothing. A dependency or startup request may have failed.')},5000)})();<\/script>`;
}

app.post('/api/build-preview', rateLimit, async (req, res) => {
  try {
    const files = sanitizeFiles(req.body?.files);
    const frontend = findFrontend(files);
    const plugin = {
      name: 'codem8s-virtual-project',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === 'entry-point') return { path: frontend.entry, namespace: 'codem8s' };
          if (!args.path.startsWith('.') && !args.path.startsWith('/')) return { path: args.path, external: true };
          const found = findLocalFile(files, args.path, args.importer || frontend.entry);
          return found
            ? { path: found, namespace: 'codem8s' }
            : { errors: [{ text: `Missing local import ${args.path} from ${args.importer || frontend.entry}` }] };
        });
        build.onLoad({ filter: /.*/, namespace: 'codem8s' }, (args) => ({
          contents: files[args.path],
          loader: loaderFor(args.path),
          resolveDir: path.posix.dirname(args.path)
        }));
      }
    };

    const result = await esbuild.build({
      entryPoints: [frontend.entry],
      outfile: 'codem8s-preview.js',
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      jsx: 'automatic',
      sourcemap: 'inline',
      plugins: [plugin],
      logLevel: 'silent'
    });

    const jsFile = result.outputFiles.find((file) => file.path.endsWith('.js')) || result.outputFiles[0];
    const cssFile = result.outputFiles.find((file) => file.path.endsWith('.css'));
    const rawJs = jsFile?.text || '';
    if (!rawJs.trim()) throw new Error('The framework compiler returned an empty JavaScript bundle.');

    const versions = packageVersions(files, frontend.root);
    const js = rewriteBareImports(rawJs, versions);
    const css = cssFile?.text || '';
    const style = css ? `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>` : '';
    const compiled = `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`;
    const injected = `${runtimeGuard()}${style}${compiled}`;
    let html = frontend.htmlText.replace(/%PUBLIC_URL%\/?/g, '');

    if (frontend.moduleMatch) html = html.replace(frontend.moduleMatch[0], injected);
    else {
      const marker = html.toLowerCase().lastIndexOf('</body>');
      html = marker >= 0 ? html.slice(0, marker) + injected + html.slice(marker) : html + injected;
    }

    html = html.replace(/<link\b[^>]*href=["'][^"']*\.(?:css|scss|sass)["'][^>]*>/gi, '');
    res.json({
      ok: true,
      html,
      entry: frontend.entry,
      bundleBytes: Buffer.byteLength(js),
      warnings: result.warnings.map((warning) => warning.text)
    });
  } catch (error) {
    const details = Array.isArray(error?.errors) ? error.errors.map((item) => item.text).filter(Boolean) : [];
    res.status(400).json({ error: { message: error?.message || 'Framework preview failed.', details } });
  }
});

const hostHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#07101c">
<title>Codem8s</title>
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#07101c}
#codem8s-app{display:block;width:100%;height:100%;border:0;background:#07101c}
#codem8s-version{position:fixed;right:8px;bottom:8px;z-index:99999;background:#10243c;color:#64dcff;border:1px solid #315476;border-radius:999px;padding:5px 9px;font:11px system-ui}
</style>
</head>
<body>
<iframe id="codem8s-app" src="/studio.html" title="Codem8s Studio"></iframe>
<div id="codem8s-version">Codem8s ${VERSION}</div>
<script src="/host-framework-preview-v10_5.js?v=${VERSION}"></script>
</body>
</html>`;

app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.type('html').send(hostHtml);
});

app.get('/studio.html', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use(express.static(PUBLIC_DIR, {
  index: false,
  extensions: ['html'],
  maxAge: 0,
  setHeaders(res) { res.setHeader('Cache-Control', 'no-store, max-age=0'); }
}));

app.get('*', (req, res) => {
  if (path.extname(req.path)) return res.status(404).send('Not found');
  res.redirect('/');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Codem8s ${VERSION} listening on port ${PORT}`);
});
