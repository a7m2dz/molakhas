const base = (process.env.OMNIROUTE_BASE_URL || 'http://127.0.0.1:20128/v1').replace(/\/$/, '');
const key = (process.env.OMNIROUTE_API_KEY || '').trim();
const configuredModel = (process.env.OMNIROUTE_MODEL || 'auto/best-free').trim();
const fallbackModel = (process.env.OMNIROUTE_FALLBACK_MODEL || 'auto').trim();
const timeoutMs = Number(process.env.OMNIROUTE_TIMEOUT_MS || 120000);

function headers(extra = {}) {
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    ...(key ? { authorization: `Bearer ${key}` } : {}),
    ...extra
  };
}

export function configured() {
  return Boolean(base);
}

export async function listModels() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/models`, { headers: headers(), signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`OmniRoute models ${response.status}: ${text.slice(0, 500)}`);
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}

function extractText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((part) => typeof part === 'string' ? part : (part?.text || '')).join('').trim();
  if (typeof data?.output_text === 'string') return data.output_text.trim();
  return '';
}

async function chatWithModel(model, prompt, { temperature = 0.1 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'أنت محرر أخبار رياضية عربي وخبير SEO تقني وتحريري. الأولوية للدقة، نية البحث، الوضوح، وإضافة قيمة حقيقية للقارئ بدون حشو أو اختلاق. يجب أن تكون كل الحقول التحريرية عربية سليمة، مع السماح فقط بأسماء العلامات والكيانات الأجنبية عند الحاجة. لا تستخدم أي أحرف صينية أو يابانية أو كورية أو سيريليّة، ولا شظايا كود أو كلمات هجينة بين العربية والإنجليزية. عندما يُطلب JSON فأعد JSON صالحًا فقط بلا Markdown.'
          },
          { role: 'user', content: prompt }
        ],
        temperature,
        stream: false
      }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`OmniRoute ${response.status}: ${text.slice(0, 700)}`);
    const data = JSON.parse(text);
    const out = extractText(data);
    if (!out) throw new Error(`OmniRoute returned no text: ${text.slice(0, 300)}`);
    return out;
  } finally { clearTimeout(timer); }
}

async function requestWithRouting(prompt, opts = {}) {
  try {
    console.log(`[OmniRoute] Model: ${configuredModel}`);
    return await chatWithModel(configuredModel, prompt, opts);
  } catch (error) {
    if (!fallbackModel || fallbackModel === configuredModel) throw error;
    console.warn(`[OmniRoute] ${configuredModel} failed; falling back to ${fallbackModel}: ${error.message}`);
    return chatWithModel(fallbackModel, prompt, opts);
  }
}

export async function omniRequest(prompt) {
  return requestWithRouting(prompt);
}

function cleanJsonEnvelope(raw) {
  let cleaned = String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^\uFEFF/, '')
    .trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
  return cleaned;
}

function localJsonRepairs(raw) {
  return cleanJsonEnvelope(raw)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function tryParseJson(raw) {
  const attempts = [cleanJsonEnvelope(raw), localJsonRepairs(raw)];
  let lastError;
  for (const candidate of [...new Set(attempts)]) {
    try { return { value: JSON.parse(candidate), repaired: candidate !== attempts[0] }; }
    catch (error) { lastError = error; }
  }
  throw Object.assign(new Error(lastError?.message || 'Invalid JSON'), { raw: cleanJsonEnvelope(raw) });
}

async function repairJsonWithModel(raw, parseError) {
  const clipped = cleanJsonEnvelope(raw).slice(0, 12000);
  const prompt = `أصلح JSON التالي فقط من ناحية البنية والصياغة التقنية.

قواعد إلزامية:
- أعد كائن JSON صالحًا فقط بلا Markdown أو شرح.
- لا تضف أي حقيقة أو اسم أو رقم غير موجود في JSON الأصلي.
- حافظ على نفس المفاتيح والقيم قدر الإمكان.
- أصلح الفواصل والاقتباسات والمصفوفات والأقواس الناقصة.
- إذا وجدت نصًا فاسدًا أو شظايا كود داخل حقل تحريري، لا تخترع بديلًا؛ اتركه لكي يرفضه فحص الجودة لاحقًا.
- لا تحذف الحقول المطلوبة.

