import matches from '../data/matches.json';

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
  source?: string;
  sourceUrl?: string;
  updatedAt?: string;
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
  return new Intl.DateTimeFormat('ar-SA', {
    timeZone: 'Asia/Riyadh', hour: 'numeric', minute: '2-digit'
  }).format(new Date(kickoff));
}

export function matchDateArabic(kickoff: string) {
  return new Intl.DateTimeFormat('ar-SA', {
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

export function indexableMatches() {
  return allMatches.filter((item) => item.indexable !== false && (item.opportunityScore || 0) >= 55);
}
