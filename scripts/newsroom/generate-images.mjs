import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const stories = JSON.parse(await fs.readFile(new URL('../../src/data/stories.json', import.meta.url), 'utf8'));
const manifestPath = new URL('../../src/data/image-manifest.json', import.meta.url);
let manifest = {};
try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch {}

const outDir = fileURLToPath(new URL('../../public/news-images/', import.meta.url));
const brandDir = fileURLToPath(new URL('../../public/brand/', import.meta.url));
await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(brandDir, { recursive: true });

const RESOLVER_VERSION = 3;
const FETCH_TIMEOUT_MS = Number(process.env.IMAGE_SOURCE_TIMEOUT_MS || 18000);
const sectionNames = {
  football: 'كرة القدم', saudi: 'الكرة السعودية', transfers: 'الانتقالات',
  ufc: 'UFC', wwe: 'WWE', boxing: 'الملاكمة'
};
const palettes = {
  football: ['#07101d', '#0f3150', '#59e6a8'], saudi: ['#07101d', '#153d34', '#59e6a8'],
  transfers: ['#07101d', '#2b254f', '#9a8cff'], ufc: ['#07101d', '#4a1e27', '#ff6b6b'],
  wwe: ['#07101d', '#35214d', '#c692ff'], boxing: ['#07101d', '#4c3418', '#ffbd59']
};
const expectedDomains = {
  'reuters-football': ['reuters.com'],
  'reuters-transfers': ['reuters.com'],
  'reuters-boxing': ['reuters.com'],
  'saudi-official': ['spl.com.sa', 'saff.com.sa'],
  'ufc-official': ['ufc.com'],
  'wwe-official': ['wwe.com']
};

const esc = (value = '') => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const stripHtml = (value = '') => String(value).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
const decodeEntities = (value = '') => String(value)
  .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&#x2f;/gi, '/').replace(/&#47;/g, '/');
const decodeEscaped = (value = '') => decodeEntities(String(value))
  .replace(/\\u0026/gi, '&').replace(/\\u003d/gi, '=').replace(/\\u003f/gi, '?')
  .replace(/\\u002f/gi, '/').replace(/\\\//g, '/');

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
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch { return ''; }
}
function hostMatches(url, domains = []) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}
function isGoogleNews(url = '') {
  try { return /(^|\.)news\.google\./i.test(new URL(url).hostname); } catch { return false; }
}
function unwrapRedirectUrl(value, baseUrl) {
  const absolute = absoluteUrl(value, baseUrl);
  if (!absolute) return '';
  try {
    const u = new URL(absolute);
    for (const key of ['url', 'q', 'u', 'target']) {
      const nested = u.searchParams.get(key);
      if (nested && /^https?:/i.test(nested)) return nested;
    }
  } catch {}
  return absolute;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36 MolakhasBot/3.0',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'ar-SA,ar;q=0.9,en;q=0.8'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error(`Not HTML: ${type}`);
    return { html: await response.text(), url: response.url || url };
  } finally { clearTimeout(timer); }
}

