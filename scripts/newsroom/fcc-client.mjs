const base = (process.env.FCC_BASE_URL || '').replace(/\/$/, '');
const key = process.env.FCC_API_KEY || '';
const configuredModel = (process.env.FCC_MODEL || '').trim();
const timeoutMs = Number(process.env.FCC_TIMEOUT_MS || 60000);
const FCC_DEFAULT_MODEL = 'nvidia_nim/nvidia/nemotron-3-super-120b-a12b';
let cachedModel = configuredModel || '';

function headers(extra = {}) {
  return {
    'content-type': 'application/json',
    accept: 'text/event-stream, application/json',
    ...(key ? { authorization: `Bearer ${key}` } : {}),
    ...extra
  };
}

function outputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') return content.text;
      if (typeof content?.text?.value === 'string') return content.text.value;
    }
  }
  const chatContent = data?.choices?.[0]?.message?.content;
  if (typeof chatContent === 'string') return chatContent;
  return '';
}

function outputTextFromSse(raw) {
  const deltas = [];
  let completedResponse = null;
  let lastObject = null;

  for (const line of String(raw).split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;

    try {
      const event = JSON.parse(payload);
      lastObject = event;

      if (typeof event?.delta === 'string') deltas.push(event.delta);
      if (typeof event?.text === 'string' && /output_text/i.test(String(event?.type || ''))) {
        deltas.push(event.text);
      }

      const chatDelta = event?.choices?.[0]?.delta?.content;
      if (typeof chatDelta === 'string') deltas.push(chatDelta);

      if (event?.response && typeof event.response === 'object') {
        completedResponse = event.response;
      }
    } catch {
      // Ignore malformed/diagnostic SSE lines and continue collecting valid events.
    }
  }

  const finalText = outputText(completedResponse) || outputText(lastObject);
  if (finalText) return finalText;
  return deltas.join('');
}

function parseFccText(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';

  try {
    return outputText(JSON.parse(text));
  } catch {
    if (/^(event:|data:)/m.test(text)) return outputTextFromSse(text);
    throw new Error(`FCC returned an unsupported response format: ${text.slice(0, 180)}`);
  }
}

export function configured() {
  return Boolean(base);
}

export async function listModels() {
  if (!configured()) throw new Error('FCC_BASE_URL is missing');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/models`, {
      headers: headers({ accept: 'application/json' }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`FCC models ${response.status}: ${text.slice(0, 500)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function resolveModel() {
  if (cachedModel) return cachedModel;

  const payload = await listModels();
  const ids = Array.isArray(payload?.data)
    ? payload.data.map((item) => String(item?.id || '').trim()).filter(Boolean)
    : [];

  cachedModel =
    ids.find((id) => id === FCC_DEFAULT_MODEL) ||
    ids.find((id) => /nemotron-3-super-120b-a12b/i.test(id)) ||
    ids[0] ||
    FCC_DEFAULT_MODEL;

  console.log(`[FCC] Model: ${cachedModel}${configuredModel ? '' : ' (auto-selected)'}`);
  return cachedModel;
}

export async function fccRequest(prompt) {
  if (!configured()) throw new Error('FCC_BASE_URL is missing');
  const model = await resolveModel();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/responses`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ model, input: prompt, stream: true }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`FCC ${response.status}: ${text.slice(0, 500)}`);
    const out = parseFccText(text).trim();
    if (!out) throw new Error(`FCC returned no text. Raw response: ${text.slice(0, 300)}`);
    return out;
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('FCC did not return JSON');
    return JSON.parse(match[0]);
  }
}

export async function rewriteStory(item) {
  const prompt = `أنت محرر رياضي عربي محترف في منصة "ملخص". مهمتك صياغة خبر أصلي ودقيق اعتمادًا فقط على المعلومات المتاحة أدناه.

قواعد إلزامية:
- لا تخترع أي رقم أو تصريح أو نتيجة أو اسم غير موجود في البيانات.
- إذا كانت المعلومة تقريرًا أو شائعة فاذكر أنها "بحسب المصدر" ولا تحولها إلى حقيقة مؤكدة.
- لا تنسخ صياغة المصدر حرفيًا، ولا تستخدم أكثر من 8 كلمات متتالية من النص الأصلي.
- اكتب بالعربية الفصحى السهلة المناسبة للقارئ السعودي والعربي، بلا مبالغة أو عناوين مضللة.
- العنوان بين 25 و95 حرفًا، واضح ومباشر.
- الملخص بين 80 و220 حرفًا.
- اكتب 4 إلى 7 فقرات قصيرة. استهدف 180 إلى 420 كلمة عندما تسمح الحقائق بذلك، ولا تطل إذا كانت البيانات محدودة.
- لا تضف إعلان لورفيو داخل النص؛ الموقع يضيفه تلقائيًا في موضع مناسب.
- لا تذكر أنك نموذج ذكاء اصطناعي.

أعد JSON صالحًا فقط بهذا الشكل:
{"title":"","excerpt":"","body":[""],"tags":[""],"confidence":0,"importance":1}

confidence رقم من 0 إلى 100 يعكس مدى كفاية المعلومات المتاحة لصياغة خبر دقيق.
importance رقم من 1 إلى 5 لأهمية الخبر رياضيًا.

العنوان الوارد: ${item.title}
الوصف المتاح: ${item.description}
الناشر: ${item.sourceName}
رابط المصدر: ${item.link}
القسم: ${item.section}`;

  const parsed = parseJson(await fccRequest(prompt));
  const body = Array.isArray(parsed.body) ? parsed.body.map((p) => String(p).trim()).filter(Boolean) : [];
  if (!parsed.title || body.length < 2) throw new Error('FCC JSON incomplete');

  return {
    title: String(parsed.title).trim(),
    excerpt: String(parsed.excerpt || '').trim(),
    body,
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).map((x) => x.trim()).filter(Boolean) : [],
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
    importance: Math.max(1, Math.min(5, Number(parsed.importance) || 1))
  };
}
