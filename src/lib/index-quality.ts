export function teamHubQuality(hub: any) {
  let score = 20;
  if (hub?.known) score += 15;
  const matches = Array.isArray(hub?.matches) ? hub.matches : [];
  const stories = Array.isArray(hub?.stories) ? hub.stories : [];
  const opportunity = Number(hub?.opportunityScore || 0);
  if (matches.length >= 1) score += 10;
  if (matches.length >= 3) score += 10;
  if (stories.length >= 1) score += 10;
  if (stories.length >= 3) score += 10;
  if (opportunity >= 70) score += 10;
  if (opportunity >= 90) score += 5;
  return Math.max(0, Math.min(100, score));
}

export function competitionHubQuality(hub: any) {
  let score = 20;
  if (hub?.known) score += 15;
  const matches = Array.isArray(hub?.matches) ? hub.matches : [];
  const stories = Array.isArray(hub?.stories) ? hub.stories : [];
  const teams = Array.isArray(hub?.teams) ? hub.teams : [];
  const opportunity = Number(hub?.opportunityScore || 0);
  if (matches.length >= 2) score += 10;
  if (matches.length >= 6) score += 10;
  if (teams.length >= 4) score += 10;
  if (stories.length >= 1) score += 10;
  if (stories.length >= 3) score += 10;
  if (opportunity >= 75) score += 5;
  return Math.max(0, Math.min(100, score));
}

export function hubRobots(score: number) {
  return score >= 55
    ? 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1'
    : 'noindex,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1';
}

export function isHubIndexable(score: number) {
  return Number(score || 0) >= 55;
}
