import stories from '../data/stories.json';
export const prerender = true;
const esc = (v='') => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function GET() {
  const items = stories.filter(s=>s.status==='approved').slice(0,30).map(s=>`<item><title>${esc(s.title)}</title><link>https://molakhas.com/${s.section}/${s.slug}</link><description>${esc(s.excerpt)}</description><pubDate>${new Date(s.publishedAt).toUTCString()}</pubDate><guid>https://molakhas.com/${s.section}/${s.slug}</guid></item>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>ملخص</title><link>https://molakhas.com</link><description>أهم الأخبار الرياضية</description>${items}</channel></rss>`;
  return new Response(xml,{headers:{'Content-Type':'application/rss+xml; charset=utf-8'}});
}
