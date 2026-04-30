// aply-server/scripts/export-brands.mjs
//
// Dump all brands from Firestore. Cross-references Pipelines so you can see
// which cards each brand belongs to.
//
// Usage:
//   node scripts/export-brands.mjs                       # names to stdout
//   node scripts/export-brands.mjs --json brands.json    # also write full JSON
//   node scripts/export-brands.mjs --csv brands.csv      # also write CSV
//   node scripts/export-brands.mjs --json b.json --csv b.csv   # both
//
// The stdout output is just the sorted list of brand names — pipe-friendly:
//   node scripts/export-brands.mjs | grep -i nike

import admin from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Bootstrap Admin SDK using the same service account as server.js ───────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverJsPath = path.resolve(__dirname, '..', 'server.js');
const src = fs.readFileSync(serverJsPath, 'utf8');
const pkMatch = src.match(/private_key:\s*'([^']+)'/);
if (!pkMatch) throw new Error('Could not find private_key in server.js');

const serviceAccount = {
  type: 'service_account',
  project_id: 'mrkt-2efde',
  private_key_id: '9278d3dab0b13eb5720140943d7ffed2996b1a1a',
  private_key: pkMatch[1].replace(/\\n/g, '\n'),
  client_email: 'firebase-adminsdk-18dkb@mrkt-2efde.iam.gserviceaccount.com',
};

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── Args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = { json: null, csv: null };
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--json') flags.json = args[++i];
  else if (args[i] === '--csv') flags.csv = args[++i];
}

// ── Helpers ───────────────────────────────────────────────────────────────
function normalizeLocation(loc) {
  if (!loc) return '';
  if (typeof loc === 'object') {
    return [loc.city, loc.state].filter(Boolean).join(', ');
  }
  return String(loc);
}

function csvEscape(v) {
  if (v == null) return '';
  const s = Array.isArray(v) ? v.join('; ') : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  process.stderr.write('Reading Brands + Pipelines from Firestore…\n');
  const [brandSnap, pipeSnap] = await Promise.all([
    db.collection('Brands').get(),
    db.collection('Pipelines').get(),
  ]);

  // Build brandId → [pipelineSlug, …] cross-reference
  const inPipelinesByBrand = new Map();
  pipeSnap.docs.forEach((d) => {
    const slug = d.id;
    (d.data().brandIds || []).forEach((bid) => {
      if (!inPipelinesByBrand.has(bid)) inPipelinesByBrand.set(bid, []);
      inPipelinesByBrand.get(bid).push(slug);
    });
  });

  const brands = brandSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: data.name || '',
      logo: data.logo || '',
      location: normalizeLocation(data.location),
      tags: Array.isArray(data.tags) ? data.tags : [],
      category: data.category || '',
      enrichmentStatus: data.enrichmentStatus || '',
      priority: !!data.priority,
      feature: !!data.feature,
      popular: !!data.popular,
      inPipelines: inPipelinesByBrand.get(d.id) || [],
      claimedBy: data.claimedBy || '',
      claimedByName: data.claimedByName || '',
    };
  });

  brands.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // ── stdout: just sorted names, one per line ─────────────────────────────
  brands.forEach((b) => process.stdout.write(`${b.name}\n`));

  // ── stderr: summary ─────────────────────────────────────────────────────
  process.stderr.write(`\n${brands.length} brands total\n`);
  const inAnyPipeline = brands.filter((b) => b.inPipelines.length > 0).length;
  const onLeads = brands.filter((b) => b.enrichmentStatus).length;
  const priority = brands.filter((b) => b.priority).length;
  process.stderr.write(
    `  ${inAnyPipeline} in at least one pipeline · ${onLeads} on /leads · ${priority} marked priority\n`
  );

  // ── Optional file outputs ───────────────────────────────────────────────
  if (flags.json) {
    fs.writeFileSync(path.resolve(flags.json), JSON.stringify(brands, null, 2));
    process.stderr.write(`Wrote JSON: ${flags.json}\n`);
  }

  if (flags.csv) {
    const headers = [
      'id',
      'name',
      'location',
      'category',
      'tags',
      'enrichmentStatus',
      'priority',
      'inPipelines',
      'logo',
      'claimedByName',
    ];
    const rows = [headers.join(',')];
    brands.forEach((b) => {
      rows.push(headers.map((h) => csvEscape(b[h])).join(','));
    });
    fs.writeFileSync(path.resolve(flags.csv), rows.join('\n'));
    process.stderr.write(`Wrote CSV: ${flags.csv}\n`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
