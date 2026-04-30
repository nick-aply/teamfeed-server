// aply-server/scripts/dedupe-brands.mjs
//
// Identify and merge duplicate brand names. Keeper rule (per Nick):
//   - Most decisionMakers wins (the one with leads stays)
//   - Tiebreak: most filled other-fields (logo, location, tags, category,
//     perks, description, hireFields)
//   - Final tiebreak: oldest createdAt
//
// Safety: by default, if a non-keeper duplicate ALSO has decisionMakers, the
// group is skipped and logged for manual review — we never destroy lead data.
//
// With --merge-dms, those skip groups become merges: each loser DM is copied
// onto the keeper (dedup by email if present, else lowercase trimmed name).
// Already-present DMs are skipped silently.
//
// For each merged group:
//   - Copy DMs from losers to keeper if --merge-dms (dedup as above)
//   - Find Pipelines referencing the loser's ID and rewrite brandIds to the
//     keeper's ID (deduped so we don't end up with the keeper listed twice).
//   - Delete loser docs (and any stray subcollection docs).
//
// Usage:
//   node scripts/dedupe-brands.mjs                          # dry run
//   node scripts/dedupe-brands.mjs --execute                # safe merges only
//   node scripts/dedupe-brands.mjs --merge-dms              # dry run incl. DM merges
//   node scripts/dedupe-brands.mjs --merge-dms --execute    # all merges, DM consolidation on

import admin from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverJsPath = path.resolve(__dirname, '..', 'server.js');
const src = fs.readFileSync(serverJsPath, 'utf8');
const pkMatch = src.match(/private_key:\s*'([^']+)'/);
if (!pkMatch) throw new Error('Could not find private_key in server.js');

admin.initializeApp({
  credential: admin.credential.cert({
    type: 'service_account',
    project_id: 'mrkt-2efde',
    private_key_id: '9278d3dab0b13eb5720140943d7ffed2996b1a1a',
    private_key: pkMatch[1].replace(/\\n/g, '\n'),
    client_email: 'firebase-adminsdk-18dkb@mrkt-2efde.iam.gserviceaccount.com',
  }),
});
const db = admin.firestore();

const EXECUTE = process.argv.includes('--execute');
const MERGE_DMS = process.argv.includes('--merge-dms');
const log = (...args) => console.log(...args);

// Match key for DM dedup: email-first (most reliable), then name.
function dmKey(data) {
  const email = (data.email || '').trim().toLowerCase();
  if (email) return `email:${email}`;
  const name = (data.name || '').trim().toLowerCase();
  if (name) return `name:${name}`;
  return null; // skip blank-name DMs (shouldn't exist but defensive)
}

function fillScore(data) {
  // Rough "completeness" score for tiebreaks. Each filled field = 1 point.
  let s = 0;
  if (data.logo) s += 1;
  if (data.location) s += 1;
  if (data.category) s += 1;
  if (data.bio || data.description) s += 1;
  if (Array.isArray(data.tags) && data.tags.length > 0) s += 1;
  if (Array.isArray(data.perks) && data.perks.length > 0) s += 1;
  if (Array.isArray(data.hireFields) && data.hireFields.length > 0) s += 1;
  if (data.backgroundImage) s += 1;
  if (data.website) s += 1;
  return s;
}

