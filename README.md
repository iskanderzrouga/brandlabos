## Getting Started

### Environment

Create `.env.local` based on `.env.example`.

### Run Locally

Run the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Deploy (Netlify)

This repo includes `netlify.toml` and uses `@netlify/plugin-nextjs`.

1. Create a new Netlify site from the GitHub repo (main branch).
2. Set environment variables in Netlify (Site configuration → Environment variables):
   - `NETLIFY_DATABASE_URL_UNPOOLED`
   - `NETLIFY_DATABASE_URL`
   - `AUTH_SECRET`
   - `ANTHROPIC_API_KEY`
   - `ANTHROPIC_AGENT_MODEL` (optional)
   - `R2_ENDPOINT`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_BUCKET`
   - `R2_REGION` (optional, default `auto`)

## Migrations (Neon)

Apply migrations to your Neon database:

```bash
node scripts/migrate-neon.js
```

## Media Worker (Render)

Heavy swipe ingestion (Meta Ad Library → download video → Whisper transcript → upload to R2) runs in a separate worker:

- Service: `services/media-worker`
- Docs: `services/media-worker/README.md`

## Notes

`.env*` is gitignored on purpose. Commit `.env.example` only.
