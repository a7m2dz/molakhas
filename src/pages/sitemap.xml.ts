import stories from '../data/stories.json';
import matches from '../data/matches.json';
import imageManifest from '../data/image-manifest.json';
import { sections } from '../data/sections';
import { topicCounts } from '../lib/content';
import { buildTeamHubs, buildCompetitionHubs } from '../lib/hubs';
import { competitionHubQuality, isHubIndexable, teamHubQuality } from '../lib/index-quality';
import { isMatchIndexable } from '../lib/matches';
export const prerender = true;
const base = 'https://mulakhas.com';
const esc = (v='') => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const absolute = (value='') => /^https?:\/\//i.test(String(value)) ? String(value) : `${base}${String(value).startsWith('/') ? '' : '/'}${value}`;
export function GET() {
  const mediaMap = imageManifest as Record<string, any>;
  const publicStories = stories.filter(s=>s.status==='approved' && s.sourceId!=='molakhas-editorial');
  // Latest publish per section — used for section-index lastmod and thin-page gating.
  const latestInSection = new Map<string, any>();
  for (const s of publicStories as any[]) {
    const existing = latestInSection.get(s.section);
    if (!existing || +new Date(s.publishedAt) > +new Date(existing.publishedAt)) latestInSection.set(s.section, s);
  }
  const staticUrls = [
    { path: '/', lastmod: new Date().toISOString() },
    { path: '/latest', lastmod: publicStories[0]?.generatedAt || publicStories[0]?.publishedAt || new Date().toISOString() },
    { path: '/matches' }, { path: '/matches/today', lastmod: new Date().toISOString() },
    { path: '/teams' }, { path: '/competitions' },
    { path: '/about' }, { path: '/editorial-policy' }, { path: '/corrections' }, { path: '/contact' },
    { path: '/authors/editorial-team' }, { path: '/privacy' }, { path: '/disclosure' },
    // Sections are listed only when they hold at least one approved story; empty sections stay crawlable via nav but are dropped from the sitemap.
    ...sections.filter((item)=>latestInSection.has(item.slug)).map((item)=> { const latest = latestInSection.get(item.slug); return { path:`/${item.slug}`, lastmod: latest?.generatedAt || latest?.publishedAt }; })
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
  const matchUrls = (matches as any[])
    .filter((m)=>m?.slug && isMatchIndexable(m) && Number(m.opportunityScore || 0) >= 55)
    .map((m)=>({ path:`/matches/${m.slug}`, lastmod:m.updatedAt || m.kickoff }));
  const teamUrls = buildTeamHubs()
    .filter((hub)=>isHubIndexable(teamHubQuality(hub)))
    .map((hub)=>({ path:`/teams/${hub.slug}`, lastmod:hub.updatedAt }));
  const competitionUrls = buildCompetitionHubs()
    .filter((hub)=>isHubIndexable(competitionHubQuality(hub)))
    .map((hub)=>({ path:`/competitions/${hub.slug}`, lastmod:hub.updatedAt }));
  const topics = [...topicCounts(publicStories as any[]).entries()]
    .filter(([,data])=>data.count>=2)
    .map(([slug])=>({ path:`/topic/${slug}` }));
  const allUrls: { path: string; lastmod?: string }[] = [...staticUrls,...topics,...matchUrls,...teamUrls,...competitionUrls];
  const staticXml = allUrls.map(item=>`<url><loc>${esc(base+item.path)}</loc>${item.lastmod?`<lastmod>${new Date(item.lastmod).toISOString()}</lastmod>`:''}</url>`).join('');
  const articleXml = articleUrls.map(item=>`<url><loc>${esc(base+item.path)}</loc>${item.lastmod?`<lastmod>${new Date(item.lastmod).toISOString()}</lastmod>`:''}<image:image><image:loc>${esc(encodeURI(item.image))}</image:loc><image:title>${esc(item.imageTitle)}</image:title></image:image></url>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${staticXml}${articleXml}</urlset>`;
  return new Response(xml, { headers: { 'Content-Type':'application/xml; charset=utf-8', 'Cache-Control':'public,max-age=900' } });
}
