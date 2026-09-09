import fs from 'node:fs/promises';

const catalogs = [
  {
    base: new URL('../../src/data/sources.json', import.meta.url),
    extra: new URL('../../src/data/sources-extra.json', import.meta.url),
    label: 'sports'
  },
  {
    base: new URL('../../src/data/entertainment-sources.json', import.meta.url),
    extra: new URL('../../src/data/entertainment-sources-extra.json', import.meta.url),
    label: 'entertainment'
  }
];

async function syncCatalog({ base, extra, label }) {
  const baseItems = JSON.parse(await fs.readFile(base, 'utf8'));
  const extraItems = JSON.parse(await fs.readFile(extra, 'utf8'));
  const merged = new Map();

  for (const item of baseItems) merged.set(item.id, item);
  for (const item of extraItems) {
    const previous = merged.get(item.id) || {};
    merged.set(item.id, { ...previous, ...item });
  }

  const nextItems = [...merged.values()];
  const nextText = `${JSON.stringify(nextItems, null, 2)}\n`;
  const currentText = await fs.readFile(base, 'utf8');

  if (currentText !== nextText) {
    await fs.writeFile(base, nextText, 'utf8');
    console.log(`[Sources] Synced ${label}: ${baseItems.length} base + ${extraItems.length} curated => ${nextItems.length}.`);
  } else {
    console.log(`[Sources] ${label} catalog already synced (${nextItems.length}).`);
  }
}

for (const catalog of catalogs) await syncCatalog(catalog);
