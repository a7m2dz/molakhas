import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { XMLParser } from 'fast-xml-parser';

const STORIES_URL = new URL('../../src/data/stories.json', import.meta.url);
const MANIFEST_URL = new URL('../../src/data/image-manifest.json', import.meta.url);
const OUT_DIR = fileURLToPath(new URL('../../public/news-images/', import.meta.url));
const BRAND_DIR = fileURLToPath(new URL('../../public/brand/', import.meta.url));

const RESOLVER_VERSION = 5;
const FETCH_TIMEOUT_MS = Math.max(5000, Number(process.env.IMAGE_SOURCE_TIMEOUT_MS || 16000));
const RETRY_HOURS = Math.max(2, Number(process.env.IMAGE_FALLBACK_RETRY_HOURS || 12));
const MAX_CANDIDATES = Math.max(4, Number(process.env.IMAGE_MAX_CANDIDATES || 12));
const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, processEntities: true });

const stories = JSON.parse(await fs.readFile(STORIES_URL, 'utf8'));
let manifest = {};
try { manifest = JSON.parse(await fs.readFile(MANIFEST_URL, 'utf8')); } catch {}
await fs.mkdir(OUT_DIR, { recursive: true });
await fs.mkdir(BRAND_DIR, { recursive: true });

const sectionNames = {
  football: 'كرة القدم', saudi: 'الكرة السعودية', transfers: 'الانتقالات', basketball: 'كرة السلة',
  ufc: 'UFC', wwe: 'WWE', boxing: 'الملاكمة', movies: 'أفلام', tv: 'مسلسلات', sports: 'رياضة'
};
const palettes = {
  football: ['#07101d', '#0f3150', '#59e6a8'], saudi: ['#07101d', '#153d34', '#59e6a8'],
  transfers: ['#07101d', '#2b254f', '#9a8cff'], basketball: ['#07101d', '#183154', '#65b7ff'],
  ufc: ['#07101d', '#4a1e27', '#ff6b6b'], wwe: ['#07101d', '#35214d', '#c692ff'],
  boxing: ['#07101d', '#4c3418', '#ffbd59'], movies: ['#07101d', '#3a1f45', '#f09cff'],
  tv: ['#07101d', '#1f3545', '#68d5ff'], sports: ['#07101d', '#22394b', '#59e6a8']
};
const expectedDomains = {
  'reuters-football': ['reuters.com'], 'reuters-transfers': ['reuters.com'], 'reuters-boxing': ['reuters.com'],
  'saudi-official': ['spl.com.sa', 'saff.com.sa'], 'ufc-official': ['ufc.com'], 'wwe-official': ['wwe.com']
};

const esc = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const decodeEntities = (value = '') => String(value)
  .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#x2f;|&#47;/gi, '/');
