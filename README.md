# Molakhas — ملخص

منصة أخبار رياضية عربية Static مبنية بـ Astro، مع غرفة أخبار آلية:

`RSS / Google News Radar → Deduplication → FCC → Quality Gate → GitHub → Cloudflare Workers Static Assets`

## الحالة الحالية

- الموقع: `https://molakhas.a7asmari.workers.dev`
- Cloudflare يبني وينشر تلقائيًا من `main`.
- فحص RSS يعمل من GitHub Actions حتى عند توقف FCC.
- FCC يمكن تشغيله محليًا بدون تعريضه للإنترنت عبر مسار Windows Local Publisher.
- تسويق Lurvue موجود site-wide وسياقي داخل الأخبار.

## Cloudflare

- Build: `npm run build`
- Deploy: `npx wrangler deploy`
- Static assets: `dist/`
- عند ربط دومين مخصص، اضبط `PUBLIC_SITE_URL` في Cloudflare Build Variables ليتم تحديث canonical / sitemap / RSS تلقائيًا.

## غرفة الأخبار

الأوامر الأساسية:

```bash
npm run newsroom:dry
npm run fcc:test
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
- `FCC_TIMEOUT_MS=60000`

مصادر الرصد العامة تكون `discoveryOnly` ولا تنشر آليًا. المصادر عالية الثقة فقط تستطيع الوصول إلى `approved` بعد اجتياز الجودة والثقة ودرجة ثقة FCC.

## FCC — المسار الموصى به

للإنتاج، الأفضل تشغيل FCC محليًا ثم تشغيل Newsroom على نفس جهاز Windows. لا يحتاج هذا المسار Cloudflare Tunnel ولا يجعل FCC Public.

بعد Clone للمستودع:

```powershell
npm install
powershell -ExecutionPolicy Bypass -File .\scripts\windows\publish-local.ps1
```

السكربت يقوم بـ:

1. تشغيل `fcc-server` تلقائيًا إذا كان متاحًا في PATH وغير شغال.
2. `git pull`.
3. اختبار `http://127.0.0.1:8082/v1`.
4. سحب RSS وإزالة التكرار.
5. توليد الأخبار عبر FCC.
6. Quality Gate.
7. اختبار Astro build.
8. Commit وPush فقط إذا تغير `stories.json`.
9. Cloudflare ينشر الـcommit تلقائيًا.

### جدولة Windows كل ساعتين

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\install-task.ps1
```

لاختبار المهمة فورًا:

```powershell
schtasks /Run /TN "Molakhas Newsroom"
```

إذا فعلت Proxy Auth في FCC، انسخ `.env.local.ps1.example` إلى `.env.local.ps1` وضع فيه `FCC_API_KEY`. هذا الملف ignored من Git.

## FCC عبر GitHub Actions / Tunnel

يبقى المسار السحابي موجودًا كخيار احتياطي. المتغيرات المدعومة:

- `FCC_BASE_URL`
- `FCC_API_KEY`
- `FCC_MODEL`

إذا FCC غير قابل للوصول، الـworkflow لا يكسر الموقع: يتخطى التوليد ويستمر في RSS dry-run وproduction build.

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

تسويق لورفيو مفعل site-wide من `BaseLayout.astro`، إضافة إلى CTA سياقي داخل المقالات بحسب القسم (كرة القدم، السعودية، الانتقالات، UFC، WWE، الملاكمة).

- المتجر: `https://lurvue.com`
- كود الخصم: `Hala10`
- روابط الحملة تحمل UTM tracking.
- روابط الإعلان تستخدم `rel="sponsored nofollow noopener"`.
