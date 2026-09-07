import fs from 'node:fs';

const SECTION_WEIGHT = {
  saudi: 11,
  transfers: 9,
  football: 8,
  basketball: 8,
  ufc: 7,
  sports: 6,
  wwe: 5,
  boxing: 5
};

const ENTITY_SIGNALS = [
  ['دوري روشن', /(?:دوري\s+روشن|saudi\s+pro\s+league|roshn\s+saudi\s+league)/iu, 10],
  ['الهلال', /(?:الهلال|al[-\s]?hilal)/iu, 12],
  ['النصر', /(?:النصر|al[-\s]?nassr)/iu, 12],
  ['الاتحاد', /(?:الاتحاد|al[-\s]?ittihad)/iu, 10],
  ['الأهلي', /(?:الأهلي|al[-\s]?ahli)/iu, 10],
  ['المنتخب السعودي', /(?:المنتخب\s+السعودي|saudi\s+(?:arabia|national\s+team))/iu, 9],
  ['ريال مدريد', /(?:ريال\s+مدريد|real\s+madrid)/iu, 11],
  ['برشلونة', /(?:برشلونة|barcelona)/iu, 11],
  ['ليفربول', /(?:ليفربول|liverpool)/iu, 11],
  ['أرسنال', /(?:أرسنال|arsenal)/iu, 10],
  ['مانشستر سيتي', /(?:مانشستر\s+سيتي|manchester\s+city|man\s+city)/iu, 10],
  ['مانشستر يونايتد', /(?:مانشستر\s+يونايتد|manchester\s+united|man\s+united)/iu, 10],
  ['تشيلسي', /(?:تشيلسي|chelsea)/iu, 9],
  ['باريس سان جيرمان', /(?:باريس\s+سان\s+جيرمان|paris\s+saint[-\s]?germain|psg)/iu, 8],
  ['بايرن ميونخ', /(?:بايرن\s+ميونخ|bayern\s+munich)/iu, 8],
  ['دوري الأبطال', /(?:دوري\s+أبطال\s+أوروبا|champions\s+league|ucl)/iu, 11],
  ['الدوري الإنجليزي', /(?:الدوري\s+الإنجليزي|premier\s+league)/iu, 10],
  ['الدوري الإسباني', /(?:الدوري\s+الإسباني|la\s*liga|laliga)/iu, 8],
  ['NBA', /(?:\bNBA\b|إن\s*بي\s*إيه|الدوري\s+الأمريكي\s+للسلة)/iu, 10],
  ['ليكرز', /(?:lakers|ليكرز)/iu, 10],
  ['سيلتكس', /(?:celtics|سيلتكس)/iu, 9],
  ['ووريورز', /(?:warriors|ووريورز)/iu, 9],
  ['UFC', /(?:\bUFC\b|يو\s*إف\s*سي)/iu, 8],
  ['WWE', /(?:\bWWE\b|دبليو\s+دبليو\s+إي)/iu, 7],
  ['كراون جول', /(?:كراون\s+جول|crown\s+jewel)/iu, 9]
];

const INTENT_SIGNALS = [
  ['انتقال', /(?:انتقال|صفقة|تعاقد|ينضم|يرحل|transfer|signing|signs|joins|move|trade)/iu, 12],
  ['نتيجة', /(?:نتيجة|يفوز|يهزم|تعادل|خسارة|فوز|win|wins|beats|defeats|draw|result|score)/iu, 10],
  ['هدف', /(?:هدف|يسجل|هاتريك|goal|scores?|hat[-\s]?trick)/iu, 10],
  ['مباراة', /(?:مباراة|مواجهة|ديربي|قمة|match|fixture|clash|derby|game|matchup)/iu, 9],
  ['تشكيلة', /(?:تشكيلة|التشكيل|lineup|starting\s+xi|starting\s+five)/iu, 10],
  ['إصابة', /(?:إصابة|مصاب|يغيب|injury|injured|ruled\s+out)/iu, 8],
  ['إيقاف', /(?:إيقاف|عقوبة|ban|suspension|suspended)/iu, 7],
  ['رسمي', /(?:رسمي(?:اً|ا)?|يعلن|أعلن|official|officially|confirmed)/iu, 6],
  ['موعد', /(?:موعد|متى|القنوات|الناقل|schedule|when|kick[-\s]?off|tip[-\s]?off|time|watch)/iu, 8],
  ['نهائي', /(?:نهائي|final|finals|title\s+fight|championship)/iu, 8]
];

