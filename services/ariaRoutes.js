// Aria — HTTP route handlers. Mounted by server.js as `mountAriaRoutes(app, { admin })`.
//
// Routes:
//   POST /api/aria/apollo-search                 (kicks off translation + Apollo call)
//   POST /api/aria/apollo-search/:queryId/assign-to-list  (assigns selected results to a list)
//
// Auth: Bearer <Firebase ID token>; the token's UID must have
//       tfTeams/{uid}.manager === true (matches the Firestore rule).

import { isAnthropicConfigured, translateToApolloParams } from './ariaClaudeService.js';
import {
  isApolloConfigured,
  mapApolloPersonToContact,
  mapApolloRevealToContactPatch,
  revealApolloPerson,
  searchPeople,
} from './ariaApolloService.js';

const RESULT_CAP = 100;

export function mountAriaRoutes(app, { admin }) {
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  // Admin gate. Real data model:
  //   tfTeams/{teamId} {
  //     members: { [uid]: { role: 'admin' | 'member', ... } }
  //   }
  // A user is admin if there exists ANY team where members[uid].role === 'admin'.
  // We use Firestore nested-map equality on the dotted path.
  const requireAdmin = async (req, res, next) => {
    try {
      const auth = req.headers.authorization || '';
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (!m) return res.status(401).json({ error: 'Missing bearer token' });
      const decoded = await admin.auth().verifyIdToken(m[1]);
      const uid = decoded.uid;
      const snap = await db
        .collection('tfTeams')
        .where(`members.${uid}.role`, '==', 'admin')
        .limit(1)
        .get();
      if (snap.empty) {
        return res.status(401).json({ error: 'Admin role required' });
      }
      req.aria = { uid };
      return next();
    } catch (e) {
      console.error('[aria] auth failure', e);
      return res.status(401).json({ error: 'Invalid token' });
    }
  };

  // ── POST /api/aria/apollo-search ────────────────────────────────────────
  app.post('/api/aria/apollo-search', requireAdmin, async (req, res) => {
    const { queryDescription, queryId } = req.body || {};
    if (!queryDescription || !queryId) {
      return res.status(400).json({ error: 'queryDescription and queryId are required' });
    }
    if (!isAnthropicConfigured() || !isApolloConfigured()) {
      return res.status(503).json({
        error: 'Apollo or Anthropic API key not configured on server. See README — both must be set in Render env vars before this endpoint works.',
      });
    }

    const queryRef = db.doc(`ApolloQueries/${queryId}`);
    try {
      // Step 1: mark pending (the client may have already seeded the doc, but
      // we make this idempotent so a direct API call still works).
      await queryRef.set(
        {
          queryDescription,
          status: 'pending',
          executedBy: req.aria.uid,
          executedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      // Step 2: translate via Claude.
      let queryParams;
      try {
        queryParams = await translateToApolloParams(queryDescription);
      } catch (e) {
        await queryRef.set(
          {
            status: 'failed',
            errorMessage: `Translation failed: ${e.message}`,
          },
          { merge: true },
        );
        return res.status(502).json({ error: 'Could not translate description', detail: e.message });
      }

      await queryRef.set({ status: 'running', queryParams }, { merge: true });

      // Step 3: call Apollo.
      let apolloRes;
      try {
        apolloRes = await searchPeople(queryParams);
      } catch (e) {
        console.error('[aria] apollo error:', e.status, e.message, e.payload || '');
        await queryRef.set(
          {
            status: 'failed',
            errorMessage: `Apollo call failed: ${e.message}`,
          },
          { merge: true },
        );
        return res.status(502).json({ error: 'Apollo call failed', detail: e.message, payload: e.payload });
      }

      const people = Array.isArray(apolloRes.people) ? apolloRes.people.slice(0, RESULT_CAP) : [];

      // Step 4: write each as a Contact with deterministic doc ID = apolloPersonId.
      // Re-runs against the same query dedup automatically since the doc ID is stable.
      const contactIds = [];
      const writes = [];
      const now = FieldValue.serverTimestamp();
      for (const person of people) {
        const mapped = mapApolloPersonToContact(person);
        if (!mapped.apolloPersonId) continue;
        contactIds.push(mapped.apolloPersonId);
        const ref = db.doc(`Contacts/${mapped.apolloPersonId}`);
        writes.push(
          ref.set(
            {
              name: mapped.name,
              email: mapped.email || '',
              linkedinUrl: mapped.linkedinUrl,
              company: mapped.company,
              title: mapped.title,
              verificationStatus: 'unverified',
              source: 'apollo',
              listIds: [],
              notes: '',
              apolloPersonId: mapped.apolloPersonId,
              createdAt: now,
              updatedAt: now,
              lastActivityAt: null,
              createdBy: req.aria.uid,
            },
            { merge: true },
          ),
        );
      }
      await Promise.all(writes);

      await queryRef.set(
        {
          status: 'complete',
          resultCount: contactIds.length,
          contactIds,
          errorMessage: null,
        },
        { merge: true },
      );

      return res.json({ queryId, resultCount: contactIds.length, contactIds });
    } catch (e) {
      console.error('[aria] apollo-search failed', e);
      await queryRef
        .set({ status: 'failed', errorMessage: e.message || 'Unknown error' }, { merge: true })
        .catch(() => {});
      return res.status(500).json({ error: 'Unexpected server error', detail: e.message });
    }
  });

  // ── POST /api/aria/contacts/:contactId/reveal ───────────────────────────
  // Burns 1 Apollo credit. Use sparingly.
  app.post('/api/aria/contacts/:contactId/reveal', requireAdmin, async (req, res) => {
    const { contactId } = req.params;
    if (!isApolloConfigured()) {
      return res.status(503).json({ error: 'Apollo API key not configured on server' });
    }
    try {
      const ref = db.doc(`Contacts/${contactId}`);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Contact not found' });
      const c = snap.data();
      if (!c.apolloPersonId) {
        return res.status(400).json({ error: 'Contact has no apolloPersonId — can only reveal Apollo-sourced contacts' });
      }
      const person = await revealApolloPerson(c.apolloPersonId);
      const patch = mapApolloRevealToContactPatch(person);
      if (!patch || Object.keys(patch).length === 0) {
        return res.status(502).json({ error: 'Apollo returned no usable fields for this person' });
      }
      await ref.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
      return res.json({ contactId, patch });
    } catch (e) {
      console.error('[aria] reveal error:', e.status, e.message, e.payload || '');
      return res.status(502).json({ error: 'Reveal failed', detail: e.message });
    }
  });

  // ── POST /api/aria/contacts/bulk-reveal ────────────────────────────────
  // Reveals up to 25 contacts in parallel (capped to keep credit blast-radius
  // small). Burns 1 Apollo credit per contact. Returns per-contact result.
  app.post('/api/aria/contacts/bulk-reveal', requireAdmin, async (req, res) => {
    const { contactIds } = req.body || {};
    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({ error: 'contactIds[] required' });
    }
    if (contactIds.length > 25) {
      return res.status(400).json({ error: 'Maximum 25 reveals per request (credit blast-radius cap)' });
    }
    if (!isApolloConfigured()) {
      return res.status(503).json({ error: 'Apollo API key not configured on server' });
    }
    const results = await Promise.all(
      contactIds.map(async (contactId) => {
        try {
          const ref = db.doc(`Contacts/${contactId}`);
          const snap = await ref.get();
          if (!snap.exists) return { contactId, ok: false, error: 'not found' };
          const c = snap.data();
          if (!c.apolloPersonId) {
            return { contactId, ok: false, error: 'no apolloPersonId' };
          }
          // Skip if already revealed (cheap shortcut — saves credits).
          if (c.email && c.email.length > 0) {
            return { contactId, ok: true, skipped: 'already revealed' };
          }
          const person = await revealApolloPerson(c.apolloPersonId);
          const patch = mapApolloRevealToContactPatch(person);
          if (!patch || Object.keys(patch).length === 0) {
            return { contactId, ok: false, error: 'no usable fields returned' };
          }
          await ref.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
          return { contactId, ok: true, patch };
        } catch (e) {
          console.error('[aria] bulk-reveal item error:', contactId, e.message);
          return { contactId, ok: false, error: e.message };
        }
      }),
    );
    const revealed = results.filter((r) => r.ok && !r.skipped).length;
    const skipped = results.filter((r) => r.skipped).length;
    const failed = results.filter((r) => !r.ok).length;
    return res.json({ revealed, skipped, failed, results });
  });

  // ── POST /api/aria/apollo-search/:queryId/assign-to-list ────────────────
  app.post('/api/aria/apollo-search/:queryId/assign-to-list', requireAdmin, async (req, res) => {
    const { queryId } = req.params;
    const { listId, contactIds } = req.body || {};
    if (!listId || !Array.isArray(contactIds) || !contactIds.length) {
      return res.status(400).json({ error: 'listId and non-empty contactIds[] are required' });
    }
    try {
      // Ensure target list exists.
      const listSnap = await db.doc(`Lists/${listId}`).get();
      if (!listSnap.exists) return res.status(404).json({ error: 'List not found' });

      // Batched updates — Firestore caps batches at 500 ops; chunk if needed.
      let added = 0;
      for (let i = 0; i < contactIds.length; i += 400) {
        const chunk = contactIds.slice(i, i + 400);
        const batch = db.batch();
        for (const cid of chunk) {
          batch.update(db.doc(`Contacts/${cid}`), {
            listIds: admin.firestore.FieldValue.arrayUnion(listId),
            updatedAt: FieldValue.serverTimestamp(),
          });
          added += 1;
        }
        await batch.commit();
      }

      await db.doc(`Lists/${listId}`).update({
        contactCount: FieldValue.increment(added),
        updatedAt: FieldValue.serverTimestamp(),
      });

      await db.doc(`ApolloQueries/${queryId}`).set(
        { assignedToListId: listId },
        { merge: true },
      );

      return res.json({ added });
    } catch (e) {
      console.error('[aria] assign-to-list failed', e);
      return res.status(500).json({ error: 'Assignment failed', detail: e.message });
    }
  });
}
