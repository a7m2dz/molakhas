const base = (process.env.FCC_BASE_URL || '').replace(/\/$/, '');
const key = process.env.FCC_API_KEY || '';
const model = process.env.FCC_MODEL || '';
const timeoutMs = Number(process.env.FCC_TIMEOUT_MS || 60000);

function outputText(data) {
  if (typeof data.output_text === 'string') return data.output_text;
  for (const item of data.output || []) for (const content of item.content || []) if (typeof content.text === 'string') return content.text;
  return '';
}

export function configured() { return Boolean(base && key); }

export async function fccRequest(prompt) {
  if (!configured()) throw new Error('FCC_BASE_URL / FCC_API_KEY are missing');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ ...(model ? { model } : {}), input: prompt }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`FCC ${response.status}: ${text.slice(0,500)}`);
    const data = JSON.parse(text);
    const out = outputText(data).trim();
    if (!out) throw new Error('FCC returned no text');
    return out;
  } finally { clearTimeout(timer); }
}

export async function rewriteStory(item) {
  const prompt = `أنت محرر منصة رياضية عربية سعودية اسمها ملخص.\nحوّل الحقائق أدناه إلى خبر عربي أصلي وواضح، ولا تنسخ نص المصدر حرفيًا. لا تخترع أرقامًا أو تصريحات. إذا كانت المعلومة غير مؤكدة وضح ذلك.\nأعد JSON فقط بالشكل: {"title":"","excerpt":"","body":["","",""],"tags":[""]}.\nالعنوان: ${item.title}\nالوصف المتاح: ${item.description}\nالمصدر: ${item.sourceName}\nالرابط: ${item.link}\nالقسم: ${item.section}`;
  const raw = await fccRequest(prompt);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('FCC did not return JSON');
  const parsed = JSON.parse(match[0]);
  if (!parsed.title || !Array.isArray(parsed.body) || parsed.body.length < 2) throw new Error('FCC JSON incomplete');
  return parsed;
}
