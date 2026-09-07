# Molakhas — ملخص

منصة أخبار رياضية عربية Static مبنية بـ Astro، مع RSS → FCC → Quality Gate → Cloudflare Workers Static Assets.

## Cloudflare

- Build: `npm run build`
- Deploy: `npx wrangler deploy`
- Static assets: `dist/`

## FCC / GitHub Actions

Repository secrets:
- `FCC_BASE_URL`
- `FCC_API_KEY`

Repository variables:
- `FCC_MODEL`
- `FCC_TIMEOUT_MS=60000`
- `NEWSROOM_MAX_STORIES=8`
- `AUTO_PUBLISH_ENABLED=true`
- `AUTO_PUBLISH_MIN_SCORE=90`
- `AUTO_PUBLISH_MIN_TRUST=85`

The newsroom runs every two hours. If FCC secrets are missing, it exits safely without changing content.

## Lurvue

Lurvue marketing is site-wide through `BaseLayout.astro` and contextual per section/article. Store: https://lurvue.com — code `Hala10`.
