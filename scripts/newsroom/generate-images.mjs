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

const sectionNames = {
  football: 'كرة القدم',
  saudi: 'الكرة السعودية',
  transfers: 'الانتقالات',
  ufc: 'UFC',
  wwe: 'WWE',
  boxing: 'الملاكمة'
};

const palettes = {
  football: ['#07101d', '#0f3150', '#59e6a8'],
  saudi: ['#07101d', '#153d34', '#59e6a8'],
  transfers: ['#07101d', '#2b254f', '#9a8cff'],
  ufc: ['#07101d', '#4a1e27', '#ff6b6b'],
  wwe: ['#07101d', '#35214d', '#c692ff'],
  boxing: ['#07101d', '#4c3418', '#ffbd59']
};

function esc(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function stripHtml(value = '') {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}

function archiveSubject(story) {
  const arabicTags = (story.tags || []).filter((tag) => /\p{Script=Arabic}/u.test(String(tag))).slice(0, 2);
  if (arabicTags.length) return arabicTags.join(' و');
  const section = sectionNames[story.section] || 'الخبر الرياضي';
  return section;
}

function archivalCopy(story) {
  const subject = archiveSubject(story);
  return {
    alt: `صورة أرشيفية مرتبطة بـ${subject} من Wikimedia Commons`,
    caption: `صورة أرشيفية مرتبطة بـ${subject}؛ لا تمثل بالضرورة الحدث المذكور في الخبر.`
  };
}

function wrapArabic(text, maxChars = 33, maxLines = 4) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (test.length > maxChars && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines - 1) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.join(' ').length > lines.join(' ').length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.…]+$/u, '')}…`;
  }
  return lines;
}

function allowedLicense(meta = {}) {
  const short = String(meta?.LicenseShortName?.value || meta?.License?.value || '').replace(/<[^>]*>/g, '').trim();
  if (/public domain/i.test(short)) return true;
  if (/^CC0(?:\s*1\.0)?$/i.test(short)) return true;
  if (/^CC BY(?:-SA)?(?:\s*[1-4]\.0)?$/i.test(short)) return true;
  return false;
}

async function searchCommons(query) {
  if (!query || query.length < 2) return null;
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', query);
  url.searchParams.set('gsrnamespace', '6');
  url.searchParams.set('gsrlimit', '10');
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|size|mime|extmetadata');
  url.searchParams.set('iiurlwidth', '1600');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');

  const response = await fetch(url, { headers: { 'user-agent': 'MolakhasImageBot/1.1 (https://molakhas.a7asmari.workers.dev)' } });
  if (!response.ok) throw new Error(`Commons search ${response.status}`);
  const data = await response.json();
  const pages = Object.values(data?.query?.pages || {});

  const candidates = pages.map((page) => {
    const info = page?.imageinfo?.[0];
    return { page, info, meta: info?.extmetadata || {} };
  }).filter(({ info, meta }) => {
    if (!info?.url) return false;
    if (!/^image\/(jpeg|png|webp)$/i.test(info?.mime || '')) return false;
    if (Number(info?.width || 0) < 1000 || Number(info?.height || 0) < 550) return false;
    return allowedLicense(meta);
  });

  if (!candidates.length) return null;
  candidates.sort((a, b) => (Number(b.info.width) * Number(b.info.height)) - (Number(a.info.width) * Number(a.info.height)));
  const { page, info, meta } = candidates[0];
  return {
    downloadUrl: info.thumburl || info.url,
    sourceUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/^File:/, 'File:'))}`,
    title: String(page.title || '').replace(/^File:/, ''),
    creator: stripHtml(meta?.Artist?.value || meta?.Credit?.value || 'Wikimedia Commons contributor'),
    license: stripHtml(meta?.LicenseShortName?.value || meta?.License?.value || 'Open license'),
    licenseUrl: String(meta?.LicenseUrl?.value || '').trim(),
    description: stripHtml(meta?.ImageDescription?.value || '')
  };
}

async function downloadBuffer(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'MolakhasImageBot/1.1 (https://molakhas.a7asmari.workers.dev)' } });
  if (!response.ok) throw new Error(`Image download ${response.status}`);
  const arr = await response.arrayBuffer();
  if (arr.byteLength > 15 * 1024 * 1024) throw new Error('Image too large');
  return Buffer.from(arr);
}

function brandOverlay(section, accent) {
  return Buffer.from(`
  <svg width="1200" height="675" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07101d" stop-opacity="0"/><stop offset="1" stop-color="#07101d" stop-opacity="0.52"/></linearGradient></defs>
    <rect width="1200" height="675" fill="url(#fade)"/>
    <rect x="875" y="535" width="255" height="76" rx="22" fill="#07101d" fill-opacity="0.76" stroke="${accent}" stroke-opacity="0.65"/>
    <text x="1095" y="571" text-anchor="end" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="25" font-weight="900" fill="${accent}">مُلخّص</text>
    <text x="1095" y="598" text-anchor="end" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="15" fill="#dfe9f6">${esc(section)}</text>
  </svg>`);
}

