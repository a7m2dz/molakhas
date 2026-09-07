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

const RELEVANCE_VERSION = 2;
const sectionNames = {
  football: 'كرة القدم', saudi: 'الكرة السعودية', transfers: 'الانتقالات',
  ufc: 'UFC', wwe: 'WWE', boxing: 'الملاكمة'
};
const palettes = {
  football: ['#07101d', '#0f3150', '#59e6a8'], saudi: ['#07101d', '#153d34', '#59e6a8'],
  transfers: ['#07101d', '#2b254f', '#9a8cff'], ufc: ['#07101d', '#4a1e27', '#ff6b6b'],
  wwe: ['#07101d', '#35214d', '#c692ff'], boxing: ['#07101d', '#4c3418', '#ffbd59']
};

const esc = (value = '') => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const stripHtml = (value = '') => String(value).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();

const STOP_TOKENS = new Set([
  'image','photo','photos','picture','news','official','highlights','sports','sport','match','game','games','team','club','football','soccer','fc',
  'صورة','صور','خبر','أخبار','اخبار','رسمي','الرسمية','رياضة','رياضي','رياضية','كرة','قدم','فريق','نادي','مباراة','مباريات','بطولة','الدوري','دوري'
]);
const CONFLICT_GROUPS = [
  ['saudi','roshn','spl','السعودي','روشن'],
  ['laliga','la-liga','spain','spanish','إسبانيا','الاسباني','الإسباني'],
  ['premier','premierleague','epl','الإنجليزي','الانجليزي'],
  ['bundesliga','germany','german','الألماني','الالماني'],
  ['seriea','italy','italian','الإيطالي','الايطالي'],
  ['wwe','smackdown','raw','wrestlemania'],
  ['ufc','mma','octagon']
];

function normalizeText(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u064B-\u065F\u0670]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function lexicalTokens(value = '') {
  return normalizeText(value).split(' ').filter((token) => token.length >= 3 && !STOP_TOKENS.has(token));
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }

function archiveSubject(story) {
  const tags = (story.tags || []).filter((tag) => /\p{Script=Arabic}/u.test(String(tag))).slice(0, 2);
  if (tags.length) return tags.join(' و');
  return sectionNames[story.section] || 'الخبر الرياضي';
}
function archivalCopy(story) {
  const subject = archiveSubject(story);
  return {
    alt: `صورة أرشيفية مرتبطة بـ${subject}`,
    caption: `صورة أرشيفية مرتبطة بـ${subject}؛ لا تمثل بالضرورة الحدث المذكور في الخبر.`
  };
}
function queryVariants(story) {
  if (story.sourceId === 'molakhas-editorial') return [];
  const entities = (story.entities || []).map(String).filter(Boolean);
  const latinEntities = entities.filter((x) => /[A-Za-z]/.test(x));
  const values = [
    story.image?.searchQuery,
    latinEntities.slice(0, 2).join(' '),
    latinEntities[0],
    entities.slice(0, 2).join(' '),
    entities[0],
    story.focusKeyword
  ].map((x) => String(x || '').trim()).filter((x) => x.length >= 3);
  return unique(values).slice(0, 6);
}
function storySignals(story) {
  const phrases = unique([
    ...(story.entities || []).map(String),
    story.image?.searchQuery,
    story.focusKeyword
  ].map((x) => normalizeText(x)).filter((x) => x.length >= 3));
  const tokens = unique([
    ...phrases.flatMap(lexicalTokens),
    ...lexicalTokens(story.title)
  ]);
  return { phrases, tokens };
}
function conflictReason(story, candidateText) {
  const storyText = normalizeText(`${story.title} ${(story.entities || []).join(' ')} ${story.image?.searchQuery || ''} ${story.focusKeyword || ''}`);
  const hay = normalizeText(candidateText);
  const storyGroups = CONFLICT_GROUPS.filter((group) => group.some((term) => storyText.includes(normalizeText(term))));
  const candidateGroups = CONFLICT_GROUPS.filter((group) => group.some((term) => hay.includes(normalizeText(term))));
  if (!storyGroups.length || !candidateGroups.length) return '';
  const sharesGroup = storyGroups.some((group) => candidateGroups.includes(group));
  if (sharesGroup) return '';
  return 'conflicting competition/organization';
}
function evaluateCandidate(candidate, query, story) {
  const hay = normalizeText(`${candidate.title || ''} ${candidate.description || ''} ${(candidate.tags || []).join(' ')}`);
  if (!hay) return { accepted: false, score: 0, matchedTerms: [], reason: 'empty metadata' };

  const conflict = conflictReason(story, hay);
  if (conflict) return { accepted: false, score: 0, matchedTerms: [], reason: conflict };

  const qTokens = unique(lexicalTokens(query));
  const signals = storySignals(story);
  const matchedQuery = qTokens.filter((token) => hay.includes(token));
  const matchedAnchors = signals.tokens.filter((token) => hay.includes(token));
  const exactPhrases = signals.phrases.filter((phrase) => phrase.includes(' ') && phrase.length >= 7 && hay.includes(phrase));
  const strongSingle = matchedAnchors.filter((token) => token.length >= 6);

  const accepted = exactPhrases.length > 0 || matchedAnchors.length >= 2 || matchedQuery.length >= 2 || strongSingle.length >= 1;
  if (!accepted) {
    return {
      accepted: false,
      score: 0,
      matchedTerms: unique([...matchedQuery, ...matchedAnchors]),
      reason: 'insufficient entity match'
    };
  }

  let score = exactPhrases.length * 35 + matchedAnchors.length * 12 + matchedQuery.length * 8;
  const width = Number(candidate.width || 0), height = Number(candidate.height || 0);
  if (width && height) {
    const ratio = width / height;
    if (ratio >= 1.3 && ratio <= 2.15) score += 6;
    if (width >= 1200 && height >= 650) score += 4;
  }
  return { accepted: true, score, matchedTerms: unique([...exactPhrases, ...matchedAnchors, ...matchedQuery]).slice(0, 8), reason: '' };
}

