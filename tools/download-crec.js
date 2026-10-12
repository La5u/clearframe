#!/usr/bin/env node
// Download a sample of recent Congressional Record floor speeches from GovInfo
// (US government works: public domain). Each sampled session day becomes one
// JSONL file of floor granules with their speakers' parties from GovInfo MODS.
// Extensions of Remarks are skipped, matching the GST methodology.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'research', 'raw', 'crec');
const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const FROM_YEAR = Number(args.from || 2017), TO_YEAR = Number(args.to || new Date().getFullYear());
const DAYS_PER_MONTH = Number(args['days-per-month'] || 2);
const CONCURRENCY = Number(args.concurrency || 4);
const FLOOR_CLASSES = new Set(['HOUSE', 'SENATE']);
fs.mkdirSync(OUT, { recursive: true });

async function get(url, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'ClearFrame research (bias-term mining)' } });
      if (response.ok) return await response.text();
      if (response.status === 404) return null;
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (attempt >= attempts) throw new Error(`${url}: ${error instanceof Error ? error.message : error}`);
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

async function pool(items, worker) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

function attr(tag, name) {
  return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] || '';
}

function decode(text) {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}

function sampleDays(packageIds) {
  const byMonth = new Map();
  for (const id of packageIds) {
    const month = id.slice(5, 12);
    byMonth.set(month, [...(byMonth.get(month) || []), id]);
  }
  // Spread picks across the month instead of taking the first days.
  return [...byMonth.values()].flatMap(ids => {
    const step = ids.length / DAYS_PER_MONTH;
    return [...new Set(Array.from({ length: Math.min(DAYS_PER_MONTH, ids.length) }, (_, i) => ids[Math.floor(i * step)]))];
  });
}

async function downloadDay(packageId) {
  const target = path.join(OUT, `${packageId}.jsonl`);
  if (fs.existsSync(target)) return 0;
  const mods = await get(`https://www.govinfo.gov/metadata/pkg/${packageId}/mods.xml`);
  if (!mods) return 0;
  const granules = [...mods.matchAll(/<relatedItem type="constituent"[\s\S]*?<\/relatedItem>\s*(?=<relatedItem type="constituent"|<\/mods>)/g)].map(match => match[0])
    .map(block => ({
      id: block.match(/<accessId>([^<]+)<\/accessId>/)?.[1],
      granuleClass: block.match(/<granuleClass>([^<]+)<\/granuleClass>/)?.[1],
      speakers: [...block.matchAll(/<congMember[^>]*role="SPEAKING"[^>]*>[\s\S]*?<\/congMember>/g)].map(([member]) => ({
        bioGuideId: attr(member, 'bioGuideId'), party: attr(member, 'party'), chamber: attr(member, 'chamber'),
        parsedName: member.match(/<name type="parsed">([^<]+)<\/name>/)?.[1] || '',
      })),
    }))
    .filter(granule => granule.id && FLOOR_CLASSES.has(granule.granuleClass || '') && granule.speakers.length);
  const records = await pool(granules, async granule => {
    const html = await get(`https://www.govinfo.gov/content/pkg/${packageId}/html/${granule.id}.htm`);
    const text = html ? decode(html.match(/<pre>([\s\S]*?)<\/pre>/)?.[1] || '') : '';
    return text ? JSON.stringify({ packageId, ...granule, text }) : null;
  });
  fs.writeFileSync(target, `${records.filter(Boolean).join('\n')}\n`);
  return records.filter(Boolean).length;
}

const packageIds = [];
for (let year = FROM_YEAR; year <= TO_YEAR; year++) {
  const sitemap = await get(`https://www.govinfo.gov/sitemap/CREC_${year}_sitemap.xml`);
  // Daily editions only; "-i6"-style suffixes are re-issued parts.
  for (const [, id] of (sitemap || '').matchAll(/details\/(CREC-\d{4}-\d{2}-\d{2})<\/loc>/g)) packageIds.push(id);
}
const days = sampleDays([...new Set(packageIds)].sort());
console.log(`${packageIds.length} session days ${FROM_YEAR}-${TO_YEAR}; sampling ${days.length}`);
let done = 0, granuleCount = 0;
for (const day of days) {
  granuleCount += await downloadDay(day);
  if (++done % 10 === 0) console.log(`${done}/${days.length} days, ${granuleCount} new granules`);
}
console.log(`done: ${done} days, ${granuleCount} new granules in ${path.relative(ROOT, OUT)}`);