const decodeEscaped = (value = '') => decodeEntities(String(value))
  .replace(/\\u0026/gi, '&').replace(/\\u003d/gi, '=').replace(/\\u003f/gi, '?')
  .replace(/\\u002f/gi, '/').replace(/\\\//g, '/').replace(/\\x26/gi, '&');

function parseAttrs(tag = '') {
  const attrs = {};
  const re = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = re.exec(tag))) attrs[String(match[1]).toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  return attrs;
}
function absoluteUrl(value, baseUrl) {
  const raw = decodeEscaped(value || '').trim();
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return '';
  try {
    const url = new URL(raw, baseUrl);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch { return ''; }
}
function hostname(value = '') {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}
function isGoogleNews(value = '') {
  const host = hostname(value);
  return host === 'news.google.com' || host.startsWith('news.google.');
}
function hostMatches(value, domains = []) {
  const host = hostname(value);
  return Boolean(host && domains.some((domain) => host === domain || host.endsWith(`.${domain}`)));
}
function domainsForStory(story) {
  const domains = [...(expectedDomains[story.sourceId] || [])];
  for (const candidate of [story.publisherUrl, !isGoogleNews(story.sourceUrl) ? story.sourceUrl : '']) {
    const host = hostname(candidate);
    if (host && !host.includes('google.') && !domains.includes(host)) domains.push(host);
  }
  return domains;
}
function storyTitle(story) {
  return String(story.sourceTitle || story.originalTitle || story.title || '').replace(/["'“”]/g, ' ').replace(/\s+/g, ' ').trim();
}
function normalizeWords(value = '') {
  return new Set(String(value).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/).filter((x) => x.length > 2));
}
function titleSimilarity(a = '', b = '') {
  const left = normalizeWords(a), right = normalizeWords(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try { return await fetch(url, { redirect: 'follow', ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
async function fetchPage(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'ar-SA,ar;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = response.headers.get('content-type') || '';
  if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error(`Not HTML: ${type}`);
  return { html: await response.text(), url: response.url || url };
}
async function fetchText(url, headers = {}) {
  const response = await fetchWithTimeout(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36', accept: '*/*', ...headers }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.text();
}

function metaValues(html, keys) {
  const wanted = new Set(keys.map((x) => x.toLowerCase()));
  const out = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = parseAttrs(tag);
    const key = String(attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (wanted.has(key) && attrs.content) out.push(attrs.content);
  }
  return out;
}
function pageTitle(html = '') {
  return metaValues(html, ['og:title', 'twitter:title'])[0]
    || decodeEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, ' ').trim();
}
function collectExternalUrls(html, baseUrl) {
  const out = [];
  const decoded = decodeEscaped(html);
  for (const tag of decoded.match(/<a\b[^>]*>/gi) || []) {
    const href = parseAttrs(tag).href;
    const absolute = absoluteUrl(href, baseUrl);
    if (absolute) out.push(absolute);
  }
  return [...new Set(out)];
}

async function bingSearch(story, domains) {
  const title = storyTitle(story);
  if (!title) return null;
  const queries = domains.length
    ? domains.flatMap((domain) => [`site:${domain} "${title}"`, `site:${domain} ${title}`])
    : [`"${title}" "${String(story.sourceName || '').replace(/"/g, '')}"`, `"${title}"`];

  for (const query of queries.slice(0, 6)) {
    try {
      const xmlText = await fetchText(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`, {
        accept: 'application/rss+xml,application/xml,text/xml,*/*;q=0.8'
      });
      const xml = parser.parse(xmlText);
      const rawItems = xml?.rss?.channel?.item ?? [];
      const items = Array.isArray(rawItems) ? rawItems : [rawItems];
      for (const item of items.slice(0, 8)) {
        const link = String(item?.link || '').trim();
        if (!link || isGoogleNews(link) || /bing\.com|microsoft\.com/i.test(hostname(link))) continue;
        if (domains.length && !hostMatches(link, domains)) continue;
        try {
          const page = await fetchPage(link);
          if (domains.length && !hostMatches(page.url, domains)) continue;
          if (!domains.length && titleSimilarity(title, pageTitle(page.html)) < 0.28) continue;
          return { ...page, resolutionMethod: 'publisher-bing-search' };
        } catch {}
      }
    } catch (error) {
      console.warn(`[Images] Publisher search failed: ${error.message}`);
    }
  }
  return null;
}

async function resolveSourcePage(story) {
  if (!story.sourceUrl || story.sourceId === 'molakhas-editorial') return null;
  const domains = domainsForStory(story);

  // 1) Direct article URL is always the cheapest/highest-confidence route.
  if (!isGoogleNews(story.sourceUrl)) {
    try { return { ...(await fetchPage(story.sourceUrl)), resolutionMethod: 'direct-source' }; }
    catch (error) {
      const searched = await bingSearch(story, domains);
      return searched || { error: `source page ${error.message}` };
    }
  }

  // 2) If ingestion retained a publisher URL that looks article-like, try it before touching Google.
  if (story.publisherUrl && !isGoogleNews(story.publisherUrl)) {
    try {
      const publisher = new URL(story.publisherUrl);
      if (publisher.pathname && publisher.pathname !== '/') {
        const page = await fetchPage(story.publisherUrl);
        if (!domains.length || hostMatches(page.url, domains)) return { ...page, resolutionMethod: 'publisher-url' };
      }
    } catch {}
  }

  // 3) Search the known publisher first. This avoids Google's private batch endpoint and its 429s.
  const searched = await bingSearch(story, domains);
  if (searched) return searched;

  // 4) Last resort: inspect the public Google News landing page once and follow a publisher link.
  try {
    const googlePage = await fetchPage(story.sourceUrl);
    const links = collectExternalUrls(googlePage.html, googlePage.url)
      .filter((url) => !isGoogleNews(url))
      .filter((url) => !/googleusercontent\.com|gstatic\.com|youtube\.com|youtu\.be/i.test(url));
    const ranked = domains.length
      ? [...links.filter((url) => hostMatches(url, domains)), ...links.filter((url) => !hostMatches(url, domains))]
      : links;
    for (const link of [...new Set(ranked)].slice(0, 8)) {
      try {
        const page = await fetchPage(link);
        if (domains.length && !hostMatches(page.url, domains)) continue;
        if (!domains.length && titleSimilarity(storyTitle(story), pageTitle(page.html)) < 0.25) continue;
        return { ...page, resolutionMethod: 'google-public-link' };
      } catch {}
    }
  } catch (error) {
    return { error: `publisher page unresolved; Google landing ${error.message}` };
  }
  return { error: 'publisher page could not be resolved safely' };
}

function jsonLdImages(html) {
  const out = [];
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  const visit = (value, inImage = false) => {
    if (!value) return;
    if (typeof value === 'string') { if (inImage && /^https?:\/\//i.test(value)) out.push(value); return; }
    if (Array.isArray(value)) { for (const child of value) visit(child, inImage); return; }
    if (typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const imageContext = inImage || ['image', 'thumbnailurl', 'contenturl'].includes(String(key).toLowerCase());
      visit(child, imageContext);
    }
  };
  for (const script of scripts) {
    const raw = script.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    try { visit(JSON.parse(raw)); } catch {}
  }
  return out;
}
function articleImages(html) {
  const article = html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] || html;
  const out = [];
  for (const tag of article.match(/<img\b[^>]*>/gi) || []) {
    const attrs = parseAttrs(tag);
    const srcset = String(attrs.srcset || attrs['data-srcset'] || '').split(',').map((x) => x.trim().split(/\s+/)[0]).filter(Boolean);
    out.push(attrs.src, attrs['data-src'], attrs['data-original'], attrs['data-lazy-src'], ...srcset);
  }
  return out.filter(Boolean);
}
function badImageUrl(url = '') {
  return /(?:logo|icon|favicon|avatar|sprite|placeholder|blank|tracking|pixel|badge|weather|stock)[-_./?]/i.test(url) || /\.svg(?:$|\?)/i.test(url);
}
async function probeOnce(url, referer, useRange) {
  const response = await fetchWithTimeout(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36',
      accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      ...(referer ? { referer } : {}),
      ...(useRange ? { range: 'bytes=0-65535' } : {})
    }
  });
  const status = response.status;
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  try { await response.body?.cancel(); } catch {}
  if (!response.ok && status !== 206) throw new Error(`HTTP ${status}`);
  if (!type.startsWith('image/')) throw new Error(`Not image: ${type || 'unknown'}`);
  return { type, finalUrl: response.url || url };
}
async function probeImage(url, referer) {
  try { return { ok: true, ...(await probeOnce(url, referer, true)) }; }
  catch (first) {
    if (!/HTTP (403|405|416)/.test(String(first.message))) return { ok: false, error: first.message };
    try { return { ok: true, ...(await probeOnce(url, referer, false)) }; }
    catch (second) { return { ok: false, error: second.message }; }
  }
}
async function resolveSourceImage(story) {
  const page = await resolveSourcePage(story);
  if (!page?.html) return { error: page?.error || 'publisher page unavailable' };
  const candidates = [...new Set([
    ...metaValues(page.html, ['og:image', 'og:image:url', 'og:image:secure_url']),
    ...metaValues(page.html, ['twitter:image', 'twitter:image:src']),
    ...jsonLdImages(page.html), ...articleImages(page.html)
  ].map((x) => absoluteUrl(x, page.url)).filter(Boolean))]
    .filter((url) => !badImageUrl(url))
    .filter((url) => !/news\.google\.|gstatic\.com/i.test(url));

  for (const url of candidates.slice(0, MAX_CANDIDATES)) {
    const probe = await probeImage(url, page.url);
    if (!probe.ok) continue;
    const width = Number(metaValues(page.html, ['og:image:width'])[0] || 0);
    const height = Number(metaValues(page.html, ['og:image:height'])[0] || 0);
    return {
      src: probe.finalUrl, type: probe.type, width: width > 0 ? width : undefined, height: height > 0 ? height : undefined,
      pageUrl: page.url, resolutionMethod: page.resolutionMethod || 'source-page'
    };
  }
  return { error: `publisher resolved (${page.resolutionMethod || 'unknown'}) but no usable source image found` };
}

function wrapArabic(text, maxChars = 33, maxLines = 4) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = []; let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (test.length > maxChars && line) { lines.push(line); line = word; if (lines.length >= maxLines - 1) break; }
    else line = test;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.join(' ').length > lines.join(' ').length && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.…]+$/u, '')}…`;
  return lines;
}
async function writeFallbackFile(story, outPath) {
  const [bg, panel, accent] = palettes[story.section] || palettes.sports;
  const section = sectionNames[story.section] || 'ملخص';
  const lines = wrapArabic(story.title);
  const lineSvg = lines.map((line, i) => `<text x="1080" y="${270 + i * 74}" text-anchor="end" direction="rtl" unicode-bidi="plaintext" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="54" font-weight="700" fill="#f7f9fc">${esc(line)}</text>`).join('');
  const svg = `<svg width="1200" height="675" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${panel}"/></linearGradient></defs><rect width="1200" height="675" fill="url(#bg)"/><text x="1080" y="120" text-anchor="end" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="28" font-weight="700" fill="${accent}">${esc(section)}</text>${lineSvg}<text x="1080" y="610" text-anchor="end" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="24" font-weight="900" fill="${accent}">ملخص</text><text x="120" y="610" font-family="Segoe UI, Arial, sans-serif" font-size="17" fill="#b7c4d6">mulakhas.com</text></svg>`;
  await sharp(Buffer.from(svg)).resize(1200, 675, { fit: 'cover' }).webp({ quality: 84, effort: 5 }).toFile(outPath);
}
async function ensureFallback(story, outPath) {
  try { await fs.access(outPath); } catch { await writeFallbackFile(story, outPath); }
}
async function ensureLogo() {
  const logoPath = path.join(BRAND_DIR, 'molakhas-logo.png');
  try { await fs.access(logoPath); return; } catch {}
  const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" rx="112" fill="#07101d"/><circle cx="256" cy="256" r="178" fill="none" stroke="#59e6a8" stroke-width="12"/><text x="256" y="282" text-anchor="middle" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="92" font-weight="900" fill="#59e6a8">ملخص</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(logoPath);
}
function retryDue(current) {
  if (!current || current.kind !== 'branded-fallback' || Number(current.resolverVersion || 0) < RESOLVER_VERSION) return true;
  const last = +new Date(current.lastTriedAt || 0);
  if (!last) return true;
  return Date.now() - last >= RETRY_HOURS * 3_600_000;
}

