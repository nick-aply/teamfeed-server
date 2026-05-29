// aply-server/scripts/migrate-contacts-to-brands.mjs
//
// S2 of the Aria → /Brands restructure. Migrates flat /Contacts/{id} docs
// into /Brands/{brandId}/decisionMakers/{personId} subcollection, with full
// archive-before-delete safety net and resumable per-contact processing.
//
// FLOW PER CONTACT
//   1. Resolve target Brand:
//      a. apollo_org_id   — contact.companyInfo.apolloId matches existing
//                            Brand.apolloOrganizationId
//      b. name_match      — normalized(contact.company) matches normalized(Brand.name)
//                            (strips "the ", trailing "Inc/LLC/Corp/etc",
//                            punctuation, casefold)
//      c. new_brand       — create new /Brands doc with Apollo company data
//                            (nested under `apolloCompany`) + S1 sales-state
//                            defaults. Jamal's top-level fields (name, logo,
//                            location, bio, tags, hireFields, enrichmentStatus)
//                            are set only when we're CREATING the brand —
//                            we never overwrite Jamal data on existing
//                            brands.
//
//   2. Resolve target decisionMaker doc:
//      - Default doc id = contact.apolloPersonId (else contact.id).
//      - If a DM already exists at this Brand with matching email,
//        MERGE INTO that DM (preserve its docId). Apollo-only fields
//        always overwrite (Jamal doesn't set those); shared fields
//        (name, title, email, linkedin) never overwrite if Jamal's
//        value is non-empty. listIds union.
//
//   3. Write DM doc with required `listIds` (CRITICAL — mobile draft pipeline
//      uses collectionGroup('decisionMakers').where('listIds', 'array-contains', listId))
//      plus both `linkedin` AND `linkedinUrl` (cross-team field-name parity).
//
//   4. Archive original /Contacts doc:
//        /Contacts_archive/{originalContactId}  ← full snapshot + _migratedTo
//        /Contacts/{originalContactId}          ← delete
//
// FLAGS
//   --dry-run                Log planned actions; no writes. Default behavior is to
//                            stop after dry-run summary. Re-run without --dry-run
//                            to commit.
//   --limit=N                Only process first N contacts (testing).
//   --contact-id=XYZ         Only process this one contact (debugging).
//
// IDEMPOTENT: deleting the source /Contacts doc on success means re-runs
// naturally skip already-migrated contacts. If a write fails mid-flight,
// the source doc stays and a re-run retries it.

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
const FV = admin.firestore.FieldValue;

// ── Args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = {
  dryRun: args.includes('--dry-run'),
  limit: Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1]) || null,
  contactId: args.find((a) => a.startsWith('--contact-id='))?.split('=')[1] || null,
};

const log = (...a) => console.log(...a);
const note = (...a) => console.log('  ·', ...a);
const tag = flags.dryRun ? '[dry-run]' : '[LIVE]';

// ── Helpers ────────────────────────────────────────────────────────────────

// Normalize a company name for fuzzy matching against /Brands.
// "The Poppi Co., Inc." → "poppi"
function normalizeName(s) {
  return (s || '')
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[,]?\s+(inc|incorporated|llc|corp|corporation|ltd|limited|co|company|holdings|group|gmbh|pbc|sa|spa)\.?\s*$/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Drop keys whose value is null/undefined/empty so Firestore docs stay lean.
function pickDefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out;
}

// Map a contact's companyInfo into the nested apolloCompany subobject we
// store on /Brands. Doesn't touch Jamal's top-level fields.
function buildApolloCompanySubobject(ci) {
  if (!ci) return null;
  return pickDefined({
    apolloId: ci.apolloId || null,
    name: ci.name || null,
    domain: ci.domain || null,
    websiteUrl: ci.websiteUrl || null,
    logoUrl: ci.logoUrl || null,
    industry: ci.industry || null,
    industries: ci.industries || null,
    secondaryIndustries: ci.secondaryIndustries || null,
    keywords: ci.keywords || null,
    estimatedEmployees: ci.estimatedEmployees || null,
    revenue: ci.revenue || null,
    revenuePrinted: ci.revenuePrinted || null,
    foundedYear: ci.foundedYear || null,
    shortDescription: ci.shortDescription || null,
    linkedinUrl: ci.linkedinUrl || null,
    twitterUrl: ci.twitterUrl || null,
    facebookUrl: ci.facebookUrl || null,
    crunchbaseUrl: ci.crunchbaseUrl || null,
    angellistUrl: ci.angellistUrl || null,
    city: ci.city || null,
    state: ci.state || null,
    country: ci.country || null,
    postalCode: ci.postalCode || null,
    streetAddress: ci.streetAddress || null,
    primaryPhone: ci.primaryPhone || null,
    publiclyTradedExchange: ci.publiclyTradedExchange || null,
    publiclyTradedSymbol: ci.publiclyTradedSymbol || null,
    alexaRanking: ci.alexaRanking || null,
  });
}

