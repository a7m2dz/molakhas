import stories from '../data/stories.json';
import { allMatches, type MolakhasMatch } from './matches';

export type HubStory = {
  slug: string;
  section: string;
  title: string;
  excerpt?: string;
  publishedAt?: string;
  generatedAt?: string;
  sourceId?: string;
  sourceName?: string;
  status?: string;
  tags?: string[];
  entities?: string[];
};

export type TeamHub = {
  slug: string;
  name: string;
  alternateName: string;
  terms: string[];
  matches: MolakhasMatch[];
  stories: HubStory[];
  opportunityScore: number;
  updatedAt: string;
  known: boolean;
};

export type CompetitionHub = {
  slug: string;
  name: string;
  alternateName: string;
  terms: string[];
  matches: MolakhasMatch[];
  stories: HubStory[];
  teams: { slug: string; name: string; alternateName: string }[];
  opportunityScore: number;
  updatedAt: string;
  known: boolean;
};

type Alias = { pattern: RegExp; slug: string; name: string; terms: string[] };

const TEAM_ALIASES: Alias[] = [
  { pattern: /^(?:Al[-\s]?Hilal(?: SFC)?|الهلال)$/iu, slug: 'al-hilal', name: 'الهلال', terms: ['الهلال', 'Al Hilal'] },
  { pattern: /^(?:Al[-\s]?Nassr(?: FC)?|النصر)$/iu, slug: 'al-nassr', name: 'النصر', terms: ['النصر', 'Al Nassr'] },
  { pattern: /^(?:Al[-\s]?Ittihad(?: Club| FC)?|الاتحاد)$/iu, slug: 'al-ittihad', name: 'الاتحاد', terms: ['الاتحاد', 'Al Ittihad'] },
  { pattern: /^(?:Al[-\s]?Ahli(?: Saudi FC| FC)?|الأهلي)$/iu, slug: 'al-ahli', name: 'الأهلي', terms: ['الأهلي', 'Al Ahli'] },
  { pattern: /^(?:Al[-\s]?Qadsiah|Al Qadisiya|القادسية)$/iu, slug: 'al-qadsiah', name: 'القادسية', terms: ['القادسية', 'Al Qadsiah', 'Al Qadisiya'] },
  { pattern: /^(?:Al[-\s]?Shabab(?: FC)?|الشباب)$/iu, slug: 'al-shabab', name: 'الشباب', terms: ['الشباب', 'Al Shabab'] },
  { pattern: /^(?:Real Madrid|ريال مدريد)$/iu, slug: 'real-madrid', name: 'ريال مدريد', terms: ['ريال مدريد', 'Real Madrid'] },
  { pattern: /^(?:Barcelona|FC Barcelona|برشلونة)$/iu, slug: 'barcelona', name: 'برشلونة', terms: ['برشلونة', 'Barcelona'] },
  { pattern: /^(?:Liverpool|Liverpool FC|ليفربول)$/iu, slug: 'liverpool', name: 'ليفربول', terms: ['ليفربول', 'Liverpool'] },
  { pattern: /^(?:Arsenal|Arsenal FC|أرسنال)$/iu, slug: 'arsenal', name: 'أرسنال', terms: ['أرسنال', 'Arsenal'] },
  { pattern: /^(?:Manchester City|Man City|مانشستر سيتي)$/iu, slug: 'manchester-city', name: 'مانشستر سيتي', terms: ['مانشستر سيتي', 'Manchester City', 'Man City'] },
  { pattern: /^(?:Manchester United|Man United|Man Utd|مانشستر يونايتد)$/iu, slug: 'manchester-united', name: 'مانشستر يونايتد', terms: ['مانشستر يونايتد', 'Manchester United', 'Man United', 'Man Utd'] },
  { pattern: /^(?:Chelsea|Chelsea FC|تشيلسي)$/iu, slug: 'chelsea', name: 'تشيلسي', terms: ['تشيلسي', 'Chelsea'] },
  { pattern: /^(?:Tottenham(?: Hotspur)?|Spurs|توتنهام)$/iu, slug: 'tottenham', name: 'توتنهام', terms: ['توتنهام', 'Tottenham', 'Spurs'] },
  { pattern: /^(?:Paris Saint[-\s]?Germain|PSG|باريس سان جيرمان)$/iu, slug: 'psg', name: 'باريس سان جيرمان', terms: ['باريس سان جيرمان', 'PSG', 'Paris Saint-Germain'] },
  { pattern: /^(?:Bayern Munich|Bayern München|بايرن ميونخ)$/iu, slug: 'bayern-munich', name: 'بايرن ميونخ', terms: ['بايرن ميونخ', 'Bayern Munich', 'Bayern München'] },
  { pattern: /^(?:Inter|Inter Milan|Internazionale|إنتر)$/iu, slug: 'inter-milan', name: 'إنتر ميلان', terms: ['إنتر', 'إنتر ميلان', 'Inter', 'Inter Milan'] },
  { pattern: /^(?:AC Milan|Milan|ميلان)$/iu, slug: 'ac-milan', name: 'ميلان', terms: ['ميلان', 'AC Milan', 'Milan'] },
  { pattern: /^(?:Juventus|يوفنتوس)$/iu, slug: 'juventus', name: 'يوفنتوس', terms: ['يوفنتوس', 'Juventus'] },
  { pattern: /^(?:Atl[eé]tico Madrid|Atletico Madrid|أتلتيكو مدريد)$/iu, slug: 'atletico-madrid', name: 'أتلتيكو مدريد', terms: ['أتلتيكو مدريد', 'Atletico Madrid', 'Atlético Madrid'] },
  { pattern: /^(?:Borussia Dortmund|Dortmund|بوروسيا دورتموند|دورتموند)$/iu, slug: 'borussia-dortmund', name: 'بوروسيا دورتموند', terms: ['دورتموند', 'بوروسيا دورتموند', 'Borussia Dortmund', 'Dortmund'] },
  { pattern: /^(?:Newcastle United|Newcastle|نيوكاسل)$/iu, slug: 'newcastle-united', name: 'نيوكاسل', terms: ['نيوكاسل', 'Newcastle United', 'Newcastle'] }
];

