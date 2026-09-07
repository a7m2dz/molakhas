import fs from 'node:fs/promises';

const MATCHES_PATH = new URL('../../src/data/matches.json', import.meta.url);
const BASE_URL = 'https://www.fotmob.com';
const TIMEOUT_MS = Number(process.env.FOTMOB_DETAIL_TIMEOUT_MS || 7000);
const DETAIL_LIMIT = Math.max(4, Math.min(24, Number(process.env.FOTMOB_DETAIL_LIMIT || 12)));
const WINDOW_HOURS = Math.max(12, Math.min(96, Number(process.env.FOTMOB_DETAIL_WINDOW_HOURS || 42)));

const clean = (value = '') => String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();

function browserHeaders() {
  return {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    accept: 'application/json,text/plain,*/*',
    'accept-language': 'en-US,en;q=0.9',
    referer: 'https://www.fotmob.com/'
  };
}

async function fetchWithTimeout(url, as = 'json') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: browserHeaders(), signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return as === 'json' ? await response.json() : await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function deepGet(obj, paths) {
  for (const path of paths) {
    let value = obj;
    let ok = true;
    for (const key of path.split('.')) {
      if (value == null || !(key in Object(value))) { ok = false; break; }
      value = value[key];
    }
    if (ok && value !== undefined && value !== null && clean(typeof value === 'object' ? '' : value)) return value;
  }
  return null;
}

function textFromMaybeObject(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return clean(value);
  return clean(value?.name || value?.label || value?.text || value?.title || value?.value || '');
}

function normalizeEvent(event = {}) {
  const player = clean(event?.player?.name || event?.playerName || event?.nameStr || event?.name || event?.who || '');
  const assist = clean(event?.assistInput || event?.assistStr || event?.assist?.name || '');
  const type = clean(event?.type || event?.eventType || event?.typeStr || event?.card || event?.incident || '');
  const minuteRaw = event?.timeStr || event?.time || event?.minute || event?.timeMinutes || '';
  const minute = clean(typeof minuteRaw === 'object' ? minuteRaw?.label || minuteRaw?.time || '' : minuteRaw);
  const score = clean(event?.newScore || event?.score || event?.scoreStr || '');
  const teamId = Number(event?.teamId || event?.team?.id || 0) || null;
  const team = clean(event?.team?.name || event?.teamName || '');
  const description = clean(event?.description || event?.reason || event?.overloadTimeStr || '');
  if (!player && !type && !description && !score) return null;
  return { minute, type, player, assist, teamId, team, score, description };
}

function extractEvents(data = {}) {
  const candidates = [
    data?.content?.matchFacts?.events?.events,
    data?.content?.matchFacts?.events,
    data?.header?.events,
    data?.content?.liveticker?.events
  ];
  for (const source of candidates) {
    const list = Array.isArray(source) ? source : Array.isArray(source?.events) ? source.events : [];
    const normalized = list.map(normalizeEvent).filter(Boolean);
    if (normalized.length) return normalized.slice(-28);
  }
  return [];
}

function collectStatRows(node, out = []) {
  if (!node || typeof node !== 'object' || out.length >= 80) return out;
  if (Array.isArray(node)) {
    for (const item of node) collectStatRows(item, out);
    return out;
  }
  const title = clean(node.title || node.name || node.label || node.key || '');
  const values = Array.isArray(node.stats) ? node.stats : Array.isArray(node.values) ? node.values : null;
  if (title && values && values.length >= 2 && values.length <= 3 && values.every((x) => ['string','number'].includes(typeof x) || x == null)) {
    out.push({ title, home: clean(values[0] ?? ''), away: clean(values[1] ?? '') });
  }
  for (const value of Object.values(node)) collectStatRows(value, out);
  return out;
}

