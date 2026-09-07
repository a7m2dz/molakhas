# Molakhas — ملخص

منصة أخبار رياضية عربية Static مبنية بـ Astro، مع غرفة أخبار آلية: RSS/Google News Radar → Deduplication → FCC → Quality Gate → Git commit → Cloudflare Workers Static Assets.

## Cloudflare

- Build: `npm run build`
- Deploy: `npx wrangler deploy`
- Static assets: `dist/`
- Current default site: `https://molakhas.a7asmari.workers.dev`
- عند ربط دومين مخصص، اضبط `PUBLIC_SITE_URL` في Cloudflare Build Variables ليتم تحديث canonical / sitemap / RSS تلقائيًا.

## FCC

غرفة الأخبار تستطيع استخدام FCC محليًا عبر Cloudflare Tunnel.

- `FCC_BASE_URL`: يمكن وضعه Secret أو Variable. أثناء الاختبار يوجد Quick Tunnel fallback في workflow.
- `FCC_API_KEY`: اختياري تقنيًا إذا كان Proxy Auth غير مفعل، لكنه موصى به بشدة عند تعريض FCC للإنترنت.
- `FCC_MODEL`: اختياري؛ عند تركه فارغًا يستخدم FCC إعداد السيرفر الافتراضي.

Variables الاختيارية:

- `FCC_TIMEOUT_MS=60000`
- `NEWSROOM_MAX_STORIES=8`
- `NEWSROOM_MAX_AGE_HOURS=72`
- `AUTO_PUBLISH_ENABLED=true`
- `AUTO_PUBLISH_MIN_SCORE=88`
- `AUTO_PUBLISH_MIN_TRUST=88`
- `AUTO_PUBLISH_MIN_CONFIDENCE=78`

الـworkflow يعمل كل ساعتين، ويعمل أيضًا عند تعديل كود غرفة الأخبار أو المصادر. المقالات من مصادر الرصد العامة تدخل `review`، بينما المصادر عالية الثقة فقط يمكن أن تتجاوز بوابة النشر الآلي.

## Lurvue

تسويق لورفيو مفعل site-wide من `BaseLayout.astro`، إضافة إلى CTA سياقي داخل المقالات بحسب القسم. كل الروابط تستخدم `rel="sponsored nofollow"` وUTM tracking. المتجر: `https://lurvue.com` — كود الخصم `Hala10`.

## أوامر مفيدة

```bash
npm install
npm run newsroom:dry
npm run fcc:test
npm run newsroom
npm run build
```
