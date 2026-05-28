// Verifies the admin-check predicate used by aply-server's requireAdmin
// middleware. Runs the *exact* Firestore query the middleware runs against
// real data: queries `tfTeams` where `members.${uid}.role == 'admin'`.
//
// What it proves:
//   1. The dotted-path query syntax is valid (no `INVALID_ARGUMENT` from Firestore).
//   2. For at least one existing admin in the dataset, the query returns >0 docs.
//   3. For a known member-only uid (we synthesize one), the query returns 0 docs.
//
// Run from /aply-server:  node scripts/verify-aria-admin.js

import admin from 'firebase-admin';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Pull the service account out of server.js by parsing it — keeps this script
// self-contained without re-pasting the credentials.
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

const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  process.exitCode = 1;
};

async function adminCheck(uid) {
  const snap = await db
    .collection('tfTeams')
    .where(`members.${uid}.role`, '==', 'admin')
    .limit(1)
    .get();
  return !snap.empty;
}

async function main() {
  console.log('\n[verify-aria-admin] Checking requireAdmin predicate against real Firestore…\n');

  // 1) Pull a sample of tfTeams docs to find a real admin uid and a real
  //    member-only uid we can use as our negative test case.
  const teams = await db.collection('tfTeams').limit(10).get();
  if (teams.empty) {
    fail('tfTeams collection is empty in this project — cannot verify against real data');
    return;
  }
  ok(`Found ${teams.size} tfTeams doc(s)`);

  // 2) Walk the members maps and bucket uids by role.
  const adminUids = new Set();
  const memberUids = new Set();
  for (const doc of teams.docs) {
    const members = doc.data()?.members || {};
    for (const [uid, m] of Object.entries(members)) {
      if (m?.role === 'admin') adminUids.add(uid);
      else if (m?.role === 'member') memberUids.add(uid);
    }
  }
  // Exclude any uid that's admin somewhere else so the "member" sample is genuinely non-admin.
  for (const uid of [...memberUids]) {
    if (adminUids.has(uid)) memberUids.delete(uid);
  }
  console.log(`  · admin uids in sample: ${adminUids.size}`);
  console.log(`  · member-only uids in sample: ${memberUids.size}`);

  // 3) Positive case — an admin should pass.
  if (adminUids.size === 0) {
    fail('No admin uids found in sample — cannot verify the passing path');
  } else {
    const adminUid = [...adminUids][0];
    const passed = await adminCheck(adminUid);
    if (passed) ok(`admin uid ${adminUid.slice(0, 6)}… → passes (members[uid].role === 'admin')`);
    else fail(`admin uid ${adminUid.slice(0, 6)}… → rejected, but should pass`);
  }

  // 4) Negative case — a member-only uid should be rejected.
  if (memberUids.size === 0) {
    // Fall back to a synthetic uid that definitely doesn't exist.
    const syntheticUid = 'verify-script-nonexistent-uid';
    const passed = await adminCheck(syntheticUid);
    if (!passed) ok(`synthetic non-existent uid → rejected (empty result set)`);
    else fail(`synthetic uid passed admin check — query is matching too broadly`);
  } else {
    const memberUid = [...memberUids][0];
    const passed = await adminCheck(memberUid);
    if (!passed) ok(`member uid ${memberUid.slice(0, 6)}… → rejected (role === 'member')`);
    else fail(`member uid ${memberUid.slice(0, 6)}… → passed admin check, but should be rejected`);
  }

  // 5) Always-fail case — a uid that doesn't exist in any team.
  const syntheticUid = 'verify-script-' + Math.random().toString(36).slice(2);
  const passed = await adminCheck(syntheticUid);
  if (!passed) ok(`unknown uid ${syntheticUid.slice(0, 18)}… → rejected`);
  else fail(`unknown uid passed admin check`);

  console.log('\n[verify-aria-admin] Done.\n');
}

main().catch((e) => {
  console.error('[verify-aria-admin] Error:', e);
  process.exit(1);
});
