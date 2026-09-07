import fs from 'node:fs/promises';

const key = '4d5c8189e6697955fa6202bddfcc91a5';
const base = (process.env.PUBLIC_SITE_URL || 'https://molakhas.a7asmari.workers.dev').replace(/\/$/, '');
const site = new URL(base);
const stories = JSON.parse(await fs.readFile(new URL('../../src/data/stories.json', import.meta.url), 'utf8'));
const cutoff = Date.now() - 24 * 60 * 60 * 1000;
const urls = stories
  .filter((s) => s.status === 'approved' && +new Date(s.generatedAt || s.publishedAt) >= cutoff)
  .sort((a,b)=>+new Date(b.generatedAt || b.publishedAt)-+new Date(a.generatedAt || a.publishedAt))
  .slice(0, 100)
  .map((s) => `${base}/${s.section}/${s.slug}`);

if (!urls.length) {
  console.log('[IndexNow] No fresh approved URLs to submit.');
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
console.log(`[IndexNow] Submitted ${urls.length} fresh URLs (${response.status}).`);
