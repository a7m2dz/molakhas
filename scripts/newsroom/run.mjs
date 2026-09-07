import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { configured, rewriteStory } from './omniroute-client.mjs';
import { languageIssues } from './quality-gate.mjs';
import { enrichCandidate } from './source-enrichment.mjs';
import { rankTrafficCandidates, selectTrafficCandidates } from './traffic-opportunity.mjs';
import { applySearchFeedback } from './search-feedback-boost.mjs';

const dryRun = process.argv.includes('--dry-run');
const maxStories = Number(process.env.NEWSROOM_MAX_STORIES || 8);
const maxAgeHours = Number(process.env.NEWSROOM_MAX_AGE_HOURS || 72);
const minTrafficScore = Number(process.env.NEWSROOM_MIN_TRAFFIC_SCORE || 35);
const minScore = Number(process.env.AUTO_PUBLISH_MIN_SCORE || 88);
const minTrust = Number(process.env.AUTO_PUBLISH_MIN_TRUST || 88);
const minConfidence = Number(process.env.AUTO_PUBLISH_MIN_CONFIDENCE || 78);
const autoPublishEnabled = String(process.env.AUTO_PUBLISH_ENABLED || 'true') === 'true';

const sources = JSON.parse(await fs.readFile(new URL('../../src/data/sources.json', import.meta.url), 'utf8'));
const storiesPath = new URL('../../src/data/stories.json', import.meta.url);
const stories = JSON.parse(await fs.readFile(storiesPath, 'utf8'));
const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, processEntities: true });

const clean = (value = '') => String(value).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
const hash = (value) => crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
const slugify = (text) => clean(text).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 90);
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

let auditedExisting = false;
for (const story of stories) {
  if (story.status !== 'approved') continue;
  const issues = languageIssues(story);
  if (!issues.length) continue;
  story.status = 'review';
  story.qualityFlags = [...new Set([...(story.qualityFlags || []), 'language-quality-failed'])];
  story.qualityNotes = issues;
  auditedExisting = true;
  console.warn(`[Audit] Unpublished corrupted story: ${story.title} :: ${issues.join('; ')}`);
}

const dedupeEligible = (story) => !(story.qualityFlags || []).includes('language-quality-failed');
const existingLinks = new Set(stories.filter(dedupeEligible).map((s) => s.sourceUrl).filter(Boolean));
const publishedTitles = stories.filter((s) => dedupeEligible(s) && s.status === 'approved').map((s) => s.title);
const candidates = [];
const candidateLinks = new Set();
const now = Date.now();

