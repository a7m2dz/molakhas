import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const stories = JSON.parse(await fs.readFile(new URL('../../src/data/stories.json', import.meta.url), 'utf8'));
const outDir = fileURLToPath(new URL('../../public/news-images/', import.meta.url));
await fs.mkdir(outDir, { recursive: true });

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

for (const story of stories) {
  if (!story?.slug || !story?.title) continue;
  const [bg, panel, accent] = palettes[story.section] || palettes.football;
  const section = sectionNames[story.section] || 'رياضة';
  const lines = wrapArabic(story.title);
  const lineSvg = lines.map((line, i) => `<text x="1080" y="${270 + i * 74}" text-anchor="end" direction="rtl" unicode-bidi="plaintext" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="54" font-weight="700" fill="#f7f9fc">${esc(line)}</text>`).join('');
  const svg = `
  <svg width="1200" height="675" viewBox="0 0 1200 675" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${bg}"/>
        <stop offset="1" stop-color="${panel}"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.82" cy="0.15" r="0.8">
        <stop offset="0" stop-color="${accent}" stop-opacity="0.28"/>
        <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1200" height="675" fill="url(#bg)"/>
    <rect width="1200" height="675" fill="url(#glow)"/>
    <circle cx="1085" cy="115" r="74" fill="none" stroke="${accent}" stroke-width="3" opacity="0.55"/>
    <circle cx="1085" cy="115" r="48" fill="${accent}" opacity="0.14"/>
    <text x="1085" y="126" text-anchor="middle" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="30" font-weight="900" fill="${accent}">مُلخّص</text>
    <rect x="70" y="78" rx="18" ry="18" width="245" height="54" fill="#07101d" opacity="0.62" stroke="${accent}" stroke-opacity="0.4"/>
    <text x="285" y="114" text-anchor="end" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="22" font-weight="700" fill="${accent}">${esc(section)}</text>
    ${lineSvg}
    <line x1="70" y1="595" x2="1130" y2="595" stroke="#ffffff" stroke-opacity="0.12"/>
    <text x="1130" y="632" text-anchor="end" direction="rtl" font-family="Tahoma, Segoe UI, Arial, sans-serif" font-size="19" fill="#b7c4d6">molakhas.a7asmari.workers.dev</text>
    <text x="70" y="632" text-anchor="start" font-family="Segoe UI, Arial, sans-serif" font-size="16" fill="#92a4bc">1200×675 • WebP</text>
  </svg>`;

  const outPath = path.join(outDir, `${story.slug}.webp`);
  await sharp(Buffer.from(svg))
    .resize(1200, 675, { fit: 'cover' })
    .webp({ quality: 84, effort: 5 })
    .toFile(outPath);
}

console.log(`[Images] Generated ${stories.filter((s) => s?.slug && s?.title).length} WebP article images.`);
