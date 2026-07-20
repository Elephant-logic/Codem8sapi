const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PUBLIC_DIR = path.join(__dirname, "public");
const INDEX_PATH = path.join(PUBLIC_DIR, "index.html");

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));

const buckets = new Map();
function rateLimit(req, res, next) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const windowMs = 60_000;
  const limit = 30;
  const current = buckets.get(key) || { start: now, count: 0 };
  if (now - current.start > windowMs) {
    current.start = now;
    current.count = 0;
  }
  current.count += 1;
  buckets.set(key, current);
  if (current.count > limit) {
    return res.status(429).json({ error: { message: "Too many requests. Try again shortly." } });
  }
  next();
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    openaiConfigured: Boolean(OPENAI_API_KEY),
    service: "codem8s-render",
    repairPipeline: "10.2",
    buildRequirements: "10.2"
  });
});

app.post("/api/openai", rateLimit, async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(503).json({ error: { message: "OPENAI_API_KEY is not configured in Render." } });
  }
  const body = req.body;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: { message: "A JSON request body is required." } });
  }
  const allowed = {
    model: typeof body.model === "string" ? body.model : "gpt-5-mini",
    instructions: typeof body.instructions === "string" ? body.instructions : undefined,
    input: body.input
  };
  if (allowed.input == null) {
    return res.status(400).json({ error: { message: "input is required." } });
  }
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(allowed)
    });
    const data = await response.json().catch(() => ({ error: { message: "OpenAI returned an unreadable response." } }));
    res.status(response.status).json(data);
  } catch (error) {
    console.error("OpenAI proxy request failed:", error?.message || error);
    res.status(502).json({ error: { message: "The AI service could not be reached." } });
  }
});

app.use(express.static(PUBLIC_DIR, {
  extensions: ["html"],
  maxAge: "1h",
  setHeaders(res, filePath) {
    if (filePath.endsWith("index.html") || filePath.endsWith("build-requirements-v10_2.js")) {
      res.setHeader("Cache-Control", "no-store");
    }
  }
}));

