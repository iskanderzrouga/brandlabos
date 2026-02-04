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

## Notes

`.env*` is gitignored on purpose. Commit `.env.example` only.
