import fs from 'node:fs/promises';

const key = '4d5c8189e6697955fa6202bddfcc91a5';
const base = (process.env.PUBLIC_SITE_URL || 'https://mulakhas.com').replace(/\/$/, '');
const site = new URL(base);
const stories = JSON.parse(await fs.readFile(new URL('../../src/data/stories.json', import.meta.url), 'utf8'));
let matches = [];
try { matches = JSON.parse(await fs.readFile(new URL('../../src/data/matches.json', import.meta.url), 'utf8')); } catch {}
const cutoff = Date.now() - 24 * 60 * 60 * 1000;

const storyUrls = stories
  .filter((s) => s.status === 'approved' && +new Date(s.generatedAt || s.publishedAt) >= cutoff)
  .sort((a,b)=>+new Date(b.generatedAt || b.publishedAt)-+new Date(a.generatedAt || a.publishedAt))
  .map((s) => `${base}/${s.section}/${s.slug}`);

const matchUrls = (Array.isArray(matches) ? matches : [])
  .filter((m) => m?.slug && m.indexable !== false && Number(m.indexQualityScore || 0) >= 55 && Number(m.opportunityScore || 0) >= 55 && +new Date(m.updatedAt || 0) >= cutoff)
  .sort((a,b)=>+new Date(b.updatedAt || b.kickoff)-+new Date(a.updatedAt || a.kickoff))
  .map((m) => `${base}/matches/${m.slug}`);

async function sitemapHubUrls(kind, limit) {
  try {
    const xml = await fs.readFile(new URL('../../dist/sitemap.xml', import.meta.url), 'utf8');
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].replaceAll('&amp;','&'));
    return urls.filter((url) => url.startsWith(`${base}/${kind}/`) && url !== `${base}/${kind}`).slice(0, limit);
  } catch {
    return [];
  }
}

const teamUrls = await sitemapHubUrls('teams', 24);
const competitionUrls = await sitemapHubUrls('competitions', 20);

const urls = [...new Set([
  ...(storyUrls.length ? [`${base}/latest`] : []),
  ...(matchUrls.length ? [`${base}/matches/today`] : []),
  ...(teamUrls.length ? [`${base}/teams`] : []),
  ...(competitionUrls.length ? [`${base}/competitions`] : []),
  ...storyUrls,
  ...teamUrls,
  ...competitionUrls,
  ...matchUrls
])].slice(0, 100);

if (!urls.length) {
  console.log('[IndexNow] No fresh story, match, team or competition URLs to submit.');
  process.exit(0);
}

const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    host: site.host,
    key,
    keyLocation: `${base}/${key}.txt`,
    urlList: urls
  })
});

if (!response.ok && response.status !== 202) {
  const text = await response.text();
  throw new Error(`IndexNow ${response.status}: ${text.slice(0, 500)}`);
}
console.log(`[IndexNow] Submitted ${urls.length} fresh URLs (${response.status}); indexable hubs=${teamUrls.length + competitionUrls.length}.`);
