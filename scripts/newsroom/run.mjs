import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { configured, rewriteStory } from './fcc-client.mjs';

const dryRun = process.argv.includes('--dry-run');
const maxStories = Number(process.env.NEWSROOM_MAX_STORIES || 8);
const minScore = Number(process.env.AUTO_PUBLISH_MIN_SCORE || 90);
const minTrust = Number(process.env.AUTO_PUBLISH_MIN_TRUST || 85);
const autoPublishEnabled = String(process.env.AUTO_PUBLISH_ENABLED || 'true') === 'true';
const sources = JSON.parse(await fs.readFile(new URL('../../src/data/sources.json', import.meta.url), 'utf8'));
const storiesPath = new URL('../../src/data/stories.json', import.meta.url);
const stories = JSON.parse(await fs.readFile(storiesPath, 'utf8'));
const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

const clean = (v='') => String(v).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const slugify = (text) => clean(text).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').slice(0,85);
const hash = (v) => crypto.createHash('sha1').update(v).digest('hex').slice(0,10);
const existingLinks = new Set(stories.map(s=>s.sourceUrl));
const existingTitles = new Set(stories.map(s=>clean(s.title).toLowerCase()));
const candidates = [];

for (const source of sources.filter(s=>s.enabled)) {
  try {
    const response = await fetch(source.url, { headers: { 'user-agent':'MolakhasNewsroom/0.2 (+https://molakhas.com)' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = parser.parse(await response.text());
    const rawItems = xml?.rss?.channel?.item ?? xml?.feed?.entry ?? [];
    const list = Array.isArray(rawItems) ? rawItems : [rawItems];
    for (const entry of list.slice(0,12)) {
      const title = clean(entry.title?.['#text'] ?? entry.title ?? '');
      const link = typeof entry.link === 'string' ? entry.link : (entry.link?.['@_href'] ?? entry.link ?? entry.guid ?? '');
      if (!title || !link || existingLinks.has(link) || existingTitles.has(title.toLowerCase())) continue;
      candidates.push({ title, link, description: clean(entry.description ?? entry.summary ?? entry.content ?? '').slice(0,1800), pubDate: entry.pubDate ?? entry.published ?? entry.updated ?? new Date().toISOString(), section: source.section, sourceName: source.name, trust: source.trust, autoPublish: source.autoPublish });
    }
  } catch (error) { console.error(`[${source.id}]`, error.message); }
}

candidates.sort((a,b)=>+new Date(b.pubDate)-+new Date(a.pubDate));
const selected = candidates.slice(0,maxStories);
console.log(`Found ${candidates.length} new candidates; selected ${selected.length}.`);
if (dryRun) { console.table(selected.map(x=>({section:x.section,source:x.sourceName,title:x.title.slice(0,70)}))); process.exit(0); }
if (!configured()) { console.log('FCC is not configured; no stories written.'); process.exit(0); }

let changed = false;
for (const item of selected) {
  try {
    const rewritten = await rewriteStory(item);
    const wordCount = rewritten.body.join(' ').split(/\s+/).filter(Boolean).length;
    const qualityScore = Math.min(100, 55 + Math.min(25, wordCount/8) + (rewritten.excerpt?.length > 80 ? 10 : 0) + (rewritten.title?.length > 20 ? 10 : 0));
    const approved = autoPublishEnabled && item.autoPublish && item.trust >= minTrust && qualityScore >= minScore;
    const baseSlug = slugify(rewritten.title) || hash(item.link);
    const slug = stories.some(s=>s.slug===baseSlug) ? `${baseSlug}-${hash(item.link)}` : baseSlug;
    stories.push({ id: hash(item.link), slug, section:item.section, title:rewritten.title, excerpt:rewritten.excerpt || rewritten.body[0].slice(0,180), body:rewritten.body.slice(0,8), sourceName:item.sourceName, sourceUrl:item.link, publishedAt:new Date(item.pubDate).toISOString(), status:approved?'approved':'review', qualityScore:Math.round(qualityScore), trust:item.trust, tags:Array.isArray(rewritten.tags)?rewritten.tags.slice(0,8):[] });
    existingLinks.add(item.link);
    changed = true;
    console.log(`${approved?'APPROVED':'REVIEW'}: ${rewritten.title}`);
  } catch (error) { console.error('Story failed:', item.title, error.message); }
}
if (changed) await fs.writeFile(storiesPath, JSON.stringify(stories,null,2)+'\n');
