// aply-server/scripts/import-pipelines.mjs
//
// Bulk-create or update Pipeline cards from a JSON file.
//
// Usage:
//   node scripts/import-pipelines.mjs path/to/pipelines.json
//
// Behavior:
//   - Reads an array of card objects (see the JSON format in the docs).
//   - Resolves `templateNames` → InputTemplate doc IDs.
//   - Resolves `brandNames` → Brand doc IDs. Missing brands get auto-created
//     and seeded with enrichmentStatus='queue' (mirrors the UI flow so the
//     brand shows up on /leads).
//   - Writes Pipelines/{slug} via setDoc(merge:true) — re-running with the
//     same slug overwrites that card cleanly. Doc IDs that already exist are
//     PATCHED, not replaced — fields not in the JSON are preserved.
//   - Existing brands referenced by name AND lacking enrichmentStatus are
//     also seeded to 'queue' so they appear on /leads (matches client save).
//
// Idempotent: safe to re-run.

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

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'mrkt-2efde.appspot.com',
});

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// ── Args ──────────────────────────────────────────────────────────────────
const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: node scripts/import-pipelines.mjs <path/to/pipelines.json>');
  process.exit(2);
}

const cards = JSON.parse(fs.readFileSync(path.resolve(inputFile), 'utf-8'));
if (!Array.isArray(cards)) {
  console.error('JSON file must be an array of card objects.');
  process.exit(2);
}

console.log(`Loaded ${cards.length} card${cards.length === 1 ? '' : 's'} from ${inputFile}`);

// ── Pre-fetch lookup maps ─────────────────────────────────────────────────
async function loadLookups() {
  const [tplSnap, brandSnap] = await Promise.all([
    db.collection('InputTemplates').get(),
    db.collection('Brands').get(),
  ]);
  const templates = new Map();
  tplSnap.docs.forEach((d) => {
    const name = (d.data().name || '').toLowerCase().trim();
    if (name) templates.set(name, d.id);
  });
  const brands = new Map();
  const brandData = new Map();
  brandSnap.docs.forEach((d) => {
    const data = d.data();
    const name = (data.name || '').toLowerCase().trim();
    if (name) {
      brands.set(name, d.id);
      brandData.set(d.id, data);
    }
  });
  return { templates, brands, brandData };
}

// Create a brand doc on the fly. Mirrors apply.jsx + Pipelines.jsx flow:
// seeds enrichmentStatus='queue' so the brand immediately appears on /leads.
async function createBrand(name) {
  const ref = await db.collection('Brands').add({
    name: name.trim(),
    tags: [],
    pipelines: [], // legacy /apply field
    feature: false,
    popular: false,
    enrichmentStatus: 'queue',
    addedBy: 'bulk-import',
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

// Mirror the seeding side-effect from Pipelines.jsx handleSave: any brand
// added to a pipeline that doesn't already have an enrichmentStatus gets
// seeded to 'queue'. This is what makes /leads pick it up.
async function seedEnrichmentIfMissing(brandId, brandData) {
  if (brandData.enrichmentStatus) return false;
  await db.collection('Brands').doc(brandId).update({
    enrichmentStatus: 'queue',
    updatedAt: FieldValue.serverTimestamp(),
  });
  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const { templates, brands, brandData } = await loadLookups();
  console.log(
    `Loaded lookups: ${templates.size} templates, ${brands.size} brands`
  );

  const errors = [];
  let writeCount = 0;
  let createdBrandCount = 0;
  let seededCount = 0;
  let skippedTemplateCount = 0;

  for (const card of cards) {
    const slug = (card.slug || '').toLowerCase().trim();
    if (!slug) {
      errors.push({ card, reason: 'missing slug' });
      continue;
    }
    if (!card.stripTitle) {
      errors.push({ card, reason: `[${slug}] missing stripTitle` });
      continue;
    }

    // Resolve template names → IDs
    const templateIds = [];
    for (const name of card.templateNames || []) {
      const id = templates.get(String(name).toLowerCase().trim());
      if (!id) {
        console.warn(`[${slug}] template not found, skipping: "${name}"`);
        skippedTemplateCount += 1;
        continue;
      }
      templateIds.push(id);
    }

    // Resolve brand names → IDs (auto-create missing)
    const brandIds = [];
    for (const name of card.brandNames || []) {
      const key = String(name).toLowerCase().trim();
      let id = brands.get(key);
      if (!id) {
        id = await createBrand(name);
        brands.set(key, id);
        brandData.set(id, { name: name.trim(), enrichmentStatus: 'queue' });
        createdBrandCount += 1;
        console.log(`[${slug}]   + created brand "${name}" → ${id}`);
      }
      brandIds.push(id);
    }

    // Seed enrichmentStatus on existing brands that lack it (mirrors UI)
    for (const id of brandIds) {
      const data = brandData.get(id) || {};
      const seeded = await seedEnrichmentIfMissing(id, data);
      if (seeded) {
        brandData.set(id, { ...data, enrichmentStatus: 'queue' });
        seededCount += 1;
      }
    }

    // Build payload — only fields the script knows about. Anything else on the
    // existing doc (e.g. older fields) is preserved by setDoc(merge:true).
    const payload = {
      stripTitle: card.stripTitle,
      subtext: card.subtext || '',
      backgroundImage: card.backgroundImage || '',
      perks: Array.isArray(card.perks) ? card.perks : [],
      pipelineStatus: card.pipelineStatus || 'active',
      published: !!card.published,
      tags: Array.isArray(card.tags) ? card.tags : [],
      templateIds,
      expDataFields: [],
      brandIds,
      updatedAt: FieldValue.serverTimestamp(),
    };

    const ref = db.collection('Pipelines').doc(slug);
    const existing = await ref.get();
    if (!existing.exists) {
      payload.createdAt = FieldValue.serverTimestamp();
    }
    await ref.set(payload, { merge: true });
    writeCount += 1;
    console.log(
      `[${slug}] ${existing.exists ? 'updated' : 'created'} · ${brandIds.length} brand${
        brandIds.length === 1 ? '' : 's'
      }, ${templateIds.length} template${templateIds.length === 1 ? '' : 's'}`
    );
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n── Summary ──');
  console.log(`Pipelines written:   ${writeCount}`);
  console.log(`Brands auto-created: ${createdBrandCount}`);
  console.log(`Brands seeded queue: ${seededCount}`);
  console.log(`Templates skipped:   ${skippedTemplateCount}`);
  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    errors.forEach((e) =>
      console.log(`  · ${e.reason}` + (e.card?.slug ? ` (slug=${e.card.slug})` : ''))
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
