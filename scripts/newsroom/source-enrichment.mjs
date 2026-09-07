import { XMLParser } from 'fast-xml-parser';

const FETCH_TIMEOUT_MS = Number(process.env.SOURCE_ENRICH_TIMEOUT_MS || 18000);
const MAX_SOURCE_CHARS = Number(process.env.SOURCE_ENRICH_MAX_CHARS || 9000);
const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, processEntities: true });

const expectedDomains = {
  'reuters-football': ['reuters.com'],
  'reuters-transfers': ['reuters.com'],
  'reuters-boxing': ['reuters.com'],
  'saudi-official': ['spl.com.sa', 'saff.com.sa'],
  'ufc-official': ['ufc.com'],
  'wwe-official': ['wwe.com']
};

const decodeEntities = (value = '') => String(value)
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&#x2f;/gi, '/').replace(/&#47;/g, '/');
const decodeEscaped = (value = '') => decodeEntities(String(value))
  .replace(/\\u0026/gi, '&').replace(/\\u003d/gi, '=').replace(/\\u003f/gi, '?')
  .replace(/\\u002f/gi, '/').replace(/\\\//g, '/');
const cleanText = (value = '') => decodeEntities(String(value))
  .replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/[\t\r ]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

function parseAttrs(tag = '') {
  const attrs = {};
  const re = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = re.exec(tag))) attrs[String(match[1]).toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  return attrs;
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
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try { return await fetch(url, { redirect: 'follow', ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
async function fetchPage(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36 MolakhasBot/5.0',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'ar-SA,ar;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = response.headers.get('content-type') || '';
  if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error(`Not HTML: ${type}`);
  return { html: await response.text(), url: response.url || url };
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
  const response = await fetchWithTimeout('https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36',
      referer: 'https://news.google.com/'
    },
    body: `f.req=${encodeURIComponent(fReq)}`
  });
  if (!response.ok) throw new Error(`Google batch HTTP ${response.status}`);
  const decoded = parseGartUrlResponse(await response.text());
  if (!decoded) throw new Error('Google batch returned no publisher URL');
  return decoded;
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
      signature = attrs['data-n-a-sg']; timestamp = attrs['data-n-a-ts']; break;
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
async function searchPublisherPage(item, domains) {
  if (!domains.length || !item.title) return null;
  const title = String(item.title).replace(/["'“”]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const domain of domains) {
    try {
      const rssUrl = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(`site:${domain} ${title}`)}`;
      const response = await fetchWithTimeout(rssUrl, { headers: { accept: 'application/rss+xml,application/xml,text/xml,*/*;q=0.8' } });
      if (!response.ok) continue;
      const xml = parser.parse(await response.text());
      const rawItems = xml?.rss?.channel?.item ?? [];
      const items = Array.isArray(rawItems) ? rawItems : [rawItems];
      for (const result of items.slice(0, 6)) {
        const link = String(result?.link || '').trim();
        if (!link || !hostMatches(link, [domain])) continue;
        try {
          const page = await fetchPage(link);
          if (hostMatches(page.url, [domain])) return { ...page, method: 'publisher-search' };
        } catch {}
      }
    } catch {}
  }
  return null;
}

function extractJsonLdText(html) {
  const chunks = [];
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== 'object') return;
    if (typeof value.articleBody === 'string') chunks.push(value.articleBody);
    if (typeof value.description === 'string' && /NewsArticle|Article|ReportageNewsArticle/i.test(String(value['@type'] || ''))) chunks.push(value.description);
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
  };
  for (const script of scripts) {
    const raw = script.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    try { visit(JSON.parse(raw)); } catch {}
  }
  return chunks;
}
function extractParagraphs(html) {
  const cleanedHtml = String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(?:nav|header|footer|aside|form)\b[\s\S]*?<\/(?:nav|header|footer|aside|form)>/gi, ' ');
  const container = cleanedHtml.match(/<article\b[\s\S]*?<\/article>/i)?.[0]
    || cleanedHtml.match(/<main\b[\s\S]*?<\/main>/i)?.[0]
    || cleanedHtml;
  const paragraphs = [];
  for (const match of container.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = cleanText(match[1]);
    if (text.length >= 35 && text.length <= 1800) paragraphs.push(text);
  }
  return paragraphs;
}
function extractSourceText(html) {
  const chunks = [...extractJsonLdText(html), ...extractParagraphs(html)]
    .map(cleanText).filter((text) => text.length >= 35);
  const seen = new Set();
  const unique = [];
  for (const chunk of chunks) {
    const key = chunk.toLowerCase().replace(/\s+/g, ' ').slice(0, 220);
    if (seen.has(key)) continue;
    seen.add(key); unique.push(chunk);
  }
  return unique.join('\n\n').slice(0, MAX_SOURCE_CHARS).trim();
}

export async function enrichCandidate(item) {
  const domains = expectedDomains[item.sourceId] || [];
  let page = null;
  let method = '';
  try {
    if (!isGoogleNews(item.link)) {
      page = await fetchPage(item.link); method = 'direct-source';
    } else {
      try {
        const decoded = await decodeGoogleNewsSigned(item.link);
        if (decoded && (!domains.length || hostMatches(decoded, domains))) {
          page = await fetchPage(decoded); method = 'google-batch-signed';
        }
      } catch (error) {
        console.warn(`[Source] Google decode failed for ${item.title}: ${error.message}`);
      }
      if (!page) {
        const searched = await searchPublisherPage(item, domains);
        if (searched) { page = searched; method = searched.method || 'publisher-search'; }
      }
    }
  } catch (error) {
    console.warn(`[Source] Publisher fetch failed for ${item.title}: ${error.message}`);
  }

  if (!page?.html) return { ...item, sourceContent: '', publisherUrl: '', enrichmentMethod: 'rss-only' };
  const sourceContent = extractSourceText(page.html);
  if (!sourceContent) return { ...item, sourceContent: '', publisherUrl: page.url, enrichmentMethod: `${method}-no-text` };
  return { ...item, sourceContent, publisherUrl: page.url, enrichmentMethod: method || 'publisher-page' };
}
