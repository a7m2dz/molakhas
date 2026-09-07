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
    const response = await fetch(`${base}/models`, {
      headers: headers(),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`OmniRoute models ${response.status}: ${text.slice(0, 500)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function extractText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === 'string' ? part : (part?.text || '')).join('').trim();
  }
  if (typeof data?.output_text === 'string') return data.output_text.trim();
  return '';
}

async function chatWithModel(model, prompt) {
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
            content: 'أنت محرر أخبار رياضية عربي وخبير SEO تقني وتحريري. الأولوية للدقة، نية البحث، الوضوح، وإضافة قيمة حقيقية للقارئ بدون حشو أو اختلاق. التزم بتعليمات المستخدم وأعد فقط المخرجات المطلوبة.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.15,
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
  } finally {
    clearTimeout(timer);
  }
}

export async function omniRequest(prompt) {
  try {
    console.log(`[OmniRoute] Model: ${configuredModel}`);
    return await chatWithModel(configuredModel, prompt);
  } catch (error) {
    if (!fallbackModel || fallbackModel === configuredModel) throw error;
    console.warn(`[OmniRoute] ${configuredModel} failed; falling back to ${fallbackModel}: ${error.message}`);
    return chatWithModel(fallbackModel, prompt);
  }
}

function parseJson(raw) {
  const cleaned = String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first === -1 || last <= first) throw new Error(`OmniRoute did not return JSON: ${cleaned.slice(0, 220)}`);
    return JSON.parse(cleaned.slice(first, last + 1));
  }
}

export async function rewriteStory(item) {
  const prompt = `أنت محرر رياضي عربي محترف وخبير SEO لمنصة "ملخص". صغ خبرًا أصليًا ومفيدًا اعتمادًا فقط على البيانات أدناه.

قواعد التحرير:
- لا تخترع أي رقم أو تصريح أو نتيجة أو اسم غير موجود.
- إذا كانت المعلومة تقريرًا أو شائعة فقل "بحسب المصدر" ولا تحولها إلى حقيقة مؤكدة.
- لا تنسخ صياغة المصدر حرفيًا، ولا تستخدم أكثر من 8 كلمات متتالية من النص الأصلي.
- اكتب بالعربية الفصحى السهلة المناسبة للقارئ السعودي والعربي.
- لا تبالغ ولا تستخدم عنوانًا مضللًا.
- H1 بين 25 و95 حرفًا ويصف الحدث مباشرة.
- الملخص المرئي excerpt بين 80 و220 حرفًا.
- اكتب 4 إلى 7 فقرات قصيرة، 180 إلى 420 كلمة عندما تسمح الحقائق، ولا تطل إذا كانت المعلومات محدودة.
- اذكر الكيان أو البطولة الرئيسية طبيعيًا في أول فقرة عندما يكون مناسبًا.
- لا تحشو الكلمات المفتاحية ولا تكررها صناعيًا.
- أضف keyPoints من نقطتين إلى أربع نقاط سريعة تلخص أهم ما يعرفه القارئ، وكل نقطة يجب أن تكون مدعومة بالبيانات المتاحة.
- لا تضف إعلان لورفيو داخل النص؛ الموقع يضيف الإعلان تلقائيًا.
- لا تذكر أنك نموذج ذكاء اصطناعي أو تشرح تفكيرك.

قواعد SEO والصور:
- seoTitle عنوان نتائج البحث، طبيعي وجذاب، بحد أقصى 60 حرفًا تقريبًا، ولا تضف "| ملخص" لأن الموقع يضيف العلامة.
- metaDescription وصف بحث عربي من 130 إلى 160 حرفًا تقريبًا، يلخص القيمة الخبرية دون clickbait.
- focusKeyword عبارة بحث واحدة طبيعية من كلمتين إلى خمس كلمات مرتبطة مباشرة بالخبر.
- imageAlt وصف عربي دقيق للصورة المصاحبة، من 50 إلى 125 حرفًا تقريبًا؛ لا تبدأ بـ"صورة لـ" ولا تحشو كلمات مفتاحية.
- imageCaption تعليق قصير للصورة من 35 إلى 110 أحرف.
- imageSearchQuery عبارة بحث بالإنجليزية من 2 إلى 6 كلمات للعثور على صورة حقيقية مرخصة في Wikimedia Commons. استخدم أسماء اللاعب/الفريق/المقاتل/البطولة الأساسية فقط، ولا تستخدم كلمات عامة مثل news أو photo.
- entities من 2 إلى 6 أسماء كيانات أساسية في الخبر مثل لاعب، فريق، بطولة أو مدينة، بدون تكرار.
- tags من 2 إلى 6 وسوم حقيقية مرتبطة بالكيانات أو البطولة أو الموضوع.

أعد JSON صالحًا فقط، بلا Markdown وبلا أي نص قبله أو بعده.

الشكل المطلوب حرفيًا:
{"title":"","seoTitle":"","metaDescription":"","focusKeyword":"","excerpt":"","keyPoints":[""],"body":[""],"tags":[""],"entities":[""],"imageAlt":"","imageCaption":"","imageSearchQuery":"","confidence":0,"importance":1}

confidence من 0 إلى 100 ويعكس كفاية المعلومات ودقتها.
importance من 1 إلى 5 لأهمية الخبر رياضيًا.

العنوان الوارد: ${item.title}
الوصف المتاح: ${item.description}
الناشر: ${item.sourceName}
رابط المصدر: ${item.link}
القسم: ${item.section}`;

  const parsed = parseJson(await omniRequest(prompt));
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
