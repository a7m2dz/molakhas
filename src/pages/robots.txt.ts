export const prerender = true;
const base = 'https://mulakhas.com';
export function GET() {
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\nSitemap: ${base}/news-sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control':'public,max-age=86400' } });
}
