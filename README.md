# Codem8s Render v10

## Deploy on Render

1. Upload this folder to a GitHub repository.
2. In Render, choose **New → Blueprint** and connect the repository.
   - Alternatively choose **New → Web Service**.
3. Add the environment variable:
   - Key: `OPENAI_API_KEY`
   - Value: your OpenAI API key
4. Deploy.

The browser never receives the API key. Requests go to `/api/openai`, and the Node server adds the secret.

## Manual Web Service settings

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
