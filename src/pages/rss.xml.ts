import stories from '../data/stories.json';
export const prerender = true;
const base = (import.meta.env.PUBLIC_SITE_URL || 'https://molakhas.a7asmari.workers.dev').replace(/\/$/, '');
const esc = (v='') => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function GET() {
  const items = stories.filter(s=>s.status==='approved').sort((a,b)=>+new Date(b.publishedAt)-+new Date(a.publishedAt)).slice(0,60).map(s=>{
    const url = `${base}/${s.section}/${s.slug}`;
    const image = `${base}${s.image?.src || `/news-images/${s.slug}.webp`}`;
    return `<item><title>${esc(s.title)}</title><link>${esc(url)}</link><description>${esc(s.excerpt)}</description><pubDate>${new Date(s.publishedAt).toUTCString()}</pubDate><guid isPermaLink="true">${esc(url)}</guid><media:content url="${esc(image)}" type="image/webp" width="1200" height="675" medium="image"/><media:description type="plain">${esc(s.image?.alt || s.title)}</media:description></item>`;
  }).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>ملخص</title><link>${base}</link><description>أهم الأخبار الرياضية العربية والعالمية</description><language>ar-SA</language><atom:link href="${base}/rss.xml" rel="self" type="application/rss+xml"/><lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items}</channel></rss>`;
  return new Response(xml,{headers:{'Content-Type':'application/rss+xml; charset=utf-8','Cache-Control':'public,max-age=600'}});
}