async function loadAllBrands() {
  const snap = await db.collection('Brands').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadDmCounts(brandIds) {
  // One subcollection read per brand. ~120 reads worst case (42 dup names * ~3
  // docs each). Cheap. Run in parallel.
  const entries = await Promise.all(
    brandIds.map(async (id) => {
      const sn = await db.collection('Brands').doc(id).collection('decisionMakers').get();
      return [id, sn.size];
    })
  );
  return new Map(entries);
}

async function loadPipelinesByBrand() {
  const snap = await db.collection('Pipelines').get();
  const map = new Map(); // brandId → [{ pipelineId, brandIds }]
  snap.docs.forEach((d) => {
    const ids = Array.isArray(d.data().brandIds) ? d.data().brandIds : [];
    ids.forEach((bid) => {
      if (!map.has(bid)) map.set(bid, []);
      map.get(bid).push({ pipelineId: d.id, brandIds: ids });
    });
  });
  return map;
}

async function deleteSubcollection(brandId) {
  const sn = await db.collection('Brands').doc(brandId).collection('decisionMakers').get();
  await Promise.all(sn.docs.map((d) => d.ref.delete()));
  return sn.size;
}

async function main() {
  log(`Mode: ${EXECUTE ? 'EXECUTE (writes will happen)' : 'DRY RUN (no writes)'}`);

  const brands = await loadAllBrands();
  log(`Loaded ${brands.length} brands`);

  // Group by lowercase trimmed name.
  const groups = new Map();
  brands.forEach((b) => {
    const key = (b.name || '').trim().toLowerCase();
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  });

  const dupGroups = Array.from(groups.entries()).filter(([, arr]) => arr.length > 1);
  log(`Found ${dupGroups.length} duplicate name group${dupGroups.length === 1 ? '' : 's'}`);
  if (dupGroups.length === 0) {
    log('Nothing to do.');
    return;
  }

  // Fetch DM counts for everyone in a duplicate group, plus the pipeline xref.
  const allDupIds = dupGroups.flatMap(([, arr]) => arr.map((b) => b.id));
  const [dmCounts, pipelinesByBrand] = await Promise.all([
    loadDmCounts(allDupIds),
    loadPipelinesByBrand(),
  ]);

  let mergedCount = 0;
  let skippedCount = 0;
  let deletedCount = 0;
  let pipelinesPatched = 0;
  let dmsCopied = 0;
  const skips = [];

  for (const [key, group] of dupGroups) {
    const enriched = group.map((b) => ({
      ...b,
      dmCount: dmCounts.get(b.id) || 0,
      _fill: fillScore(b),
    }));

    enriched.sort((a, b) => {
      if (b.dmCount !== a.dmCount) return b.dmCount - a.dmCount;
      if (b._fill !== a._fill) return b._fill - a._fill;
      const aT = a.createdAt?._seconds ?? a.createdAt?.seconds ?? 0;
      const bT = b.createdAt?._seconds ?? b.createdAt?.seconds ?? 0;
      return aT - bT; // older first as tiebreak
    });

    const [keeper, ...losers] = enriched;
    const losersWithDms = losers.filter((l) => l.dmCount > 0);

    if (losersWithDms.length > 0 && !MERGE_DMS) {
      // Multiple duplicates have leads — refuse to auto-merge unless
      // --merge-dms was passed.
      log(
        `\n[SKIP] "${keeper.name}" — keeper ${keeper.id} (${keeper.dmCount} DMs), but ${losersWithDms.length} other dup${
          losersWithDms.length === 1 ? '' : 's'
        } also have DMs:`
      );
      losersWithDms.forEach((l) => log(`        loser ${l.id} (${l.dmCount} DMs)`));
      skippedCount += 1;
      skips.push({ name: keeper.name, keeper: keeper.id, losersWithDms: losersWithDms.map((l) => ({ id: l.id, dms: l.dmCount })) });
      continue;
    }

    // Plan the merge.
    log(
      `\n[MERGE] "${keeper.name}" — keep ${keeper.id} (${keeper.dmCount} DMs, fill=${keeper._fill}); drop ${losers.length}:`
    );
    losers.forEach((l) => log(`         drop ${l.id} (DMs=${l.dmCount}, fill=${l._fill})`));

    // DM consolidation step (only fires when --merge-dms AND a loser has DMs).
    // Build keeper's existing DM keys, then copy any non-duplicate loser DMs.
    let dmsCopiedThisGroup = 0;
    let dmDupesSkippedThisGroup = 0;
    if (MERGE_DMS && losersWithDms.length > 0) {
      const keeperRef = db.collection('Brands').doc(keeper.id);
      const keeperDms = await keeperRef.collection('decisionMakers').get();
      const keeperKeys = new Set();
      keeperDms.docs.forEach((d) => {
        const k = dmKey(d.data());
        if (k) keeperKeys.add(k);
      });

      for (const loser of losersWithDms) {
        const loserDms = await db
          .collection('Brands')
          .doc(loser.id)
          .collection('decisionMakers')
          .get();
        for (const ldoc of loserDms.docs) {
          const ldata = ldoc.data();
          const k = dmKey(ldata);
          if (!k) continue;
          if (keeperKeys.has(k)) {
            dmDupesSkippedThisGroup += 1;
            continue;
          }
          if (EXECUTE) {
            // Strip the createdAt server timestamp ref (it's a sentinel object,
            // can't be re-saved). Replace with a fresh one.
            const { createdAt, updatedAt, ...rest } = ldata;
            await keeperRef.collection('decisionMakers').add({
              ...rest,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              mergedFrom: loser.id,
            });
          }
          keeperKeys.add(k);
          dmsCopiedThisGroup += 1;
        }
      }
      if (dmsCopiedThisGroup > 0 || dmDupesSkippedThisGroup > 0) {
        log(
          `         DMs: ${dmsCopiedThisGroup} copied to keeper, ${dmDupesSkippedThisGroup} skipped as duplicates`
        );
      }
      dmsCopied += dmsCopiedThisGroup;
    }

    // Find pipeline references on losers. Patch them to point to the keeper.
    const pipelineUpdates = new Map(); // pipelineId → new brandIds (deduped)
    losers.forEach((l) => {
      const refs = pipelinesByBrand.get(l.id) || [];
      refs.forEach((ref) => {
        const current = pipelineUpdates.get(ref.pipelineId) || [...ref.brandIds];
        const next = current.map((bid) => (bid === l.id ? keeper.id : bid));
        // Dedupe — if keeper was already in the array, we'd otherwise have duplicates.
        const seen = new Set();
        const deduped = next.filter((bid) => (seen.has(bid) ? false : seen.add(bid)));
        pipelineUpdates.set(ref.pipelineId, deduped);
      });
    });

    if (pipelineUpdates.size > 0) {
      pipelineUpdates.forEach((newIds, pid) => {
        log(`         patch pipeline ${pid} → ${newIds.length} brands`);
      });
    }

    if (EXECUTE) {
      // 1. Patch pipelines first (so brandIds are clean before we delete)
      await Promise.all(
        Array.from(pipelineUpdates.entries()).map(([pid, newIds]) =>
          db.collection('Pipelines').doc(pid).update({
            brandIds: newIds,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          })
        )
      );
      pipelinesPatched += pipelineUpdates.size;

      // 2. Delete loser DMs (defensive — should be 0 by safety check above)
      // 3. Delete loser doc
      for (const l of losers) {
        await deleteSubcollection(l.id);
        await db.collection('Brands').doc(l.id).delete();
        deletedCount += 1;
      }
    }

    mergedCount += 1;
  }

  log(`\n── Summary ──`);
  log(`Groups merged:     ${mergedCount}`);
  log(`Groups skipped:    ${skippedCount}`);
  log(`Brands deleted:    ${deletedCount}${EXECUTE ? '' : ' (dry run — no writes)'}`);
  log(`Pipelines patched: ${pipelinesPatched}${EXECUTE ? '' : ' (dry run — no writes)'}`);
  if (MERGE_DMS) {
    log(`DMs migrated:      ${dmsCopied}${EXECUTE ? '' : ' (dry run — no writes)'}`);
  }
  if (skips.length > 0) {
    log(`\nGroups requiring manual review (multiple dups have DMs):`);
    skips.forEach((s) =>
      log(`  · ${s.name}: keep ${s.keeper}, manual decision needed for ${s.losersWithDms.map((l) => l.id).join(', ')}`)
    );
  }
  if (!EXECUTE) {
    log(`\nRe-run with --execute to apply.`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
