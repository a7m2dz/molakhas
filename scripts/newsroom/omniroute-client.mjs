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
            content: 'أنت محرر رياضي عربي دقيق. التزم بتعليمات المستخدم وأعد فقط المخرجات المطلوبة دون شرح لعملية التفكير.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
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
  const prompt = `أنت محرر رياضي عربي محترف في منصة "ملخص". صغ خبرًا أصليًا ودقيقًا اعتمادًا فقط على البيانات أدناه.

قواعد إلزامية:
- لا تخترع أي رقم أو تصريح أو نتيجة أو اسم غير موجود.
- إذا كانت المعلومة تقريرًا أو شائعة فقل "بحسب المصدر" ولا تحولها إلى حقيقة مؤكدة.
- لا تنسخ صياغة المصدر حرفيًا، ولا تستخدم أكثر من 8 كلمات متتالية من النص الأصلي.
- اكتب بالعربية الفصحى السهلة المناسبة للقارئ السعودي والعربي.
- لا تبالغ ولا تستخدم عنوانًا مضللًا.
- العنوان بين 25 و95 حرفًا.
- الملخص بين 80 و220 حرفًا.
- اكتب 4 إلى 7 فقرات قصيرة، 180 إلى 420 كلمة عندما تسمح الحقائق.
- إذا كانت المعلومات محدودة فلا تطل ولا تملأ الفراغ بتخمينات.
- لا تضف إعلان لورفيو داخل النص؛ الموقع يضيف الإعلان تلقائيًا.
- لا تذكر أنك نموذج ذكاء اصطناعي أو تشرح تفكيرك.
- أعد JSON صالحًا فقط، بلا Markdown وبلا أي نص قبله أو بعده.

الشكل المطلوب حرفيًا:
{"title":"","excerpt":"","body":[""],"tags":[""],"confidence":0,"importance":1}

confidence من 0 إلى 100 ويعكس كفاية المعلومات ودقتها.
importance من 1 إلى 5 لأهمية الخبر رياضيًا.

العنوان الوارد: ${item.title}
الوصف المتاح: ${item.description}
الناشر: ${item.sourceName}
رابط المصدر: ${item.link}
القسم: ${item.section}`;

  const parsed = parseJson(await omniRequest(prompt));
  const body = Array.isArray(parsed.body) ? parsed.body.map((p) => String(p).trim()).filter(Boolean) : [];
  if (!parsed.title || body.length < 2) throw new Error('OmniRoute JSON incomplete');

  return {
    title: String(parsed.title).trim(),
    excerpt: String(parsed.excerpt || '').trim(),
    body,
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).map((x) => x.trim()).filter(Boolean) : [],
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
    importance: Math.max(1, Math.min(5, Number(parsed.importance) || 1))
  };
}