function isCommercialEditableLicense(value = '') {
  const v = String(value).toLowerCase().replace(/^cc\s*/, '').trim();
  return ['cc0', 'pdm', 'by', 'by-sa'].includes(v) || /^by-sa(?:\s|$)/.test(v) || /^by(?:\s|$)/.test(v);
}
async function searchOpenverse(query) {
  const url = new URL('https://api.openverse.org/v1/images/');
  url.searchParams.set('q', query);
  url.searchParams.set('page_size', '30');
  const response = await fetch(url, { headers: { 'user-agent': 'MolakhasImageBot/2.1 (https://molakhas.a7asmari.workers.dev)', accept: 'application/json' } });
  if (!response.ok) throw new Error(`Openverse search ${response.status}`);
  const data = await response.json();
  return (data?.results || [])
    .filter((item) => (item?.url || item?.thumbnail) && isCommercialEditableLicense(item?.license) && !item?.mature)
    .map((item) => ({
      downloadUrl: item.url || item.thumbnail,
      backupUrl: item.thumbnail || null,
      sourceUrl: item.foreign_landing_url || item.detail_url || '',
      title: stripHtml(item.title || ''),
      creator: stripHtml(item.creator || 'Openverse contributor'),
      license: [String(item.license || '').toUpperCase(), item.license_version].filter(Boolean).join(' '),
      licenseUrl: item.license_url || '',
      provider: item.provider || item.source || 'Openverse',
      description: stripHtml(item.description || ''),
      tags: (item.tags || []).map((tag) => stripHtml(tag?.name || tag)).filter(Boolean),
      width: Number(item.width || 0), height: Number(item.height || 0), query
    }));
}

function allowedCommonsLicense(meta = {}) {
  const short = String(meta?.LicenseShortName?.value || meta?.License?.value || '').replace(/<[^>]*>/g, '').trim();
  return /public domain/i.test(short) || /^CC0(?:\s*1\.0)?$/i.test(short) || /^CC BY(?:-SA)?(?:\s*[1-4]\.0)?$/i.test(short);
}
async function searchCommons(query) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.searchParams.set('action', 'query'); url.searchParams.set('generator', 'search'); url.searchParams.set('gsrsearch', query);
  url.searchParams.set('gsrnamespace', '6'); url.searchParams.set('gsrlimit', '20'); url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|size|mime|extmetadata'); url.searchParams.set('iiurlwidth', '1600'); url.searchParams.set('format', 'json'); url.searchParams.set('origin', '*');
  const response = await fetch(url, { headers: { 'user-agent': 'MolakhasImageBot/2.1 (https://molakhas.a7asmari.workers.dev)' } });
  if (!response.ok) throw new Error(`Commons search ${response.status}`);
  const data = await response.json();
  return Object.values(data?.query?.pages || {}).map((page) => {
    const info = page?.imageinfo?.[0], meta = info?.extmetadata || {};
    return { page, info, meta };
  }).filter(({ info, meta }) => info?.url && /^image\/(jpeg|png|webp)$/i.test(info?.mime || '') && Number(info?.width || 0) >= 900 && Number(info?.height || 0) >= 500 && allowedCommonsLicense(meta))
    .map(({ page, info, meta }) => ({
      downloadUrl: info.thumburl || info.url,
      backupUrl: info.url,
      sourceUrl: info.descriptionurl || '',
      title: String(page.title || '').replace(/^File:/, ''),
      creator: stripHtml(meta?.Artist?.value || meta?.Credit?.value || 'Wikimedia Commons contributor'),
      license: stripHtml(meta?.LicenseShortName?.value || meta?.License?.value || 'Open license'),
      licenseUrl: String(meta?.LicenseUrl?.value || '').trim(),
      provider: 'Wikimedia Commons',
      description: stripHtml(meta?.ImageDescription?.value || ''),
      tags: [], width: Number(info?.width || 0), height: Number(info?.height || 0), query
    }));
}

