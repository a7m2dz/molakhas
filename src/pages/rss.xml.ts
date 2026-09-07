import stories from '../data/stories.json';
export const prerender = true;
const base = (import.meta.env.PUBLIC_SITE_URL || 'https://molakhas.a7asmari.workers.dev').replace(/\/$/, '');
const esc = (v='') => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function GET() {
  const items = stories.filter(s=>s.status==='approved').sort((a,b)=>+new Date(b.publishedAt)-+new Date(a.publishedAt)).slice(0,40).map(s=>`<item><title>${esc(s.title)}</title><link>${base}/${s.section}/${s.slug}</link><description>${esc(s.excerpt)}</description><pubDate>${new Date(s.publishedAt).toUTCString()}</pubDate><guid isPermaLink="true">${base}/${s.section}/${s.slug}</guid></item>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>ملخص</title><link>${base}</link><description>أهم الأخبار الرياضية العربية والعالمية</description><language>ar-SA</language><lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items}</channel></rss>`;
  return new Response(xml,{headers:{'Content-Type':'application/rss+xml; charset=utf-8'}});
}