const CONVERSION_SIGNAL = /(?:مباراة|مواجهة|دوري|بطولة|نهائي|نزال|عرض|match|fixture|game|league|championship|fight|card|NBA|UFC|WWE)/iu;
const LOW_VALUE_SIGNAL = /(?:ورشة|اجتماع|مجلس\s+الإدارة|تحت\s+(?:14|15)|معسكر\s+تدريبي|شراكة\s+إدارية|workshop|board\s+meeting|under[-\s]?(?:14|15)|training\s+camp)/iu;
const FOTMOB_SNAPSHOT = new URL('../../src/data/fotmob-radar.json', import.meta.url);

function readFotMobRadar(now) {
  try {
    const list = JSON.parse(fs.readFileSync(FOTMOB_SNAPSHOT, 'utf8'));
    if (!Array.isArray(list)) return [];
    return list.filter((item) => {
      if (!item?.fotmobSignal || !item?.title || !item?.section) return false;
      const time = +new Date(item.pubDate || now);
      if (!Number.isFinite(time)) return false;
      const ageHours = (now - time) / 3_600_000;
      return ageHours <= 30 && ageHours >= -2;
    });
  } catch {
    return [];
  }
}

export function normalizeTrafficText(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ـً-ْ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleTokens(value = '') {
  return new Set(normalizeTrafficText(value).split(' ').filter((token) => token.length > 2));
}

export function trafficSimilarity(a, b) {
  const aa = titleTokens(a);
  const bb = titleTokens(b);
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const token of aa) if (bb.has(token)) common += 1;
  return common / Math.max(aa.size, bb.size);
}

function freshnessPoints(pubDate, now) {
  const age = Math.max(0, (now - +new Date(pubDate || now)) / 3_600_000);
  if (age <= 2) return [24, 'fresh<2h'];
  if (age <= 6) return [19, 'fresh<6h'];
  if (age <= 12) return [14, 'fresh<12h'];
  if (age <= 24) return [9, 'fresh<24h'];
  if (age <= 48) return [5, 'fresh<48h'];
  return [2, 'fresh<72h'];
}

function entityMomentum(rawCandidates) {
  const map = new Map();
  for (const [label, regex] of ENTITY_SIGNALS) {
    const sources = new Set();
    for (const item of rawCandidates) {
      const text = `${item.title || ''} ${item.description || ''}`;
      if (regex.test(text)) sources.add(item.sourceId || item.sourceName || item.link);
    }
    map.set(label, sources.size);
  }
  return map;
}

function chooseRepresentative(members) {
  return [...members].sort((a, b) => {
    const aPublish = a.autoPublish && !a.discoveryOnly ? 1 : 0;
    const bPublish = b.autoPublish && !b.discoveryOnly ? 1 : 0;
    return (bPublish - aPublish)
      || ((b.trust || 0) - (a.trust || 0))
      || ((b.priority || 0) - (a.priority || 0))
      || (+new Date(b.pubDate || 0) - +new Date(a.pubDate || 0));
  })[0];
}

function clusterCandidates(items) {
  const clusters = [];
  const ordered = [...items].sort((a, b) => +new Date(b.pubDate || 0) - +new Date(a.pubDate || 0));
  for (const item of ordered) {
    let target = null;
    let best = 0;
    for (const cluster of clusters) {
      if (cluster.section !== item.section) continue;
      const score = trafficSimilarity(item.title, cluster.seed.title);
      if (score >= 0.56 && score > best) {
        target = cluster;
        best = score;
      }
    }
    if (target) target.members.push(item);
    else clusters.push({ section: item.section, seed: item, members: [item] });
  }
  return clusters;
}

