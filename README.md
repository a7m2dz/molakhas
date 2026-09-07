# Molakhas — ملخص

منصة أخبار رياضية عربية Static مبنية بـ Astro، مع غرفة أخبار آلية:

`RSS / Google News Radar → Deduplication → OmniRoute → Quality Gate → GitHub → Cloudflare Workers Static Assets`

## الحالة الحالية

- الموقع: `https://molakhas.a7asmari.workers.dev`
- Cloudflare يبني وينشر تلقائيًا من `main`.
- فحص RSS يعمل من GitHub Actions حتى لو OmniRoute المحلي متوقف.
- توليد الأخبار الأساسي يعمل عبر OmniRoute المحلي على Windows بدون تعريضه للإنترنت.
- تسويق Lurvue موجود site-wide وسياقي داخل الأخبار.

## Cloudflare

- Build: `npm run build`
- Deploy: `npx wrangler deploy`
- Static assets: `dist/`
- عند ربط دومين مخصص اضبط `PUBLIC_SITE_URL` لتحديث canonical / sitemap / RSS.

## غرفة الأخبار

```bash
npm run newsroom:dry
npm run omniroute:test
npm run newsroom
npm run build
```

القواعد الافتراضية:

- `NEWSROOM_MAX_STORIES=8`
- `NEWSROOM_MAX_AGE_HOURS=72`
- `AUTO_PUBLISH_ENABLED=true`
- `AUTO_PUBLISH_MIN_SCORE=88`
- `AUTO_PUBLISH_MIN_TRUST=88`
- `AUTO_PUBLISH_MIN_CONFIDENCE=78`
- `OMNIROUTE_MODEL=auto/best-free`
- `OMNIROUTE_FALLBACK_MODEL=auto`
- `OMNIROUTE_TIMEOUT_MS=120000`

مصادر الرصد العامة تكون `discoveryOnly` ولا تنشر آليًا. المصادر عالية الثقة فقط تستطيع الوصول إلى `approved` بعد اجتياز الجودة والثقة ودرجة ثقة الكاتب.

## OmniRoute — المسار الموصى به

شغّل OmniRoute محليًا على:

`http://127.0.0.1:20128/v1`

ثم شغّل:

```powershell
npm install
powershell -ExecutionPolicy Bypass -File .\scripts\windows\publish-local.ps1
```

السكربت يقوم بـ:

1. التأكد أن OmniRoute يعمل على المنفذ `20128` ومحاولة تشغيله إذا كان مثبتًا وفي PATH.
2. `git pull`.
3. اختبار `/v1/models` و`/v1/chat/completions`.
4. سحب RSS وإزالة التكرار.
5. توليد الأخبار عبر `auto/best-free` مع fallback إلى `auto`.
6. Quality Gate.
7. اختبار Astro build.
8. Commit وPush فقط إذا تغير `stories.json`.
9. Cloudflare ينشر الـcommit تلقائيًا.

إذا OmniRoute عندك يتطلب API key، انسخ `.env.local.ps1.example` إلى `.env.local.ps1` وضع فيه المفتاح. الملف ignored من Git.

### جدولة Windows كل ساعتين

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\install-task.ps1
```

لاختبار المهمة فورًا:

```powershell
schtasks /Run /TN "Molakhas Newsroom"
```

## OmniRoute عبر GitHub Actions

المسار السحابي اختياري فقط إذا وفرت endpoint عام لـ OmniRoute. المتغيرات المدعومة:

- `OMNIROUTE_BASE_URL`
- `OMNIROUTE_API_KEY`
- `OMNIROUTE_MODEL`
- `OMNIROUTE_FALLBACK_MODEL`

إذا لم يوجد endpoint عام، GitHub Actions يكتفي بفحص RSS وproduction build، بينما Windows Local Publisher يتولى التوليد.

## SEO

المشروع يولد تلقائيًا:

- `/robots.txt`
- `/sitemap.xml`
- `/news-sitemap.xml`
- `/rss.xml`
- canonical URLs
- Open Graph / Twitter metadata
- WebSite وNewsArticle structured data

## Lurvue

تسويق لورفيو مفعل site-wide من `BaseLayout.astro`، إضافة إلى CTA سياقي داخل المقالات حسب القسم: كرة القدم، السعودية، الانتقالات، UFC، WWE، والملاكمة.

- المتجر: `https://lurvue.com`
- كود الخصم: `Hala10`
- روابط الحملة تحمل UTM tracking.
- روابط الإعلان تستخدم `rel="sponsored nofollow noopener"`.
