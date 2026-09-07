import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const OUTPUT = new URL('../../src/data/search-feedback.json', import.meta.url);
const SITE_URL = String(process.env.GSC_SITE_URL || '').trim();
const CLIENT_EMAIL = String(process.env.GSC_CLIENT_EMAIL || '').trim();
const PRIVATE_KEY = String(process.env.GSC_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
const CREDENTIALS_PATH = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
const DAYS = Math.max(7, Math.min(90, Number(process.env.GSC_LOOKBACK_DAYS || 28)));
const END_LAG_DAYS = Math.max(1, Math.min(7, Number(process.env.GSC_END_LAG_DAYS || 3)));
const ROW_LIMIT = Math.max(100, Math.min(25000, Number(process.env.GSC_ROW_LIMIT || 10000)));

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

async function credentials() {
  if (CLIENT_EMAIL && PRIVATE_KEY) return { client_email: CLIENT_EMAIL, private_key: PRIVATE_KEY };
  if (!CREDENTIALS_PATH) return null;
  try {
    const parsed = JSON.parse(await fs.readFile(CREDENTIALS_PATH, 'utf8'));
    if (parsed?.client_email && parsed?.private_key) return parsed;
  } catch (error) {
    console.warn(`[Search Console] Could not read GOOGLE_APPLICATION_CREDENTIALS: ${error.message}`);
  }
  return null;
}

async function accessToken(creds) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(creds.private_key).toString('base64url');
  const assertion = `${unsigned}.${signature}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  if (!response.ok) throw new Error(`OAuth ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json();
  if (!data?.access_token) throw new Error('OAuth response did not include access_token');
  return data.access_token;
}

function opportunityScore({ impressions, clicks, ctr, position }) {
  const imp = Number(impressions || 0);
  const click = Number(clicks || 0);
  const pos = Number(position || 100);
  const ratio = Number(ctr || 0);
  let score = 0;
  score += Math.min(40, Math.round(Math.log10(imp + 1) * 14));
  if (pos >= 4 && pos <= 12) score += 30;
  else if (pos > 12 && pos <= 25) score += 24;
  else if (pos > 25 && pos <= 40) score += 15;
  else if (pos <= 3) score += 8;
  else score += 5;
  if (imp >= 10 && ratio < 0.01) score += 15;
  else if (imp >= 10 && ratio < 0.025) score += 10;
  else if (imp >= 5 && ratio < 0.05) score += 5;
  score += Math.min(10, click * 2);
  return Math.max(0, Math.min(100, Math.round(score)));
}

async function querySearchConsole(token, startDate, endDate) {
  const endpoint = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      startDate,
      endDate,
      dimensions: ['query', 'page'],
      type: 'web',
      rowLimit: ROW_LIMIT
    })
  });
  if (!response.ok) throw new Error(`Search Analytics ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return await response.json();
}

const creds = await credentials();
if (!SITE_URL || !creds) {
  console.log('[Search Console] Not configured; keeping cached feedback. Set GSC_SITE_URL plus service-account credentials to enable.');
  process.exit(0);
}

try {
  const end = new Date(Date.now() - END_LAG_DAYS * 86_400_000);
  const start = new Date(+end - (DAYS - 1) * 86_400_000);
  const startDate = isoDate(start);
  const endDate = isoDate(end);
  const token = await accessToken(creds);
  const data = await querySearchConsole(token, startDate, endDate);
  const rows = (Array.isArray(data?.rows) ? data.rows : [])
    .map((row) => ({
      query: String(row?.keys?.[0] || '').trim(),
      page: String(row?.keys?.[1] || '').trim(),
      clicks: Number(row?.clicks || 0),
      impressions: Number(row?.impressions || 0),
      ctr: Number(row?.ctr || 0),
      position: Number(row?.position || 0)
    }))
    .filter((row) => row.query && row.page && row.impressions > 0)
    .map((row) => ({ ...row, opportunityScore: opportunityScore(row) }))
    .sort((a, b) => (b.opportunityScore - a.opportunityScore) || (b.impressions - a.impressions))
    .slice(0, 750);

  const output = {
    generatedAt: new Date().toISOString(),
    siteUrl: SITE_URL,
    window: { startDate, endDate, days: DAYS },
    rows
  };
  await fs.writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`[Search Console] Feedback updated: ${rows.length} query/page opportunities (${startDate} → ${endDate}).`);
  for (const row of rows.slice(0, 8)) {
    console.log(`[Search Console] ${row.opportunityScore}/100 pos=${row.position.toFixed(1)} imp=${row.impressions} ctr=${(row.ctr * 100).toFixed(1)}% :: ${row.query}`);
  }
} catch (error) {
  console.warn(`[Search Console] Refresh failed; keeping cached feedback: ${error.message}`);
  process.exit(0);
}