function extractStats(data = {}) {
  const root = data?.content?.stats?.Periods?.All || data?.content?.stats?.periods?.all || data?.content?.stats || data?.stats || {};
  const rows = collectStatRows(root, []);
  const wanted = /expected goals|xg|possession|total shots|shots on target|big chances|corners|fouls|passes|accurate passes|yellow cards|red cards|saves|offsides|التسديد|الاستحواذ|الركنيات|الفرص/iu;
  const filtered = rows.filter((row) => wanted.test(row.title));
  const selected = (filtered.length ? filtered : rows).slice(0, 12);
  const seen = new Set();
  return selected.filter((row) => {
    const key = row.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractStarters(teamBlock) {
  if (!teamBlock) return [];
  const pools = [teamBlock?.starters, teamBlock?.players, teamBlock?.lineup, teamBlock];
  for (const pool of pools) {
    const list = Array.isArray(pool) ? pool : [];
    const names = list
      .filter((p) => p && (p?.isStarter !== false))
      .map((p) => clean(p?.name || p?.player?.name || p?.playerName || p?.fullName || ''))
      .filter(Boolean);
    if (names.length >= 4) return names.slice(0, 11);
  }
  return [];
}

function extractLineups(data = {}) {
  const lineup = data?.content?.lineup || data?.lineup || {};
  const containers = [lineup?.lineup, lineup?.teams, lineup];
  for (const container of containers) {
    if (Array.isArray(container) && container.length >= 2) {
      const home = extractStarters(container[0]);
      const away = extractStarters(container[1]);
      if (home.length || away.length) return { home, away };
    }
    if (container && typeof container === 'object') {
      const home = extractStarters(container.home || container.homeTeam || container[0]);
      const away = extractStarters(container.away || container.awayTeam || container[1]);
      if (home.length || away.length) return { home, away };
    }
  }
  return { home: [], away: [] };
}

function extractTopPlayers(data = {}) {
  const source = data?.content?.topPlayers || data?.content?.playerOfTheMatch || data?.topPlayers || [];
  const list = Array.isArray(source) ? source : Array.isArray(source?.players) ? source.players : source && typeof source === 'object' ? Object.values(source) : [];
  return list.map((item) => ({
    name: clean(item?.name || item?.player?.name || item?.playerName || ''),
    team: clean(item?.teamName || item?.team?.name || ''),
    rating: Number(item?.rating?.num || item?.rating || item?.value || 0) || null
  })).filter((item) => item.name).slice(0, 6);
}

function normalizeDetails(data = {}, match = {}) {
  const general = data?.general || data?.content?.general || {};
  const venue = textFromMaybeObject(deepGet(data, [
    'general.venue', 'general.stadium', 'content.matchFacts.infoBox.Stadium', 'content.matchFacts.infoBox.Venue', 'content.matchFacts.infoBox.stadium'
  ]));
  const referee = textFromMaybeObject(deepGet(data, [
    'general.refereeName', 'general.referee', 'content.matchFacts.infoBox.Referee', 'content.matchFacts.infoBox.referee'
  ]));
  const attendanceValue = deepGet(data, ['general.attendance', 'content.matchFacts.infoBox.Attendance', 'content.matchFacts.infoBox.attendance']);
  const attendance = Number(String(attendanceValue || '').replace(/[^0-9]/g, '')) || null;
  const round = textFromMaybeObject(deepGet(data, [
    'general.matchRound', 'general.roundName', 'content.matchFacts.infoBox.Round', 'content.matchFacts.infoBox.round'
  ]));
  const events = extractEvents(data);
  const stats = extractStats(data);
  const lineups = extractLineups(data);
  const topPlayers = extractTopPlayers(data);
  const xgRow = stats.find((row) => /expected goals|\bxg\b/i.test(row.title));
  const xg = xgRow ? { home: xgRow.home, away: xgRow.away } : null;
  const hasDetails = Boolean(venue || referee || events.length || stats.length || lineups.home.length || lineups.away.length || topPlayers.length);
  return {
    venue,
    referee,
    attendance,
    round,
    events,
    stats,
    lineups,
    topPlayers,
    xg,
    hasDetails,
    detailProvider: hasDetails ? 'FotMob' : '',
    detailUpdatedAt: new Date().toISOString(),
    detailGeneral: {
      matchId: clean(general?.matchId || match.id || ''),
      matchName: clean(general?.matchName || `${match?.home?.name || ''} vs ${match?.away?.name || ''}`),
      leagueName: clean(general?.leagueName || match?.league?.name || '')
    }
  };
}

async function fetchDetails(match) {
  const urls = [
    `${BASE_URL}/api/data/matchDetails?matchId=${encodeURIComponent(match.id)}`,
    `${BASE_URL}/api/matchDetails?matchId=${encodeURIComponent(match.id)}`
  ];
  const errors = [];
  for (const url of urls) {
    try {
      const data = await fetchWithTimeout(url, 'json');
      return { data, method: url.includes('/api/data/') ? 'api-data' : 'api' };
    } catch (error) {
      errors.push(error.name === 'AbortError' ? 'timeout' : error.message);
    }
  }
  throw new Error(errors.join(' / '));
}

function qualityScore(match) {
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

function stale(match, now) {
  const updated = +new Date(match?.details?.detailUpdatedAt || 0);
  if (!updated) return true;
  const age = (now - updated) / 3_600_000;
  if (match.state === 'live') return age >= 0.08;
  if (match.state === 'final') return age >= 20;
  return age >= 5;
}

const matches = JSON.parse(await fs.readFile(MATCHES_PATH, 'utf8'));
if (!Array.isArray(matches) || !matches.length) {
  console.log('[MatchDetails] No matches to enrich.');
  process.exit(0);
}

const now = Date.now();
const targets = matches
  .filter((match) => {
    const kickoff = +new Date(match.kickoff || 0);
    if (!Number.isFinite(kickoff)) return false;
    const delta = (kickoff - now) / 3_600_000;
    const relevantTime = delta <= WINDOW_HOURS && delta >= -WINDOW_HOURS;
    return relevantTime && Number(match.opportunityScore || 0) >= 55 && stale(match, now);
  })
  .sort((a, b) => {
    const liveA = a.state === 'live' ? 1 : 0;
    const liveB = b.state === 'live' ? 1 : 0;
    return (liveB - liveA) || (Number(b.opportunityScore || 0) - Number(a.opportunityScore || 0)) || (Math.abs(+new Date(a.kickoff) - now) - Math.abs(+new Date(b.kickoff) - now));
  })
  .slice(0, DETAIL_LIMIT);

let enriched = 0;
for (const target of targets) {
  const index = matches.findIndex((match) => Number(match.id) === Number(target.id));
  if (index < 0) continue;
  try {
    const { data, method } = await fetchDetails(target);
    const details = normalizeDetails(data, target);
    matches[index] = {
      ...matches[index],
      details: { ...details, fetchMethod: method },
      indexQualityScore: 0,
      updatedAt: new Date().toISOString()
    };
    matches[index].indexQualityScore = qualityScore(matches[index]);
    matches[index].indexable = matches[index].indexable !== false && matches[index].indexQualityScore >= 55;
    enriched += 1;
    console.log(`[MatchDetails] ${details.hasDetails ? 'Enriched' : 'Empty'} ${target.home.name} vs ${target.away.name}: events=${details.events.length}, stats=${details.stats.length}, lineups=${details.lineups.home.length}/${details.lineups.away.length}, quality=${matches[index].indexQualityScore}.`);
  } catch (error) {
    matches[index].indexQualityScore = qualityScore(matches[index]);
    console.warn(`[MatchDetails] ${target.home.name} vs ${target.away.name} unavailable: ${error.name === 'AbortError' ? 'timeout' : error.message}`);
  }
}

for (const match of matches) {
  if (!Number.isFinite(Number(match.indexQualityScore))) match.indexQualityScore = qualityScore(match);
  if (match.indexable !== false) match.indexable = Number(match.indexQualityScore || 0) >= 55;
}

await fs.writeFile(MATCHES_PATH, `${JSON.stringify(matches, null, 2)}\n`);
console.log(`[MatchDetails] Completed: ${enriched}/${targets.length} enriched; ${matches.filter((m) => m.indexable !== false && Number(m.indexQualityScore || 0) >= 55).length} indexable match pages.`);