function collectExternalUrls(html, pageUrl) {
  const decoded = decodeEscaped(html);
  const urls = [];
  for (const tag of decoded.match(/<a\b[^>]*>/gi) || []) {
    const attrs = parseAttrs(tag);
    if (attrs.href) urls.push(unwrapRedirectUrl(attrs.href, pageUrl));
  }
  for (const match of decoded.matchAll(/https?:\/\/[^\s"'<>\\]+/gi)) urls.push(unwrapRedirectUrl(match[0], pageUrl));
  return [...new Set(urls.filter(Boolean))];
}

async function resolveSourcePage(story) {
  if (!story.sourceUrl || story.sourceId === 'molakhas-editorial') return null;
  let first;
  try { first = await fetchText(story.sourceUrl); }
  catch (error) { return { error: `source page ${error.message}` }; }

  if (!isGoogleNews(first.url)) return first;

  const domains = expectedDomains[story.sourceId] || [];
  const links = collectExternalUrls(first.html, first.url)
    .filter((url) => !isGoogleNews(url))
    .filter((url) => !/googleusercontent\.com|gstatic\.com|youtube\.com|youtu\.be/i.test(url));
  const ranked = [
    ...links.filter((url) => hostMatches(url, domains)),
    ...links.filter((url) => !domains.length)
  ];

  for (const url of [...new Set(ranked)].slice(0, 8)) {
    try {
      const page = await fetchText(url);
      if (domains.length && !hostMatches(page.url, domains)) continue;
      return page;
    } catch {}
  }
  return { ...first, unresolvedGoogleNews: true };
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
function linkValues(html, relName) {
  const out = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const attrs = parseAttrs(tag);
    if (String(attrs.rel || '').toLowerCase().split(/\s+/).includes(relName) && attrs.href) out.push(attrs.href);
  }
  return out;
}
function jsonLdImages(html) {
  const out = [];
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  const visit = (value) => {
    if (!value) return;
    if (typeof value === 'string') {
      if (/^https?:\/\//i.test(value)) out.push(value);
      return;
    }
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['image', 'thumbnailurl', 'contenturl', 'url'].includes(String(key).toLowerCase())) visit(child);
      else if (typeof child === 'object') visit(child);
    }
  };
  for (const script of scripts) {
    const raw = script.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    try { visit(JSON.parse(raw)); } catch {}
  }
  return out;
}
function articleImages(html) {
  const article = html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] || '';
  const out = [];
  for (const tag of article.match(/<img\b[^>]*>/gi) || []) {
    const attrs = parseAttrs(tag);
    const srcset = String(attrs.srcset || attrs['data-srcset'] || '').split(',').map((x) => x.trim().split(/\s+/)[0]).filter(Boolean);
    out.push(attrs.src, attrs['data-src'], attrs['data-original'], attrs['data-lazy-src'], ...srcset);
  }
  return out.filter(Boolean);
}
function badImageUrl(url = '') {
  return /(?:logo|icon|favicon|avatar|sprite|placeholder|blank|tracking|pixel|badge)[-_./?]/i.test(url) || /\.svg(?:$|\?)/i.test(url);
}

async function probeImage(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(FETCH_TIMEOUT_MS, 12000));
  try {
    const response = await fetch(url, {
      redirect: 'follow', signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36',
        'accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'range': 'bytes=0-65535',
        ...(referer ? { referer } : {})
      }
    });
    if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`);
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('image/')) throw new Error(`Not image: ${type || 'unknown'}`);
    return { ok: true, type, finalUrl: response.url || url };
  } catch (error) { return { ok: false, error: error.message }; }
  finally { clearTimeout(timer); }
}

async function resolveSourceImage(story) {
  const page = await resolveSourcePage(story);
  if (!page?.html || page.unresolvedGoogleNews) return { error: page?.error || 'publisher page could not be resolved from Google News' };

  const imageCandidates = [
    ...metaValues(page.html, ['og:image', 'og:image:url', 'og:image:secure_url']),
    ...metaValues(page.html, ['twitter:image', 'twitter:image:src']),
    ...jsonLdImages(page.html),
    ...articleImages(page.html)
  ];
  const candidates = [...new Set(imageCandidates.map((x) => absoluteUrl(x, page.url)).filter(Boolean))]
    .filter((url) => !badImageUrl(url))
    .filter((url) => !/news\.google\.|gstatic\.com/i.test(url));

  for (const url of candidates.slice(0, 14)) {
    const probe = await probeImage(url, page.url);
    if (!probe.ok) continue;
    const width = Number(metaValues(page.html, ['og:image:width'])[0] || 0);
    const height = Number(metaValues(page.html, ['og:image:height'])[0] || 0);
    return {
      src: probe.finalUrl,
      type: probe.type,
      width: width > 0 ? width : undefined,
      height: height > 0 ? height : undefined,
      pageUrl: page.url
    };
  }
  return { error: 'no usable source image found' };
}

function wrapArabic(text, maxChars = 33, maxLines = 4) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean); const lines = []; let line = '';
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
  const [bg, panel, accent] = palettes[story.section] || palettes.football;
  const section = sectionNames[story.section] || 'رياضة';
  const lines = wrapArabic(story.title);
  const lineSvg = lines.map((line, i) => `<text x="1080" y="${270 + i * 74}" text-anchor="end" direction="rtl" unicode-bidi="plaintext" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="54" font-weight="700" fill="#f7f9fc">${esc(line)}</text>`).join('');
  const svg = `<svg width="1200" height="675" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${panel}"/></linearGradient></defs><rect width="1200" height="675" fill="url(#bg)"/>${lineSvg}<text x="1085" y="126" text-anchor="middle" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="30" font-weight="900" fill="${accent}">مُلخّص</text><text x="1130" y="632" text-anchor="end" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="19" fill="#b7c4d6">molakhas.a7asmari.workers.dev</text></svg>`;
  await sharp(Buffer.from(svg)).resize(1200, 675, { fit: 'cover' }).webp({ quality: 84, effort: 5 }).toFile(outPath);
}
async function ensureFallback(story, outPath) {
  try { await fs.access(outPath); }
  catch { await writeFallbackFile(story, outPath); }
}
async function ensureLogo() {
  const logoPath = path.join(brandDir, 'molakhas-logo.png');
  try { await fs.access(logoPath); return; } catch {}
  const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" rx="112" fill="#07101d"/><circle cx="256" cy="256" r="178" fill="none" stroke="#59e6a8" stroke-width="12"/><text x="256" y="282" text-anchor="middle" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="92" font-weight="900" fill="#59e6a8">ملخص</text></svg>`;
  await sharp(Buffer.from(svg)).png({ quality: 90 }).toFile(logoPath);
}

await ensureLogo();
let resolved = 0, fallback = 0, refreshed = 0;
for (const story of stories.filter((s) => s?.status === 'approved' && s?.slug && s?.title)) {
  const outPath = path.join(outDir, `${story.slug}.webp`);
  const fallbackSrc = `/news-images/${story.slug}.webp`;
  const current = manifest[story.slug] || {};

  await ensureFallback(story, outPath);

  if (story.sourceId === 'molakhas-editorial') {
    manifest[story.slug] = {
      src: fallbackSrc, fallbackSrc, kind: 'branded-fallback', type: 'image/webp', width: 1200, height: 675,
      alt: story.image?.alt || story.title, caption: story.image?.caption || story.excerpt,
      resolverVersion: RESOLVER_VERSION, rejectionReason: 'editorial story uses branded artwork'
    };
    fallback += 1;
    continue;
  }

  if (current.kind === 'source-remote' && Number(current.resolverVersion || 0) >= RESOLVER_VERSION && current.src) continue;

  const sourceImage = await resolveSourceImage(story);
  if (sourceImage.src) {
    manifest[story.slug] = {
      src: sourceImage.src,
      fallbackSrc,
      kind: 'source-remote',
      external: true,
      provider: story.sourceName || 'المصدر الأصلي',
      sourceUrl: sourceImage.pageUrl || story.sourceUrl,
      originalStoryUrl: story.sourceUrl,
      type: sourceImage.type,
      width: sourceImage.width,
      height: sourceImage.height,
      alt: story.image?.alt || story.title,
      caption: `الصورة المستخدمة في صفحة المصدر الأصلي للخبر — ${story.sourceName || 'المصدر'}.`,
      resolverVersion: RESOLVER_VERSION
    };
    resolved += 1;
    if (current.kind && current.kind !== 'source-remote') refreshed += 1;
    console.log(`[Images] Source image: ${story.slug} ← ${story.sourceName || sourceImage.pageUrl}`);
  } else {
    manifest[story.slug] = {
      src: fallbackSrc, fallbackSrc, kind: 'branded-fallback', type: 'image/webp', width: 1200, height: 675,
      alt: story.image?.alt || story.title, caption: story.image?.caption || story.excerpt,
      provider: story.sourceName || '', sourceUrl: story.sourceUrl,
      resolverVersion: RESOLVER_VERSION, rejectionReason: sourceImage.error || 'source image unavailable'
    };
    fallback += 1;
    console.warn(`[Images] Source image unavailable for ${story.slug}: ${sourceImage.error || 'unknown'}; using branded fallback.`);
  }
}
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[Images] Source-first resolver complete: ${resolved} source images, ${fallback} branded fallbacks, ${refreshed} upgraded entries.`);
