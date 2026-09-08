import matches from '../data/matches.json';

export type MatchEventDetail = {
  minute?: string;
  type?: string;
  player?: string;
  assist?: string;
  teamId?: number | null;
  team?: string;
  score?: string;
  description?: string;
};

export type MatchStatDetail = { title: string; home: string; away: string };

export type MolakhasMatch = {
  id: number;
  slug: string;
  date: string;
  kickoff: string;
  timezone?: string;
  state: 'upcoming' | 'scheduled' | 'live' | 'final';
  score?: string;
  league: { id?: number; name: string; country?: string };
  home: { id?: number; name: string; score?: number | null };
  away: { id?: number; name: string; score?: number | null };
  tournamentStage?: string;
  section: string;
  opportunityScore: number;
  indexable?: boolean;
  indexQualityScore?: number;
  source?: string;
  sourceUrl?: string;
  updatedAt?: string;
  details?: {
    venue?: string;
    referee?: string;
    attendance?: number | null;
    round?: string;
    events?: MatchEventDetail[];
    stats?: MatchStatDetail[];
    lineups?: { home?: string[]; away?: string[] };
    topPlayers?: { name: string; team?: string; rating?: number | null }[];
    xg?: { home?: string; away?: string } | null;
    hasDetails?: boolean;
    detailProvider?: string;
    detailUpdatedAt?: string;
    fetchMethod?: string;
  };
};

export const allMatches = (matches as MolakhasMatch[])
  .filter((item) => item?.slug && item?.kickoff && item?.home?.name && item?.away?.name)
  .sort((a, b) => +new Date(a.kickoff) - +new Date(b.kickoff));

export function riyadhDate(value: string | Date = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

export function todayMatches(now = new Date()) {
  const day = riyadhDate(now);
  return allMatches.filter((item) => item.date === day);
}

export function matchStateArabic(state: MolakhasMatch['state']) {
  if (state === 'live') return 'مباشر الآن';
  if (state === 'final') return 'انتهت';
  return 'لم تبدأ';
}

export function matchTimeArabic(kickoff: string) {
  return new Intl.DateTimeFormat('ar-SA-u-nu-latn', {
    timeZone: 'Asia/Riyadh', hour: 'numeric', minute: '2-digit'
  }).format(new Date(kickoff));
}

export function matchDateArabic(kickoff: string) {
  return new Intl.DateTimeFormat('ar-SA-u-nu-latn', {
    timeZone: 'Asia/Riyadh', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).format(new Date(kickoff));
}

export function groupByLeague(items: MolakhasMatch[]) {
  const map = new Map<string, MolakhasMatch[]>();
  for (const item of items) {
    const key = item.league?.name || 'كرة القدم';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return [...map.entries()].sort((a, b) => {
    const bestA = Math.max(...a[1].map((x) => x.opportunityScore || 0));
    const bestB = Math.max(...b[1].map((x) => x.opportunityScore || 0));
    return bestB - bestA;
  });
}

export function matchIndexQualityScore(match: MolakhasMatch) {
  if (Number.isFinite(Number(match.indexQualityScore))) return Number(match.indexQualityScore);
  let score = 20;
  const opportunity = Number(match.opportunityScore || 0);
  if (opportunity >= 55) score += 20;
  if (opportunity >= 75) score += 15;
  if (opportunity >= 90) score += 10;
  if (match.state === 'live' || match.state === 'final') score += 8;
  if (match.details?.hasDetails) score += 10;
  if (match.details?.venue) score += 3;
  if ((match.details?.events?.length || 0) >= 2) score += 5;
  if ((match.details?.stats?.length || 0) >= 3) score += 5;
  if ((match.details?.lineups?.home?.length || 0) >= 8 && (match.details?.lineups?.away?.length || 0) >= 8) score += 4;
  return Math.max(0, Math.min(100, score));
}

export function isMatchIndexable(match: MolakhasMatch) {
  return match.indexable !== false && matchIndexQualityScore(match) >= 55;
}

export function indexableMatches() {
  return allMatches.filter(isMatchIndexable);
}
