import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { omniRequest, configured } from './omniroute-client.mjs';
import { languageIssues } from './quality-gate.mjs';
import { factualIssues } from './fact-consistency.mjs';
import { enrichCandidate } from './source-enrichment.mjs';

const dryRun = process.argv.includes('--dry-run');
const maxStories = Number(process.env.NEWSROOM_MAX_ENTERTAINMENT_STORIES || 4);
const maxAgeHours = Number(process.env.ENTERTAINMENT_MAX_AGE_HOURS || 96);
const minTrafficScore = Number(process.env.ENTERTAINMENT_MIN_TRAFFIC_SCORE || 38);
const minScore = Number(process.env.AUTO_PUBLISH_MIN_SCORE || 88);
const minTrust = Number(process.env.AUTO_PUBLISH_MIN_TRUST || 88);
const minConfidence = Number(process.env.AUTO_PUBLISH_MIN_CONFIDENCE || 78);
const autoPublishEnabled = String(process.env.AUTO_PUBLISH_ENABLED || 'true') === 'true';

const sources = JSON.parse(await fs.readFile(new URL('../../src/data/entertainment-sources.json', import.meta.url), 'utf8'));
const storiesPath = new URL('../../src/data/stories.json', import.meta.url);
const stories = JSON.parse(await fs.readFile(storiesPath, 'utf8'));
const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, processEntities: true });

