const express = require("express");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PUBLIC_DIR = path.join(__dirname, "public");
const INDEX_PATH = path.join(PUBLIC_DIR, "index.html");
const VERSION = "10.4.0";

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "4mb" }));

const buckets = new Map();
function rateLimit(req, res, next) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const current = buckets.get(key) || { start: now, count: 0 };
  if (now - current.start > 60_000) {
    current.start = now;
    current.count = 0;
  }
  current.count += 1;
  buckets.set(key, current);
  if (current.count > 30) return res.status(429).json({ error: { message: "Too many requests. Try again shortly." } });
  next();
}

app.get("/api/health", (_req, res) => res.json({
  ok: true,
  openaiConfigured: Boolean(OPENAI_API_KEY),
  service: "codem8s-render",
  version: VERSION,
  frameworkPreview: "esbuild"
}));

app.post("/api/openai", rateLimit, async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(503).json({ error: { message: "OPENAI_API_KEY is not configured in Render." } });
  const body = req.body;
  if (!body || typeof body !== "object" || body.input == null) return res.status(400).json({ error: { message: "input is required." } });
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: typeof body.model === "string" ? body.model : "gpt-5-mini",
        instructions: typeof body.instructions === "string" ? body.instructions : undefined,
        input: body.input
      })
    });
    const data = await response.json().catch(() => ({ error: { message: "OpenAI returned an unreadable response." } }));
    res.status(response.status).json(data);
  } catch (error) {
    console.error("OpenAI proxy request failed:", error?.message || error);
    res.status(502).json({ error: { message: "The AI service could not be reached." } });
  }
});

function sanitizeFiles(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Project files are required.");
  const files = {};
  let total = 0;
  for (const [rawName, rawContent] of Object.entries(value)) {
    if (typeof rawContent !== "string") continue;
    const name = path.posix.normalize(String(rawName).replace(/^\/+/, ""));
    if (!name || name.startsWith("../") || name.includes("/../")) continue;
    total += Buffer.byteLength(rawContent);
    if (total > 3_000_000) throw new Error("Project is too large for preview.");
    files[name] = rawContent;
  }
  if (!Object.keys(files).length) throw new Error("No text files were supplied.");
  if (Object.keys(files).length > 250) throw new Error("Too many files for preview.");
  return files;
}

function findLocalFile(files, requested, importer = "") {
  const base = requested.startsWith(".")
    ? path.posix.normalize(path.posix.join(path.posix.dirname(importer), requested))
    : requested.replace(/^\/+/, "");
  const candidates = [
    base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, `${base}.css`, `${base}.json`,
    path.posix.join(base, "index.tsx"), path.posix.join(base, "index.ts"),
    path.posix.join(base, "index.jsx"), path.posix.join(base, "index.js")
  ];
  return candidates.find((name) => Object.prototype.hasOwnProperty.call(files, name)) || null;
}

function loaderFor(name) {
  const ext = path.posix.extname(name).slice(1).toLowerCase();
  return ({ tsx: "tsx", ts: "ts", jsx: "jsx", js: "js", mjs: "js", cjs: "js", css: "css", json: "json" })[ext] || "text";
}

function findFrontend(files) {
  const names = Object.keys(files);
  const html = names.find((name) => /(^|\/)public\/index\.html$/i.test(name)) || names.find((name) => /(^|\/)index\.html$/i.test(name));
  if (!html) throw new Error("No frontend index.html was found.");
  const root = html.replace(/(?:public\/)?index\.html$/i, "");
  const htmlText = files[html];
  const moduleMatch = htmlText.match(/<script\b[^>]*src=["']([^"']+)["'][^>]*><\/script>/i);
  let entry = moduleMatch ? findLocalFile(files, moduleMatch[1], html) : null;
  if (!entry) {
    const preferred = [
      `${root}src/index.tsx`, `${root}src/main.tsx`, `${root}src/index.ts`, `${root}src/main.ts`,
      `${root}src/index.jsx`, `${root}src/main.jsx`, `${root}src/index.js`, `${root}src/main.js`
    ];
    entry = preferred.find((name) => Object.prototype.hasOwnProperty.call(files, name));
  }
  if (!entry) throw new Error("No React, TypeScript, or JavaScript frontend entry was found.");
  return { html, htmlText, entry, root, moduleMatch };
}

