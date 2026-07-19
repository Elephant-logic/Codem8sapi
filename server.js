const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.disable("x-powered-by");
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
    service: "codem8s-render"
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

app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  maxAge: "1h"
}));

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Codem8s listening on port ${PORT}`);
});
