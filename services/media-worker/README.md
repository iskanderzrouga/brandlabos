# BrandLab Media Worker

Background worker for heavy swipe ingestion (v1: Meta Ad Library URL -> download video -> Whisper transcript -> upload to R2).

## Environment Variables

- `DATABASE_URL` Neon connection string (unpooled)
- `WORKER_ID` Any string (for logs/locks), e.g. `worker-1`

### Cloudflare R2

- `R2_ENDPOINT` (e.g. `https://<accountid>.r2.cloudflarestorage.com`)
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_REGION` (default `auto`)

### AI

- `OPENAI_API_KEY` (Whisper transcription)
- `ANTHROPIC_API_KEY` (title + summary)
- `ANTHROPIC_SUMMARIZE_MODEL` (optional, defaults to `claude-3-5-haiku-latest`)

## Run Locally

```bash
cd services/media-worker
npm install
npm start
```

## Deploy (Render)

1. Create a **Background Worker** in Render from this repo.
2. Set the root directory to `services/media-worker`.
3. Use Docker deploy with `services/media-worker/Dockerfile`.
4. Set the env vars above.
