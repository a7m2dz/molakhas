import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://www.fotmob.com';
const TIMEZONE = process.env.FOTMOB_TIMEZONE || 'Asia/Riyadh';
const COUNTRY = process.env.FOTMOB_CCODE3 || 'SAU';
const TIMEOUT_MS = Number(process.env.FOTMOB_TIMEOUT_MS || 9000);
const TRENDING_LIMIT = Number(process.env.FOTMOB_TRENDING_LIMIT || 24);
const MATCH_WINDOW_HOURS = Number(process.env.FOTMOB_MATCH_WINDOW_HOURS || 30);
const ENABLED = String(process.env.FOTMOB_RADAR_ENABLED || 'true').toLowerCase() !== 'false';
const CACHE_DIR = new URL('../../.cache/', import.meta.url);
const SNAPSHOT_PATH = new URL('../../.cache/fotmob-radar.json', import.meta.url);
const MATCHES_PATH = new URL('../../src/data/matches.json', import.meta.url);

const BIG_TEAM = /(?:Al Hilal|Al Nassr|Al Ittihad|Al Ahli|Al Qadsiah|Al Shabab|الهلال|النصر|الاتحاد|الأهلي|القادسية|الشباب|Real Madrid|Barcelona|Liverpool|Arsenal|Manchester City|Manchester United|Chelsea|Tottenham|Paris Saint-Germain|PSG|Bayern Munich|Inter(?: Milan)?|AC Milan|Juventus|Atletico Madrid|Borussia Dortmund|Newcastle United)/iu;
const SAUDI_SIGNAL = /(?:Saudi Pro League|Roshn|Saudi Arabia|Al Hilal|Al Nassr|Al Ittihad|Al Ahli|Al Qadsiah|Al Shabab|الهلال|النصر|الاتحاد|الأهلي|القادسية|الشباب)/iu;
const TRANSFER_SIGNAL = /(?:transfer|signing|signs|joins|joined|move|bid|deal|contract|loan|fee|انتقال|صفقة|تعاقد)/iu;