const clean = (value = '') => String(value).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
const hash = (value) => crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
const slugify = (text) => clean(text).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 90);
const safeDate = (value) => {
  const date = new Date(value || Date.now());
  return Number.isNaN(+date) ? new Date() : date;
};
const normalizeTitle = (text) => clean(text).toLowerCase().replace(/[ـً-ْ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const tokens = (text) => new Set(normalizeTitle(text).split(' ').filter((x) => x.length > 2));
const similarity = (a, b) => {
  const aa = tokens(a); const bb = tokens(b);
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const token of aa) if (bb.has(token)) common += 1;
  return common / Math.max(aa.size, bb.size);
};
const sourceText = (entry, fallback) => {
  const raw = entry?.source;
  if (typeof raw === 'string') return clean(raw) || fallback;
  return clean(raw?.['#text'] ?? raw?.name ?? '') || fallback;
};
const entryLink = (entry) => {
  if (typeof entry?.link === 'string') return entry.link;
  if (Array.isArray(entry?.link)) {
    const preferred = entry.link.find((x) => x?.['@_rel'] === 'alternate') ?? entry.link[0];
    return preferred?.['@_href'] ?? preferred?.['#text'] ?? '';
  }
  return entry?.link?.['@_href'] ?? entry?.guid?.['#text'] ?? entry?.guid ?? '';
};
const googleNewsUrl = (source) => {
  if (source.url) return source.url;
  const url = new URL('https://news.google.com/rss/search');
  url.searchParams.set('q', source.query);
  url.searchParams.set('hl', source.hl || 'en-US');
  url.searchParams.set('gl', source.gl || 'US');
  url.searchParams.set('ceid', source.ceid || 'US:en');
  return url.toString();
};

const TV_SIGNAL = /(?:\bseries\b|\bseason\b|\bepisode\b|\btelevision\b|\btv\b|renewed|cancelled|canceled|showrunner|limited\s+series|مسلسل|مسلسلات|موسم|حلقة|حلقات|تجديد|إلغاء|برنامج\s+تلفزيوني|دراما\s+تلفزيونية)/iu;
const MOVIE_SIGNAL = /(?:\bfilm\b|\bmovie\b|cinema|cinematic|theatrical|box\s+office|feature\s+film|فيلم|أفلام|سينما|سينمائي|شباك\s+التذاكر)/iu;
const STRONG_TV = /(?:season\s+\d+|episode\s+\d+|renewed|cancelled|canceled|premiere\s+date|موسم\s+\d+|الحلقة|تجديد|إلغاء)/iu;
const STRONG_MOVIE = /(?:box\s+office|theatrical|feature\s+film|movie\s+release|film\s+release|شباك\s+التذاكر|موعد\s+عرض\s+الفيلم|في\s+السينما)/iu;

function classifySection(text = '') {
  const tv = (TV_SIGNAL.test(text) ? 2 : 0) + (STRONG_TV.test(text) ? 2 : 0);
  const movies = (MOVIE_SIGNAL.test(text) ? 2 : 0) + (STRONG_MOVIE.test(text) ? 2 : 0);
  if (!tv && !movies) return null;
  if (tv === movies) return STRONG_MOVIE.test(text) ? 'movies' : 'tv';
  return tv > movies ? 'tv' : 'movies';
}

const PLATFORM_SIGNALS = [
  ['Netflix', /(?:netflix|نتفليكس)/iu, 11],
  ['Shahid', /(?:shahid|شاهد|mbc)/iu, 11],
  ['Disney+', /(?:disney\+|disney plus|ديزني\+)/iu, 9],
  ['OSN+', /(?:osn\+|osn plus|أو\s*إس\s*إن)/iu, 9],
  ['HBO/Max', /(?:\bhbo\b|\bmax\b)/iu, 8],
  ['Prime Video', /(?:prime video|amazon prime|برايم فيديو)/iu, 7]
];
const INTENT_SIGNALS = [
  ['موعد عرض', /(?:release\s+date|premiere\s+date|premieres?|debut|launches?|streaming\s+on|موعد\s+عرض|يعرض|يبدأ\s+عرض|قريب[ًاا]|ابتداءً\s+من)/iu, 15],
  ['موسم/حلقة', /(?:season\s+\d+|episode\s+\d+|new\s+season|موسم\s+\d+|حلقة\s+\d+|الموسم\s+الجديد|الحلقة\s+الجديدة)/iu, 12],
  ['تجديد/إلغاء', /(?:renewed|cancelled|canceled|renewal|تجديد|إلغاء|يلغى|أُلغي)/iu, 12],
  ['إعلان/تريلر', /(?:trailer|teaser|first\s+look|إعلان\s+رسمي|الإعلان\s+الأول|نظرة\s+أولى)/iu, 9],
  ['شباك التذاكر', /(?:box\s+office|opening\s+weekend|شباك\s+التذاكر|الإيرادات)/iu, 9],
  ['طاقم/إنتاج', /(?:cast|casting|production|filming|joins\s+cast|بطولة|طاقم|بدء\s+التصوير|الإنتاج)/iu, 6]
];
const CONVERSION_SIGNAL = /(?:movie|film|series|season|episode|streaming|premiere|فيلم|مسلسل|موسم|حلقة|عرض|نتفليكس|شاهد|OSN|Disney\+)/iu;

function freshnessPoints(pubDate, now) {
  const age = Math.max(0, (now - +new Date(pubDate || now)) / 3_600_000);
  if (age <= 2) return [24, 'fresh<2h'];
  if (age <= 6) return [19, 'fresh<6h'];
  if (age <= 12) return [14, 'fresh<12h'];
  if (age <= 24) return [10, 'fresh<24h'];
  if (age <= 48) return [6, 'fresh<48h'];
  return [3, 'fresh<96h'];
}

function scoreCandidate(item, now) {
  const text = `${item.title || ''} ${item.description || ''}`;
  let score = 12;
  const signals = [];
  const [fresh, freshLabel] = freshnessPoints(item.pubDate, now);
  score += fresh; signals.push(freshLabel);
  const sectionPoints = item.section === 'tv' ? 9 : 9;
  score += sectionPoints; signals.push(`section:${item.section}+${sectionPoints}`);

  const platforms = PLATFORM_SIGNALS.filter(([, regex]) => regex.test(text));
  const platformPoints = Math.min(18, platforms.slice(0, 2).reduce((sum, item) => sum + item[2], 0));
  score += platformPoints;
  if (platforms.length) signals.push(`platform:${platforms.slice(0, 2).map((x) => x[0]).join('+')}`);

  const intents = INTENT_SIGNALS.filter(([, regex]) => regex.test(text)).sort((a, b) => b[2] - a[2]);
  const intentPoints = Math.min(24, intents.slice(0, 2).reduce((sum, item) => sum + item[2], 0));
  score += intentPoints;
  if (intents.length) signals.push(`intent:${intents.slice(0, 2).map((x) => x[0]).join('+')}`);

  const sourcePoints = Math.max(0, Math.min(12, Math.round(((item.priority || 50) - 50) / 4)));
  score += sourcePoints;
  if ((item.trust || 0) >= 95) { score += 6; signals.push('official-source'); }
  else if ((item.trust || 0) >= 92) score += 4;
  else if ((item.trust || 0) >= 88) score += 2;

  if (/\p{Script=Arabic}/u.test(text)) { score += 4; signals.push('arabic-interest'); }
  if (CONVERSION_SIGNAL.test(text)) { score += 7; signals.push('lurvue-intent'); }

  return { ...item, trafficScore: Math.max(0, Math.min(100, Math.round(score))), trafficSignals: signals.slice(0, 9) };
}

function clusterAndBoost(items) {
  const clusters = [];
  for (const item of [...items].sort((a, b) => +new Date(b.pubDate) - +new Date(a.pubDate))) {
    let target = null;
    let best = 0;
    for (const cluster of clusters) {
      if (cluster.section !== item.section) continue;
      const s = similarity(item.title, cluster.seed.title);
      if (s >= 0.56 && s > best) { target = cluster; best = s; }
    }
    if (target) target.members.push(item);
    else clusters.push({ section: item.section, seed: item, members: [item] });
  }
  return clusters.map((cluster) => {
    const representative = [...cluster.members].sort((a, b) => {
      const ap = a.autoPublish && !a.discoveryOnly ? 1 : 0;
      const bp = b.autoPublish && !b.discoveryOnly ? 1 : 0;
      return (bp - ap) || ((b.trust || 0) - (a.trust || 0)) || ((b.priority || 0) - (a.priority || 0));
    })[0];
    if (!representative?.autoPublish || representative.discoveryOnly) return null;
    const coverage = new Set(cluster.members.map((x) => x.sourceId || x.sourceName || x.link)).size;
    const radar = cluster.members.filter((x) => x.discoveryOnly).length;
    const boost = Math.min(14, Math.max(0, coverage - 1) * 5 + Math.min(4, radar * 2));
    return {
      ...representative,
      trafficScore: Math.min(100, representative.trafficScore + boost),
      trafficSignals: [...representative.trafficSignals, ...(boost ? [`coverage:${coverage}/radar:${radar}`] : [])].slice(0, 9),
      sourceCoverage: coverage,
      radarCoverage: radar
    };
  }).filter(Boolean).sort((a, b) => b.trafficScore - a.trafficScore || +new Date(b.pubDate) - +new Date(a.pubDate));
}

function selectBalanced(ranked, limit) {
  const selected = [];
  for (const section of ['movies', 'tv']) {
    const first = ranked.find((item) => item.section === section && item.trafficScore >= minTrafficScore);
    if (first) selected.push(first);
  }
  for (const item of ranked) {
    if (selected.includes(item)) continue;
    const sameSection = selected.filter((x) => x.section === item.section).length;
    if (sameSection >= 2) continue;
    if (item.trafficScore < minTrafficScore && selected.length >= Math.min(2, limit)) continue;
    selected.push(item);
    if (selected.length >= limit) return selected;
  }
  return selected.slice(0, limit);
}

function jsonEnvelope(raw = '') {
  let text = String(raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const first = text.indexOf('{'); const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  return text;
}
function parseJson(raw = '') {
  const attempts = [
    jsonEnvelope(raw),
    jsonEnvelope(raw).replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  ];
  let last;
  for (const attempt of [...new Set(attempts)]) {
    try { return JSON.parse(attempt); } catch (error) { last = error; }
  }
  throw last || new Error('Invalid JSON');
}
function normalizeRewritten(data = {}) {
  const array = (value) => Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
  return {
    title: clean(data.title),
    seoTitle: clean(data.seoTitle),
    metaDescription: clean(data.metaDescription),
    focusKeyword: clean(data.focusKeyword),
    excerpt: clean(data.excerpt),
    keyPoints: array(data.keyPoints).slice(0, 4),
    body: array(data.body).slice(0, 8),
    tags: array(data.tags).slice(0, 6),
    entities: array(data.entities).slice(0, 6),
    imageAlt: clean(data.imageAlt),
    imageCaption: clean(data.imageCaption),
    imageSearchQuery: clean(data.imageSearchQuery),
    confidence: Math.max(0, Math.min(100, Number(data.confidence || 0))),
    importance: Math.max(0, Math.min(100, Number(data.importance || 0)))
  };
}

async function rewriteEntertainmentStory(item, qualityFeedback = '') {
  const sourceBlock = item.sourceContent
    ? `\n\nالمادة المستخرجة من صفحة الناشر الأصلية وهي المرجع الأساسي للحقائق:\n---\n${String(item.sourceContent).slice(0, 9000)}\n---`
    : '\n\nلم نتمكن من استخراج نص صفحة الناشر؛ لا تتوسع خارج العنوان والوصف المتاحين.';
  const feedback = qualityFeedback ? `\n\nهذه محاولة تصحيح. فشلت المحاولة السابقة للأسباب التالية: ${qualityFeedback}. أعد كل الحقول من الصفر ولا تكرر الخطأ.` : '';
  const prompt = `أنت محرر أخبار ترفيه عربي لمنصة "ملخص". اكتب خبرًا أصليًا عن ${item.section === 'movies' ? 'الأفلام' : 'المسلسلات'} اعتمادًا فقط على المصدر المرفق.\n\nقواعد إلزامية:\n- لا تخترع موعد عرض أو موسمًا أو منصة أو رقمًا أو تصريحًا.\n- إذا ذكر المصدر تاريخ عرض، اكتبه بوضوح وبنفس الدقة.\n- فرّق بين الإعلان الرسمي والتقرير أو الشائعة.\n- اكتب بالعربية الفصحى السهلة المناسبة للقارئ السعودي والعربي، مع إبقاء أسماء الأعمال والمنصات الأجنبية عند الحاجة.\n- لا تنسخ أكثر من 8 كلمات متتالية من المصدر.\n- العنوان 25-95 حرفًا ومباشر، ويفضل إبراز الموعد/الموسم/المنصة عندما تكون هي الخبر.\n- excerpt بين 80 و220 حرفًا.\n- 4 إلى 7 فقرات قصيرة، 180 إلى 420 كلمة عندما تسمح المادة المصدرية.\n- keyPoints من 2 إلى 4 نقاط مدعومة بالمصدر.\n- SEO: seoTitle عربي طبيعي بحد أقصى 60 حرفًا تقريبًا، metaDescription من 130 إلى 160 حرفًا، focusKeyword من 2 إلى 5 كلمات.\n- imageAlt عربي دقيق، imageCaption قصير، imageSearchQuery من 2 إلى 6 كلمات.\n- لا تضع إعلان لورفيو داخل المقال؛ الموقع يضيفه تلقائيًا.\n- أعد JSON صالحًا فقط بلا Markdown.\n\nالشكل المطلوب:\n{"title":"","seoTitle":"","metaDescription":"","focusKeyword":"","excerpt":"","keyPoints":[""],"body":[""],"tags":[""],"entities":[""],"imageAlt":"","imageCaption":"","imageSearchQuery":"","confidence":0,"importance":0}\n\nالقسم: ${item.section}\nالمصدر: ${item.sourceName}\nالعنوان الأصلي: ${item.title}\nالوصف: ${item.description || ''}\nالرابط: ${item.link}${sourceBlock}${feedback}`;

  let raw = await omniRequest(prompt);
  try { return normalizeRewritten(parseJson(raw)); }
  catch (error) {
    raw = await omniRequest(`${prompt}\n\nتنبيه تقني: المخرجات السابقة لم تكن JSON صالحًا. أعد الكائن كاملًا فقط بصيغة JSON سليمة.`);
    return normalizeRewritten(parseJson(raw));
  }
}

function qualityScore(rewritten, item) {
  const wordCount = rewritten.body.join(' ').split(/\s+/).filter(Boolean).length;
  let score = 36;
  if (wordCount >= 120) score += 8;
  if (wordCount >= 180) score += 8;
  if (rewritten.body.length >= 4) score += 7;
  if (rewritten.title.length >= 25 && rewritten.title.length <= 95) score += 7;
  if (rewritten.excerpt.length >= 80 && rewritten.excerpt.length <= 220) score += 7;
  if (rewritten.seoTitle.length >= 25 && rewritten.seoTitle.length <= 70) score += 5;
  if (rewritten.metaDescription.length >= 120 && rewritten.metaDescription.length <= 180) score += 6;
  if (rewritten.focusKeyword.length >= 4) score += 3;
  if (rewritten.imageAlt.length >= 35) score += 3;
  if (rewritten.imageSearchQuery.length >= 3) score += 2;
  if (rewritten.keyPoints.length >= 2) score += 5;
  if (rewritten.entities.length >= 2) score += 3;
  if (rewritten.confidence >= 80) score += 7;
  if (item.trust >= 92) score += 5;
  if (item.sourceContent?.length >= 600) score += 4;
  return Math.max(0, Math.min(100, Math.round(score)));
}

const existingLinks = new Set(stories.map((s) => s.sourceUrl).filter(Boolean));
const publishedTitles = stories.filter((s) => s.status === 'approved').map((s) => s.title);
const candidateLinks = new Set();
const candidates = [];
const now = Date.now();

for (const source of sources) {
  try {
    const response = await fetch(googleNewsUrl(source), {
      headers: {
        'user-agent': 'MolakhasEntertainment/1.0 (+https://molakhas.a7asmari.workers.dev)',
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.7'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = parser.parse(await response.text());
    const rawItems = xml?.rss?.channel?.item ?? xml?.feed?.entry ?? [];
    const list = Array.isArray(rawItems) ? rawItems : [rawItems];

    for (const entry of list.slice(0, Number(source.scanLimit || 18))) {
      const title = clean(entry?.title?.['#text'] ?? entry?.title ?? '');
      const link = clean(entryLink(entry));
      const description = clean(entry?.description ?? entry?.summary ?? entry?.content?.['#text'] ?? entry?.content ?? '').slice(0, 2400);
      const pubDate = safeDate(entry?.pubDate ?? entry?.published ?? entry?.updated ?? Date.now());
      const ageHours = (now - +pubDate) / 3_600_000;
      if (!title || !link || candidateLinks.has(link) || existingLinks.has(link) || ageHours > maxAgeHours || ageHours < -2) continue;
      if (publishedTitles.some((old) => similarity(title, old) >= 0.78)) continue;
      const section = classifySection(`${title} ${description}`);
      if (!section) continue;

      candidateLinks.add(link);
      candidates.push(scoreCandidate({
        title,
        link,
        description,
        pubDate: pubDate.toISOString(),
        section,
        sourceId: source.id,
        sourceName: sourceText(entry, source.name),
        trust: Number(source.trust || 50),
        priority: Number(source.priority || 50),
        autoPublish: Boolean(source.autoPublish),
        discoveryOnly: Boolean(source.discoveryOnly)
      }, now));
    }
  } catch (error) {
    console.error(`[Entertainment:${source.id}] ${error.message}`);
  }
}

const ranked = clusterAndBoost(candidates);
const selected = selectBalanced(ranked, maxStories);
console.log(`[Entertainment] Found ${candidates.length} fresh candidates; ranked ${ranked.length} publishable opportunities; selected ${selected.length}.`);
selected.forEach((item, index) => console.log(`[Entertainment] #${index + 1} ${item.trafficScore}/100 ${item.section} :: ${item.title} :: ${(item.trafficSignals || []).join(', ')}`));

if (dryRun) {
  console.table(selected.map((item) => ({ traffic: item.trafficScore, section: item.section, trust: item.trust, source: item.sourceName, title: item.title.slice(0, 72) })));
  process.exit(0);
}
if (!configured()) {
  console.log('[Entertainment] OmniRoute is not configured; no entertainment stories written.');
  process.exit(0);
}

let changed = false;
for (const rawItem of selected) {
  try {
    const item = await enrichCandidate(rawItem);
    if (item.sourceContent) console.log(`[Entertainment Source] Enriched (${item.enrichmentMethod}) ${item.title}: ${item.sourceContent.length} chars`);
    else console.warn(`[Entertainment Source] RSS-only ${item.title}`);

    const canFactCheck = Boolean((item.sourceContent?.length || 0) >= 350 || (item.description?.length || 0) >= 180);
    let rewritten = await rewriteEntertainmentStory(item);
    let language = languageIssues(rewritten);
    let facts = canFactCheck ? factualIssues(rewritten, item) : [];
    if (language.length || facts.length) {
      const notes = [...language, ...facts].join('; ');
      console.warn(`[Entertainment Quality] Retrying ${item.title}: ${notes}`);
      rewritten = await rewriteEntertainmentStory(item, notes);
      language = languageIssues(rewritten);
      facts = canFactCheck ? factualIssues(rewritten, item) : [];
    }

    const score = qualityScore(rewritten, item);
    const approved = autoPublishEnabled && !language.length && !facts.length && item.autoPublish && !item.discoveryOnly && item.trust >= minTrust && score >= minScore && rewritten.confidence >= minConfidence;
    const baseSlug = slugify(rewritten.title) || hash(item.link);
    const slug = stories.some((s) => s.slug === baseSlug) ? `${baseSlug}-${hash(item.link).slice(0, 6)}` : baseSlug;
    const storyRecord = {
      id: hash(item.link),
      slug,
      section: item.section,
      title: rewritten.title,
      seoTitle: rewritten.seoTitle,
      metaDescription: rewritten.metaDescription,
      focusKeyword: rewritten.focusKeyword,
      excerpt: rewritten.excerpt || rewritten.body[0]?.slice(0, 180) || '',
      keyPoints: rewritten.keyPoints,
      body: rewritten.body,
      sourceName: item.sourceName,
      sourceUrl: item.link,
      publisherUrl: item.publisherUrl || '',
      sourceId: item.sourceId,
      sourceEnrichment: item.enrichmentMethod || 'rss-only',
      factChecked: canFactCheck,
      trafficScore: rawItem.trafficScore || 0,
      trafficSignals: rawItem.trafficSignals || [],
      sourceCoverage: rawItem.sourceCoverage || 1,
      radarCoverage: rawItem.radarCoverage || 0,
      publishedAt: safeDate(item.pubDate).toISOString(),
      generatedAt: new Date().toISOString(),
      status: approved ? 'approved' : 'review',
      qualityScore: score,
      confidence: rewritten.confidence,
      importance: rewritten.importance,
      trust: item.trust,
      qualityFlags: [
        ...(language.length ? ['language-quality-failed'] : []),
        ...(facts.length ? ['factual-quality-failed'] : [])
      ],
      qualityNotes: language,
      factualNotes: facts,
      tags: rewritten.tags,
      entities: rewritten.entities,
      image: {
        src: `/news-images/${slug}.webp`,
        alt: rewritten.imageAlt,
        caption: rewritten.imageCaption,
        searchQuery: rewritten.imageSearchQuery,
        width: 1200,
        height: 675,
        type: 'image/webp'
      }
    };
    stories.push(storyRecord);
    existingLinks.add(item.link);
    publishedTitles.push(rewritten.title);
    changed = true;
    console.log(`${approved ? 'APPROVED' : 'REVIEW'} ENTERTAINMENT [Q${score}/C${rewritten.confidence}/T${rawItem.trafficScore || 0}]: ${rewritten.title}`);
    if (facts.length) console.warn(`[Entertainment Facts] ${rewritten.title}: ${facts.join('; ')}`);
  } catch (error) {
    console.error(`[Entertainment] Story failed: ${rawItem.title}: ${error.message}`);
  }
}

if (changed) {
  stories.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
  await fs.writeFile(storiesPath, `${JSON.stringify(stories.slice(0, 1500), null, 2)}\n`);
}