function patchBuilderSource(source) {
  const helper = `
function projectNeedsToolchain(){
 const names=Object.keys(project.files||{});
 if(names.some(n=>/\\.(tsx?|jsx|vue|svelte)$/i.test(n)))return true;
 const pkg=project.files['package.json']||project.files['frontend/package.json']||'';
 return /\\"(?:react|vite|next|vue|svelte|typescript|webpack|parcel)\\"\\s*:/i.test(pkg);
}
function protectedRepairFile(name){return /(^|\\/)(?:\\.env(?:\\.example)?|\\.gitignore|render\\.yaml|package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml)$/i.test(name)}
function shortRuntimeError(message){const text=String(message||'');if(text.includes('data:text/javascript'))return text.replace(/data:text\\/javascript[^ @]*/i,'generated preview script');return text.length>500?text.slice(0,500)+'…':text}
`;

  source = source.replace("function bundleProject(){", helper + "\nfunction bundleProject(){");

  source = source.replace(
    "function renderPreview(clear=true){saveEditor();runtimeErrors=[];if(clear)logs=[];const bundled=bundleProject();els.preview.srcdoc=bundled;persist();renderHome();if(clear){const entry=chooseEntry();log('info',entry?`Running ${entry} with ${Object.keys(project.files).length} text files and ${Object.keys(importedBinaries).length} preserved binaries.`:`No browser entry found; showing source.`)}}",
    "function renderPreview(clear=true){saveEditor();runtimeErrors=[];if(clear)logs=[];if(projectNeedsToolchain()){const names=Object.keys(project.files);const entry=names.find(n=>/(^|\\/)index\\.html$/i.test(n))||names.find(n=>/\\.(tsx?|jsx)$/i.test(n))||names[0];els.preview.srcdoc='<!doctype html><html><meta name=viewport content=\"width=device-width,initial-scale=1\"><body style=\"margin:0;background:#07101c;color:#eaf3ff;font-family:system-ui;padding:24px\"><h2 style=\"color:#64dcff\">Build toolchain required</h2><p>This framework project cannot be executed by injecting raw TypeScript or JSX into the browser.</p><p>Codem8s will validate and export the real project without reporting a fake data-URL syntax error.</p><p><b>Entry:</b> '+escapeHtml(entry||'project')+'</p></body></html>';persist();renderHome();if(clear)log('info','Framework project detected. Source checks enabled; raw browser execution skipped.');return}const bundled=bundleProject();els.preview.srcdoc=bundled;persist();renderHome();if(clear){const entry=chooseEntry();log('info',entry?`Running ${entry} with ${Object.keys(project.files).length} text files and ${Object.keys(importedBinaries).length} preserved binaries.`:`No browser entry found; showing source.`)}}"
  );

  source = source.replace(
    "window.addEventListener('message',e=>{if(e.data?.source!=='codem8s-preview')return;const type=e.data.type==='ready'?'ok':'error';if(type==='error')runtimeErrors.push(String(e.data.message));log(type,e.data.message)});",
    "window.addEventListener('message',e=>{if(e.data?.source!=='codem8s-preview')return;const type=e.data.type==='ready'?'ok':'error';const message=shortRuntimeError(e.data.message);if(type==='error'&&!projectNeedsToolchain())runtimeErrors.push(message);log(type,message)});"
  );

  source = source.replace("state['file:'+name+':nonempty']=!!content.trim();", "if(!protectedRepairFile(name))state['file:'+name+':nonempty']=!!content.trim();");
  source = source.replace("state['runtime:no-errors']=runtimeErrors.length===0;return state", "state['runtime:no-errors']=projectNeedsToolchain()?true:runtimeErrors.length===0;return state");
  source = source.replace("if(!content.trim())issues.push(`${name} is empty.`)", "if(!content.trim()&&!protectedRepairFile(name))issues.push(`${name} is empty.`)");
  source = source.replace("for(const err of runtimeErrors)issues.push(`Runtime error: ${err}`);", "if(!projectNeedsToolchain())for(const err of runtimeErrors)issues.push(`Runtime error: ${shortRuntimeError(err)}`);");
  source = source.replace("if(!content.trim())log('warn',`${name} is empty.`)", "if(!content.trim()&&!protectedRepairFile(name))log('warn',`${name} is empty.`)");
  source = source.replace("for(const err of runtimeErrors)log('error',`Runtime: ${err}`);", "if(!projectNeedsToolchain())for(const err of runtimeErrors)log('error',`Runtime: ${shortRuntimeError(err)}`);else log('info','Framework runtime preview skipped; use the exported project build command.');");
  source = source.replace(
    "function findRegressions(beforePassing,afterState){return beforePassing.filter(id=>afterState[id]!==true)}",
    "function findRegressions(beforePassing,afterState){return beforePassing.filter(id=>!/^file:(?:.*\\/)?(?:\\.env(?:\\.example)?|\\.gitignore|render\\.yaml|package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml):nonempty$/i.test(id)&&!(projectNeedsToolchain()&&id==='runtime:no-errors')&&afterState[id]!==true)}"
  );
  return source;
}

function sendPatchedIndex(res) {
  fs.readFile(INDEX_PATH, "utf8", (error, source) => {
    if (error) {
      console.error("Unable to read public/index.html:", error.message);
      return res.status(500).send("Codem8s frontend is unavailable.");
    }
    const requirementsTag = '<script src="/build-requirements-v10_2.js"></script>';
    let html = patchBuilderSource(source);
    if (!html.includes(requirementsTag)) html = html.replace(/<\/body>/i, `${requirementsTag}</body>`);
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.type("html").send(html);
  });
}

app.get("/", (_req, res) => sendPatchedIndex(res));
app.get("*", (req, res) => {
  if (path.extname(req.path)) return res.status(404).send("Not found");
  return sendPatchedIndex(res);
});

app.listen(PORT, "0.0.0.0", () => console.log(`Codem8s listening on port ${PORT}`));