for (const source of sources.filter((item) => item.enabled)) {
  try {
    const response = await fetch(source.url, {
      headers: {
        'user-agent': 'MolakhasNewsroom/0.8 (+https://molakhas.a7asmari.workers.dev)',
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.7'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const xml = parser.parse(await response.text());
    const rawItems = xml?.rss?.channel?.item ?? xml?.feed?.entry ?? [];
    const list = Array.isArray(rawItems) ? rawItems : [rawItems];

    for (const entry of list.slice(0, Number(source.scanLimit || 20))) {
      const title = clean(entry?.title?.['#text'] ?? entry?.title ?? '');
      const link = clean(entryLink(entry));
      const pubDate = safeDate(entry?.pubDate ?? entry?.published ?? entry?.updated ?? Date.now());
      const ageHours = (now - +pubDate) / 3_600_000;
      if (!title || !link || candidateLinks.has(link) || existingLinks.has(link) || ageHours > maxAgeHours || ageHours < -2) continue;
      if (publishedTitles.some((old) => similarity(title, old) >= 0.78)) continue;

      candidateLinks.add(link);
      candidates.push({
        title,
        link,
        description: clean(entry?.description ?? entry?.summary ?? entry?.content?.['#text'] ?? entry?.content ?? '').slice(0, 2400),
        pubDate: pubDate.toISOString(),
        section: source.section,
        sourceId: source.id,
        sourceName: sourceText(entry, source.name),
        trust: Number(source.trust || 50),
        priority: Number(source.priority || 50),
        autoPublish: Boolean(source.autoPublish),
        discoveryOnly: Boolean(source.discoveryOnly)
      });
    }
  } catch (error) {
    console.error(`[${source.id}] ${error.message}`);
  }
}

const rankedCandidates = applySearchFeedback(rankTrafficCandidates(candidates, { now }));
const strongTraffic = rankedCandidates.filter((item) => item.trafficScore >= minTrafficScore);
const trafficPool = strongTraffic.length >= Math.min(3, maxStories) ? strongTraffic : rankedCandidates;
const selected = selectTrafficCandidates(trafficPool, maxStories);

console.log(`[Traffic] Found ${candidates.length} fresh raw candidates; ranked ${rankedCandidates.length} publishable opportunities; selected ${selected.length}.`);
selected.forEach((item, index) => {
  console.log(`[Traffic] #${index + 1} ${item.trafficScore}/100 ${item.section} :: ${item.title} :: ${(item.trafficSignals || []).join(', ')}`);
});

if (dryRun) {
  console.table(selected.map((x) => ({
    traffic: x.trafficScore,
    section: x.section,
    coverage: x.sourceCoverage,
    radar: x.radarCoverage,
    trust: x.trust,
    source: x.sourceName,
    title: x.title.slice(0, 70)
  })));
  process.exit(0);
}
if (!configured()) {
  if (auditedExisting) {
    stories.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
    await fs.writeFile(storiesPath, `${JSON.stringify(stories.slice(0, 1500), null, 2)}\n`);
  }
  console.log('OmniRoute is not configured; no new stories written.');
  process.exit(0);
}

function qualityScore(rewritten, item) {
  const wordCount = rewritten.body.join(' ').split(/\s+/).filter(Boolean).length;
  const paragraphCount = rewritten.body.length;
  let score = 36;
  if (wordCount >= 120) score += 8;
  if (wordCount >= 180) score += 8;
  if (paragraphCount >= 4) score += 7;
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

let changed = auditedExisting;
for (const rawItem of selected) {
  try {
    const item = await enrichCandidate(rawItem);
    if (item.sourceContent) console.log(`[Source] Enriched (${item.enrichmentMethod}) ${item.title}: ${item.sourceContent.length} chars`);
    else console.warn(`[Source] RSS-only ${item.title}`);

    let rewritten = await rewriteStory(item);
    let issues = languageIssues(rewritten);
    if (issues.length) {
      console.warn(`[Quality] Retrying ${item.title}: ${issues.join('; ')}`);
      rewritten = await rewriteStory(item, issues.join('; '));
      issues = languageIssues(rewritten);
    }

    const score = qualityScore(rewritten, item);
    const languageClean = issues.length === 0;
    const approved = autoPublishEnabled && languageClean && !item.discoveryOnly && item.autoPublish && item.trust >= minTrust && score >= minScore && rewritten.confidence >= minConfidence;
    const baseSlug = slugify(rewritten.title) || hash(item.link);
    const corruptIndex = stories.findIndex((s) => s.sourceUrl === item.link && (s.qualityFlags || []).includes('language-quality-failed'));
    const slugConflict = stories.some((s, index) => s.slug === baseSlug && index !== corruptIndex);
    const slug = slugConflict ? `${baseSlug}-${hash(item.link).slice(0, 6)}` : baseSlug;

    const storyRecord = {
      id: hash(item.link),
      slug,
      section: item.section,
      title: rewritten.title,
      seoTitle: rewritten.seoTitle,
      metaDescription: rewritten.metaDescription,
      focusKeyword: rewritten.focusKeyword,
      excerpt: rewritten.excerpt || rewritten.body[0].slice(0, 180),
      keyPoints: rewritten.keyPoints,
      body: rewritten.body.slice(0, 8),
      sourceName: item.sourceName,
      sourceUrl: item.link,
      publisherUrl: item.publisherUrl || '',
      sourceId: item.sourceId,
      sourceEnrichment: item.enrichmentMethod || 'rss-only',
      trafficScore: rawItem.trafficScore || 0,
      trafficSignals: rawItem.trafficSignals || [],
      searchFeedback: rawItem.searchFeedback || undefined,
      sourceCoverage: rawItem.sourceCoverage || 1,
      radarCoverage: rawItem.radarCoverage || 0,
      publishedAt: safeDate(item.pubDate).toISOString(),
      generatedAt: new Date().toISOString(),
      status: approved ? 'approved' : 'review',
      qualityScore: score,
      confidence: rewritten.confidence,
      importance: rewritten.importance,
      trust: item.trust,
      qualityFlags: languageClean ? [] : ['language-quality-failed'],
      qualityNotes: issues,
      tags: rewritten.tags.slice(0, 6),
      entities: rewritten.entities.slice(0, 6),
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

    if (corruptIndex >= 0) stories[corruptIndex] = storyRecord;
    else stories.push(storyRecord);

    existingLinks.add(item.link);
    publishedTitles.push(rewritten.title);
    changed = true;
    console.log(`${approved ? 'APPROVED' : 'REVIEW'} [Q${score}/C${rewritten.confidence}/T${rawItem.trafficScore || 0}]${languageClean ? '' : ' [LANGUAGE BLOCKED]'}: ${rewritten.title}`);
  } catch (error) {
    console.error(`Story failed: ${rawItem.title}: ${error.message}`);
  }
}

if (changed) {
  stories.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
  await fs.writeFile(storiesPath, `${JSON.stringify(stories.slice(0, 1500), null, 2)}\n`);
}