async function writeFallback(story, outPath) {
  const [bg, panel, accent] = palettes[story.section] || palettes.football;
  const section = sectionNames[story.section] || 'رياضة';
  const lines = wrapArabic(story.title);
  const lineSvg = lines.map((line, i) => `<text x="1080" y="${270 + i * 74}" text-anchor="end" direction="rtl" unicode-bidi="plaintext" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="54" font-weight="700" fill="#f7f9fc">${esc(line)}</text>`).join('');
  const svg = `
  <svg width="1200" height="675" viewBox="0 0 1200 675" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${panel}"/></linearGradient>
      <radialGradient id="glow" cx="0.82" cy="0.15" r="0.8"><stop offset="0" stop-color="${accent}" stop-opacity="0.28"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1200" height="675" fill="url(#bg)"/><rect width="1200" height="675" fill="url(#glow)"/>
    <circle cx="1085" cy="115" r="74" fill="none" stroke="${accent}" stroke-width="3" opacity="0.55"/><circle cx="1085" cy="115" r="48" fill="${accent}" opacity="0.14"/>
    <text x="1085" y="126" text-anchor="middle" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="30" font-weight="900" fill="${accent}">مُلخّص</text>
    <rect x="70" y="78" rx="18" ry="18" width="245" height="54" fill="#07101d" opacity="0.62" stroke="${accent}" stroke-opacity="0.4"/>
    <text x="285" y="114" text-anchor="end" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="22" font-weight="700" fill="${accent}">${esc(section)}</text>
    ${lineSvg}
    <line x1="70" y1="595" x2="1130" y2="595" stroke="#ffffff" stroke-opacity="0.12"/>
    <text x="1130" y="632" text-anchor="end" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="19" fill="#b7c4d6">molakhas.a7asmari.workers.dev</text>
  </svg>`;
  await sharp(Buffer.from(svg)).resize(1200, 675, { fit: 'cover' }).webp({ quality: 84, effort: 5 }).toFile(outPath);
}

async function ensureLogo() {
  const logoPath = path.join(brandDir, 'molakhas-logo.png');
  try { await fs.access(logoPath); return; } catch {}
  const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" rx="112" fill="#07101d"/><circle cx="256" cy="256" r="178" fill="none" stroke="#59e6a8" stroke-width="12"/><text x="256" y="282" text-anchor="middle" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="92" font-weight="900" fill="#59e6a8">ملخص</text></svg>`;
  await sharp(Buffer.from(svg)).png({ quality: 90 }).toFile(logoPath);
}

await ensureLogo();
let generated = 0;
let licensed = 0;
let fallback = 0;

for (const story of stories.filter((s) => s?.status === 'approved' && s?.slug && s?.title)) {
  const outPath = path.join(outDir, `${story.slug}.webp`);
  try {
    await fs.access(outPath);
    if (!manifest[story.slug]) {
      manifest[story.slug] = { src: `/news-images/${story.slug}.webp`, kind: 'existing', alt: story.image?.alt || story.title };
    } else if (manifest[story.slug].kind === 'wikimedia') {
      const copy = archivalCopy(story);
      manifest[story.slug].alt = copy.alt;
      manifest[story.slug].caption = copy.caption;
      manifest[story.slug].archival = true;
    }
    continue;
  } catch {}

  const section = sectionNames[story.section] || 'رياضة';
  const accent = (palettes[story.section] || palettes.football)[2];
  const query = story.image?.searchQuery || story.focusKeyword || story.entities?.[0] || '';
  let commons = null;
  try { commons = await searchCommons(query); } catch (error) { console.warn(`[Images] Commons lookup failed for ${story.slug}: ${error.message}`); }

  if (commons) {
    try {
      const input = await downloadBuffer(commons.downloadUrl);
      await sharp(input)
        .rotate()
        .resize(1200, 675, { fit: 'cover', position: 'attention' })
        .composite([{ input: brandOverlay(section, accent), top: 0, left: 0 }])
        .webp({ quality: 82, effort: 5 })
        .toFile(outPath);
      const copy = archivalCopy(story);
      manifest[story.slug] = {
        src: `/news-images/${story.slug}.webp`,
        kind: 'wikimedia',
        archival: true,
        alt: copy.alt,
        caption: copy.caption,
        creator: commons.creator,
        license: commons.license,
        licenseUrl: commons.licenseUrl,
        sourceUrl: commons.sourceUrl,
        sourceTitle: commons.title,
        sourceDescription: commons.description,
        query
      };
      licensed += 1;
      generated += 1;
      console.log(`[Images] Licensed archival photo: ${story.slug} ← ${commons.title}`);
      continue;
    } catch (error) {
      console.warn(`[Images] Licensed photo failed for ${story.slug}: ${error.message}`);
    }
  }

  await writeFallback(story, outPath);
  manifest[story.slug] = {
    src: `/news-images/${story.slug}.webp`,
    kind: 'branded-fallback',
    alt: story.image?.alt || story.title,
    caption: story.image?.caption || story.excerpt,
    query
  };
  fallback += 1;
  generated += 1;
}

await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[Images] Generated ${generated} missing WebP images (${licensed} licensed archival photos, ${fallback} branded fallbacks).`);
