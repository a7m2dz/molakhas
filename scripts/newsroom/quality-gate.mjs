const HAN_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;
const REPLACEMENT_RE = /\uFFFD/u;
const CODE_RE = /(?:\.AppendFormat\b|\b(?:function|const|let|var)\s+[A-Za-z_$]|<\/?[A-Za-z][^>]*>|\{\s*"?[A-Za-z_$][\w$]*"?\s*:)/u;
const GENERIC_ENGLISH_RE = /\b(?:trademark|updates?|accessible|availability|available|partnership|website|article|content|source|report|highlights|officially|worldwide|globally)\b/giu;

function letters(text = '') {
  return [...String(text)].filter((ch) => /\p{L}/u.test(ch));
}

export function arabicRatio(text = '') {
  const all = letters(text);
  if (!all.length) return 0;
  const arabic = all.filter((ch) => /\p{Script=Arabic}/u.test(ch)).length;
  return arabic / all.length;
}

function mixedScriptTokens(text = '') {
  return String(text)
    .split(/[\s،,.;:!?()\[\]{}"'«»/\\|]+/u)
    .filter(Boolean)
    .filter((token) => /\p{Script=Arabic}/u.test(token) && /[A-Za-z]/u.test(token));
}

function foreignScriptLetters(text = '') {
  return [...String(text)]
    .filter((ch) => /\p{L}/u.test(ch))
    .filter((ch) => !/\p{Script=Arabic}/u.test(ch) && !/\p{Script=Latin}/u.test(ch));
}

function suspiciousEnglishWords(text = '') {
  return [...String(text).matchAll(GENERIC_ENGLISH_RE)].map((match) => match[0]);
}

function collectText(item = {}) {
  return [
    item.title,
    item.seoTitle,
    item.metaDescription,
    item.excerpt,
    ...(Array.isArray(item.keyPoints) ? item.keyPoints : []),
    ...(Array.isArray(item.body) ? item.body : []),
    item.imageAlt || item.image?.alt,
    item.imageCaption || item.image?.caption
  ].filter(Boolean).join('\n');
}

export function languageIssues(item = {}) {
  const issues = [];
  const all = collectText(item);

  if (HAN_RE.test(all)) issues.push('contains CJK/Han characters');
  if (REPLACEMENT_RE.test(all)) issues.push('contains Unicode replacement characters');
  if (CODE_RE.test(all)) issues.push('contains code/template fragments');

  const foreign = foreignScriptLetters(all);
  if (foreign.length) issues.push(`contains unsupported foreign-script letters: ${[...new Set(foreign)].slice(0, 6).join('')}`);

  const mixed = mixedScriptTokens(all);
  if (mixed.length) issues.push(`contains mixed-script tokens: ${mixed.slice(0, 4).join(', ')}`);

  const genericEnglish = suspiciousEnglishWords(all);
  if (genericEnglish.length) issues.push(`contains stray generic English words: ${[...new Set(genericEnglish)].slice(0, 6).join(', ')}`);

  const checks = [
    ['title', item.title, 0.45],
    ['seoTitle', item.seoTitle || item.title, 0.35],
    ['metaDescription', item.metaDescription || item.excerpt, 0.5],
    ['excerpt', item.excerpt, 0.5],
    ['body', Array.isArray(item.body) ? item.body.join(' ') : '', 0.5]
  ];

  for (const [name, value, minimum] of checks) {
    if (!value) continue;
    const ratio = arabicRatio(value);
    if (ratio < minimum) issues.push(`${name} Arabic ratio ${ratio.toFixed(2)} < ${minimum}`);
  }

  return [...new Set(issues)];
}

export function isLanguageClean(item = {}) {
  return languageIssues(item).length === 0;
}