const COMPETITION_ALIASES: Alias[] = [
  { pattern: /^(?:Saudi Pro League|Saudi Professional League|Roshn Saudi League)$/iu, slug: 'saudi-pro-league', name: 'دوري روشن السعودي', terms: ['دوري روشن', 'الدوري السعودي', 'Saudi Pro League', 'Roshn Saudi League'] },
  { pattern: /^(?:King Cup|King's Cup|Saudi King Cup|Custodian of the Two Holy Mosques Cup)$/iu, slug: 'saudi-king-cup', name: 'كأس خادم الحرمين الشريفين', terms: ['كأس الملك', 'كأس خادم الحرمين', 'King Cup'] },
  { pattern: /^(?:Saudi Super Cup)$/iu, slug: 'saudi-super-cup', name: 'كأس السوبر السعودي', terms: ['السوبر السعودي', 'كأس السوبر السعودي', 'Saudi Super Cup'] },
  { pattern: /^(?:Premier League)$/iu, slug: 'premier-league', name: 'الدوري الإنجليزي الممتاز', terms: ['الدوري الإنجليزي', 'البريميرليغ', 'Premier League'] },
  { pattern: /^(?:FA Cup)$/iu, slug: 'fa-cup', name: 'كأس الاتحاد الإنجليزي', terms: ['كأس الاتحاد الإنجليزي', 'FA Cup'] },
  { pattern: /^(?:EFL Cup|Carabao Cup)$/iu, slug: 'efl-cup', name: 'كأس الرابطة الإنجليزية', terms: ['كأس الرابطة', 'كاراباو', 'EFL Cup', 'Carabao Cup'] },
  { pattern: /^(?:Community Shield)$/iu, slug: 'community-shield', name: 'الدرع الخيرية', terms: ['الدرع الخيرية', 'Community Shield'] },
  { pattern: /^(?:LaLiga|La Liga|LaLiga EA Sports)$/iu, slug: 'la-liga', name: 'الدوري الإسباني', terms: ['الدوري الإسباني', 'لا ليغا', 'LaLiga', 'La Liga'] },
  { pattern: /^(?:Copa del Rey)$/iu, slug: 'copa-del-rey', name: 'كأس ملك إسبانيا', terms: ['كأس ملك إسبانيا', 'Copa del Rey'] },
  { pattern: /^(?:Supercopa de España|Spanish Super Cup)$/iu, slug: 'spanish-super-cup', name: 'السوبر الإسباني', terms: ['السوبر الإسباني', 'Spanish Super Cup', 'Supercopa'] },
  { pattern: /^(?:Bundesliga)$/iu, slug: 'bundesliga', name: 'الدوري الألماني', terms: ['الدوري الألماني', 'بوندسليغا', 'Bundesliga'] },
  { pattern: /^(?:DFB-Pokal|DFB Pokal)$/iu, slug: 'dfb-pokal', name: 'كأس ألمانيا', terms: ['كأس ألمانيا', 'DFB-Pokal', 'DFB Pokal'] },
  { pattern: /^(?:DFL-Supercup|Franz Beckenbauer Supercup)$/iu, slug: 'german-super-cup', name: 'السوبر الألماني', terms: ['السوبر الألماني', 'DFL-Supercup'] },
  { pattern: /^(?:Serie A)$/iu, slug: 'serie-a', name: 'الدوري الإيطالي', terms: ['الدوري الإيطالي', 'Serie A'] },
  { pattern: /^(?:Coppa Italia)$/iu, slug: 'coppa-italia', name: 'كأس إيطاليا', terms: ['كأس إيطاليا', 'Coppa Italia'] },
  { pattern: /^(?:Supercoppa Italiana)$/iu, slug: 'italian-super-cup', name: 'السوبر الإيطالي', terms: ['السوبر الإيطالي', 'Supercoppa Italiana'] },
  { pattern: /^(?:Ligue 1)$/iu, slug: 'ligue-1', name: 'الدوري الفرنسي', terms: ['الدوري الفرنسي', 'Ligue 1'] },
  { pattern: /^(?:Coupe de France)$/iu, slug: 'coupe-de-france', name: 'كأس فرنسا', terms: ['كأس فرنسا', 'Coupe de France'] },
  { pattern: /^(?:Trophée des Champions|Trophee des Champions)$/iu, slug: 'trophee-des-champions', name: 'السوبر الفرنسي', terms: ['السوبر الفرنسي', 'Trophée des Champions'] },
  { pattern: /^(?:Champions League|UEFA Champions League)$/iu, slug: 'champions-league', name: 'دوري أبطال أوروبا', terms: ['دوري أبطال أوروبا', 'دوري الأبطال', 'Champions League', 'UCL'] },
  { pattern: /^(?:Europa League|UEFA Europa League)$/iu, slug: 'europa-league', name: 'الدوري الأوروبي', terms: ['الدوري الأوروبي', 'Europa League'] },
  { pattern: /^(?:Conference League|UEFA Conference League)$/iu, slug: 'conference-league', name: 'دوري المؤتمر الأوروبي', terms: ['دوري المؤتمر', 'Conference League'] },
  { pattern: /^(?:UEFA Super Cup)$/iu, slug: 'uefa-super-cup', name: 'السوبر الأوروبي', terms: ['السوبر الأوروبي', 'UEFA Super Cup'] },
  { pattern: /^(?:AFC Champions League|AFC Champions League Elite|Asian Champions League)$/iu, slug: 'afc-champions-league-elite', name: 'دوري أبطال آسيا للنخبة', terms: ['دوري أبطال آسيا', 'دوري أبطال آسيا للنخبة', 'AFC Champions League', 'AFC Champions League Elite'] },
  { pattern: /^(?:AFC Champions League Two)$/iu, slug: 'afc-champions-league-two', name: 'دوري أبطال آسيا 2', terms: ['دوري أبطال آسيا 2', 'AFC Champions League Two'] },
  { pattern: /^(?:Club World Cup|FIFA Club World Cup)$/iu, slug: 'club-world-cup', name: 'كأس العالم للأندية', terms: ['كأس العالم للأندية', 'Club World Cup', 'FIFA Club World Cup'] },
  { pattern: /^(?:FIFA Intercontinental Cup)$/iu, slug: 'intercontinental-cup', name: 'كأس القارات للأندية', terms: ['كأس القارات للأندية', 'FIFA Intercontinental Cup'] }
];

const publicStories = (stories as HubStory[]).filter((story) => story.status === 'approved' && story.sourceId !== 'molakhas-editorial');

function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

function aliasFor(value: string, aliases: Alias[]) {
  const raw = String(value || '').trim();
  const alias = aliases.find((item) => item.pattern.test(raw));
  if (alias) return { ...alias, alternateName: raw, known: true };
  return { slug: slugify(raw), name: raw, alternateName: raw, terms: [raw], known: false };
}

export function teamMeta(value: string) {
  return aliasFor(value, TEAM_ALIASES);
}

export function competitionMeta(value: string) {
  return aliasFor(value, COMPETITION_ALIASES);
}

function storyHaystack(story: HubStory) {
  return `${story.title || ''} ${story.excerpt || ''} ${(story.tags || []).join(' ')} ${(story.entities || []).join(' ')}`.toLocaleLowerCase('ar');
}

function storiesForTerms(terms: string[]) {
  const normalized = terms.map((term) => term.toLocaleLowerCase('ar')).filter((term) => term.length > 2);
  return publicStories
    .filter((story) => {
      const haystack = storyHaystack(story);
      return normalized.some((term) => haystack.includes(term));
    })
    .sort((a, b) => +new Date(b.publishedAt || b.generatedAt || 0) - +new Date(a.publishedAt || a.generatedAt || 0))
    .slice(0, 12);
}

function newestUpdate(items: MolakhasMatch[]) {
  const values = items.map((item) => +new Date(item.updatedAt || item.kickoff || 0)).filter(Number.isFinite);
  return new Date(values.length ? Math.max(...values) : Date.now()).toISOString();
}

export function buildTeamHubs(): TeamHub[] {
  const map = new Map<string, { meta: ReturnType<typeof teamMeta>; matches: MolakhasMatch[] }>();
  for (const match of allMatches) {
    for (const team of [match.home, match.away]) {
      const meta = teamMeta(team.name);
      if (!meta.slug) continue;
      if (!map.has(meta.slug)) map.set(meta.slug, { meta, matches: [] });
      map.get(meta.slug)!.matches.push(match);
    }
  }

  return [...map.values()]
    .map(({ meta, matches }) => {
      const terms = [...new Set([meta.name, meta.alternateName, ...meta.terms])];
      const related = storiesForTerms(terms);
      const opportunityScore = Math.max(0, ...matches.map((match) => Number(match.opportunityScore || 0)));
      return {
        slug: meta.slug,
        name: meta.name,
        alternateName: meta.alternateName,
        terms,
        matches: [...matches].sort((a, b) => +new Date(b.kickoff) - +new Date(a.kickoff)),
        stories: related,
        opportunityScore,
        updatedAt: newestUpdate(matches),
        known: meta.known
      };
    })
    .sort((a, b) => (b.opportunityScore - a.opportunityScore) || (b.matches.length - a.matches.length) || a.name.localeCompare(b.name, 'ar'));
}

export function buildCompetitionHubs(): CompetitionHub[] {
  const map = new Map<string, { meta: ReturnType<typeof competitionMeta>; matches: MolakhasMatch[] }>();
  for (const match of allMatches) {
    const meta = competitionMeta(match.league?.name || '');
    if (!meta.slug) continue;
    if (!map.has(meta.slug)) map.set(meta.slug, { meta, matches: [] });
    map.get(meta.slug)!.matches.push(match);
  }

  return [...map.values()]
    .map(({ meta, matches }) => {
      const terms = [...new Set([meta.name, meta.alternateName, ...meta.terms])];
      const related = storiesForTerms(terms);
      const teamMap = new Map<string, { slug: string; name: string; alternateName: string }>();
      for (const match of matches) {
        for (const side of [match.home, match.away]) {
          const team = teamMeta(side.name);
          if (!team.slug) continue;
          teamMap.set(team.slug, { slug: team.slug, name: team.name, alternateName: team.alternateName });
        }
      }
      const opportunityScore = Math.max(0, ...matches.map((match) => Number(match.opportunityScore || 0)));
      return {
        slug: meta.slug,
        name: meta.name,
        alternateName: meta.alternateName,
        terms,
        matches: [...matches].sort((a, b) => +new Date(b.kickoff) - +new Date(a.kickoff)),
        stories: related,
        teams: [...teamMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar')),
        opportunityScore,
        updatedAt: newestUpdate(matches),
        known: meta.known
      };
    })
    .filter((hub) => hub.known || hub.matches.length >= 2 || hub.stories.length >= 1)
    .sort((a, b) => (b.opportunityScore - a.opportunityScore) || (b.matches.length - a.matches.length) || a.name.localeCompare(b.name, 'ar'));
}

export function teamHref(name: string) {
  const meta = teamMeta(name);
  return meta.slug ? `/teams/${meta.slug}/` : '/teams/';
}

export function competitionHref(name: string) {
  const meta = competitionMeta(name);
  return meta.slug ? `/competitions/${meta.slug}/` : '/competitions/';
}
