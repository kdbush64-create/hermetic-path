# ∴ The Hermetic Path ∴

Private AI-powered esoteric study application — a Progressive Web App served entirely from Cloudflare Workers.

- **Production:** https://hermeticpath.v64otd.com
- **Dev:** https://hermetic-path-dev.&lt;account&gt;.workers.dev

## Architecture

- **Cloudflare Workers** serve the HTML app and proxy all Anthropic API calls server-side.
- **Anthropic Claude API** (`claude-sonnet-4-20250514`) generates all content on demand.
- **No database.** Content is fresh every session. User preferences live in `localStorage`.
- **API key never leaves Cloudflare.** Stored only as an encrypted Worker secret.

## Branches

| Branch  | Deploys to                                  |
|---------|---------------------------------------------|
| `main`  | `hermeticpath.v64otd.com` (production)      |
| `dev`   | `hermetic-path-dev.<account>.workers.dev`   |

Deploys happen automatically via GitHub Actions on push.

## Local development

```bash
npm install
npm run dev          # local wrangler dev server
npm run deploy:dev   # manual deploy to dev environment
```

You'll need a local `.dev.vars` file (already gitignored) with:

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Secrets

| Secret               | Where                            | Purpose                              |
|----------------------|----------------------------------|--------------------------------------|
| `ANTHROPIC_API_KEY`  | Cloudflare Worker → Settings     | Server-side API calls to Claude      |
| `CLOUDFLARE_API_TOKEN` | GitHub repo → Settings → Secrets | Lets GitHub Actions deploy           |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub repo → Settings → Secrets | Identifies the CF account to deploy to |