// Build a fresh /Brands doc payload from an Apollo-sourced contact.
// CAREFUL: don't run the optional Apollo metadata through pickDefined and then
// merge with the sales-state defaults — pickDefined would strip the explicit
// nulls/empties we deliberately set (lastTouchedAt: null, activeCampaigns: []).
// Build the two halves separately and spread the must-have defaults last.
function buildNewBrand(contact, uid) {
  const ci = contact.companyInfo || {};
  const optional = pickDefined({
    // Jamal-compatible top-level (only set when creating; never override later)
    name: ci.name || contact.company || 'Unknown',
    logo: ci.logoUrl || null,
    location: ci.city || ci.state ? { city: ci.city || null, state: ci.state || null } : null,
    // Apollo top-level for queryability + audit
    apolloOrganizationId: ci.apolloId || null,
    apolloCompany: buildApolloCompanySubobject(ci),
    addedBy: uid || null,
  });
  return {
    ...optional,
    // Empty defaults Jamal expects on his brand surface
    bio: '',
    tags: [],
    // S1 sales-state defaults — MUST be present even when null/empty so the
    // shape matches docs written by the S1 backfill.
    outreachCount: 0,
    repliedCount: 0,
    lastTouchedAt: null,
    activeCampaigns: [],
    coldOutreachStatus: 'cold',
    // Audit
    apolloEnrichedAt: FV.serverTimestamp(),
    createdAt: FV.serverTimestamp(),
    updatedAt: FV.serverTimestamp(),
    createdBy: 'aply-server/aria-migration-s2',
  };
}

// When matching an existing Brand, the only top-level fields we touch are:
//   - apolloOrganizationId  (set if missing)
//   - apolloCompany         (replace — always freshest)
//   - apolloEnrichedAt      (now)
//   - updatedAt             (now)
// Jamal's name, logo, location, bio, tags, hireFields, enrichmentStatus
// are NEVER overwritten.
function buildExistingBrandPatch(existingBrand, contact) {
  const ci = contact.companyInfo || {};
  const patch = {
    apolloCompany: buildApolloCompanySubobject(ci),
    apolloEnrichedAt: FV.serverTimestamp(),
    updatedAt: FV.serverTimestamp(),
  };
  if (!existingBrand.apolloOrganizationId && ci.apolloId) {
    patch.apolloOrganizationId = ci.apolloId;
  }
  return patch;
}

// Build the decisionMaker doc body from a /Contacts doc.
//
// CRITICAL fields per the user:
//   - listIds (string[])      — used by mobile via collectionGroup query
//   - linkedin AND linkedinUrl — Jamal uses `linkedin`, Aria uses `linkedinUrl`;
//                                we write BOTH so neither team reads null
function buildDecisionMaker(contact) {
  return pickDefined({
    // Identity (always set on a fresh write)
    name: contact.name || null,
    firstName: contact.firstName || null,
    lastName: contact.lastName || null,
    email: contact.email || null,
    emailStatus: contact.emailStatus || null,
    emailConfidence: contact.emailConfidence || null,

    // Job + links — both field names populated
    title: contact.title || null,
    linkedin: contact.linkedinUrl || null,
    linkedinUrl: contact.linkedinUrl || null,
    twitterUrl: contact.twitterUrl || null,
    facebookUrl: contact.facebookUrl || null,
    githubUrl: contact.githubUrl || null,

    // Apollo enrichment (Jamal doesn't have these — safe to always set)
    photoUrl: contact.photoUrl || null,
    headline: contact.headline || null,
    seniority: contact.seniority || null,
    departments: contact.departments || null,
    subdepartments: contact.subdepartments || null,
    functions: contact.functions || null,
    city: contact.city || null,
    state: contact.state || null,
    country: contact.country || null,
    postalCode: contact.postalCode || null,
    timeZone: contact.timeZone || null,
    intentStrength: contact.intentStrength || null,
    showIntent: contact.showIntent ?? null,
    employmentHistory: contact.employmentHistory || null,

    // Aria operational
    apolloPersonId: contact.apolloPersonId || null,
    source: contact.source || 'manual',
    verificationStatus: contact.verificationStatus || 'unverified',
    notes: contact.notes || '',

    // CRITICAL — list memberships for collectionGroup query
    listIds: Array.isArray(contact.listIds) ? contact.listIds : [],

    // Audit
    migratedFromContactId: contact.id,
    migratedAt: FV.serverTimestamp(),
    createdAt: contact.createdAt || FV.serverTimestamp(),
    updatedAt: FV.serverTimestamp(),
    createdBy: contact.createdBy || null,
  });
}

