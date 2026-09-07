import stories from '../data/stories.json';
import imageManifest from '../data/image-manifest.json';
import { sections } from '../data/sections';
import { topicCounts } from '../lib/content';
export const prerender = true;
const base = (import.meta.env.PUBLIC_SITE_URL || 'https://molakhas.a7asmari.workers.dev').replace(/\/$/, '');
const esc = (v='') => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const absolute = (value='') => /^https?:\/\//i.test(String(value)) ? String(value) : `${base}${String(value).startsWith('/') ? '' : '/'}${value}`;
export function GET() {
  const mediaMap = imageManifest as Record<string, any>;
  const publicStories = stories.filter(s=>s.status==='approved' && s.sourceId!=='molakhas-editorial');
  const staticUrls = [
    { path: '', lastmod: new Date().toISOString() },
    { path: '/about' }, { path: '/editorial-policy' }, { path: '/corrections' }, { path: '/contact' },
    { path: '/authors/editorial-team' }, { path: '/privacy' }, { path: '/disclosure' },
    ...sections.map(s=>({ path:`/${s.slug}` }))
  ];
  const articleUrls = publicStories.map(s=>{
    const media = mediaMap[s.slug] || {};
    return {
      path:`/${s.section}/${s.slug}`,
      lastmod:s.generatedAt || s.publishedAt,
      image:absolute(media.src || s.image?.src || `/news-images/${s.slug}.webp`),
      imageTitle:media.alt || s.image?.alt || s.title
    };
  });
  const topics = [...topicCounts(publicStories as any[]).entries()]
    .filter(([,data])=>data.count>=2)
    .map(([slug])=>({ path:`/topic/${slug}` }));
  const staticXml = [...staticUrls,...topics].map(item=>`<url><loc>${esc(base+item.path)}</loc>${item.lastmod?`<lastmod>${new Date(item.lastmod).toISOString()}</lastmod>`:''}</url>`).join('');
  const articleXml = articleUrls.map(item=>`<url><loc>${esc(base+item.path)}</loc>${item.lastmod?`<lastmod>${new Date(item.lastmod).toISOString()}</lastmod>`:''}<image:image><image:loc>${esc(item.image)}</image:loc><image:title>${esc(item.imageTitle)}</image:title></image:image></url>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${staticXml}${articleXml}</urlset>`;
  return new Response(xml, { headers: { 'Content-Type':'application/xml; charset=utf-8', 'Cache-Control':'public,max-age=900' } });
}