const DOMESTIC_COMPETITIONS = [
  /^(?:Premier League|FA Cup|EFL Cup|Carabao Cup|Community Shield)$/iu,
  /^(?:LaLiga|La Liga|LaLiga EA Sports|Copa del Rey|Supercopa de España|Spanish Super Cup)$/iu,
  /^(?:Bundesliga|DFB-Pokal|DFB Pokal|DFL-Supercup|Franz Beckenbauer Supercup)$/iu,
  /^(?:Serie A|Coppa Italia|Supercoppa Italiana)$/iu,
  /^(?:Ligue 1|Coupe de France|Trophée des Champions|Trophee des Champions)$/iu,
  /^(?:Saudi Pro League|Saudi Professional League|Roshn Saudi League|King Cup|King's Cup|Saudi King Cup|Saudi Super Cup|Custodian of the Two Holy Mosques Cup)$/iu
];

const CONTINENTAL_COMPETITIONS = [
  /^(?:Champions League|UEFA Champions League)$/iu,
  /^(?:Europa League|UEFA Europa League)$/iu,
  /^(?:Conference League|UEFA Conference League)$/iu,
  /^(?:UEFA Super Cup)$/iu,
  /^(?:AFC Champions League|AFC Champions League Elite|AFC Champions League Two|Asian Champions League)$/iu,
  /^(?:Club World Cup|FIFA Club World Cup|FIFA Intercontinental Cup)$/iu
];

const clean = (value = '') => String(value).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
const slugify = (value = '') => clean(value)
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 115);

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
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(value);
  const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${map.year}${map.month}${map.day}`;
}

function localDateISO(epochMs) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(epochMs));
  const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function isDomesticCompetition(name = '') {
  return DOMESTIC_COMPETITIONS.some((pattern) => pattern.test(clean(name)));
}

function isContinentalCompetition(name = '') {
  return CONTINENTAL_COMPETITIONS.some((pattern) => pattern.test(clean(name)));
}

function isSaudiCompetition(league = {}) {
  const name = clean(league?.name || '');
  const ccode = clean(league?.ccode || '').toUpperCase();
  return /(?:Saudi|Roshn|King Cup|King's Cup)/iu.test(name) || ['SAU', 'KSA'].includes(ccode);
}

function relevantMatch(league, match) {
  const leagueName = clean(league?.name || '');
  if (isDomesticCompetition(leagueName) || isContinentalCompetition(leagueName)) return true;
  const text = `${leagueName} ${match?.home?.name || ''} ${match?.away?.name || ''}`;
  return BIG_TEAM.test(text) && /(?:Super Cup|Friendly|Club World Cup|Intercontinental)/iu.test(leagueName);
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

function matchState(match, now) {
  const finished = Boolean(match?.status?.finished);
  const started = Boolean(match?.status?.started);
  if (finished) return 'final';
  if (started) return 'live';
  const kickoff = +new Date(match?.status?.utcTime || match?.timeTS || now);
  return kickoff > now ? 'upcoming' : 'scheduled';
}

function matchOpportunity(league, match, state, now) {
  const leagueName = clean(league?.name || '');
  const text = `${leagueName} ${match?.home?.name || ''} ${match?.away?.name || ''}`;
  let score = 25;
  if (isDomesticCompetition(leagueName)) score += 20;
  if (isContinentalCompetition(leagueName)) score += 25;
  if (isSaudiCompetition(league) || SAUDI_SIGNAL.test(text)) score += 18;
  if (BIG_TEAM.test(text)) score += 24;
  if (state === 'live') score += 15;
  else if (state === 'final') score += 10;
  else {
    const kickoff = +new Date(match?.status?.utcTime || match?.timeTS || now);
    const hours = (kickoff - now) / 3_600_000;
    if (hours <= 12) score += 12;
    else if (hours <= 36) score += 8;
  }
  return Math.min(100, score);
}

function makeMatchRecord(league, match, now) {
  if (!match?.id || !match?.home?.name || !match?.away?.name || !relevantMatch(league, match)) return null;
  const leagueName = clean(league?.name || 'Football');
  const home = clean(match.home.name);
  const away = clean(match.away.name);
  const kickoffRaw = match?.status?.utcTime || (match?.timeTS ? new Date(Number(match.timeTS)).toISOString() : null);
  const kickoff = new Date(kickoffRaw || now);
  const kickoffMs = Number.isNaN(+kickoff) ? now : +kickoff;
  const state = matchState(match, now);
  const score = clean(match?.status?.scoreStr || `${match?.home?.score ?? ''} - ${match?.away?.score ?? ''}`).replace(/^\s*-\s*$/, '');
  const section = (isSaudiCompetition(league) || SAUDI_SIGNAL.test(`${leagueName} ${home} ${away}`)) ? 'saudi' : 'football';
  const opportunityScore = matchOpportunity(league, match, state, now);
  const date = localDateISO(kickoffMs);
  const slug = `${slugify(`${home}-${away}`)}-${date}-${match.id}`;
  return {
    id: Number(match.id),
    slug,
    date,
    kickoff: new Date(kickoffMs).toISOString(),
    timezone: TIMEZONE,
    state,
    score,
    league: {
      id: Number(league?.id || match?.leagueId || 0),
      name: leagueName,
      country: clean(league?.ccode || '')
    },
    home: {
      id: Number(match?.home?.id || 0),
      name: home,
      score: Number.isFinite(Number(match?.home?.score)) ? Number(match.home.score) : null
    },
    away: {
      id: Number(match?.away?.id || 0),
      name: away,
      score: Number.isFinite(Number(match?.away?.score)) ? Number(match.away.score) : null
    },
    tournamentStage: clean(match?.tournamentStage || ''),
    section,
    opportunityScore,
    indexable: opportunityScore >= 55,
    source: 'FotMob',
    sourceUrl: `https://www.fotmob.com/matches/${encodeURIComponent(`${home}-vs-${away}`)}#${match.id}`,
    updatedAt: new Date(now).toISOString()
  };
}

