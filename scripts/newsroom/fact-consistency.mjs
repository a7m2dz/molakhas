const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

const KNOWN_ENTITY_GROUPS = [
  ['الهلال', 'al hilal'], ['النصر', 'al nassr'], ['الاتحاد', 'al ittihad'], ['الأهلي', 'al ahli'],
  ['ريال مدريد', 'real madrid'], ['برشلونة', 'barcelona'], ['ليفربول', 'liverpool'], ['أرسنال', 'arsenal'],
  ['مانشستر سيتي', 'manchester city', 'man city'], ['مانشستر يونايتد', 'manchester united', 'man united', 'man utd'],
  ['تشيلسي', 'chelsea'], ['توتنهام', 'tottenham', 'spurs'], ['باريس سان جيرمان', 'paris saint germain', 'psg'],
  ['بايرن ميونخ', 'bayern munich', 'bayern münchen'], ['إنتر', 'inter milan', 'internazionale'], ['ميلان', 'ac milan'],
  ['يوفنتوس', 'juventus'], ['أتلتيكو مدريد', 'atletico madrid', 'atlético madrid'],
  ['دوري روشن', 'الدوري السعودي', 'saudi pro league', 'roshn saudi league'],
  ['الدوري الإنجليزي', 'premier league'], ['الدوري الإسباني', 'la liga', 'laliga'],
  ['دوري أبطال أوروبا', 'دوري الأبطال', 'champions league', 'ucl'],
  ['الدوري الأوروبي', 'europa league'], ['دوري المؤتمر', 'conference league'],
  ['دوري أبطال آسيا', 'afc champions league'], ['كأس العالم للأندية', 'club world cup'],
  ['nba', 'إن بي إيه'], ['ufc', 'يو اف سي', 'يو إف سي'], ['wwe', 'دبليو دبليو إي']
];

function normalizeDigits(value = '') {
  return [...String(value)].map((ch) => {
    const ai = ARABIC_DIGITS.indexOf(ch);
    if (ai >= 0) return String(ai);
    const pi = PERSIAN_DIGITS.indexOf(ch);
    if (pi >= 0) return String(pi);
    return ch;
  }).join('');
}

function normalize(value = '') {
  return normalizeDigits(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ـً-ْ]/g, '')
    .replace(/[^\p{L}\p{N}%+.-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceText(item = {}) {
  return normalize([
    item.title,
    item.description,
    item.sourceContent,
    item.sourceName
  ].filter(Boolean).join('\n'));
}

function rewrittenText(item = {}) {
  return normalize([
    item.title,
    item.seoTitle,
    item.metaDescription,
    item.excerpt,
    ...(Array.isArray(item.keyPoints) ? item.keyPoints : []),
    ...(Array.isArray(item.body) ? item.body : [])
  ].filter(Boolean).join('\n'));
}

function numericClaims(text = '') {
  const matches = String(text).match(/(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?%?(?![\p{L}\p{N}])/gu) || [];
  return [...new Set(matches.map((x) => x.replace(',', '.')))];
}

function supportedNumber(claim, source) {
  const escaped = claim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('%', '%?');
  const direct = new RegExp(`(^|[^0-9])${escaped}([^0-9]|$)`, 'u');
  if (direct.test(source)) return true;

  // Scores are often formatted with separators that change during rewriting.
  if (/^\d+$/.test(claim)) {
    const n = Number(claim);
    if (n <= 3 && new RegExp(`(?:^|[^0-9])${n}(?:[^0-9]|$)`, 'u').test(source)) return true;
  }
  return false;
}

function entityGroupFor(value = '') {
  const n = normalize(value);
  if (!n) return null;
  return KNOWN_ENTITY_GROUPS.find((group) => group.some((term) => {
    const t = normalize(term);
    return n === t || n.includes(t) || t.includes(n);
  })) || null;
}

export function factualIssues(rewritten = {}, sourceItem = {}) {
  const issues = [];
  const source = sourceText(sourceItem);
  const output = rewrittenText(rewritten);
  if (!source || !output) return issues;

  for (const claim of numericClaims(output)) {
    if (!supportedNumber(claim, source)) issues.push(`unsupported numeric claim: ${claim}`);
  }

  const entities = Array.isArray(rewritten.entities) ? rewritten.entities : [];
  for (const entity of entities.slice(0, 8)) {
    const group = entityGroupFor(entity);
    if (!group) continue;
    const supported = group.some((term) => source.includes(normalize(term)));
    if (!supported) issues.push(`unsupported known entity: ${entity}`);
  }

  // A final score/result claim should be present in source material if written as digits.
  const scoreClaims = output.match(/\b\d+\s*[-–:]\s*\d+\b/gu) || [];
  for (const score of scoreClaims) {
    const compact = score.replace(/[–:]/g, '-').replace(/\s+/g, '');
    const sourceCompact = source.replace(/[–:]/g, '-').replace(/\s+/g, '');
    if (!sourceCompact.includes(compact)) issues.push(`unsupported score claim: ${score}`);
  }

  return [...new Set(issues)].slice(0, 10);
}

export function isFactuallyConsistent(rewritten = {}, sourceItem = {}) {
  return factualIssues(rewritten, sourceItem).length === 0;
}
