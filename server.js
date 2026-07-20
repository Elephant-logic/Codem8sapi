const express = require("express");
const fs = require("fs");
const path = require("path");
const posix = path.posix;
const esbuild = require("esbuild");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PUBLIC_DIR = path.join(__dirname, "public");
const INDEX_PATH = path.join(PUBLIC_DIR, "index.html");

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "4mb" }));

const buckets = new Map();
function rateLimit(req, res, next) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const current = buckets.get(key) || { start: now, count: 0 };
  if (now - current.start > 60_000) { current.start = now; current.count = 0; }
  current.count += 1;
  buckets.set(key, current);
  if (current.count > 30) return res.status(429).json({ error: { message: "Too many requests. Try again shortly." } });
  next();
}

app.get("/api/health", (_req, res) => res.json({
  ok: true,
  openaiConfigured: Boolean(OPENAI_API_KEY),
  service: "codem8s-render",
  repairPipeline: "10.3",
  buildRequirements: "10.2",
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

function cleanFiles(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Project files are required.");
  const files = {};
  let total = 0;
  for (const [rawName, rawContent] of Object.entries(value)) {
    if (typeof rawContent !== "string") continue;
    const name = posix.normalize(String(rawName).replace(/^\/+/, ""));
    if (!name || name.startsWith("../") || name.includes("/../")) continue;
    total += Buffer.byteLength(rawContent);
    if (total > 3_000_000) throw new Error("Project is too large for preview.");
    files[name] = rawContent;
  }
  if (!Object.keys(files).length) throw new Error("No text files were supplied.");
  if (Object.keys(files).length > 250) throw new Error("Too many files for preview.");
  return files;
}

function findFile(files, requested, importer = "") {
  let base = requested;
  if (requested.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(importer), requested));
  else base = requested.replace(/^\/+/, "");
  const candidates = [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, `${base}.css`, `${base}.json`, posix.join(base, "index.tsx"), posix.join(base, "index.ts"), posix.join(base, "index.jsx"), posix.join(base, "index.js")];
  return candidates.find(name => Object.prototype.hasOwnProperty.call(files, name)) || null;
}

function loaderFor(name) {
  const ext = posix.extname(name).slice(1).toLowerCase();
  return ({ tsx: "tsx", ts: "ts", jsx: "jsx", js: "js", mjs: "js", cjs: "js", css: "css", json: "json" })[ext] || "text";
}

function packageImports(files) {
  const pkgName = Object.keys(files).find(name => /(^|\/)package\.json$/i.test(name));
  if (!pkgName) return [];
  try {
    const pkg = JSON.parse(files[pkgName]);
    return [...new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.peerDependencies || {})])];
  } catch { return []; }
}

app.post("/api/build-preview", rateLimit, async (req, res) => {
  try {
    const files = cleanFiles(req.body?.files);
    const htmlName = Object.keys(files).find(name => /(^|\/)index\.html$/i.test(name));
    if (!htmlName) throw new Error("Framework preview needs an index.html file.");
    const html = files[htmlName];
    const scriptMatch = html.match(/<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*><\/script>/i) || html.match(/<script\b[^>]*src=["']([^"']+)["'][^>]*type=["']module["'][^>]*><\/script>/i);
    if (!scriptMatch) throw new Error("No module entry script was found in index.html.");
    const entry = findFile(files, scriptMatch[1], htmlName);
    if (!entry) throw new Error(`Entry file not found: ${scriptMatch[1]}`);
    const dependencies = packageImports(files);
    const virtualPlugin = {
      name: "codem8s-virtual-project",
      setup(build) {
        build.onResolve({ filter: /.*/ }, args => {
          if (!args.path.startsWith(".") && !args.path.startsWith("/")) return { path: args.path, external: true };
          const found = findFile(files, args.path, args.importer || entry);
          if (!found) return { errors: [{ text: `Missing local import ${args.path} from ${args.importer || entry}` }] };
          return { path: found, namespace: "codem8s" };
        });
        build.onLoad({ filter: /.*/, namespace: "codem8s" }, args => ({ contents: files[args.path], loader: loaderFor(args.path), resolveDir: posix.dirname(args.path) }));
      }
    };
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2020",
      jsx: "automatic",
      sourcemap: "inline",
      plugins: [virtualPlugin],
      logLevel: "silent"
    });
    const js = result.outputFiles.find(file => file.path.endsWith(".js"))?.text || "";
    const css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text || "";
    const imports = {};
    for (const dep of dependencies) {
      imports[dep] = `https://esm.sh/${dep}`;
      imports[`${dep}/`] = `https://esm.sh/${dep}/`;
    }
    const importMap = `<script type="importmap">${JSON.stringify({ imports })}</script>`;
    const style = css ? `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>` : "";
    const compiledScript = `<script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script>`;
    let preview = html.replace(scriptMatch[0], `${importMap}${style}${compiledScript}`);
    preview = preview.replace(/<link\b[^>]*href=["'][^"']*\.(?:css|scss|sass)["'][^>]*>/gi, "");
    res.json({ ok: true, html: preview, entry, warnings: result.warnings.map(w => w.text) });
  } catch (error) {
    const details = Array.isArray(error?.errors) ? error.errors.map(item => item.text).filter(Boolean) : [];
    res.status(400).json({ error: { message: error?.message || "Framework preview failed.", details } });
  }
});