خطأ المحلل: ${String(parseError || '').slice(0, 500)}

JSON غير الصالح:
${clipped}`;
  console.warn('[OmniRoute] Structured output malformed; attempting JSON repair...');
  return requestWithRouting(prompt, { temperature: 0 });
}

async function requestJson(prompt) {
  const raw = await requestWithRouting(prompt, { temperature: 0.08 });
  try {
    return tryParseJson(raw).value;
  } catch (firstError) {
    try {
      const repairedRaw = await repairJsonWithModel(raw, firstError.message);
      return tryParseJson(repairedRaw).value;
    } catch (repairError) {
      console.warn(`[OmniRoute] JSON repair failed: ${repairError.message}`);
      console.warn('[OmniRoute] Regenerating structured output once from source instructions...');
      const regenerated = await requestWithRouting(`${prompt}\n\nتنبيه تقني: المحاولة السابقة لم تكن JSON صالحًا. أعد إنشاء الكائن كاملًا من الصفر. تأكد يدويًا من صحة JSON قبل الإرسال: اقتباسات مزدوجة، فاصلة بين كل خاصيتين، لا trailing commas، ولا Markdown.`, { temperature: 0 });
      try { return tryParseJson(regenerated).value; }
      catch (finalError) { throw new Error(`OmniRoute structured JSON failed after repair/regeneration: ${finalError.message}`); }
    }
  }
}

export async function rewriteStory(item, qualityFeedback = '') {
  const retryBlock = qualityFeedback ? `\n\nهذه محاولة تصحيح. المخرجات السابقة فشلت فحص الجودة للأسباب التالية:\n- ${qualityFeedback}\nأعد كتابة جميع الحقول من الصفر بالعربية السليمة، ولا تكرر أي جزء فاسد من المحاولة السابقة.` : '';
  const sourceBlock = item.sourceContent
    ? `\n\nالمادة المستخرجة من صفحة الناشر الأصلية (هي المرجع الأساسي للحقائق):\n---\n${String(item.sourceContent).slice(0, 9000)}\n---`
    : '\n\nلم نتمكن من استخراج نص صفحة الناشر؛ اعتمد فقط على العنوان والوصف المتاحين ولا توسع بما لا تدعمه البيانات.';

  const prompt = `أنت محرر رياضي عربي محترف وخبير SEO لمنصة "ملخص". صغ خبرًا أصليًا ومفيدًا اعتمادًا فقط على البيانات أدناه.

قواعد التحرير:
- المادة المستخرجة من صفحة الناشر هي المرجع الأساسي عند توفرها؛ لا تضف شيئًا غير موجود فيها أو في بيانات RSS.
- لا تخترع أي رقم أو تصريح أو نتيجة أو اسم غير موجود.
- إذا كانت المعلومة تقريرًا أو شائعة فقل "بحسب المصدر" ولا تحولها إلى حقيقة مؤكدة.
- لا تنسخ صياغة المصدر حرفيًا، ولا تستخدم أكثر من 8 كلمات متتالية من النص الأصلي.
- اكتب بالعربية الفصحى السهلة المناسبة للقارئ السعودي والعربي.
- كل الحقول التحريرية يجب أن تكون عربية سليمة. يجوز إبقاء أسماء العلامات مثل WWE وUFC وEA SPORTS FC وأسماء الأشخاص الأجنبية فقط عند الحاجة.
- ممنوع استخدام أحرف صينية أو يابانية أو كورية أو سيريليّة، أو شظايا برمجية، أو كلمات هجينة بين العربية والإنجليزية داخل الكلمة نفسها.
- لا تستخدم كلمات إنجليزية عامة مثل updates أو trademark أو report إذا لها بديل عربي طبيعي.
- لا تبالغ ولا تستخدم عنوانًا مضللًا.
- H1 بين 25 و95 حرفًا ويصف الحدث مباشرة.
- excerpt بين 80 و220 حرفًا.
- اكتب 4 إلى 7 فقرات قصيرة، 180 إلى 420 كلمة عندما تسمح المادة المصدرية، ولا تطل إذا كانت المعلومات محدودة.
- اذكر الكيان أو البطولة الرئيسية طبيعيًا في أول فقرة عندما يكون مناسبًا.
- لا تحشو الكلمات المفتاحية ولا تكررها صناعيًا.
- أضف keyPoints من نقطتين إلى أربع نقاط سريعة، وكل نقطة يجب أن تكون مدعومة بالبيانات المتاحة.
- لا تضف إعلان لورفيو داخل النص؛ الموقع يضيف الإعلان تلقائيًا.
- لا تذكر أنك نموذج ذكاء اصطناعي أو تشرح تفكيرك.

