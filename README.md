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
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY`
   - `NEXT_PUBLIC_SITE_URL` (set to your deployed URL, e.g. `https://YOUR-SITE.netlify.app`)
3. In Supabase Auth settings, add your Netlify URL to allowed redirect URLs / site URL (so login callbacks work).

## Notes

`.env*` is gitignored on purpose. Commit `.env.example` only.