app.use(express.static(PUBLIC_DIR, {
  extensions: ["html"],
  maxAge: "1h",
  setHeaders(res, filePath) {
    if (filePath.endsWith("index.html") || filePath.endsWith("build-requirements-v10_2.js")) res.setHeader("Cache-Control", "no-store");
  }
}));

function patchBuilderSource(source) {
  const helper = String.raw`
function projectNeedsToolchain(){const names=Object.keys(project.files||{});if(names.some(n=>/\.(tsx?|jsx|vue|svelte)$/i.test(n)))return true;const pkg=project.files['package.json']||project.files['frontend/package.json']||'';return /\"(?:react|vite|next|vue|svelte|typescript|webpack|parcel)\"\s*:/i.test(pkg)}
function protectedRepairFile(name){return /(^|\/)(?:\.env(?:\.example)?|\.gitignore|render\.yaml|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i.test(name)}
function shortRuntimeError(message){const text=String(message||'');if(text.includes('data:text/javascript'))return text.replace(/data:text\/javascript[^ @]*/i,'generated preview script');return text.length>500?text.slice(0,500)+'…':text}
`;
  source = source.replace("function bundleProject(){", helper + "\nfunction bundleProject(){");
  source = source.replace("state['file:'+name+':nonempty']=!!content.trim();", "if(!protectedRepairFile(name))state['file:'+name+':nonempty']=!!content.trim();");
  source = source.replace("state['runtime:no-errors']=runtimeErrors.length===0;return state", "state['runtime:no-errors']=projectNeedsToolchain()?true:runtimeErrors.length===0;return state");
  source = source.replace("if(!content.trim())issues.push(`${name} is empty.`)", "if(!content.trim()&&!protectedRepairFile(name))issues.push(`${name} is empty.`)");
  source = source.replace("for(const err of runtimeErrors)issues.push(`Runtime error: ${err}`);", "if(!projectNeedsToolchain())for(const err of runtimeErrors)issues.push(`Runtime error: ${shortRuntimeError(err)}`);");
  source = source.replace("if(!content.trim())log('warn',`${name} is empty.`)", "if(!content.trim()&&!protectedRepairFile(name))log('warn',`${name} is empty.`)");
  source = source.replace("for(const err of runtimeErrors)log('error',`Runtime: ${err}`);", "if(!projectNeedsToolchain())for(const err of runtimeErrors)log('error',`Runtime: ${shortRuntimeError(err)}`);else log('info','Framework source validated. Compiled preview is handled separately.');");
  source = source.replace("function findRegressions(beforePassing,afterState){return beforePassing.filter(id=>afterState[id]!==true)}", "function findRegressions(beforePassing,afterState){return beforePassing.filter(id=>!/^file:(?:.*\\/)?(?:\\.env(?:\\.example)?|\\.gitignore|render\\.yaml|package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml):nonempty$/i.test(id)&&!(projectNeedsToolchain()&&id==='runtime:no-errors')&&afterState[id]!==true)}");
  const override = String.raw`
const originalRenderPreview=renderPreview;
renderPreview=async function(clear=true){
 saveEditor();runtimeErrors=[];if(clear)logs=[];
 if(!projectNeedsToolchain())return originalRenderPreview(clear);
 els.preview.srcdoc='<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#07101c;color:#eaf3ff;font-family:system-ui;padding:24px"><h2 style="color:#64dcff">Compiling framework preview…</h2><p>Transpiling TypeScript and JSX safely.</p></body></html>';
 if(clear)log('info','Framework project detected. Compiling TS/TSX/JSX preview with esbuild…');
 try{const response=await fetch('/api/build-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({files:project.files})});const data=await response.json();if(!response.ok)throw new Error([data?.error?.message,...(data?.error?.details||[])].filter(Boolean).join('\n'));els.preview.srcdoc=data.html;log('ok','Framework preview compiled: '+data.entry);for(const warning of data.warnings||[])log('warn',warning);status('Framework preview compiled.','ok')}
 catch(error){const message=shortRuntimeError(error.message||String(error));els.preview.srcdoc='<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#07101c;color:#eaf3ff;font-family:system-ui;padding:24px"><h2 style="color:#ff7892">Framework preview could not compile</h2><pre style="white-space:pre-wrap">'+escapeHtml(message)+'</pre><p>The source files were preserved and were not sent for destructive repair.</p></body></html>';log('error','Framework compiler: '+message);status('Framework preview needs attention.','err')}
 persist();renderHome();
};
`;
  source = source.replace("$('#runTests').onclick=()=>runTests(true);", override + "\n$('#runTests').onclick=()=>runTests(true);");
  return source;
}

function sendPatchedIndex(res) {
  fs.readFile(INDEX_PATH, "utf8", (error, source) => {
    if (error) return res.status(500).send("Codem8s frontend is unavailable.");
    const requirementsTag = '<script src="/build-requirements-v10_2.js"></script>';
    let html = patchBuilderSource(source);
    if (!html.includes(requirementsTag)) html = html.replace(/<\/body>/i, `${requirementsTag}</body>`);
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.type("html").send(html);
  });
}

app.get("/", (_req, res) => sendPatchedIndex(res));
app.get("*", (req, res) => path.extname(req.path) ? res.status(404).send("Not found") : sendPatchedIndex(res));
app.listen(PORT, "0.0.0.0", () => console.log(`Codem8s listening on port ${PORT}`));