function dependencyImports(files, root) {
  const packageName = Object.keys(files).find((name) => name === `${root}package.json`) || Object.keys(files).find((name) => /(^|\/)package\.json$/i.test(name));
  if (!packageName) return {};
  try {
    const pkg = JSON.parse(files[packageName]);
    const names = [...new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.peerDependencies || {})])];
    const imports = {};
    for (const name of names) {
      imports[name] = `https://esm.sh/${name}`;
      imports[`${name}/`] = `https://esm.sh/${name}/`;
    }
    return imports;
  } catch {
    return {};
  }
}

app.post("/api/build-preview", rateLimit, async (req, res) => {
  try {
    const files = sanitizeFiles(req.body?.files);
    const frontend = findFrontend(files);
    const plugin = {
      name: "codem8s-virtual-project",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (!args.path.startsWith(".") && !args.path.startsWith("/")) return { path: args.path, external: true };
          const found = findLocalFile(files, args.path, args.importer || frontend.entry);
          return found
            ? { path: found, namespace: "codem8s" }
            : { errors: [{ text: `Missing local import ${args.path} from ${args.importer || frontend.entry}` }] };
        });
        build.onLoad({ filter: /.*/, namespace: "codem8s" }, (args) => ({
          contents: files[args.path],
          loader: loaderFor(args.path),
          resolveDir: path.posix.dirname(args.path)
        }));
      }
    };

    const result = await esbuild.build({
      entryPoints: [frontend.entry],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2020",
      jsx: "automatic",
      sourcemap: "inline",
      plugins: [plugin],
      logLevel: "silent"
    });

    const js = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text || "";
    const css = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "";
    const imports = dependencyImports(files, frontend.root);
    const importMap = `<script type="importmap">${JSON.stringify({ imports })}</script>`;
    const style = css ? `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>` : "";
    const compiled = `<script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script>`;
    let html = frontend.htmlText;
    if (frontend.moduleMatch) html = html.replace(frontend.moduleMatch[0], `${importMap}${style}${compiled}`);
    else html = html.replace(/<\/body>/i, `${importMap}${style}${compiled}</body>`);
    html = html.replace(/%PUBLIC_URL%\/?/g, "");
    html = html.replace(/<link\b[^>]*href=["'][^"']*\.(?:css|scss|sass)["'][^>]*>/gi, "");

    res.json({ ok: true, html, entry: frontend.entry, warnings: result.warnings.map((warning) => warning.text) });
  } catch (error) {
    const details = Array.isArray(error?.errors) ? error.errors.map((item) => item.text).filter(Boolean) : [];
    res.status(400).json({ error: { message: error?.message || "Framework preview failed.", details } });
  }
});

app.get("/", (_req, res) => {
  fs.readFile(INDEX_PATH, "utf8", (error, source) => {
    if (error) return res.status(500).send("Codem8s frontend is unavailable.");
    const tag = '<script src="/framework-preview-v10_4.js"></script>';
    const html = source.includes(tag) ? source : source.replace(/<\/body>/i, `${tag}</body>`);
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.type("html").send(html);
  });
});

app.use(express.static(PUBLIC_DIR, {
  index: false,
  extensions: ["html"],
  maxAge: 0,
  setHeaders(res) { res.setHeader("Cache-Control", "no-store, max-age=0"); }
}));

app.get("*", (req, res) => {
  if (path.extname(req.path)) return res.status(404).send("Not found");
  res.redirect("/");
});

app.listen(PORT, "0.0.0.0", () => console.log(`Codem8s ${VERSION} listening on port ${PORT}`));