async function downloadBuffer(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'MolakhasImageBot/2.1 (https://molakhas.a7asmari.workers.dev)', accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' } });
  if (!response.ok) throw new Error(`Image download ${response.status}`);
  const type = response.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error(`Not an image: ${type || 'unknown content-type'}`);
  const arr = await response.arrayBuffer();
  if (!arr.byteLength || arr.byteLength > 18 * 1024 * 1024) throw new Error('Invalid image size');
  return Buffer.from(arr);
}
function brandOverlay(section, accent) {
  return Buffer.from(`<svg width="1200" height="675" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07101d" stop-opacity="0"/><stop offset="1" stop-color="#07101d" stop-opacity="0.50"/></linearGradient></defs><rect width="1200" height="675" fill="url(#fade)"/><rect x="875" y="535" width="255" height="76" rx="22" fill="#07101d" fill-opacity="0.76" stroke="${accent}" stroke-opacity="0.65"/><text x="1095" y="571" text-anchor="end" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="25" font-weight="900" fill="${accent}">مُلخّص</text><text x="1095" y="598" text-anchor="end" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="15" fill="#dfe9f6">${esc(section)}</text></svg>`);
}
async function savePhoto(candidate, story, outPath, relevance) {
  let input;
  try { input = await downloadBuffer(candidate.downloadUrl); }
  catch (error) {
    if (!candidate.backupUrl || candidate.backupUrl === candidate.downloadUrl) throw error;
    input = await downloadBuffer(candidate.backupUrl);
  }
  const section = sectionNames[story.section] || 'رياضة';
  const accent = (palettes[story.section] || palettes.football)[2];
  await sharp(input).rotate().resize(1200, 675, { fit: 'cover', position: 'attention' }).composite([{ input: brandOverlay(section, accent), top: 0, left: 0 }]).webp({ quality: 82, effort: 5 }).toFile(outPath);
  const copy = archivalCopy(story);
  manifest[story.slug] = {
    src: `/news-images/${story.slug}.webp`, kind: 'open-photo', archival: true,
    alt: copy.alt, caption: copy.caption, creator: candidate.creator, license: candidate.license,
    licenseUrl: candidate.licenseUrl, sourceUrl: candidate.sourceUrl, sourceTitle: candidate.title,
    provider: candidate.provider, sourceDescription: candidate.description, query: candidate.query,
    relevanceVersion: RELEVANCE_VERSION, relevanceScore: relevance.score, matchedTerms: relevance.matchedTerms
  };
}

