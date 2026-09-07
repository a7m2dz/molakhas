import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { configured, rewriteStory } from './omniroute-client.mjs';

const dryRun = process.argv.includes('--dry-run');
const maxStories = Number(process.env.NEWSROOM_MAX_STORIES || 8);
const maxAgeHours = Number(process.env.NEWSROOM_MAX_AGE_HOURS || 72);
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

const existingLinks = new Set(stories.map((s) => s.sourceUrl).filter(Boolean));
const existingTitles = stories.map((s) => s.title);
const candidates = [];
const now = Date.now();

for (const source of sources.filter((item) => item.enabled)) {
  try {
    const response = await fetch(source.url, {
      headers: {
        'user-agent': 'MolakhasNewsroom/0.4 (+https://molakhas.a7asmari.workers.dev)',
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
      if (!title || !link || existingLinks.has(link) || ageHours > maxAgeHours || ageHours < -2) continue;
      if (existingTitles.some((old) => similarity(title, old) >= 0.78)) continue;
      if (candidates.some((old) => similarity(title, old.title) >= 0.72)) continue;

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

candidates.sort((a, b) => (b.priority - a.priority) || (+new Date(b.pubDate) - +new Date(a.pubDate)));

function selectDiverse(items, limit) {
  const selected = [];
  const perSection = new Map();
  const maxPerSection = Math.max(2, Math.ceil(limit / 3));
  for (const item of items) {
    const count = perSection.get(item.section) || 0;
    if (count >= maxPerSection) continue;
    selected.push(item);
    perSection.set(item.section, count + 1);
    if (selected.length >= limit) break;
  }
  if (selected.length < limit) {
    for (const item of items) {
      if (selected.includes(item)) continue;
      selected.push(item);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

const selected = selectDiverse(candidates, maxStories);
console.log(`Found ${candidates.length} fresh candidates; selected ${selected.length}.`);
if (dryRun) {
  console.table(selected.map((x) => ({ section: x.section, trust: x.trust, source: x.sourceName, title: x.title.slice(0, 70) })));
  process.exit(0);
}
if (!configured()) {
  console.log('OmniRoute is not configured; no stories written.');
  process.exit(0);
}

function qualityScore(rewritten, item) {
  const wordCount = rewritten.body.join(' ').split(/\s+/).filter(Boolean).length;
  const paragraphCount = rewritten.body.length;
  let score = 35;
  if (wordCount >= 120) score += 10;
  if (wordCount >= 180) score += 8;
  if (paragraphCount >= 4) score += 8;
  if (rewritten.title.length >= 25 && rewritten.title.length <= 95) score += 7;
  if (rewritten.excerpt.length >= 80 && rewritten.excerpt.length <= 220) score += 7;
  if (rewritten.seoTitle.length >= 25 && rewritten.seoTitle.length <= 70) score += 5;
  if (rewritten.metaDescription.length >= 120 && rewritten.metaDescription.length <= 180) score += 5;
  if (rewritten.imageAlt.length >= 35 && rewritten.imageAlt.length <= 150) score += 5;
  if (rewritten.focusKeyword.length >= 4) score += 3;
  if (rewritten.confidence >= 80) score += 5;
  if (item.trust >= 92) score += 2;
  return Math.max(0, Math.min(100, Math.round(score)));
}

let changed = false;
for (const item of selected) {
  try {
    const rewritten = await rewriteStory(item);
    const score = qualityScore(rewritten, item);
    const approved = autoPublishEnabled && !item.discoveryOnly && item.autoPublish && item.trust >= minTrust && score >= minScore && rewritten.confidence >= minConfidence;
    const baseSlug = slugify(rewritten.title) || hash(item.link);
    const slug = stories.some((s) => s.slug === baseSlug) ? `${baseSlug}-${hash(item.link).slice(0, 6)}` : baseSlug;

    stories.push({
      id: hash(item.link),
      slug,
      section: item.section,
      title: rewritten.title,
      seoTitle: rewritten.seoTitle || rewritten.title,
      metaDescription: rewritten.metaDescription || rewritten.excerpt,
      focusKeyword: rewritten.focusKeyword,
      excerpt: rewritten.excerpt || rewritten.body[0].slice(0, 180),
      body: rewritten.body.slice(0, 8),
      image: {
        src: `/news-images/${slug}.webp`,
        alt: rewritten.imageAlt || rewritten.title,
        caption: rewritten.imageCaption || rewritten.excerpt,
        width: 1200,
        height: 675,
        type: 'image/webp'
      },
      sourceName: item.sourceName,
      sourceUrl: item.link,
      sourceId: item.sourceId,
      publishedAt: safeDate(item.pubDate).toISOString(),
      generatedAt: new Date().toISOString(),
      status: approved ? 'approved' : 'review',
      qualityScore: score,
      confidence: rewritten.confidence,
      importance: rewritten.importance,
      trust: item.trust,
      tags: rewritten.tags.slice(0, 8)
    });
    existingLinks.add(item.link);
    existingTitles.push(rewritten.title);
    changed = true;
    console.log(`${approved ? 'APPROVED' : 'REVIEW'} [${score}/${rewritten.confidence}]: ${rewritten.title}`);
  } catch (error) {
    console.error(`Story failed: ${item.title}: ${error.message}`);
  }
}

if (changed) {
  stories.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
  await fs.writeFile(storiesPath, `${JSON.stringify(stories.slice(0, 1500), null, 2)}\n`);
}