قواعد SEO والصور:
- seoTitle عنوان نتائج البحث بالعربية، طبيعي وجذاب، بحد أقصى 60 حرفًا تقريبًا، ولا تضف "| ملخص".
- metaDescription وصف بحث عربي من 130 إلى 160 حرفًا تقريبًا، يلخص القيمة الخبرية دون clickbait.
- focusKeyword عبارة بحث عربية واحدة طبيعية من كلمتين إلى خمس كلمات مرتبطة مباشرة بالخبر.
- imageAlt وصف عربي دقيق للصورة المصاحبة، من 50 إلى 125 حرفًا تقريبًا.
- imageCaption تعليق عربي قصير للصورة من 35 إلى 110 أحرف.
- imageSearchQuery عبارة قصيرة من 2 إلى 6 كلمات تصف الكيان الأساسي للخبر؛ تستخدم فقط كبيانات مساعدة ولا تبني عليها أي حقيقة.
- entities من 2 إلى 6 أسماء كيانات أساسية في الخبر.
- tags من 2 إلى 6 وسوم مرتبطة فعليًا بالخبر.

أعد JSON صالحًا فقط، بلا Markdown وبلا أي نص قبله أو بعده.

الشكل المطلوب حرفيًا:
{"title":"","seoTitle":"","metaDescription":"","focusKeyword":"","excerpt":"","keyPoints":[""],"body":[""],"tags":[""],"entities":[""],"imageAlt":"","imageCaption":"","imageSearchQuery":"","confidence":0,"importance":1}

confidence من 0 إلى 100 ويعكس كفاية المادة المصدرية ودقتها، وليس جودة الأسلوب فقط.
importance من 1 إلى 5 لأهمية الخبر رياضيًا.

العنوان الوارد: ${item.title}
الوصف المتاح: ${item.description}
الناشر: ${item.sourceName}
رابط RSS/Google News: ${item.link}
رابط صفحة الناشر الأصلية: ${item.publisherUrl || 'غير متاح'}
طريقة إثراء المصدر: ${item.enrichmentMethod || 'rss-only'}
القسم: ${item.section}${sourceBlock}${retryBlock}`;

  const parsed = await requestJson(prompt);
  const body = Array.isArray(parsed.body) ? parsed.body.map((p) => String(p).trim()).filter(Boolean) : [];
  const keyPoints = Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 4) : [];
  if (!parsed.title || body.length < 2) throw new Error('OmniRoute JSON incomplete');

  const title = String(parsed.title).trim();
  const excerpt = String(parsed.excerpt || '').trim();
  return {
    title,
    seoTitle: String(parsed.seoTitle || title).trim().slice(0, 70),
    metaDescription: String(parsed.metaDescription || excerpt).trim().slice(0, 180),
    focusKeyword: String(parsed.focusKeyword || '').trim().slice(0, 80),
    excerpt,
    keyPoints,
    body,
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 6) : [],
    entities: Array.isArray(parsed.entities) ? parsed.entities.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 6) : [],
    imageAlt: String(parsed.imageAlt || title).trim().slice(0, 150),
    imageCaption: String(parsed.imageCaption || excerpt || title).trim().slice(0, 150),
    imageSearchQuery: String(parsed.imageSearchQuery || parsed.focusKeyword || title).trim().slice(0, 120),
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
    importance: Math.max(1, Math.min(5, Number(parsed.importance) || 1))
  };
}
