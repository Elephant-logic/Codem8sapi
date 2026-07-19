# Codem8s Render v10.1

Render-ready Codem8s with a server-side OpenAI proxy.

## What changed in v10.1

- AI repairs are scoped to the files linked to the detected failure.
- Repair responses are merged instead of replacing the whole project.
- `.env.example`, `.gitignore`, `render.yaml`, and lockfiles are protected.
- Opaque `data:` JavaScript errors are converted into clearer project-file diagnostics where possible.
- Config files are not treated as regressions merely because a partial repair omitted them.
- The health endpoint reports the active repair-pipeline version.

## Deploy on Render

1. Connect this repository to a Render **Web Service** or Blueprint.
2. Add the environment variable:
   - Key: `OPENAI_API_KEY`
   - Value: your OpenAI API key
3. Deploy.

The browser never receives the API key. Requests go to `/api/openai`, and the Node server adds the secret.

## Render settings

- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`

## Local run

```bash
npm install
OPENAI_API_KEY=your_key_here npm start
```

Open `http://localhost:10000`.