await ensureLogo();
let resolved = 0, fallback = 0, cached = 0, refreshed = 0;
for (const story of stories.filter((s) => s?.status === 'approved' && s?.slug && s?.title)) {
  const outPath = path.join(OUT_DIR, `${story.slug}.webp`);
  const fallbackSrc = `/news-images/${story.slug}.webp`;
  const current = manifest[story.slug] || {};
  await ensureFallback(story, outPath);

  if (story.sourceId === 'molakhas-editorial') {
    manifest[story.slug] = {
      src: fallbackSrc, fallbackSrc, kind: 'branded-fallback', type: 'image/webp', width: 1200, height: 675,
      alt: story.image?.alt || story.title, caption: story.image?.caption || story.excerpt,
      resolverVersion: RESOLVER_VERSION, rejectionReason: 'editorial story uses branded artwork', lastTriedAt: new Date().toISOString()
    };
    fallback += 1;
    continue;
  }

  if (current.kind === 'source-remote' && current.src) { cached += 1; continue; }
  if (!retryDue(current)) { fallback += 1; cached += 1; continue; }

  const sourceImage = await resolveSourceImage(story);
  if (sourceImage.src) {
    manifest[story.slug] = {
      src: sourceImage.src, fallbackSrc, kind: 'source-remote', external: true,
      provider: story.sourceName || 'المصدر الأصلي', sourceUrl: sourceImage.pageUrl || story.sourceUrl,
      originalStoryUrl: story.sourceUrl, type: sourceImage.type, width: sourceImage.width, height: sourceImage.height,
      alt: story.image?.alt || story.title, caption: `الصورة المستخدمة في صفحة المصدر الأصلي للخبر — ${story.sourceName || 'المصدر'}.`,
      resolverVersion: RESOLVER_VERSION, resolutionMethod: sourceImage.resolutionMethod, lastTriedAt: new Date().toISOString()
    };
    resolved += 1;
    if (current.kind && current.kind !== 'source-remote') refreshed += 1;
    console.log(`[Images] Source image (${sourceImage.resolutionMethod}): ${story.slug}`);
  } else {
    manifest[story.slug] = {
      src: fallbackSrc, fallbackSrc, kind: 'branded-fallback', type: 'image/webp', width: 1200, height: 675,
      alt: story.image?.alt || story.title, caption: story.image?.caption || story.excerpt,
      provider: story.sourceName || '', sourceUrl: story.sourceUrl, resolverVersion: RESOLVER_VERSION,
      rejectionReason: sourceImage.error || 'source image unavailable', lastTriedAt: new Date().toISOString()
    };
    fallback += 1;
    console.warn(`[Images] Source image unavailable for ${story.slug}: ${sourceImage.error || 'unknown'}; cached fallback for ${RETRY_HOURS}h.`);
  }
}

await fs.writeFile(MANIFEST_URL, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[Images] Source-first resolver v${RESOLVER_VERSION}: ${resolved} new source images, ${fallback} fallbacks, ${cached} cached/skipped, ${refreshed} upgraded.`);
