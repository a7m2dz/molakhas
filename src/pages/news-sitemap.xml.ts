import stories from '../data/stories.json';
import imageManifest from '../data/image-manifest.json';
export const prerender = true;
const base = (import.meta.env.PUBLIC_SITE_URL || 'https://mulakhas.com').replace(/\/$/, '');
const esc = (v='') => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const absolute = (value='') => /^https?:\/\//i.test(String(value)) ? String(value) : `${base}${String(value).startsWith('/') ? '' : '/'}${value}`;
export function GET() {
  const mediaMap = imageManifest as Record<string, any>;
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const recent = stories.filter(s=>s.status==='approved' && s.sourceId!=='molakhas-editorial' && +new Date(s.publishedAt)>=cutoff).sort((a,b)=>+new Date(b.publishedAt)-+new Date(a.publishedAt)).slice(0,1000);
  const urls = recent.map(s=>{
    const media = mediaMap[s.slug] || {};
    const image = absolute(media.src || s.image?.src || `/news-images/${s.slug}.webp`);
    const alt = media.alt || s.image?.alt || s.title;
    return `<url><loc>${esc(`${base}/${s.section}/${s.slug}`)}</loc><news:news><news:publication><news:name>ملخص</news:name><news:language>ar</news:language></news:publication><news:publication_date>${new Date(s.publishedAt).toISOString()}</news:publication_date><news:title>${esc(s.title)}</news:title></news:news><image:image><image:loc>${esc(encodeURI(image))}</image:loc><image:title>${esc(alt)}</image:title></image:image></url>`;
  }).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${urls}</urlset>`;
  return new Response(xml,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public,max-age=900'}});
}
