export const prerender = true;
const base = (import.meta.env.PUBLIC_SITE_URL || 'https://molakhas.a7asmari.workers.dev').replace(/\/$/, '');
export function GET() {
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\nSitemap: ${base}/news-sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
