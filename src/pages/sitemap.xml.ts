import stories from '../data/stories.json';
import { sections } from '../data/sections';
export const prerender = true;
export function GET() {
  const base = 'https://molakhas.com';
  const paths = ['', '/about', '/privacy', '/disclosure', ...sections.map(s=>`/${s.slug}`), ...stories.filter(s=>s.status==='approved').map(s=>`/${s.section}/${s.slug}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(p=>`<url><loc>${base}${p}</loc></url>`).join('')}</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}
