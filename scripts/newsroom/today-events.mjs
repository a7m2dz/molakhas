import fs from 'node:fs/promises';

const TIMEZONE = process.env.SPORTS_TIMEZONE || 'Asia/Riyadh';
const OUTPUT = new URL('../../src/data/today-events.json', import.meta.url);
const MATCHES = new URL('../../src/data/matches.json', import.meta.url);
const TIMEOUT_MS = Number(process.env.SPORTS_EVENTS_TIMEOUT_MS || 8000);
const MAX_PER_SPORT = Math.max(4, Math.min(30, Number(process.env.SPORTS_EVENTS_MAX_PER_SPORT || 14)));

function clean(value = '') {
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function dateParts(value, timeZone = TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(value));
  return Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
}

function localDate(value, timeZone = TIMEZONE) {
  const p = dateParts(value, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

function compactDate(value) {
  return localDate(value).replaceAll('-', '');
}

function offsetCompactDate(now, days) {
  return compactDate(new Date(+new Date(now) + days * 86_400_000));
}

function stateFromEspn(event = {}) {
  const state = String(event?.status?.type?.state || '').toLowerCase();
  const completed = Boolean(event?.status?.type?.completed);
  if (completed || state === 'post') return 'final';
  if (state === 'in') return 'live';
  return 'upcoming';
}

function eventUrl(event = {}, fallback = '') {
  const links = Array.isArray(event?.links) ? event.links : [];
  return clean(links.find((x) => /summary|gamecast|event/i.test(String(x?.rel || x?.text || '')))?.href || links[0]?.href || fallback);
}

function scoreTextFromCompetition(competition = {}) {
  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  if (competitors.length < 2) return '';
  const ordered = [...competitors].sort((a, b) => {
    const aHome = String(a?.homeAway || '') === 'home' ? 0 : 1;
    const bHome = String(b?.homeAway || '') === 'home' ? 0 : 1;
    return aHome - bHome;
  });
  return ordered.map((x) => clean(x?.score || '')).filter(Boolean).join(' - ');
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36',
        accept: 'application/json,text/plain,*/*'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36',
        accept: 'text/html,application/xhtml+xml'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeFootball(match) {
  const state = match.state === 'scheduled' ? 'upcoming' : match.state;
  const score = clean(match.score || `${match?.home?.score ?? ''} - ${match?.away?.score ?? ''}`).replace(/^\s*-\s*$/, '');
  return {
    id: `football-${match.id}`,
    sport: 'football',
    sportLabel: 'كرة القدم',
    title: `${match.home.name} ضد ${match.away.name}`,
    subtitle: clean(match?.league?.name || 'كرة القدم'),
    start: match.kickoff,
    state,
    score,
    importance: Number(match.opportunityScore || 0),
    source: 'FotMob',
    url: `/matches/${match.slug}/`,
    internal: true
  };
}

async function footballEvents(today) {
  try {
    const matches = JSON.parse(await fs.readFile(MATCHES, 'utf8'));
    return (Array.isArray(matches) ? matches : [])
      .filter((m) => m?.date === today && m?.home?.name && m?.away?.name)
      .sort((a, b) => {
        const aLive = a.state === 'live' ? 1 : 0;
        const bLive = b.state === 'live' ? 1 : 0;
        return (bLive - aLive) || (Number(b.opportunityScore || 0) - Number(a.opportunityScore || 0)) || (+new Date(a.kickoff) - +new Date(b.kickoff));
      })
      .slice(0, MAX_PER_SPORT)
      .map(normalizeFootball);
  } catch (error) {
    console.warn(`[Events] Football snapshot unavailable: ${error.message}`);
    return [];
  }
}

async function espnEvents({ sport, league, label, now, sourceName }) {
  const dates = [offsetCompactDate(now, -1), offsetCompactDate(now, 0), offsetCompactDate(now, 1)];
  const seen = new Set();
  const events = [];
  for (const date of dates) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${date}`;
    try {
      const data = await fetchJson(url);
      for (const event of Array.isArray(data?.events) ? data.events : []) {
        if (!event?.id || seen.has(String(event.id))) continue;
        seen.add(String(event.id));
        const start = new Date(event.date || now);
        if (Number.isNaN(+start) || localDate(start) !== localDate(now)) continue;
        const competition = Array.isArray(event?.competitions) ? event.competitions[0] : null;
        const subtitle = clean(
          competition?.notes?.[0]?.headline ||
          competition?.type?.text ||
          data?.leagues?.[0]?.name ||
          label
        );
        events.push({
          id: `${league}-${event.id}`,
          sport: league === 'nba' ? 'nba' : 'mma',
          sportLabel: label,
          title: clean(event.shortName || event.name || label),
          subtitle,
          start: start.toISOString(),
          state: stateFromEspn(event),
          score: scoreTextFromCompetition(competition),
          importance: stateFromEspn(event) === 'live' ? 95 : stateFromEspn(event) === 'final' ? 80 : 72,
          source: sourceName,
          url: eventUrl(event, league === 'nba' ? 'https://www.espn.com/nba/schedule' : 'https://www.espn.com/mma/schedule'),
          internal: false
        });
      }
    } catch (error) {
      console.warn(`[Events] ${label} ${date} unavailable: ${error.name === 'AbortError' ? 'timeout' : error.message}`);
    }
  }
  return events
    .sort((a, b) => {
      const aLive = a.state === 'live' ? 1 : 0;
      const bLive = b.state === 'live' ? 1 : 0;
      return (bLive - aLive) || (+new Date(a.start) - +new Date(b.start));
    })
    .slice(0, MAX_PER_SPORT);
}

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
};

function easternOffsetMs(approxUtc) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(approxUtc);
  const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const represented = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute));
  return represented - +approxUtc;
}

function easternToUtc(year, month, day, hour, minute = 0) {
  let utc = new Date(Date.UTC(year, month, day, hour, minute));
  for (let i = 0; i < 2; i++) utc = new Date(+utc - easternOffsetMs(utc));
  return utc;
}

function parseWweLines(html, now) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(?:br|\/p|\/li|\/h[1-6]|\/div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
  const lines = text.split(/\n+/).map(clean).filter((x) => x.length >= 3 && x.length <= 240);
  const targetDate = localDate(now);
  const out = [];
  const dateRegex = /(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2}).*?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\s*ET/iu;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(dateRegex);
    if (!match) continue;
    const month = MONTHS[String(match[1]).toLowerCase().replace('.', '')];
    if (month === undefined) continue;
    const day = Number(match[2]);
    const year = Number(match[3]);
    let hour = Number(match[4]);
    const minute = Number(match[5] || 0);
    const ap = String(match[6]).toLowerCase();
    if (ap.startsWith('p') && hour !== 12) hour += 12;
    if (ap.startsWith('a') && hour === 12) hour = 0;
    const start = easternToUtc(year, month, day, hour, minute);
    if (localDate(start) !== targetDate) continue;

    const dateIndex = line.search(dateRegex);
    let title = clean(line.slice(0, dateIndex).replace(/[•–—-]+$/g, ''));
    if (!title || title.length < 3 || /^(this week|upcoming)$/i.test(title)) title = clean(lines[i - 1] || 'WWE');
    title = title.replace(/^(this week|upcoming)\s*/i, '').trim();
    if (!title || title.length > 110) title = 'WWE';
    const venueMatch = line.match(/,\s*([^,]+(?:Arena|Center|Stadium|Centre|Garden|Performance Center)[^–—-]*)\s*[–—-]/i);
    out.push({
      id: `wwe-${year}${String(month + 1).padStart(2, '0')}${String(day).padStart(2, '0')}-${i}`,
      sport: 'wwe',
      sportLabel: 'WWE',
      title,
      subtitle: clean(venueMatch?.[1] || 'عرض WWE'),
      start: start.toISOString(),
      state: +start <= +now && +now - +start < 4 * 3_600_000 ? 'live' : +start < +now ? 'final' : 'upcoming',
      score: '',
      importance: /Raw|SmackDown|NXT|WrestleMania|SummerSlam|Survivor|Money in the Bank|Royal Rumble|Crown Jewel|Night of Champions/i.test(title) ? 88 : 72,
      source: 'WWE',
      url: 'https://www.wwe.com/article/wwe-upcoming-events',
      internal: false
    });
  }
  return out;
}

async function wweEvents(now) {
  try {
    const html = await fetchText('https://www.wwe.com/article/wwe-upcoming-events');
    return parseWweLines(html, now).slice(0, MAX_PER_SPORT);
  } catch (error) {
    console.warn(`[Events] WWE schedule unavailable: ${error.name === 'AbortError' ? 'timeout' : error.message}`);
    return [];
  }
}

const now = new Date();
const today = localDate(now);
const [football, nba, mma, wwe] = await Promise.all([
  footballEvents(today),
  espnEvents({ sport: 'basketball', league: 'nba', label: 'NBA', now, sourceName: 'ESPN' }),
  espnEvents({ sport: 'mma', league: 'ufc', label: 'MMA / UFC', now, sourceName: 'ESPN' }),
  wweEvents(now)
]);

const events = [...football, ...nba, ...mma, ...wwe]
  .sort((a, b) => {
    const aLive = a.state === 'live' ? 1 : 0;
    const bLive = b.state === 'live' ? 1 : 0;
    return (bLive - aLive) || (Number(b.importance || 0) - Number(a.importance || 0)) || (+new Date(a.start) - +new Date(b.start));
  });

const output = {
  generatedAt: new Date().toISOString(),
  date: today,
  timezone: TIMEZONE,
  counts: {
    football: football.length,
    nba: nba.length,
    mma: mma.length,
    wwe: wwe.length,
    total: events.length
  },
  events
};

await fs.writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(`[Events] Today ${today}: football=${football.length}, NBA=${nba.length}, MMA=${mma.length}, WWE=${wwe.length}, total=${events.length}.`);
