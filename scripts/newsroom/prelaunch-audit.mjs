import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../', import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);
const DIST_PATH = path.join(ROOT_PATH, 'dist');
const requiredFiles = [
  'dist/index.html',
  'dist/latest/index.html',
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

async function readJson(file) {
  return JSON.parse(await fs.readFile(new URL(file, ROOT), 'utf8'));
}

async function exists(file) {
  try { await fs.access(new URL(file, ROOT)); return true; } catch { return false; }
}

async function walkHtml(dir, out = []) {
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkHtml(full, out);
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function routeForFile(file) {
  const rel = path.relative(DIST_PATH, file).replaceAll('\\','/');
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return `/${rel.slice(0,-11)}`;
  return `/${rel}`;
}

function internalHrefs(html) {
  return [...html.matchAll(/href=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((href) => href.startsWith('/') && !href.startsWith('//'));
}

async function internalTargetExists(href) {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean || clean === '/') return exists('dist/index.html');
  const relative = clean.replace(/^\/+/, '');
  if (/\.[a-z0-9]{1,8}$/i.test(relative)) return exists(`dist/${relative}`);
  return (await exists(`dist/${relative}/index.html`)) || (await exists(`dist/${relative}`));
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

const eventList = Array.isArray(events?.events) ? events.events : [];
const eventIds = new Set();
for (const event of eventList) {
  if (!event?.id || eventIds.has(event.id)) failures.push(`daily events contains missing/duplicate id: ${event?.id || 'unknown'}`);
  eventIds.add(event?.id);
  if (!event?.title || !event?.start || !event?.sport) failures.push(`daily event missing core data: ${event?.id || 'unknown'}`);
  if (event?.state === 'upcoming' && String(event?.score || '').trim()) failures.push(`upcoming event exposes premature score: ${event.id} -> ${event.score}`);
}
const generatedAt = +new Date(events?.generatedAt || 0);
if (!generatedAt || Date.now() - generatedAt > 8 * 3_600_000) warnings.push('today-events snapshot is older than 8 hours');
else pass.push(`daily events snapshot fresh (${eventList.length} events)`);

for (const file of requiredFiles) {
  if (!(await exists(file))) failures.push(`required build artifact missing: ${file}`);
}
if (!failures.some((item) => item.startsWith('required build artifact missing'))) pass.push(`${requiredFiles.length} required build artifacts present`);

const htmlFiles = await walkHtml(DIST_PATH);
let checkedLinks = 0;
let checkedPages = 0;
for (const file of htmlFiles) {
  const route = routeForFile(file);
  const html = await fs.readFile(file, 'utf8');
  const is404 = route === '/404.html' || route === '/404';
  if (!is404) {
    checkedPages += 1;
    if (!/<title>[^<]+<\/title>/i.test(html)) failures.push(`page missing title: ${route}`);
    if (!/<meta[^>]+name="description"[^>]+content="[^"]+/i.test(html)) failures.push(`page missing meta description: ${route}`);
    if (!/<meta[^>]+name="robots"/i.test(html)) failures.push(`page missing robots directive: ${route}`);
    if (!/<link[^>]+rel="canonical"/i.test(html)) failures.push(`page missing canonical: ${route}`);
    const h1Count = (html.match(/<h1(?:\s|>)/gi) || []).length;
    if (h1Count !== 1) warnings.push(`page has ${h1Count} H1 elements: ${route}`);
  }
  for (const href of internalHrefs(html)) {
    if (href === '#' || href.startsWith('/#')) continue;
    checkedLinks += 1;
    if (!(await internalTargetExists(href))) failures.push(`broken internal link on ${route}: ${href}`);
  }
}
pass.push(`${checkedPages} generated HTML pages checked`);
pass.push(`${checkedLinks} internal links checked`);

if (await exists('dist/index.html')) {
  const html = await fs.readFile(new URL('dist/index.html', ROOT), 'utf8');
  if (!/<html[^>]+lang="ar"[^>]+dir="rtl"/i.test(html)) failures.push('homepage missing Arabic RTL html attributes');
  const widgetCount = (html.match(/مباريات وأحداث اليوم/gu) || []).length;
  if (widgetCount !== 1) failures.push(`homepage daily sports widget rendered ${widgetCount} times`);
  if (/وش عندنا اليوم[؟?]?/u.test(html)) failures.push('homepage still renders duplicate nightly-events panel');
  if (/href="\/football"[^>]*>\s*كل الأخبار/u.test(html)) failures.push('homepage all-news CTA incorrectly points to football');
  if (!/href="\/latest"/u.test(html)) failures.push('homepage missing latest-news archive link');
  if (!/الأخبار الساخنة/u.test(html) && approved.length >= 2) warnings.push('homepage hot-news block has no renderable stories');
  pass.push('homepage duplicate-content and CTA checks completed');
}

if (await exists('dist/sitemap.xml')) {
  const sitemap = await fs.readFile(new URL('dist/sitemap.xml', ROOT), 'utf8');
  if (!sitemap.includes('/latest')) failures.push('latest news archive missing from sitemap');
  for (const match of (Array.isArray(matches) ? matches : []).filter((m) => m?.slug && m?.indexable === false)) {
    if (sitemap.includes(`/matches/${match.slug}`)) failures.push(`noindex match leaked into sitemap: ${match.slug}`);
  }
  for (const file of htmlFiles.filter((item) => /[\\/](?:teams|competitions|matches)[\\/][^\\/]+[\\/]index\.html$/i.test(item))) {
    const html = await fs.readFile(file, 'utf8');
    if (!/name="robots" content="noindex/i.test(html)) continue;
    const route = routeForFile(file);
    if (sitemap.includes(route)) failures.push(`noindex entity page leaked into sitemap: ${route}`);
  }
  pass.push('sitemap index-quality leakage check completed');
}

console.log('\n[Prelaunch Audit] PASS');
for (const item of pass) console.log(`  ✓ ${item}`);
if (warnings.length) {
  console.log('\n[Prelaunch Audit] WARNINGS');
  for (const item of warnings.slice(0, 40)) console.log(`  ! ${item}`);
}
if (failures.length) {
  console.error('\n[Prelaunch Audit] FAILURES');
  for (const item of failures.slice(0, 60)) console.error(`  ✗ ${item}`);
  console.error(`\n[Prelaunch Audit] FAILED: ${failures.length} blocking issue(s), ${warnings.length} warning(s).`);
  process.exit(1);
}
console.log(`\n[Prelaunch Audit] READY: 0 blocking issues, ${warnings.length} warning(s).`);
