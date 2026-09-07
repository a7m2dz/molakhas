import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://www.fotmob.com';
const TIMEZONE = process.env.FOTMOB_TIMEZONE || 'Asia/Riyadh';
const COUNTRY = process.env.FOTMOB_CCODE3 || 'SAU';
const TIMEOUT_MS = Number(process.env.FOTMOB_TIMEOUT_MS || 9000);
const TRENDING_LIMIT = Number(process.env.FOTMOB_TRENDING_LIMIT || 24);
const MATCH_WINDOW_HOURS = Number(process.env.FOTMOB_MATCH_WINDOW_HOURS || 18);
const ENABLED = String(process.env.FOTMOB_RADAR_ENABLED || 'true').toLowerCase() !== 'false';

const IMPORTANT_LEAGUE = /(?:Saudi Pro League|Roshn Saudi League|Premier League|Champions League|Europa League|LaLiga|La Liga|Bundesliga|Serie A|Ligue 1|FA Cup|EFL Cup|Copa del Rey|Super Cup|Club World Cup|World Cup|AFC Champions League|MLS)/iu;
const BIG_TEAM = /(?:Al Hilal|Al Nassr|Al Ittihad|Al Ahli|الهلال|النصر|الاتحاد|الأهلي|Real Madrid|Barcelona|Liverpool|Arsenal|Manchester City|Manchester United|Chelsea|Tottenham|Paris Saint-Germain|PSG|Bayern Munich|Inter|AC Milan|Juventus|Atletico Madrid|Borussia Dortmund)/iu;
const SAUDI_SIGNAL = /(?:Saudi Pro League|Roshn|Saudi Arabia|Al Hilal|Al Nassr|Al Ittihad|Al Ahli|Al Qadsiah|Al Shabab|الهلال|النصر|الاتحاد|الأهلي|القادسية|الشباب)/iu;
const TRANSFER_SIGNAL = /(?:transfer|signing|signs|joins|joined|move|bid|deal|contract|loan|fee|انتقال|صفقة|تعاقد)/iu;

const clean = (value = '') => String(value).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();

function browserHeaders() {
  return {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    accept: 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache'
  };
}

