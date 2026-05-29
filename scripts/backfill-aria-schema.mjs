// aply-server/scripts/backfill-aria-schema.mjs
//
// S1 of the Aria → /Brands restructure. Pure additive backfill:
//
//   /Brands/{id}  — add sales-state defaults for any doc missing them.
//     outreachCount:      0    (number)
//     repliedCount:       0    (number)
//     lastTouchedAt:      null (Timestamp | null)
//     activeCampaigns:    []   (string[])
//     coldOutreachStatus: 'cold'
//   /Lists/{id}   — add list metadata defaults.
//     targetCampaignId:   null
//     sourceMethod:       null
//     icpDescription:     ''
//     freshness:          { lastExpandedAt: null, nextDueAt: null }
//
// Each doc gets ONLY the fields it's currently missing. Existing values are
// never overwritten — Jamal's curated tags/bio/hireFields/enrichmentStatus
// on /Brands stay untouched. Idempotent: re-running this is a no-op for any
// doc that's already up to date. Resumable: each doc is independent; ctrl-C
// and re-run picks up where you left off.
//
// Usage:
//   node scripts/backfill-aria-schema.mjs --dry-run        # log only, no writes
//   node scripts/backfill-aria-schema.mjs                  # do the writes
//   node scripts/backfill-aria-schema.mjs --only=brands    # backfill only Brands
//   node scripts/backfill-aria-schema.mjs --only=lists     # backfill only Lists

import admin from 'firebase-admin';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
const saMatch = serverSrc.match(/const serviceAccount = (\{[\s\S]+?\n\});/);
if (!saMatch) {
  console.error('Could not extract serviceAccount from server.js');
  process.exit(1);
}
// eslint-disable-next-line no-eval
const serviceAccount = eval('(' + saMatch[1] + ')');
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

// ── Args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = {
  dryRun: args.includes('--dry-run'),
  only: args.find((a) => a.startsWith('--only='))?.split('=')[1] || 'both',
};

const log = (...a) => console.log(...a);
const note = (...a) => console.log('  ·', ...a);

// ── Field definitions ──────────────────────────────────────────────────────
const BRAND_DEFAULTS = {
  outreachCount: 0,
  repliedCount: 0,
  lastTouchedAt: null,
  activeCampaigns: [],
  coldOutreachStatus: 'cold',
};

const LIST_DEFAULTS = {
  targetCampaignId: null,
  sourceMethod: null,
  icpDescription: '',
  freshness: { lastExpandedAt: null, nextDueAt: null },
};

// Build a patch containing ONLY the keys currently missing/undefined on the doc.
// Skips keys that already exist (even if their value is null or "" — those
// were explicitly set and we respect them).
function buildPatch(data, defaults) {
  const patch = {};
  for (const [k, v] of Object.entries(defaults)) {
    if (data[k] === undefined) {
      patch[k] = v;
    } else if (k === 'freshness' && typeof data[k] === 'object' && data[k] !== null) {
      // Nested defaults — fill in any missing leaf keys without clobbering set ones.
      const inner = {};
      for (const [ik, iv] of Object.entries(v)) {
        if (data[k][ik] === undefined) inner[ik] = iv;
      }
      if (Object.keys(inner).length > 0) patch[k] = { ...data[k], ...inner };
    }
  }
  return patch;
}

// ── Backfillers ────────────────────────────────────────────────────────────
async function backfillCollection(collName, defaults) {
  log(`\n── ${collName} ─────────────────────────────────────────────────`);
  const snap = await db.collection(collName).get();
  log(`Found ${snap.size} doc(s) in /${collName}.`);

  let scanned = 0;
  let updated = 0;
  let alreadyOk = 0;
  let fieldsAdded = 0;

  for (const docSnap of snap.docs) {
    scanned += 1;
    const data = docSnap.data();
    const patch = buildPatch(data, defaults);
    const keys = Object.keys(patch);
    if (keys.length === 0) {
      alreadyOk += 1;
      continue;
    }
    fieldsAdded += keys.length;
    if (flags.dryRun) {
      note(`[dry-run] ${docSnap.id}: would add ${keys.join(', ')}`);
    } else {
      try {
        await docSnap.ref.update(patch);
        updated += 1;
        if (updated % 50 === 0) note(`progress: updated ${updated}/${snap.size}…`);
      } catch (e) {
        console.error(`  ✗ ${docSnap.id} failed:`, e.message);
      }
    }
  }

  log(`Done /${collName}.`);
  log(`  scanned:      ${scanned}`);
  log(`  already ok:   ${alreadyOk}`);
  log(`  ${flags.dryRun ? 'would update' : 'updated'}:    ${flags.dryRun ? scanned - alreadyOk : updated}`);
  log(`  fields added: ${fieldsAdded}`);
  return { scanned, updated, alreadyOk, fieldsAdded };
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  log(`[backfill-aria-schema] mode=${flags.dryRun ? 'DRY RUN' : 'WRITE'} target=${flags.only}`);
  const totals = { brands: null, lists: null };
  if (flags.only === 'both' || flags.only === 'brands') {
    totals.brands = await backfillCollection('Brands', BRAND_DEFAULTS);
  }
  if (flags.only === 'both' || flags.only === 'lists') {
    totals.lists = await backfillCollection('Lists', LIST_DEFAULTS);
  }
  log(`\n[backfill-aria-schema] complete.`);
  if (flags.dryRun) {
    log(`Re-run without --dry-run to apply the changes.`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[backfill-aria-schema] failed:', e);
  process.exit(1);
});
