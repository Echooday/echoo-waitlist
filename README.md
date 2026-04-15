# Echoo Waitlist

Waitlist landing page built with Vite + React.

## Open-source scope

This repository is UI-only.

- The production backend, database, migrations, and operational infrastructure are private.
- Do not commit real project URLs, API keys, service credentials, tokens, or environment files.
- Use local/dev placeholders only.

## Local development

1. Copy env vars:

   ```bash
   cp .env.example .env.local
   ```

2. Fill in at least:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

3. Run:

   ```bash
   npm install
   npm run dev
   ```

## Build

```bash
npm run build
```

## Secret protection (recommended)

Install local pre-commit hook:

```bash
npm run hooks:install
```

Run manual scans:

```bash
npm run secrets:scan:staged
npm run secrets:scan:all
```

The repository also contains a GitHub Action (`.github/workflows/secret-scan.yml`) that runs secret scanning on push/PR.

## Deploy

### Vercel

- Root directory: `waitlist`
- Build command: `npm run build`
- Output directory: `dist`
- Set env vars from `.env.example`

`vercel.json` is included.

## Backend note

This UI expects backend endpoints/RPCs to exist, but backend implementation and operations are intentionally not documented in this open-source repository.
