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
    repairPipeline: "10.1"
  });
});

app.post("/api/openai", rateLimit, async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(503).json({
      error: { message: "OPENAI_API_KEY is not configured in Render." }
    });
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
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(allowed)
    });

    const data = await response.json().catch(() => ({
      error: { message: "OpenAI returned an unreadable response." }
    }));

    res.status(response.status).json(data);
  } catch (error) {
    console.error("OpenAI proxy request failed:", error?.message || error);
    res.status(502).json({
      error: { message: "The AI service could not be reached." }
    });
  }
});

app.use(express.static(PUBLIC_DIR, {
  extensions: ["html"],
  maxAge: "1h",
  setHeaders(res, filePath) {
    if (filePath.endsWith("index.html") || filePath.endsWith("repair-pipeline-v10_1.js")) {
      res.setHeader("Cache-Control", "no-store");
    }
  }
}));

function sendPatchedIndex(res) {
  fs.readFile(INDEX_PATH, "utf8", (error, source) => {
    if (error) {
      console.error("Unable to read public/index.html:", error.message);
      return res.status(500).send("Codem8s frontend is unavailable.");
    }

    const scriptTag = '<script src="/repair-pipeline-v10_1.js"></script>';
    const html = source.includes(scriptTag)
      ? source
      : source.replace(/<\/body>/i, `${scriptTag}</body>`);

    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(html);
  });
}

app.get("/", (_req, res) => sendPatchedIndex(res));
app.get("*", (req, res) => {
  if (path.extname(req.path)) return res.status(404).send("Not found");
  return sendPatchedIndex(res);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Codem8s listening on port ${PORT}`);
});
