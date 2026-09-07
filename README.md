# Molakhas — ملخص

منصة أخبار رياضية عربية Static مبنية بـ Astro، مع غرفة أخبار آلية منخفضة التكلفة:

`RSS / Google News Radar → Deduplication → OmniRoute → SEO + Reader Value → Quality Gate → Licensed WebP Media → GitHub → Cloudflare Workers Static Assets`

## الحالة الحالية

- الموقع: `https://molakhas.a7asmari.workers.dev`
- Cloudflare يبني وينشر تلقائيًا من `main`.
- فحص RSS يعمل من GitHub Actions حتى لو OmniRoute المحلي متوقف.
- توليد الأخبار الأساسي يعمل عبر OmniRoute المحلي على Windows بدون تعريضه للإنترنت.
- تسويق Lurvue موجود site-wide وسياقي داخل الأخبار مع UTM حسب القسم وموضع CTA.
- الإعلانات موسومة بصريًا وروابطها `sponsored nofollow`.

## غرفة الأخبار

```bash
npm run newsroom:dry
npm run omniroute:test
npm run newsroom
npm run images:generate
npm run build
npm run indexnow
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

كل خبر جديد يطلب من OmniRoute:

- H1 تحريري.
- SEO title مستقل.
- Meta description.
- Focus keyword طبيعي.
- 2–4 نقاط «الزبدة».
- 4–7 فقرات حسب كمية الحقائق المتاحة.
- Tags + Entities.
- ALT + Caption للصورة.
- English image search query للعثور على صورة مرخصة.

## الصور — المستوى الاحترافي المجاني

`generate-images.mjs` يحاول أولًا العثور على صورة حقيقية عبر Wikimedia Commons.

يتم قبول الصور فقط عندما يكون الترخيص مناسبًا للاستخدام التجاري والتعديل مثل:

- Public Domain
- CC0
- CC BY
- CC BY-SA

ويتم رفض تراخيص NC/ND. الصورة تُقص إلى `1200×675` وتُحوّل WebP وتضاف لها علامة ملخص خفيفة. يتم حفظ بيانات صاحب الصورة والترخيص والمصدر في `src/data/image-manifest.json` وتظهر في صفحة المقال.

إذا لم توجد صورة مناسبة، يتم إنشاء branded fallback أصلي بدل نسخ صورة من صحيفة أو حساب اجتماعي.

## SEO / Google News / Discover

المشروع يولد تلقائيًا:

- `/robots.txt`
- `/sitemap.xml` مع صور المقالات.
- `/news-sitemap.xml` للأخبار خلال آخر 48 ساعة.
- `/rss.xml`
- canonical URLs.
- Open Graph + Twitter large image.
- `NewsArticle`, `BreadcrumbList`, `Organization`, `WebSite` structured data.
- صور 1200×675 + `max-image-preview:large`.
- صفحات Topics تلقائية للوسوم التي لديها أكثر من خبر لتقوية internal linking بدون إنشاء صفحات thin.
- صفحات شفافية: About / Author / Editorial Policy / Corrections / Contact / Disclosure.
- IndexNow لإشعار محركات البحث الداعمة بالأخبار الجديدة.

لا يتم إنشاء صفحات SEO عشوائية لكل keyword؛ الهدف الحفاظ على محتوى مفيد وتجنب scaled-content spam.

## OmniRoute — المسار الموصى به

شغّل OmniRoute محليًا على:

`http://127.0.0.1:20128/v1`

إذا كان OmniRoute يتطلب API key، أنشئ `.env.local.ps1`:

```powershell
$env:OMNIROUTE_API_KEY = 'sk-...'
$env:OMNIROUTE_MODEL = 'auto/best-free'
$env:OMNIROUTE_FALLBACK_MODEL = 'auto'
```

ثم:

```powershell
npm install
powershell -ExecutionPolicy Bypass -File .\scripts\windows\publish-local.ps1
```

الـLocal Publisher يقوم بـ: تحديث المستودع → اختبار OmniRoute → RSS → توليد الخبر → Quality Gate → WebP/licensing → build → commit/push → IndexNow.

### التحديث كل 30 دقيقة

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\install-task.ps1
```

لاختبار المهمة فورًا:

```powershell
schtasks /Run /TN "Molakhas Newsroom"
```

السكربت لا يعمل Push إذا لم توجد تغييرات قابلة للنشر، لذلك الفحص المتكرر لا يعني Build على Cloudflare كل 30 دقيقة بالضرورة.

## Cloudflare

- Build: `npm run build`
- Deploy: `npx wrangler deploy`
- Static assets: `dist/`
- الصور والأصول الثابتة تستخدم cache headers من `public/_headers`.
- عند ربط دومين مخصص اضبط `PUBLIC_SITE_URL` لتحديث canonical / sitemap / RSS / IndexNow.

## Lurvue Conversion Layer

لورفيو موجود في كل صفحة من خلال Top CTA، مع CTA سياقي داخل المقالات بدل تكرار إعلانات كثيرة تعطل القراءة.

- المتجر: `https://lurvue.com`
- كود الخصم: `Hala10`
- UTM يحدد: المصدر + القسم + موضع الإعلان + slug الخبر + focus keyword.
- كل إعلان يحمل label واضح `إعلان`.
- المقالات لا تملأ بإعلانات حتى يبقى المحتوى التحريري هو الجزء الأساسي.

## خطوات خارج الكود

لأقصى استفادة من Google يجب تنفيذها مرة واحدة عند توفر الدومين النهائي:

1. إضافة الموقع إلى Google Search Console.
2. إرسال `/sitemap.xml` و`/news-sitemap.xml`.
3. تفعيل Cloudflare Web Analytics المجاني إن رغبت بقياس الزيارات وCore Web Vitals.
4. استخدام UTM في Analytics الخاص بلورفيو لمعرفة أي قسم وموضع CTA يحقق أفضل تحويل.
