import stories from '../data/stories.json';
import { sections } from '../data/sections';
export const prerender = true;
const base = (import.meta.env.PUBLIC_SITE_URL || 'https://molakhas.a7asmari.workers.dev').replace(/\/$/, '');
const esc = (v='') => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function GET() {
  const staticUrls = [
    { path: '', lastmod: new Date().toISOString() },
    { path: '/about' }, { path: '/privacy' }, { path: '/disclosure' },
    ...sections.map(s=>({ path:`/${s.slug}` }))
  ];
  const articleUrls = stories.filter(s=>s.status==='approved').map(s=>({
    path:`/${s.section}/${s.slug}`,
    lastmod:s.generatedAt || s.publishedAt,
    image:s.image?.src || `/news-images/${s.slug}.webp`,
    imageTitle:s.image?.alt || s.title
  }));
  const staticXml = staticUrls.map(item=>`<url><loc>${esc(base+item.path)}</loc>${item.lastmod?`<lastmod>${new Date(item.lastmod).toISOString()}</lastmod>`:''}</url>`).join('');
  const articleXml = articleUrls.map(item=>`<url><loc>${esc(base+item.path)}</loc>${item.lastmod?`<lastmod>${new Date(item.lastmod).toISOString()}</lastmod>`:''}<image:image><image:loc>${esc(base+item.image)}</image:loc><image:title>${esc(item.imageTitle)}</image:title></image:image></url>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${staticXml}${articleXml}</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