function wrapArabic(text, maxChars = 33, maxLines = 4) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean); const lines = []; let line = '';
  for (const word of words) { const test = line ? `${line} ${word}` : word; if (test.length > maxChars && line) { lines.push(line); line = word; if (lines.length >= maxLines - 1) break; } else line = test; }
  if (line && lines.length < maxLines) lines.push(line); if (words.join(' ').length > lines.join(' ').length && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.…]+$/u, '')}…`;
  return lines;
}
async function writeFallback(story, outPath, reason = '') {
  const [bg, panel, accent] = palettes[story.section] || palettes.football; const section = sectionNames[story.section] || 'رياضة'; const lines = wrapArabic(story.title);
  const lineSvg = lines.map((line, i) => `<text x="1080" y="${270 + i * 74}" text-anchor="end" direction="rtl" unicode-bidi="plaintext" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="54" font-weight="700" fill="#f7f9fc">${esc(line)}</text>`).join('');
  const svg = `<svg width="1200" height="675" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${panel}"/></linearGradient></defs><rect width="1200" height="675" fill="url(#bg)"/>${lineSvg}<text x="1085" y="126" text-anchor="middle" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="30" font-weight="900" fill="${accent}">مُلخّص</text><text x="1130" y="632" text-anchor="end" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="19" fill="#b7c4d6">molakhas.a7asmari.workers.dev</text></svg>`;
  await sharp(Buffer.from(svg)).resize(1200, 675, { fit: 'cover' }).webp({ quality: 84, effort: 5 }).toFile(outPath);
  manifest[story.slug] = {
    src: `/news-images/${story.slug}.webp`, kind: 'branded-fallback',
    alt: story.image?.alt || story.title, caption: story.image?.caption || story.excerpt,
    query: queryVariants(story)[0] || '', relevanceVersion: RELEVANCE_VERSION,
    rejectionReason: reason || 'no sufficiently relevant open photo found'
  };
}
async function ensureLogo() {
  const logoPath = path.join(brandDir, 'molakhas-logo.png'); try { await fs.access(logoPath); return; } catch {}
  const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" rx="112" fill="#07101d"/><circle cx="256" cy="256" r="178" fill="none" stroke="#59e6a8" stroke-width="12"/><text x="256" y="282" text-anchor="middle" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="92" font-weight="900" fill="#59e6a8">ملخص</text></svg>`;
  await sharp(Buffer.from(svg)).png({ quality: 90 }).toFile(logoPath);
}

await ensureLogo();
let generated = 0, realPhotos = 0, upgraded = 0, fallback = 0, rejected = 0;
for (const story of stories.filter((s) => s?.status === 'approved' && s?.slug && s?.title)) {
  const outPath = path.join(outDir, `${story.slug}.webp`); const current = manifest[story.slug] || {};
  let fileExists = false; try { await fs.access(outPath); fileExists = true; } catch {}

  const currentTrusted = fileExists && current.kind === 'open-photo' && Number(current.relevanceVersion || 0) >= RELEVANCE_VERSION && Number(current.relevanceScore || 0) > 0;
  if (currentTrusted) continue;

  if (story.sourceId === 'molakhas-editorial') {
    await writeFallback(story, outPath, 'editorial story uses branded artwork');
    generated += 1; fallback += 1;
    console.log(`[Images] Branded editorial image: ${story.slug}`);
    continue;
  }

  let saved = false;
  let rejectionReason = 'no candidate passed entity relevance';
  for (const query of queryVariants(story)) {
    let candidates = [];
    try { candidates.push(...await searchOpenverse(query)); } catch (error) { console.warn(`[Images] Openverse lookup failed (${query}): ${error.message}`); }
    try { candidates.push(...await searchCommons(query)); } catch (error) { console.warn(`[Images] Commons lookup failed (${query}): ${error.message}`); }

    const ranked = candidates
      .map((candidate) => ({ candidate, relevance: evaluateCandidate(candidate, query, story) }))
      .filter((x) => x.relevance.accepted)
      .sort((a, b) => b.relevance.score - a.relevance.score)
      .slice(0, 10);

    if (!ranked.length) {
      rejected += candidates.length;
      continue;
    }

    for (const { candidate, relevance } of ranked) {
      try {
        await savePhoto(candidate, story, outPath, relevance);
        saved = true; realPhotos += 1; generated += 1; if (fileExists) upgraded += 1;
        console.log(`[Images] Relevant photo [${relevance.score}]: ${story.slug} ← ${candidate.provider} / ${candidate.title || query} :: ${relevance.matchedTerms.join(', ')}`);
        break;
      } catch (error) {
        rejectionReason = error.message;
        console.warn(`[Images] Candidate failed for ${story.slug}: ${error.message}`);
      }
    }
    if (saved) break;
  }
  if (saved) continue;

  await writeFallback(story, outPath, rejectionReason);
  fallback += 1; generated += 1;
  if (fileExists) upgraded += 1;
  console.warn(`[Images] No sufficiently relevant real photo for ${story.slug}; using branded fallback.`);
}
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[Images] Generated/updated ${generated} images (${realPhotos} relevant real photos, ${upgraded} replacements, ${fallback} branded fallbacks, ${rejected} irrelevant candidates rejected).`);
