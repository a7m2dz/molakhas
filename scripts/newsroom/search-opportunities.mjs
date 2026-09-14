import fs from 'node:fs/promises';

const STORIES = new URL('../../src/data/stories.json', import.meta.url);
const FEEDBACK = new URL('../../src/data/search-feedback.json', import.meta.url);
const OUTPUT = new URL('../../src/data/seo-opportunities.json', import.meta.url);

const MAX_OUTPUT = Math.max(50, Math.min(1000, Number(process.env.SEO_OPPORTUNITY_LIMIT || 300)));
const RECENT_STORIES = Math.max(30, Math.min(500, Number(process.env.SEO_RECENT_STORIES || 180)));

const STOPWORDS = new Set([
  'في','من','على','إلى','الى','عن','مع','ضد','بعد','قبل','هذا','هذه','ذلك','اليوم','الآن','عبر','حول','بين','حتى',
  'خبر','أخبار','اخبار','آخر','اخر','جديد','الجديد','مباراة','مباريات','نتيجة','نتائج','موعد','مواعيد','الدوري','كأس',
  'the','and','for','with','from','news','today','latest','match','matches'
]);

function clean(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalize(value = '') {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ـً-ْ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function useful(value = '') {
  const text = clean(value);
  if (text.length < 3 || text.length > 90) return false;
  const parts = normalize(text).split(' ').filter(Boolean);
  if (!parts.length || parts.length > 9) return false;
  if (parts.every((part) => STOPWORDS.has(part))) return false;
  return true;
}

function conversionFit(section = '', query = '') {
  const high = new Set(['football','saudi','ufc','wwe','boxing','basketball','movies','tv','sports','transfers']);
  let score = high.has(section) ? 70 : 45;
  const q = normalize(query);
  if (/مبار|دوري|بطول|كرة|نزال|ufc|wwe|nba|فيلم|مسلسل|موسم|حلقة/u.test(q)) score += 15;
  if (/موعد|اليوم|الآن|مشاهدة|تابع/u.test(q)) score += 8;
  return Math.min(100, score);
}

const stories = JSON.parse(await fs.readFile(STORIES, 'utf8'));
let feedback = { rows: [] };
try { feedback = JSON.parse(await fs.readFile(FEEDBACK, 'utf8')); } catch {}

const opportunities = new Map();
function add(query, data = {}) {
  const label = clean(query);
  if (!useful(label)) return;
  const key = normalize(label);
  if (!key) return;
  const current = opportunities.get(key);
  const candidate = {
    query: label,
    source: data.source || 'derived',
    section: data.section || 'general',
    page: data.page || '',
    score: Math.max(0, Math.min(100, Math.round(Number(data.score || 0)))),
    impressions: Number(data.impressions || 0),
    clicks: Number(data.clicks || 0),
    ctr: Number(data.ctr || 0),
    position: Number(data.position || 0),
    conversionFit: conversionFit(data.section || 'general', label),
    reason: data.reason || '',
    recommendedUse: 'استخدمها كنية بحث/كلمة مساندة طبيعيًا عند صلتها بالمحتوى؛ لا تعرض قائمة كلمات ولا تحشوها داخل الصفحة.'
  };
  if (!current || candidate.score > current.score || candidate.impressions > current.impressions) opportunities.set(key, candidate);
}

// First priority: real Google Search Console queries. These are the strongest signals
// because the site is already receiving impressions for them.
for (const row of Array.isArray(feedback?.rows) ? feedback.rows : []) {
  const query = clean(row?.query);
  if (!query) continue;
  const path = (() => { try { return new URL(row.page).pathname; } catch { return ''; } })();
  const section = path.split('/').filter(Boolean)[0] || 'general';
  add(query, {
    source: 'gsc',
    section,
    page: row.page,
    score: Number(row.opportunityScore || 0),
    impressions: row.impressions,
    clicks: row.clicks,
    ctr: row.ctr,
    position: row.position,
    reason: `ظهور فعلي في Google؛ متوسط المركز ${Number(row.position || 0).toFixed(1)} وCTR ${(Number(row.ctr || 0) * 100).toFixed(1)}%.`
  });
}

const approved = stories
  .filter((story) => story?.status === 'approved')
  .sort((a,b) => +new Date(b.publishedAt || 0) - +new Date(a.publishedAt || 0))
  .slice(0, RECENT_STORIES);

for (const story of approved) {
  const section = story.section || 'general';
  const seeds = [story.focusKeyword, ...(story.entities || []), ...(story.tags || [])]
    .map(clean)
    .filter(useful)
    .filter((value, index, arr) => arr.findIndex((x) => normalize(x) === normalize(value)) === index)
    .slice(0, 10);

  for (const seed of seeds) {
    const base = Number(story.trafficScore || 0);
    const ageHours = Math.max(0, (Date.now() - +new Date(story.publishedAt || 0)) / 3_600_000);
    const freshness = ageHours <= 24 ? 18 : ageHours <= 72 ? 12 : ageHours <= 168 ? 6 : 0;
    const score = Math.min(82, 30 + Math.round(base * 0.35) + freshness);
    add(seed, { source:'editorial', section, score, page:`https://mulakhas.com/${story.section}/${story.slug}`, reason:'كيان أو عبارة تركيز موجودة في خبر معتمد.' });
    add(`أخبار ${seed}`, { source:'derived', section, score:Math.max(20, score - 4), reason:'صيغة بحث خبرية مشتقة من كيان فعلي في المحتوى.' });
    add(`آخر أخبار ${seed}`, { source:'derived', section, score:Math.max(20, score - 7), reason:'صيغة freshness طبيعية لكيان فعلي.' });
    add(`${seed} اليوم`, { source:'derived', section, score:Math.max(18, score - 9), reason:'صيغة بحث زمنية؛ استخدمها فقط عندما يكون المحتوى محدثًا فعلًا اليوم.' });
  }
}

const ranked = [...opportunities.values()]
  .map((item) => ({ ...item, totalScore: Math.min(100, Math.round(item.score * 0.72 + item.conversionFit * 0.28)) }))
  .sort((a,b) => b.totalScore - a.totalScore || b.impressions - a.impressions || b.score - a.score)
  .slice(0, MAX_OUTPUT);

const output = {
  generatedAt: new Date().toISOString(),
  strategy: 'gsc-first',
  warning: 'Google لا يستخدم meta keywords للترتيب. هذه فرص بحث داخلية للتخطيط والتحرير فقط، وليست قائمة كلمات تُحقن في الصفحات.',
  counts: {
    gsc: ranked.filter((x) => x.source === 'gsc').length,
    editorial: ranked.filter((x) => x.source === 'editorial').length,
    derived: ranked.filter((x) => x.source === 'derived').length,
    total: ranked.length
  },
  opportunities: ranked
};

await fs.writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(`[SEO] Search opportunities generated: ${ranked.length} (GSC ${output.counts.gsc}, editorial ${output.counts.editorial}, derived ${output.counts.derived}).`);
for (const item of ranked.slice(0, 12)) {
  console.log(`[SEO] ${item.totalScore}/100 conversion=${item.conversionFit} ${item.source} :: ${item.query}`);
}
