import stories from '../data/stories.json';
export const prerender = true;
const base = (import.meta.env.PUBLIC_SITE_URL || 'https://molakhas.a7asmari.workers.dev').replace(/\/$/, '');
const esc = (v='') => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function GET() {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const recent = stories.filter(s=>s.status==='approved' && +new Date(s.publishedAt)>=cutoff).sort((a,b)=>+new Date(b.publishedAt)-+new Date(a.publishedAt)).slice(0,1000);
  const urls = recent.map(s=>`<url><loc>${esc(`${base}/${s.section}/${s.slug}`)}</loc><news:news><news:publication><news:name>ملخص</news:name><news:language>ar</news:language></news:publication><news:publication_date>${new Date(s.publishedAt).toISOString()}</news:publication_date><news:title>${esc(s.title)}</news:title></news:news></url>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${urls}</urlset>`;
  return new Response(xml,{headers:{'Content-Type':'application/xml; charset=utf-8'}});
}
