import { buildCompetitionHubs, buildTeamHubs } from './hubs';
import type { MolakhasMatch } from './matches';

function normalize(value = '') {
  return String(value)
    .toLocaleLowerCase('ar')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ـً-ْ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function storyText(story: any) {
  return normalize([
    story?.title,
    story?.excerpt,
    story?.focusKeyword,
    ...(Array.isArray(story?.tags) ? story.tags : []),
    ...(Array.isArray(story?.entities) ? story.entities : [])
  ].filter(Boolean).join(' '));
}

function termMatch(haystack: string, term = '') {
  const needle = normalize(term);
  if (!needle || needle.length < 3) return false;
  return haystack.includes(needle);
}

export function graphForStory(story: any) {
  const haystack = storyText(story);
  const teams = buildTeamHubs()
    .filter((hub) => hub.terms.some((term) => termMatch(haystack, term)))
    .sort((a, b) => Number(b.opportunityScore || 0) - Number(a.opportunityScore || 0))
    .slice(0, 4);

  const competitions = buildCompetitionHubs()
    .filter((hub) => hub.terms.some((term) => termMatch(haystack, term)))
    .sort((a, b) => Number(b.opportunityScore || 0) - Number(a.opportunityScore || 0))
    .slice(0, 3);

  const matchMap = new Map<number, MolakhasMatch>();
  for (const hub of [...teams, ...competitions]) {
    for (const match of hub.matches || []) matchMap.set(Number(match.id), match);
  }

  const now = Date.now();
  const matches = [...matchMap.values()]
    .map((match) => {
      let relevance = Number(match.opportunityScore || 0);
      const home = normalize(match.home?.name || '');
      const away = normalize(match.away?.name || '');
      const league = normalize(match.league?.name || '');
      if ((home && haystack.includes(home)) || (away && haystack.includes(away))) relevance += 18;
      if (league && haystack.includes(league)) relevance += 10;
      const deltaHours = (+new Date(match.kickoff) - now) / 3_600_000;
      if (match.state === 'live') relevance += 30;
      else if (deltaHours >= -8 && deltaHours <= 36) relevance += 18;
      else if (match.state === 'final' && deltaHours >= -36) relevance += 10;
      return { match, relevance, distance: Math.abs(deltaHours) };
    })
    .filter((item) => item.relevance >= 60)
    .sort((a, b) => (b.relevance - a.relevance) || (a.distance - b.distance))
    .slice(0, 4)
    .map((item) => item.match);

  return { teams, competitions, matches };
}

export function graphRelatedScore(current: any, candidate: any) {
  const currentGraph = graphForStory(current);
  const candidateText = storyText(candidate);
  let score = 0;
  for (const team of currentGraph.teams) if (team.terms.some((term) => termMatch(candidateText, term))) score += 8;
  for (const competition of currentGraph.competitions) if (competition.terms.some((term) => termMatch(candidateText, term))) score += 5;
  const sharedTags = (candidate?.tags || []).filter((tag: string) => (current?.tags || []).includes(tag)).length;
  score += sharedTags * 3;
  if (candidate?.section === current?.section) score += 1.5;
  score += Math.min(2, Number(candidate?.importance || 0) * 0.15);
  return score;
}
