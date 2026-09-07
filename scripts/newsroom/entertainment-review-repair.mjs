import fs from 'node:fs/promises';
import { languageIssues } from './quality-gate.mjs';

const storiesPath = new URL('../../src/data/stories.json', import.meta.url);
const stories = JSON.parse(await fs.readFile(storiesPath, 'utf8'));

const minScore = Number(process.env.AUTO_PUBLISH_MIN_SCORE || 88);
const minTrust = Number(process.env.AUTO_PUBLISH_MIN_TRUST || 88);
const minConfidence = Number(process.env.AUTO_PUBLISH_MIN_CONFIDENCE || 78);
const autoPublishEnabled = String(process.env.AUTO_PUBLISH_ENABLED || 'true') === 'true';

function normalizePercentScale(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  if (n > 0 && n <= 1) return Math.round(n * 100);
  return Math.max(0, Math.min(100, Math.round(n)));
}

let changed = false;
let promoted = 0;
let retained = 0;

for (const story of stories) {
  if (!['movies', 'tv'].includes(story.section) || story.status !== 'review') continue;

  const normalizedConfidence = normalizePercentScale(story.confidence);
  const normalizedImportance = normalizePercentScale(story.importance);
  if (story.confidence !== normalizedConfidence || story.importance !== normalizedImportance) {
    story.confidence = normalizedConfidence;
    story.importance = normalizedImportance;
    changed = true;
  }

  const language = languageIssues(story);
  const factualBlocked = (story.qualityFlags || []).includes('factual-quality-failed') || (story.factualNotes || []).length > 0;

  if (language.length) {
    story.qualityFlags = [...new Set([...(story.qualityFlags || []), 'language-quality-failed'])];
    story.qualityNotes = language;
    retained += 1;
    changed = true;
    console.warn(`[Entertainment Repair] Keeping review: ${story.title} :: ${language.join('; ')}`);
    continue;
  }

  story.qualityFlags = (story.qualityFlags || []).filter((flag) => flag !== 'language-quality-failed');
  story.qualityNotes = [];

  const eligible = autoPublishEnabled
    && !factualBlocked
    && Number(story.trust || 0) >= minTrust
    && Number(story.qualityScore || 0) >= minScore
    && normalizedConfidence >= minConfidence;

  if (eligible) {
    story.status = 'approved';
    story.generatedAt = new Date().toISOString();
    promoted += 1;
    changed = true;
    console.log(`[Entertainment Repair] APPROVED [Q${story.qualityScore}/C${normalizedConfidence}/T${story.trafficScore || 0}]: ${story.title}`);
  } else {
    retained += 1;
    const blockers = [
      factualBlocked ? 'facts' : '',
      Number(story.trust || 0) < minTrust ? `trust ${story.trust}<${minTrust}` : '',
      Number(story.qualityScore || 0) < minScore ? `quality ${story.qualityScore}<${minScore}` : '',
      normalizedConfidence < minConfidence ? `confidence ${normalizedConfidence}<${minConfidence}` : ''
    ].filter(Boolean);
    console.warn(`[Entertainment Repair] Keeping review: ${story.title}${blockers.length ? ` :: ${blockers.join(', ')}` : ''}`);
  }
}

if (changed) {
  stories.sort((a, b) => +new Date(b.publishedAt || 0) - +new Date(a.publishedAt || 0));
  await fs.writeFile(storiesPath, `${JSON.stringify(stories.slice(0, 1500), null, 2)}\n`);
}

console.log(`[Entertainment Repair] Complete: promoted=${promoted}, retained=${retained}.`);
