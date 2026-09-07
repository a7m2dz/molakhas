import fs from 'node:fs/promises';

const ROOT = new URL('../../', import.meta.url);
const requiredFiles = [
  'dist/index.html',
  'dist/robots.txt',
  'dist/sitemap.xml',
  'dist/news-sitemap.xml',
  'dist/rss.xml',
  'dist/matches/index.html',
  'dist/matches/today/index.html',
  'dist/teams/index.html',
  'dist/competitions/index.html'
];

const failures = [];
const warnings = [];
const pass = [];

async function readJson(path) {
  return JSON.parse(await fs.readFile(new URL(path, ROOT), 'utf8'));
}

async function exists(path) {
  try { await fs.access(new URL(path, ROOT)); return true; } catch { return false; }
}

const stories = await readJson('src/data/stories.json');
const matches = await readJson('src/data/matches.json');
const events = await readJson('src/data/today-events.json');
const approved = (Array.isArray(stories) ? stories : []).filter((story) => story?.status === 'approved' && story?.sourceId !== 'molakhas-editorial');

const slugMap = new Map();
for (const story of approved) {
  const key = `${story.section}/${story.slug}`;
  if (slugMap.has(key)) failures.push(`duplicate approved story route: ${key}`);
  slugMap.set(key, story.id || story.sourceUrl || key);
  if (!story.title || !story.excerpt || !story.sourceUrl) failures.push(`approved story missing core fields: ${key}`);
  if ((story.qualityFlags || []).length) failures.push(`approved story still has quality flags: ${key} -> ${(story.qualityFlags || []).join(',')}`);
  if ((story.title || '').length > 100) warnings.push(`long article title (${story.title.length}): ${key}`);
  if ((story.metaDescription || '').length > 185) warnings.push(`long meta description (${story.metaDescription.length}): ${key}`);
  if ((story.metaDescription || '').length > 0 && (story.metaDescription || '').length < 90) warnings.push(`short meta description (${story.metaDescription.length}): ${key}`);
}
pass.push(`${approved.length} approved stories checked`);

const indexableMatches = (Array.isArray(matches) ? matches : []).filter((match) => match?.indexable !== false);
for (const match of indexableMatches) {
  if (Number(match.indexQualityScore || 0) < 55) failures.push(`indexable match below quality threshold: ${match.slug} (${match.indexQualityScore || 0})`);
  if (!match.slug || !match.kickoff || !match.home?.name || !match.away?.name) failures.push(`indexable match missing core data: ${match?.id || 'unknown'}`);
}
pass.push(`${indexableMatches.length} indexable matches checked`);

const generatedAt = +new Date(events?.generatedAt || 0);
if (!generatedAt || Date.now() - generatedAt > 8 * 3_600_000) warnings.push('today-events snapshot is older than 8 hours');
else pass.push(`daily events snapshot fresh (${events?.counts?.total || 0} events)`);

for (const path of requiredFiles) {
  if (!(await exists(path))) failures.push(`required build artifact missing: ${path}`);
}
if (!failures.some((item) => item.startsWith('required build artifact missing'))) pass.push(`${requiredFiles.length} required build artifacts present`);

if (await exists('dist/index.html')) {
  const html = await fs.readFile(new URL('dist/index.html', ROOT), 'utf8');
  if (!/<html[^>]+lang="ar"[^>]+dir="rtl"/i.test(html)) failures.push('homepage missing Arabic RTL html attributes');
  if (!/<link[^>]+rel="canonical"/i.test(html)) failures.push('homepage missing canonical link');
  if (!/<meta[^>]+name="description"/i.test(html)) failures.push('homepage missing meta description');
  if (!/مباريات وأحداث اليوم/u.test(html)) failures.push('homepage missing multi-sport today widget');
  if (!/الأخبار الساخنة/u.test(html) && approved.length >= 2) warnings.push('homepage hot-news block has no renderable stories');
  pass.push('homepage structural SEO checks completed');
}

if (await exists('dist/sitemap.xml')) {
  const sitemap = await fs.readFile(new URL('dist/sitemap.xml', ROOT), 'utf8');
  for (const match of (Array.isArray(matches) ? matches : []).filter((m) => m?.slug && m?.indexable === false)) {
    if (sitemap.includes(`/matches/${match.slug}`)) failures.push(`noindex match leaked into sitemap: ${match.slug}`);
  }
  pass.push('sitemap index-quality leakage check completed');
}

console.log('\n[Prelaunch Audit] PASS');
for (const item of pass) console.log(`  ✓ ${item}`);
if (warnings.length) {
  console.log('\n[Prelaunch Audit] WARNINGS');
  for (const item of warnings.slice(0, 30)) console.log(`  ! ${item}`);
}
if (failures.length) {
  console.error('\n[Prelaunch Audit] FAILURES');
  for (const item of failures.slice(0, 40)) console.error(`  ✗ ${item}`);
  console.error(`\n[Prelaunch Audit] FAILED: ${failures.length} blocking issue(s), ${warnings.length} warning(s).`);
  process.exit(1);
}
console.log(`\n[Prelaunch Audit] READY: 0 blocking issues, ${warnings.length} warning(s).`);
