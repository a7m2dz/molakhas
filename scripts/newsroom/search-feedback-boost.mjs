import fs from 'node:fs';

const FEEDBACK_PATH = new URL('../../src/data/search-feedback.json', import.meta.url);
const STOPWORDS = new Set([
  'في','من','على','الى','إلى','عن','مع','ضد','بعد','قبل','اليوم','مباراة','مباريات','اخبار','أخبار','نتيجة','نتائج','موعد','مواعيد','الدوري','كأس','the','and','for','with','vs','match','matches','news','today','result','results'
]);

function normalize(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ـً-ْ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value = '') {
  return new Set(normalize(value).split(' ').filter((token) => token.length > 2 && !STOPWORDS.has(token)));
}

function similarity(query, candidateText) {
  const q = tokens(query);
  const c = tokens(candidateText);
  if (!q.size || !c.size) return 0;
  let common = 0;
  for (const token of q) if (c.has(token)) common += 1;
  return common / q.size;
}

export function readSearchFeedback() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FEEDBACK_PATH, 'utf8'));
    if (!Array.isArray(parsed?.rows)) return [];
    return parsed.rows
      .filter((row) => row?.query && Number(row?.impressions || 0) > 0)
      .sort((a, b) => Number(b.opportunityScore || 0) - Number(a.opportunityScore || 0))
      .slice(0, 400);
  } catch {
    return [];
  }
}

export function applySearchFeedback(rankedCandidates) {
  const feedback = readSearchFeedback();
  if (!feedback.length) return rankedCandidates;

  return rankedCandidates
    .map((item) => {
      const text = `${item.title || ''} ${item.description || ''} ${(item.trafficSignals || []).join(' ')}`;
      let best = null;
      for (const row of feedback) {
        const sim = similarity(row.query, text);
        if (sim < 0.55) continue;
        const base = Number(row.opportunityScore || 0);
        const boost = Math.max(2, Math.min(18, Math.round((base / 100) * 18 * Math.min(1, sim + 0.15))));
        if (!best || boost > best.boost || (boost === best.boost && Number(row.impressions || 0) > Number(best.row.impressions || 0))) {
          best = { row, boost, sim };
        }
      }
      if (!best) return item;
      const queryLabel = String(best.row.query).slice(0, 42);
      return {
        ...item,
        trafficScore: Math.min(100, Number(item.trafficScore || 0) + best.boost),
        trafficSignals: [...(item.trafficSignals || []), `gsc:${queryLabel}+${best.boost}`].slice(0, 10),
        searchFeedback: {
          query: best.row.query,
          page: best.row.page,
          impressions: best.row.impressions,
          clicks: best.row.clicks,
          ctr: best.row.ctr,
          position: best.row.position,
          opportunityScore: best.row.opportunityScore,
          boost: best.boost
        }
      };
    })
    .sort((a, b) => (Number(b.trafficScore || 0) - Number(a.trafficScore || 0))
      || (Number(b.priority || 0) - Number(a.priority || 0))
      || (+new Date(b.pubDate || 0) - +new Date(a.pubDate || 0)));
}
