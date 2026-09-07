import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { XMLParser } from 'fast-xml-parser';

const stories = JSON.parse(await fs.readFile(new URL('../../src/data/stories.json', import.meta.url), 'utf8'));
const manifestPath = new URL('../../src/data/image-manifest.json', import.meta.url);
let manifest = {};
try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch {}

const outDir = fileURLToPath(new URL('../../public/news-images/', import.meta.url));
const brandDir = fileURLToPath(new URL('../../public/brand/', import.meta.url));
await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(brandDir, { recursive: true });

const RESOLVER_VERSION = 4;
const FETCH_TIMEOUT_MS = Number(process.env.IMAGE_SOURCE_TIMEOUT_MS || 20000);
const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, processEntities: true });

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

const esc = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const decodeEntities = (value = '') => String(value)
  .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#x2f;/gi, '/').replace(/&#47;/g, '/');
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
function isGoogleNews(url = '') {
  try { return /(^|\.)news\.google\./i.test(new URL(url).hostname); } catch { return false; }
}
function hostMatches(url, domains = []) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}
function googleArticleId(url = '') {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const index = parts.lastIndexOf('articles');
    return index >= 0 ? parts[index + 1] || '' : '';
  } catch { return ''; }
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

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { redirect: 'follow', ...options, signal: controller.signal });
  } finally { clearTimeout(timer); }
}
async function fetchPage(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36 MolakhasBot/4.0',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'ar-SA,ar;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = response.headers.get('content-type') || '';
  if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error(`Not HTML: ${type}`);
  return { html: await response.text(), url: response.url || url };
}
async function fetchTextAny(url, headers = {}) {
  const response = await fetchWithTimeout(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36',
      accept: '*/*',
      ...headers
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { text: await response.text(), url: response.url || url };
}

function parseGartUrlResponse(text = '') {
  const header = '[\\"garturlres\\",\\"';
  const startAt = text.indexOf(header);
  if (startAt < 0) return '';
  const rest = text.slice(startAt + header.length);
  const endAt = rest.indexOf('\\",');
  if (endAt < 0) return '';
  const raw = rest.slice(0, endAt);
  const decoded = decodeEscaped(raw).replace(/\\\\/g, '\\').replace(/\\"/g, '"');
  return /^https?:\/\//i.test(decoded) ? decoded : '';
}
async function postGoogleBatch(fReq) {
  const body = `f.req=${encodeURIComponent(fReq)}`;
  const response = await fetchWithTimeout('https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36',
      referer: 'https://news.google.com/'
    },
    body
  });
  if (!response.ok) throw new Error(`Google batch HTTP ${response.status}`);
  const text = await response.text();
  const decoded = parseGartUrlResponse(text);
  if (!decoded) throw new Error('Google batch returned no publisher URL');
  return decoded;
}
async function decodeGoogleNewsFast(sourceUrl) {
  const id = googleArticleId(sourceUrl);
  if (!id) throw new Error('Google News article id missing');
  const context = [
    ['en-US', 'US', ['FINANCE_TOP_INDICES', 'WEB_TEST_1_0_0'], null, null, 1, 1, 'US:en', null, 180, null, null, null, null, null, 0, null, null, [1608992183, 723341000]],
    'en-US', 'US', 1, [2, 3, 4, 8], 1, 0, '655000234', 0, 0, null, 0
  ];
  const request = ['garturlreq', context, id];
  const fReq = JSON.stringify([[['Fbv4je', JSON.stringify(request), null, 'generic']]]);
  return postGoogleBatch(fReq);
}
async function decodeGoogleNewsSigned(sourceUrl) {
  const id = googleArticleId(sourceUrl);
  if (!id) throw new Error('Google News article id missing');
  const page = await fetchPage(`https://news.google.com/articles/${id}`);
  const tags = page.html.match(/<(?:div|c-wiz)\b[^>]*>/gi) || [];
  let signature = '', timestamp = '';
  for (const tag of tags) {
    const attrs = parseAttrs(tag);
    if (attrs['data-n-a-sg'] && attrs['data-n-a-ts']) {
      signature = attrs['data-n-a-sg'];
      timestamp = attrs['data-n-a-ts'];
      break;
    }
  }
  if (!signature || !timestamp) throw new Error('Google signature/timestamp missing');
  const context = [
    ['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
    'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0
  ];
  const request = ['garturlreq', context, id, Number(timestamp), signature];
  const fReq = JSON.stringify([[['Fbv4je', JSON.stringify(request), null, 'generic']]]);
  return postGoogleBatch(fReq);
}
async function decodeGoogleNewsUrl(sourceUrl) {
  try {
    const decoded = await decodeGoogleNewsFast(sourceUrl);
    if (decoded && !isGoogleNews(decoded)) return { url: decoded, method: 'google-batch-fast' };
  } catch (error) {
    console.warn(`[Images] Google fast decode failed: ${error.message}`);
  }
  try {
    const decoded = await decodeGoogleNewsSigned(sourceUrl);
    if (decoded && !isGoogleNews(decoded)) return { url: decoded, method: 'google-batch-signed' };
  } catch (error) {
    console.warn(`[Images] Google signed decode failed: ${error.message}`);
  }
  return null;
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

function storySearchTitle(story) {
  return String(story.sourceTitle || story.originalTitle || story.title || '').replace(/["'“”]/g, ' ').replace(/\s+/g, ' ').trim();
}
async function searchPublisherPage(story, domains) {
  if (!domains.length) return null;
  const title = storySearchTitle(story);
  if (!title) return null;
  for (const domain of domains) {
    const queries = [`site:${domain} "${title}"`, `site:${domain} ${title}`];
    for (const query of queries) {
      try {
        const rssUrl = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
        const { text } = await fetchTextAny(rssUrl, { accept: 'application/rss+xml,application/xml,text/xml,*/*;q=0.8' });
        const xml = parser.parse(text);
        const rawItems = xml?.rss?.channel?.item ?? [];
        const items = Array.isArray(rawItems) ? rawItems : [rawItems];
        for (const item of items.slice(0, 8)) {
          const link = String(item?.link || '').trim();
          if (!link || !hostMatches(link, [domain])) continue;
          try {
            const page = await fetchPage(link);
            if (hostMatches(page.url, [domain])) return { ...page, resolutionMethod: 'publisher-search' };
          } catch {}
        }
      } catch (error) {
        console.warn(`[Images] Publisher search failed (${domain}): ${error.message}`);
      }
    }
  }
  return null;
}

async function resolveSourcePage(story) {
  if (!story.sourceUrl || story.sourceId === 'molakhas-editorial') return null;
  const domains = expectedDomains[story.sourceId] || [];

  if (!isGoogleNews(story.sourceUrl)) {
    try {
      const page = await fetchPage(story.sourceUrl);
      return { ...page, resolutionMethod: 'direct-source' };
    } catch (error) {
      const searched = await searchPublisherPage(story, domains);
      return searched || { error: `source page ${error.message}` };
    }
  }

  const decoded = await decodeGoogleNewsUrl(story.sourceUrl);
  if (decoded?.url && (!domains.length || hostMatches(decoded.url, domains))) {
    try {
      const page = await fetchPage(decoded.url);
      if (!domains.length || hostMatches(page.url, domains)) {
        return { ...page, resolutionMethod: decoded.method };
      }
    } catch (error) {
      console.warn(`[Images] Decoded publisher page failed: ${error.message}`);
    }
  }

  try {
    const googlePage = await fetchPage(story.sourceUrl);
    const links = collectExternalUrls(googlePage.html, googlePage.url)
      .filter((url) => !isGoogleNews(url))
      .filter((url) => !/googleusercontent\.com|gstatic\.com|youtube\.com|youtu\.be/i.test(url));
    const ranked = [
      ...links.filter((url) => hostMatches(url, domains)),
      ...links.filter((url) => !domains.length)
    ];
    for (const url of [...new Set(ranked)].slice(0, 10)) {
      try {
        const page = await fetchPage(url);
        if (domains.length && !hostMatches(page.url, domains)) continue;
        return { ...page, resolutionMethod: 'google-page-link' };
      } catch {}
    }
  } catch {}

  const searched = await searchPublisherPage(story, domains);
  return searched || { error: 'publisher page could not be resolved from Google News' };
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
function jsonLdImages(html) {
  const out = [];
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  const visit = (value, imageContext = false) => {
    if (!value) return;
    if (typeof value === 'string') {
      if (imageContext && /^https?:\/\//i.test(value)) out.push(value);
      return;
    }
    if (Array.isArray(value)) return value.forEach((child) => visit(child, imageContext));
    if (typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const lower = String(key).toLowerCase();
      const nextImageContext = imageContext || ['image', 'thumbnailurl', 'contenturl'].includes(lower);
      if (nextImageContext) visit(child, true);
      else if (typeof child === 'object') visit(child, false);
    }
  };
  for (const script of scripts) {
    const raw = script.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    try { visit(JSON.parse(raw), false); } catch {}
  }
  return out;
}
function articleImages(html) {
  const article = html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] || html;
  const out = [];
  for (const tag of article.match(/<img\b[^>]*>/gi) || []) {
    const attrs = parseAttrs(tag);
    const srcset = String(attrs.srcset || attrs['data-srcset'] || '')
      .split(',').map((x) => x.trim().split(/\s+/)[0]).filter(Boolean);
    out.push(attrs.src, attrs['data-src'], attrs['data-original'], attrs['data-lazy-src'], ...srcset);
  }
  return out.filter(Boolean);
}
function badImageUrl(url = '') {
  return /(?:logo|icon|favicon|avatar|sprite|placeholder|blank|tracking|pixel|badge|weather|stock)[-_./?]/i.test(url)
    || /\.svg(?:$|\?)/i.test(url);
}
async function probeImage(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(FETCH_TIMEOUT_MS, 12000));
  try {
    const response = await fetch(url, {
      redirect: 'follow', signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36',
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        range: 'bytes=0-65535',
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
  if (!page?.html) return { error: page?.error || 'publisher page unavailable' };

  const candidates = [...new Set([
    ...metaValues(page.html, ['og:image', 'og:image:url', 'og:image:secure_url']),
    ...metaValues(page.html, ['twitter:image', 'twitter:image:src']),
    ...jsonLdImages(page.html),
    ...articleImages(page.html)
  ].map((x) => absoluteUrl(x, page.url)).filter(Boolean))]
    .filter((url) => !badImageUrl(url))
    .filter((url) => !/news\.google\.|gstatic\.com/i.test(url));

  for (const url of candidates.slice(0, 18)) {
    const probe = await probeImage(url, page.url);
    if (!probe.ok) continue;
    const width = Number(metaValues(page.html, ['og:image:width'])[0] || 0);
    const height = Number(metaValues(page.html, ['og:image:height'])[0] || 0);
    return {
      src: probe.finalUrl, type: probe.type,
      width: width > 0 ? width : undefined,
      height: height > 0 ? height : undefined,
      pageUrl: page.url,
      resolutionMethod: page.resolutionMethod || 'source-page'
    };
  }
  return { error: `publisher resolved (${page.resolutionMethod || 'unknown'}) but no usable source image found` };
}

function wrapArabic(text, maxChars = 33, maxLines = 4) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = []; let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (test.length > maxChars && line) {
      lines.push(line); line = word;
      if (lines.length >= maxLines - 1) break;
    } else line = test;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.join(' ').length > lines.join(' ').length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.…]+$/u, '')}…`;
  }
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
      src: sourceImage.src, fallbackSrc, kind: 'source-remote', external: true,
      provider: story.sourceName || 'المصدر الأصلي',
      sourceUrl: sourceImage.pageUrl || story.sourceUrl,
      originalStoryUrl: story.sourceUrl,
      type: sourceImage.type, width: sourceImage.width, height: sourceImage.height,
      alt: story.image?.alt || story.title,
      caption: `الصورة المستخدمة في صفحة المصدر الأصلي للخبر — ${story.sourceName || 'المصدر'}.`,
      resolverVersion: RESOLVER_VERSION,
      resolutionMethod: sourceImage.resolutionMethod
    };
    resolved += 1;
    if (current.kind && current.kind !== 'source-remote') refreshed += 1;
    console.log(`[Images] Source image (${sourceImage.resolutionMethod}): ${story.slug} ← ${sourceImage.pageUrl || story.sourceName}`);
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
console.log(`[Images] Source-first resolver v${RESOLVER_VERSION}: ${resolved} source images, ${fallback} branded fallbacks, ${refreshed} upgraded entries.`);