async function fetchJson(pathname, params = {}) {
  const url = new URL(pathname, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: browserHeaders(), signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function dateKey(epochMs, offsetDays = 0) {
  const value = new Date(epochMs + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${map.year}${map.month}${map.day}`;
}

function classifySection(text = '') {
  if (SAUDI_SIGNAL.test(text)) return 'saudi';
  if (TRANSFER_SIGNAL.test(text)) return 'transfers';
  return 'football';
}

function normalizeNewsDate(value, now) {
  const parsed = new Date(value || now);
  return Number.isNaN(+parsed) ? new Date(now).toISOString() : parsed.toISOString();
}

function trendingCandidate(article, index, now) {
  const title = clean(article?.title);
  if (!title) return null;
  const source = clean(article?.sourceStr || 'FotMob');
  const lead = clean(article?.lead || '');
  const externalUrl = clean(article?.page?.url || '');
  const text = `${title} ${lead} ${source}`;
  return {
    title,
    link: `fotmob://trending/${article?.id || index}`,
    radarUrl: externalUrl,
    description: `${lead}${lead ? ' ' : ''}Trending on FotMob. Source: ${source}.`.slice(0, 2400),
    pubDate: normalizeNewsDate(article?.gmtTime, now),
    section: classifySection(text),
    sourceId: 'fotmob-trending-radar',
    sourceName: `FotMob Trending${source ? ` • ${source}` : ''}`,
    trust: 86,
    priority: 86,
    autoPublish: false,
    discoveryOnly: true,
    radarKind: 'fotmob-trending',
    fotmobSignal: true
  };
}

function relevantMatch(league, match) {
  const text = `${league?.name || ''} ${match?.home?.name || ''} ${match?.away?.name || ''}`;
  return IMPORTANT_LEAGUE.test(text) || BIG_TEAM.test(text);
}

function matchCandidate(league, match, now) {
  if (!match?.id || !match?.home?.name || !match?.away?.name || !relevantMatch(league, match)) return null;

  const kickoff = new Date(match?.status?.utcTime || match?.timeTS || now);
  const kickoffMs = Number.isNaN(+kickoff) ? now : +kickoff;
  const deltaHours = (kickoffMs - now) / 3_600_000;
  const finished = Boolean(match?.status?.finished);
  const started = Boolean(match?.status?.started);

  if (!started && deltaHours > MATCH_WINDOW_HOURS) return null;
  if (finished && deltaHours < -Math.max(24, MATCH_WINDOW_HOURS)) return null;

  const home = clean(match.home.name);
  const away = clean(match.away.name);
  const leagueName = clean(league?.name || 'Football');
  const score = clean(match?.status?.scoreStr || `${match?.home?.score ?? ''} - ${match?.away?.score ?? ''}`).replace(/^\s*-\s*$/, '');
  let title;
  let state;

  if (finished) {
    title = `${home} ${score || 'vs'} ${away} - ${leagueName} result`;
    state = 'final';
  } else if (started) {
    title = `${home} ${score || 'vs'} ${away} - ${leagueName} live`;
    state = 'live';
  } else {
    title = `${home} vs ${away} - ${leagueName} match`;
    state = 'upcoming';
  }

  const section = SAUDI_SIGNAL.test(`${leagueName} ${home} ${away}`) ? 'saudi' : 'football';
  return {
    title,
    link: `fotmob://match/${match.id}/${state}`,
    radarUrl: `https://www.fotmob.com/matches/${encodeURIComponent(`${home}-vs-${away}`)}#${match.id}`,
    description: `FotMob match signal: ${leagueName}; ${home} vs ${away}; state=${state}${score ? `; score=${score}` : ''}.`,
    pubDate: new Date(started ? now : Math.min(kickoffMs, now)).toISOString(),
    section,
    sourceId: 'fotmob-match-radar',
    sourceName: 'FotMob Match Radar',
    trust: 90,
    priority: state === 'live' ? 94 : finished ? 92 : 84,
    autoPublish: false,
    discoveryOnly: true,
    radarKind: `fotmob-${state}`,
    fotmobSignal: true,
    fotmobMatchId: match.id
  };
}

async function fetchTrending(now) {
  try {
    const data = await fetchJson('/api/trendingnews', { lang: 'en', ccode3: COUNTRY });
    const list = Array.isArray(data) ? data : [];
    return list.slice(0, TRENDING_LIMIT).map((article, index) => trendingCandidate(article, index, now)).filter(Boolean);
  } catch (error) {
    console.warn(`[FotMob] Trending unavailable: ${error.name === 'AbortError' ? 'timeout' : error.message}`);
    return [];
  }
}

async function fetchMatchSignals(now) {
  const keys = [-1, 0, 1].map((offset) => dateKey(now, offset));
  const requests = keys.map(async (date) => {
    try {
      return await fetchJson('/api/data/matches', {
        date,
        timezone: TIMEZONE,
        ccode3: COUNTRY,
        includeNextDayLateNight: 'true'
      });
    } catch (error) {
      console.warn(`[FotMob] Matches ${date} unavailable: ${error.name === 'AbortError' ? 'timeout' : error.message}`);
      return null;
    }
  });

  const payloads = await Promise.all(requests);
  const output = [];
  const seen = new Set();
  for (const payload of payloads) {
    const leagues = Array.isArray(payload?.leagues) ? payload.leagues : [];
    for (const league of leagues) {
      for (const match of Array.isArray(league?.matches) ? league.matches : []) {
        const candidate = matchCandidate(league, match, now);
        if (!candidate || seen.has(candidate.link)) continue;
        seen.add(candidate.link);
        output.push(candidate);
      }
    }
  }
  return output.slice(0, 80);
}

export async function getFotMobRadarCandidates({ now = Date.now() } = {}) {
  if (!ENABLED) return { candidates: [], stats: { enabled: false, trending: 0, matches: 0 } };

  const [trending, matches] = await Promise.all([fetchTrending(now), fetchMatchSignals(now)]);
  return {
    candidates: [...trending, ...matches],
    stats: {
      enabled: true,
      trending: trending.length,
      matches: matches.length,
      total: trending.length + matches.length
    }
  };
}

async function main() {
  const result = await getFotMobRadarCandidates();
  console.log(`[FotMob] Radar: ${result.stats.trending || 0} trending + ${result.stats.matches || 0} match signals = ${result.stats.total || 0}.`);
  console.table(result.candidates.slice(0, 30).map((item) => ({
    kind: item.radarKind,
    section: item.section,
    source: item.sourceName,
    title: item.title.slice(0, 90)
  })));
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main().catch((error) => {
  console.error(`[FotMob] Radar failed: ${error.message}`);
  process.exitCode = 1;
});