// Build a merge patch when an existing Jamal DM matches by email.
// - Apollo-only fields always overwrite (Jamal doesn't have them)
// - Shared fields (name, title, email, linkedin*) — NEVER overwrite a
//   non-empty Jamal value; fill in only when Jamal's is empty
// - listIds union via arrayUnion
function buildDmMergePatch(existingDm, contact) {
  const patch = pickDefined({
    // Apollo enrichment — always overwrite
    photoUrl: contact.photoUrl || null,
    headline: contact.headline || null,
    seniority: contact.seniority || null,
    departments: contact.departments || null,
    subdepartments: contact.subdepartments || null,
    functions: contact.functions || null,
    city: contact.city || null,
    state: contact.state || null,
    country: contact.country || null,
    postalCode: contact.postalCode || null,
    timeZone: contact.timeZone || null,
    emailStatus: contact.emailStatus || null,
    emailConfidence: contact.emailConfidence || null,
    twitterUrl: contact.twitterUrl || null,
    facebookUrl: contact.facebookUrl || null,
    githubUrl: contact.githubUrl || null,
    employmentHistory: contact.employmentHistory || null,
    intentStrength: contact.intentStrength || null,
    showIntent: contact.showIntent ?? null,

    // Identity
    apolloPersonId: contact.apolloPersonId || null,
    source: contact.source || existingDm.source || 'manual',
    verificationStatus: existingDm.verificationStatus || contact.verificationStatus || 'unverified',

    // Audit
    migratedFromContactId: contact.id,
    migratedAt: FV.serverTimestamp(),
    updatedAt: FV.serverTimestamp(),
  });

  // Shared fields — only set if Jamal's is empty/missing.
  const setIfEmpty = (key, val) => {
    if (val && !existingDm[key]) patch[key] = val;
  };
  setIfEmpty('name', contact.name);
  setIfEmpty('firstName', contact.firstName);
  setIfEmpty('lastName', contact.lastName);
  setIfEmpty('title', contact.title);
  setIfEmpty('email', contact.email);
  setIfEmpty('notes', contact.notes);

  // linkedin/linkedinUrl — fill both regardless of Jamal's state (cross-team parity)
  // EXCEPT we don't overwrite a non-empty Jamal `linkedin`.
  if (contact.linkedinUrl) {
    if (!existingDm.linkedin) patch.linkedin = contact.linkedinUrl;
    if (!existingDm.linkedinUrl) patch.linkedinUrl = contact.linkedinUrl;
  }

  // listIds — union (Firestore arrayUnion ignores dupes)
  if (Array.isArray(contact.listIds) && contact.listIds.length) {
    patch.listIds = FV.arrayUnion(...contact.listIds);
  }

  return patch;
}

// ── Pre-load Brands into in-memory indexes ─────────────────────────────────
async function loadBrandIndex() {
  const snap = await db.collection('Brands').get();
  const brandsById = new Map();
  const byApolloOrgId = new Map();
  const byNormalizedName = new Map();
  for (const d of snap.docs) {
    const data = d.data();
    const obj = { id: d.id, ...data };
    brandsById.set(d.id, obj);
    if (data.apolloOrganizationId) byApolloOrgId.set(data.apolloOrganizationId, d.id);
    if (data.name) {
      const norm = normalizeName(data.name);
      // First-write wins — there are dupes in /Brands today (Jamal's data).
      // The migration prefers the first-seen brand for any normalized-name
      // collision. (S5 / a future dedupe pass can rationalize this.)
      if (!byNormalizedName.has(norm)) byNormalizedName.set(norm, d.id);
    }
  }
  return { brandsById, byApolloOrgId, byNormalizedName };
}