function scoreCandidate(item, context) {
  const text = `${item.title || ''} ${item.description || ''}`;
  const signals = [];
  let score = 8;

  const [freshPoints, freshLabel] = freshnessPoints(item.pubDate, context.now);
  score += freshPoints;
  signals.push(freshLabel);

  const section = SECTION_WEIGHT[item.section] || 3;
  score += section;
  signals.push(`section:${item.section}+${section}`);

  const entityHits = [];
  for (const [label, regex, weight] of ENTITY_SIGNALS) {
    if (!regex.test(text)) continue;
    entityHits.push({ label, weight });
  }
  entityHits.sort((a, b) => b.weight - a.weight);
  const entityPoints = Math.min(24, entityHits.slice(0, 3).reduce((sum, hit) => sum + hit.weight, 0));
  score += entityPoints;
  if (entityHits.length) signals.push(`entity:${entityHits.slice(0, 3).map((x) => x.label).join('+')}`);

  const intentHits = [];
  for (const [label, regex, weight] of INTENT_SIGNALS) {
    if (regex.test(text)) intentHits.push({ label, weight });
  }
  intentHits.sort((a, b) => b.weight - a.weight);
  const intentPoints = Math.min(20, intentHits.slice(0, 3).reduce((sum, hit) => sum + hit.weight, 0));
  score += intentPoints;
  if (intentHits.length) signals.push(`intent:${intentHits.slice(0, 3).map((x) => x.label).join('+')}`);

  let momentumPoints = 0;
  const momentumLabels = [];
  for (const hit of entityHits) {
    const count = context.momentum.get(hit.label) || 0;
    if (count < 2) continue;
    momentumPoints += Math.min(6, (count - 1) * 2);
    momentumLabels.push(`${hit.label}×${count}`);
  }
  momentumPoints = Math.min(14, momentumPoints);
  score += momentumPoints;
  if (momentumLabels.length) signals.push(`momentum:${momentumLabels.slice(0, 2).join('+')}`);

  const coveragePoints = Math.min(14, Math.max(0, (context.sourceCoverage - 1) * 5) + Math.min(4, context.radarCoverage * 2));
  score += coveragePoints;
  if (context.sourceCoverage > 1 || context.radarCoverage > 0) signals.push(`coverage:${context.sourceCoverage}/radar:${context.radarCoverage}`);

  if (context.fotmobCoverage > 0) {
    const fotmobPoints = Math.min(12, 5 + (context.fotmobCoverage - 1) * 3);
    score += fotmobPoints;
    signals.push(`fotmob:${context.fotmobCoverage}+${fotmobPoints}`);
  }

  const sourcePoints = Math.max(0, Math.min(10, Math.round(((item.priority || 50) - 50) / 5)));
  score += sourcePoints;
  if ((item.trust || 0) >= 92) score += 5;

  if (CONVERSION_SIGNAL.test(text)) {
    score += 7;
    signals.push('lurvue-intent');
  }

  if (LOW_VALUE_SIGNAL.test(text)) {
    score -= 10;
    signals.push('low-demand-penalty');
  }

  return {
    trafficScore: Math.max(0, Math.min(100, Math.round(score))),
    trafficSignals: signals.slice(0, 9)
  };
}

export function rankTrafficCandidates(rawCandidates, { now = Date.now() } = {}) {
  const fotmobRadar = readFotMobRadar(now);
  const allCandidates = [...rawCandidates, ...fotmobRadar];
  const momentum = entityMomentum(allCandidates);
  const ranked = [];

  for (const cluster of clusterCandidates(allCandidates)) {
    const representative = chooseRepresentative(cluster.members);
    if (!representative?.autoPublish || representative.discoveryOnly) continue;

    const sourceCoverage = new Set(cluster.members.map((item) => item.sourceId || item.sourceName || item.link)).size;
    const radarCoverage = cluster.members.filter((item) => item.discoveryOnly).length;
    const fotmobCoverage = cluster.members.filter((item) => item.fotmobSignal || String(item.sourceId || '').startsWith('fotmob-')).length;
    const scored = scoreCandidate(representative, { now, momentum, sourceCoverage, radarCoverage, fotmobCoverage });
    ranked.push({
      ...representative,
      ...scored,
      sourceCoverage,
      radarCoverage,
      fotmobCoverage,
      clusterSize: cluster.members.length
    });
  }

  return ranked.sort((a, b) => (b.trafficScore - a.trafficScore)
    || ((b.priority || 0) - (a.priority || 0))
    || (+new Date(b.pubDate || 0) - +new Date(a.pubDate || 0)));
}

export function selectTrafficCandidates(ranked, limit) {
  const selected = [];
  const perSection = new Map();
  const preferredCaps = { football: 3, saudi: 3, transfers: 2, basketball: 2, sports: 2, ufc: 2, wwe: 2, boxing: 2 };

  for (const item of ranked) {
    const count = perSection.get(item.section) || 0;
    if (count >= (preferredCaps[item.section] || 2)) continue;
    selected.push(item);
    perSection.set(item.section, count + 1);
    if (selected.length >= limit) return selected;
  }

  for (const item of ranked) {
    if (selected.includes(item)) continue;
    selected.push(item);
    if (selected.length >= limit) break;
  }
  return selected;
}
