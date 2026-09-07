import fs from 'node:fs/promises';

const PATH = new URL('../../src/data/today-events.json', import.meta.url);
const ALLOWED = new Set(['football','nba','mma','wwe']);
const clean = (value='') => String(value ?? '').replace(/\s+/g,' ').trim();

let data;
try {
  data = JSON.parse(await fs.readFile(PATH,'utf8'));
} catch (error) {
  console.warn(`[EventsQuality] Snapshot unavailable: ${error.message}`);
  process.exit(0);
}

const input = Array.isArray(data?.events) ? data.events : [];
const seen = new Set();
const events = [];
let fixedUpcomingScores = 0;
let dropped = 0;

for (const raw of input) {
  const id = clean(raw?.id);
  const sport = clean(raw?.sport).toLowerCase();
  const title = clean(raw?.title);
  const start = clean(raw?.start);
  if (!id || !ALLOWED.has(sport) || !title || !start || Number.isNaN(+new Date(start)) || seen.has(id)) {
    dropped += 1;
    continue;
  }
  seen.add(id);
  const state = ['live','final','upcoming'].includes(raw?.state) ? raw.state : 'upcoming';
  let score = clean(raw?.score);
  if (state === 'upcoming' && score) {
    score = '';
    fixedUpcomingScores += 1;
  }
  events.push({
    ...raw,
    id,
    sport,
    title,
    subtitle: clean(raw?.subtitle),
    start: new Date(start).toISOString(),
    state,
    score,
    source: clean(raw?.source),
    url: clean(raw?.url),
    internal: Boolean(raw?.internal)
  });
}

events.sort((a,b) => {
  const liveA = a.state === 'live' ? 1 : 0;
  const liveB = b.state === 'live' ? 1 : 0;
  return (liveB-liveA) || (Number(b.importance||0)-Number(a.importance||0)) || (+new Date(a.start)-+new Date(b.start));
});

const counts = {
  football: events.filter((x)=>x.sport==='football').length,
  nba: events.filter((x)=>x.sport==='nba').length,
  mma: events.filter((x)=>x.sport==='mma').length,
  wwe: events.filter((x)=>x.sport==='wwe').length,
  total: events.length
};

await fs.writeFile(PATH, `${JSON.stringify({...data, counts, events}, null, 2)}\n`);
console.log(`[EventsQuality] PASS: ${events.length} events; cleared ${fixedUpcomingScores} premature score(s); dropped ${dropped} invalid/duplicate event(s).`);