async function resolveBrand(contact, idx) {
  const apolloOrgId = contact.companyInfo?.apolloId || null;
  if (apolloOrgId && idx.byApolloOrgId.has(apolloOrgId)) {
    return { brandId: idx.byApolloOrgId.get(apolloOrgId), strategy: 'apollo_org_id' };
  }
  const companyName = contact.companyInfo?.name || contact.company;
  if (companyName) {
    const norm = normalizeName(companyName);
    if (norm && idx.byNormalizedName.has(norm)) {
      return { brandId: idx.byNormalizedName.get(norm), strategy: 'name_match' };
    }
  }
  return { brandId: null, strategy: 'new_brand' };
}

async function findDmByEmail(brandId, email) {
  if (!email) return null;
  const snap = await db
    .collection('Brands').doc(brandId)
    .collection('decisionMakers')
    .where('email', '==', email)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ── Main per-contact migration ─────────────────────────────────────────────
async function migrateOne(contact, idx, counts) {
  // Pre-flight: must have a company name to route this contact somewhere.
  const companyName = contact.companyInfo?.name || contact.company;
  if (!companyName || !companyName.trim()) {
    counts.skipped += 1;
    return { ok: false, reason: 'no company name — orphan', contactId: contact.id };
  }

  // 1. Resolve Brand
  let { brandId, strategy } = await resolveBrand(contact, idx);

  // 1b. Create new Brand if needed
  if (!brandId) {
    const payload = buildNewBrand(contact, contact.createdBy);
    if (flags.dryRun) {
      // Synthesize a stable placeholder id so the dry-run accurately
      // simulates "subsequent contacts at the same company find this
      // just-created brand by name_match instead of creating 10 phantom
      // brands for the same company."
      brandId = `<new-brand:${normalizeName(payload.name).slice(0, 14) || 'unknown'}>`;
    } else {
      const ref = await db.collection('Brands').add(payload);
      brandId = ref.id;
    }
    // Update in-memory index in BOTH modes so the dry-run report counts
    // brands correctly. The live and dry-run reports should match.
    const inMem = { id: brandId, ...payload };
    idx.brandsById.set(brandId, inMem);
    if (payload.apolloOrganizationId) idx.byApolloOrgId.set(payload.apolloOrganizationId, brandId);
    const norm = normalizeName(payload.name);
    if (norm) idx.byNormalizedName.set(norm, brandId);
    counts.newBrands += 1;
  } else if (strategy === 'name_match' || strategy === 'apollo_org_id') {
    // Patch existing brand with fresh Apollo data — only if we have some.
    if (contact.companyInfo) {
      const existing = idx.brandsById.get(brandId);
      const patch = buildExistingBrandPatch(existing, contact);
      if (flags.dryRun) {
        // No-op in dry-run; log it
      } else {
        await db.collection('Brands').doc(brandId).update(patch);
        Object.assign(existing, patch);
        if (patch.apolloOrganizationId) idx.byApolloOrgId.set(patch.apolloOrganizationId, brandId);
      }
      counts.brandsEnriched += 1;
    }
  }

  // 2. Resolve target decisionMaker doc id
  const apolloPersonId = contact.apolloPersonId || contact.id;
  let dmId = apolloPersonId;
  let dmStrategy = 'new_dm';

  // 2b. If a DM already exists at this brand with the same email, merge into it
  if (contact.email && strategy !== 'new_brand') {
    // Skip the lookup for brand-new brands (no DMs yet — saves a query).
    // Run the lookup in dry-run too so the preview accurately counts merges
    // — it's a read-only query in both modes.
    const existingDm = await findDmByEmail(brandId, contact.email);
    if (existingDm) {
      dmId = existingDm.id;
      dmStrategy = 'merge_dm';

      if (!flags.dryRun) {
        const mergePatch = buildDmMergePatch(existingDm, contact);
        await db.collection('Brands').doc(brandId).collection('decisionMakers').doc(dmId).update(mergePatch);
      }
      counts.dmsMerged += 1;
    }
  }

  // 3. Write the new decisionMaker doc (only if we didn't merge into existing)
  if (dmStrategy === 'new_dm') {
    if (!flags.dryRun) {
      const dmPayload = buildDecisionMaker(contact);
      await db
        .collection('Brands').doc(brandId)
        .collection('decisionMakers').doc(dmId)
        .set(dmPayload);
    }
    counts.dmsCreated += 1;
  }

  // 4. Archive + delete original /Contacts doc
  if (!flags.dryRun) {
    await db.collection('Contacts_archive').doc(contact.id).set(
      pickDefined({
        ...contact,
        _archivedAt: FV.serverTimestamp(),
        _migratedTo: { brandId, dmId },
        _brandMatchStrategy: strategy,
        _dmStrategy: dmStrategy,
      }),
    );
    await db.collection('Contacts').doc(contact.id).delete();
  }
  counts.archived += 1;

  return {
    ok: true,
    contactId: contact.id,
    brandId,
    dmId,
    strategy,
    dmStrategy,
    company: companyName,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  log(`[migrate-contacts-to-brands] ${tag} starting…`);

  log('Loading Brand index (apolloOrganizationId + normalized name)…');
  const idx = await loadBrandIndex();
  log(`  loaded ${idx.brandsById.size} brands; ${idx.byApolloOrgId.size} with apolloOrganizationId; ${idx.byNormalizedName.size} unique normalized names`);

  log('Loading /Contacts…');
  let contactsQ = db.collection('Contacts');
  if (flags.contactId) {
    const one = await contactsQ.doc(flags.contactId).get();
    if (!one.exists) {
      console.error('No contact with that id'); process.exit(1);
    }
    const contact = { id: one.id, ...one.data() };
    const counts = freshCounts();
    const result = await migrateOne(contact, idx, counts);
    log(JSON.stringify(result, null, 2));
    log('counts:', counts);
    process.exit(0);
  }
  const contactSnap = await (flags.limit ? contactsQ.limit(flags.limit).get() : contactsQ.get());
  log(`  found ${contactSnap.size} /Contacts doc(s)`);

  const counts = freshCounts();
  const results = [];

  let i = 0;
  for (const docSnap of contactSnap.docs) {
    i += 1;
    const contact = { id: docSnap.id, ...docSnap.data() };
    try {
      const r = await migrateOne(contact, idx, counts);
      results.push(r);
      const line = r.ok
        ? `${tag} ${pad(i, 4)}/${contactSnap.size}  ${r.contactId.slice(0,6)}…  ${r.strategy.padEnd(13)} ${r.dmStrategy.padEnd(9)}  brand=${String(r.brandId).slice(0,8)}…  dm=${String(r.dmId).slice(0,10)}…  (${r.company.slice(0,28)})`
        : `${tag} ${pad(i, 4)}/${contactSnap.size}  ${contact.id.slice(0,6)}…  SKIP        ${r.reason}`;
      log(line);
    } catch (e) {
      counts.failed += 1;
      console.error(`${tag} ${pad(i, 4)}/${contactSnap.size}  ${contact.id.slice(0,6)}…  ✗ ERROR: ${e.message}`);
    }
  }

  log('');
  log('─── summary ─────────────────────────────────────────────');
  log(`  scanned:             ${contactSnap.size}`);
  log(`  new brands created:  ${counts.newBrands}`);
  log(`  brands enriched:     ${counts.brandsEnriched}`);
  log(`  decisionMakers new:  ${counts.dmsCreated}`);
  log(`  decisionMakers merged into Jamal DMs: ${counts.dmsMerged}`);
  log(`  archived + deleted:  ${counts.archived}`);
  log(`  skipped:             ${counts.skipped}`);
  log(`  failed:              ${counts.failed}`);
  log('');

  // Strategy breakdown
  const byStrategy = {};
  for (const r of results) {
    if (!r.ok) continue;
    const key = `${r.strategy}/${r.dmStrategy}`;
    byStrategy[key] = (byStrategy[key] || 0) + 1;
  }
  log('  strategy breakdown:');
  for (const [k, v] of Object.entries(byStrategy).sort()) {
    log(`    ${k.padEnd(28)} ${v}`);
  }

  if (flags.dryRun) {
    log('');
    log(`Dry-run complete. Re-run without --dry-run to commit ${counts.archived} migration(s).`);
  } else {
    log('');
    log(`Live run complete. Verify:`);
    log(`  /Contacts count       → expect 0 (or skipped: ${counts.skipped})`);
    log(`  /Contacts_archive     → expect ${counts.archived}`);
    log(`  collectionGroup DMs   → expect prior + ${counts.dmsCreated}`);
  }

  process.exit(0);
}

function freshCounts() {
  return {
    newBrands: 0,
    brandsEnriched: 0,
    dmsCreated: 0,
    dmsMerged: 0,
    archived: 0,
    skipped: 0,
    failed: 0,
  };
}
function pad(n, w) { return String(n).padStart(w, ' '); }

main().catch((e) => {
  console.error('[migrate-contacts-to-brands] fatal:', e);
  process.exit(1);
});