function matchCandidate(record, now) {
  if (!record) return null;
  const kickoffMs = +new Date(record.kickoff);
  const deltaHours = (kickoffMs - now) / 3_600_000;
  if (record.state === 'upcoming' && deltaHours > MATCH_WINDOW_HOURS) return null;
  if (record.state === 'final' && deltaHours < -Math.max(30, MATCH_WINDOW_HOURS)) return null;
  let title;
  if (record.state === 'final') title = `${record.home.name} ${record.score || 'vs'} ${record.away.name} - ${record.league.name} result`;
  else if (record.state === 'live') title = `${record.home.name} ${record.score || 'vs'} ${record.away.name} - ${record.league.name} live`;
  else title = `${record.home.name} vs ${record.away.name} - ${record.league.name} match`;
  return {
    title,
    link: `fotmob://match/${record.id}/${record.state}`,
    radarUrl: record.sourceUrl,
    description: `FotMob match signal: ${record.league.name}; ${record.home.name} vs ${record.away.name}; state=${record.state}${record.score ? `; score=${record.score}` : ''}.`,
    pubDate: new Date(record.state === 'live' ? now : Math.min(kickoffMs, now)).toISOString(),
    section: record.section,
    sourceId: 'fotmob-match-radar',
    sourceName: 'FotMob Match Radar',
    trust: 90,
    priority: record.state === 'live' ? 96 : record.state === 'final' ? 93 : 86,
    autoPublish: false,
    discoveryOnly: true,
    radarKind: `fotmob-${record.state}`,
    fotmobSignal: true,
    fotmobMatchId: record.id
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

async function fetchMatches(now) {
  const keys = [-1, 0, 1, 2].map((offset) => dateKey(now, offset));
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
  const records = [];
  const seen = new Set();
  for (const payload of payloads) {
    const leagues = Array.isArray(payload?.leagues) ? payload.leagues : [];
    for (const league of leagues) {
      for (const match of Array.isArray(league?.matches) ? league.matches : []) {
        const record = makeMatchRecord(league, match, now);
        if (!record || seen.has(record.id)) continue;
        seen.add(record.id);
        records.push(record);
      }
    }
  }
  return records.sort((a, b) => +new Date(a.kickoff) - +new Date(b.kickoff));
}

async function mergeMatchArchive(current, now) {
  let previous = [];
  try {
    const parsed = JSON.parse(await fs.readFile(MATCHES_PATH, 'utf8'));
    previous = Array.isArray(parsed) ? parsed : [];
  } catch {}
  const map = new Map(previous.map((item) => [Number(item.id), item]));
  for (const item of current) map.set(Number(item.id), item);
  const minTime = now - 90 * 86_400_000;
  const maxTime = now + 10 * 86_400_000;
  return [...map.values()]
    .filter((item) => {
      const time = +new Date(item.kickoff || 0);
      return Number.isFinite(time) && time >= minTime && time <= maxTime;
    })
    .sort((a, b) => +new Date(b.kickoff) - +new Date(a.kickoff))
    .slice(0, 2000);
}

export async function getFotMobRadarCandidates({ now = Date.now() } = {}) {
  if (!ENABLED) return { candidates: [], matches: [], stats: { enabled: false, trending: 0, matches: 0, total: 0 } };
  const [trending, matchRecords] = await Promise.all([fetchTrending(now), fetchMatches(now)]);
  const matchSignals = matchRecords.map((record) => matchCandidate(record, now)).filter(Boolean).slice(0, 120);
  return {
    candidates: [...trending, ...matchSignals],
    matches: matchRecords,
    stats: {
      enabled: true,
      trending: trending.length,
      matches: matchSignals.length,
      matchPages: matchRecords.filter((item) => item.indexable).length,
      total: trending.length + matchSignals.length
    }
  };
}

async function main() {
  const now = Date.now();
  const result = await getFotMobRadarCandidates({ now });
  console.log(`[FotMob] Radar: ${result.stats.trending || 0} trending + ${result.stats.matches || 0} match signals = ${result.stats.total || 0}; ${result.stats.matchPages || 0} indexable match pages.`);

  if (process.argv.includes('--write')) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(SNAPSHOT_PATH, `${JSON.stringify(result.candidates, null, 2)}\n`, 'utf8');
    const archive = await mergeMatchArchive(result.matches, now);
    await fs.writeFile(MATCHES_PATH, `${JSON.stringify(archive, null, 2)}\n`, 'utf8');
    console.log(`[FotMob] Snapshot updated: ${result.candidates.length} radar signals; match archive: ${archive.length}.`);
  } else {
    console.table(result.candidates.slice(0, 30).map((item) => ({
      kind: item.radarKind,
      section: item.section,
      source: item.sourceName,
      title: item.title.slice(0, 90)
    })));
  }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main().catch(async (error) => {
  console.warn(`[FotMob] Radar failed non-fatally: ${error.message}`);
  if (process.argv.includes('--write')) {
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(SNAPSHOT_PATH, '[]\n', 'utf8');
    } catch {}
  }
});
