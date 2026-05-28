// Paste your exact serviceAccount object here
const serviceAccount = {
  type: 'service_account',
  project_id: 'mrkt-2efde',
  private_key_id: '9278d3dab0b13eb5720140943d7ffed2996b1a1a',
  private_key:
    '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCRFL5IlO69j+pw\n5mbwXUDUDsKFeAV2rRMMXCGezELKxwWOLbB+Mb9tPDie8XgqHMvFrpaAoD5WJRAg\n59KPhtb2w1x0qoyXLlaP2VCv8ebULl/zxCQ9A9pAevE2Vtr8oxx1IW85nS3k50yK\nzM3ubt9XAtu3CwF0U+L5NO7w2jDzScC1YmZm1UubFiG0RFjgZXLcVFVwixGoQfW1\nnl6C7K9IPxjhRo+RG2d6OzzIq+YD3SZyxiC1XB5ZbD2xAqOSljbaU9f4HDcS+9tH\n5l66wGksE0zCxduAIREAGXgeydk1Pq0g/CkQ5y+UYPFM576viga5kR5HZwTVe5Vh\nvb74aGZ/AgMBAAECggEAEc7uhoFFht4+BEq70wBXX1BKf1CatxUKlAdRFylyf2qL\nm4avNeZMXY+5UYVJXz32o1bJYZOJ41AcWTWrinOeOl8Dn8x5gmstM+4UcexrDZt9\nqrHmUtkAts6Agk+KBN3Ote/7M6LACet8YUM/eeeBIbCXoLHIpWtQno9pTwYxYQN6\nw9Nd9eL1PG+nUugT0vGdkD6pQ9+JblOm4WqnJkgCJBdfaVT6WKyYaRK0QN1tb4cU\nbgCm0Vc2d5eh2+bVglNC1IEpGC/1JjCD23RSmA3n7NTNXtuOivWYKHPbpLgf8l/i\npeewI07pOradNKCcHrEsi4eaQEacKrpyJVLJvmKJvQKBgQDDDQ+79ZQPZ5aVOiaP\nObnZypAWglgr05KlxU4Ee9BQd0gJgFWxu0HVzjj/k6+snsUi6TGOhdsqetvxZ01b\n867QaSvwTTT8YEWhGZbFmaJAfhCzZ27ibkjmjB3X+IOgxH+ezL+JVRdjT7uvzGH4\nKULSs3Ca1ccNfk1F6IJ4YUeo+wKBgQC+amAR8EdjleHr1SpBReHzi+2JLCH1UShk\nYgAbn//T37sCkDu9h7nvLar4Vv+OWQhLbETP/G1GtfhkfPwWuDn1v5V797DA6Cc+\nv5vkaRn1fCLkmN8tsEE92QEk0SvNVxYfeO8V/OuDuUQOHbvmBQkf/CFAmoGDbjOE\ne2ncyhFJTQKBgGaNAn3HY34p75EsDsP1DNMGXnWHOIZqacsAjsFqu57i6Bwevm+A\nzd902qD9bDrtCycMxkJx/EY8bFFjB9hVqc7nzPM+FKKwl0tZYd0oppcT8QHyWulw\nJKIaf0Ji5gnr5lF+wyGYfIB5lmuaoNPSFdEkCQtPZKWih0w/MAHM29lrAoGBAJUS\nHHIOxSTek0cY1ALT3efYNTc9mLxANDoaSvFVmmfZ8MM5/bsMhfEMtJvFKD7dztOV\nSG33tek0zuiEvKpgwed1fGbX68WqOgcy5K215n+8FmkWkSpooTr1J6MWKo+QTR6I\ng8yX/B1crj3K425ZpOIodjPogdpOLQDbyW3zuALFAoGBAKi6R50Eq8NfizhjZ22R\nAorYrIVgxN6I5UcDbZEUalMmKy5pi8R0vSsux7Dti9gpeAitYoN/gpwL34vC8Y+0\nXukKOUJCwB/GBCsfVy0tcAYli6HagCOlqHO4LSYx6bPokygQXnwhRABi9KXygBA4\nMU6fyaIDUeCMvVN+fNa880Ix\n-----END PRIVATE KEY-----\n',
  client_email: 'firebase-adminsdk-18dkb@mrkt-2efde.iam.gserviceaccount.com',
  client_id: '115576775009570855721',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url:
    'https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-18dkb%40mrkt-2efde.iam.gserviceaccount.com',
  universe_domain: 'googleapis.com',
};

import admin from 'firebase-admin';
import cors from 'cors';
import express from 'express';
import dotenv from 'dotenv';
import sgMail from '@sendgrid/mail';
import { v4 as uuidv4 } from 'uuid';
import { generateAlixResponse } from './AlixAIProfile.js';
import cron from 'node-cron';
import Stripe from 'stripe';
import crypto from 'crypto';
import { getStripe, getPriceIdForPipeline, PIPELINE_PRICE_KEYS } from './services/stripe.js';
import { mountAriaRoutes } from './services/ariaRoutes.js';

// override: true so .env wins over any pre-set shell values. Required because
// Claude Code (and some other dev tools) export `ANTHROPIC_API_KEY=` (empty)
// into spawned subprocesses to prevent the host's API key from leaking — the
// default dotenv behavior would then keep the empty value and ignore .env.
// In production this is moot (Render has no .env file; dashboard env vars are
// the only source).
dotenv.config({ override: true });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Route-specific CORS allowlist for /api/stripe/* — explicit list of origins
// permitted to call the new Stripe endpoints.
//
// CAVEAT: the global app.use(cors()) below currently writes
// `Access-Control-Allow-Origin: *` to all responses BEFORE this route-level
// middleware runs, so on the wire this allowlist is documentary rather than
// enforcing. Tightening the global CORS to match this allowlist is a future
// cleanup that needs to be checked against every legacy endpoint that
// currently relies on wide-open cross-origin access.
const STRIPE_ALLOWED_ORIGINS = new Set([
  'https://teamfeed.co',
  'https://www.teamfeed.co',
  'http://localhost:5173', // teamfeed-web dev (Vite default)
  'http://localhost:5174', // teamfeed-web dev (fallback when 5173 is taken)
  'http://localhost:3031', // teamfeed-web dev (configured port in vite.config)
  'http://localhost:3032', // teamfeed-web dev (vite fallback)
]);
const stripeCors = cors({
  origin: (origin, cb) => {
    // Allow non-browser callers (curl, server-to-server) which send no Origin.
    if (!origin) return cb(null, true);
    if (STRIPE_ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    return cb(new Error(`Origin ${origin} not allowed by /api/stripe CORS policy`));
  },
});

// Storage bucket — falls back to the project's default appspot bucket.
const STORAGE_BUCKET =
  process.env.VITE_FIREBASE_STORAGE_BUCKET ||
  process.env.FIREBASE_STORAGE_BUCKET ||
  'mrkt-2efde.appspot.com';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: STORAGE_BUCKET,
});

const db = admin.firestore();
const bucket = admin.storage().bucket();
const app = express();
const port = 3001;

app.use(cors());

// STRIPE WEBHOOK (Phase 3c) — must be registered with express.raw() BEFORE the
// global express.json() below, so the request body stays untouched for
// signature verification.
app.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    console.log('[stripe webhook] received');

    const signature = req.headers['stripe-signature'];
    if (!signature) {
      console.error('[stripe webhook] Missing Stripe-Signature header');
      return res.status(400).send('Missing Stripe-Signature header');
    }

    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      console.error('[stripe webhook] STRIPE_WEBHOOK_SECRET is not set');
      return res.status(500).send('Webhook secret not configured');
    }

    let event;
    try {
      event = getStripe().webhooks.constructEvent(req.body, signature, secret);
    } catch (err) {
      console.error('[stripe webhook] Signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      try {
        const session = event.data.object;
        const email = session.customer_details?.email || session.customer_email || null;
        const pipelineId = session.metadata?.pipelineId || null;
        const applicationDataRaw = session.metadata?.applicationData || '';

        if (!email || !pipelineId) {
          // Data we can't act on — 200 so Stripe doesn't retry forever.
          console.error(
            '[stripe webhook] checkout.session.completed missing email or pipelineId:',
            { id: session.id, email, pipelineId }
          );
          return res.status(200).send('Skipped: missing email or pipelineId');
        }

        let formData = null;
        if (applicationDataRaw) {
          try {
            formData = JSON.parse(applicationDataRaw);
          } catch (_) {
            // Phase 3a truncates metadata to 500 chars, so a partial JSON blob
            // can land here. Preserve whatever we got rather than dropping it.
            formData = { raw: applicationDataRaw };
          }
        }

        const docId = `${email.replace(/[^a-z0-9]/gi, '_')}_${pipelineId}`;
        const appDoc = {
          email,
          pipelineId,
          formData,
          paymentStatus: 'deposit_paid',
          decisionStatus: 'pending',
          stripeCustomerId: session.customer || null,
          stripeCheckoutSessionId: session.id,
          depositPaidAt: admin.firestore.FieldValue.serverTimestamp(),
          submittedAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await db.collection('Applications').doc(docId).set(appDoc, { merge: true });
        console.log('[stripe webhook] Application doc written:', docId);
      } catch (err) {
        // Transient (Firestore) failure — return 500 so Stripe retries.
        console.error('[stripe webhook] Error processing checkout.session.completed:', err);
        return res.status(500).send('Error processing event');
      }
    } else {
      console.log('[stripe webhook] Ignored event type:', event.type);
    }

    return res.status(200).send('ok');
  }
);

app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  next();
});

app.get('/', (req, res) => {
  res.send('✅ Teamfeed backend is live.');
});

// ── Aria (V1: contacts admin) ────────────────────────────────────────────────
// Apollo natural-language search + assign-to-list. Requires APOLLO_API_KEY +
// ANTHROPIC_API_KEY env vars; returns 503 if either is missing.
mountAriaRoutes(app, { admin });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
sgMail.setApiKey(SENDGRID_API_KEY);


// ===============================
// TEAMFEED — SEND CODE
// ===============================
app.post('/send-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const createdAt = Date.now();

  try {
    await db.collection('magicCodes').doc(email).set({ code, createdAt });

    const origin = req.headers.origin || '';
    const baseUrl = origin.includes('localhost')
      ? 'http://localhost:3031'
      : 'https://teamfeed.co';

    const msg = {
      to: email,
      from: 'noreply@aply.com',
      subject: 'Sign in to Teamfeed',
      html: `
        <!DOCTYPE html>
        <html>
          <body style="background-color: #ffffff; padding: 40px; font-family: -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif; color: #111;">
            <div style="max-width: 480px; margin: auto; border: 1px solid #e5e5e5; padding: 32px; border-radius: 8px;">
              <h2 style="margin-top: 0;">Your Teamfeed sign-in code</h2>
              <p style="font-size: 16px;">Enter this code to continue:</p>
              <div style="font-size: 32px; font-weight: 700; letter-spacing: 2px; margin: 24px 0;">
                ${code}
              </div>
              <p style="font-size: 14px; color: #666;">This code expires in 15 minutes.</p>
              <p style="font-size: 12px; color: #999; margin-top: 32px;">Sent from ${baseUrl}</p>
            </div>
          </body>
        </html>
      `,
      text: `Your Teamfeed sign-in code is: ${code}`,
    };

    await sgMail.send(msg);
    return res.json({ success: true });
  } catch (err) {
    console.error('Send Code Error:', err);
    return res.status(500).json({ error: 'Failed to send code' });
  }
});


// ===============================
// TEAMFEED — VERIFY CODE
// ===============================
app.post('/verify-code', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Missing email or code' });

  try {
    const codeRef = db.collection('magicCodes').doc(email);
    const codeSnap = await codeRef.get();
    if (!codeSnap.exists) return res.status(400).json({ error: 'Code not found' });

    const { code: storedCode, createdAt } = codeSnap.data();
    const ageMinutes = (Date.now() - createdAt) / 60000;

    if (ageMinutes > 15) {
      await codeRef.delete();
      return res.status(400).json({ error: 'Code expired' });
    }

    if (code !== storedCode) return res.status(400).json({ error: 'Invalid code' });

    await codeRef.delete();

    let userRecord;
    let isNewUser = false;

    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        userRecord = await admin.auth().createUser({ email });
        isNewUser = true;
      } else {
        throw err;
      }
    }

    const uid = userRecord.uid;

    await db.collection('tfUsers').doc(uid).set(
      {
        uid,
        email,
        onboarded: false,
        teamIds: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const firebaseToken = await admin.auth().createCustomToken(uid);
    return res.json({ success: true, uid, email, firebaseToken, isNewUser });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to verify code' });
  }
});


// ===============================
// TEAMFEED — CREATE MAGIC LINK
// ===============================
app.post('/create-magic-link', async (req, res) => {
  const { email, brandFlow = false, segment = null } = req.body;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  try {
    const token = uuidv4();
    const createdAt = Date.now();

    await db.collection('magicLinks').doc(token).set({ email, createdAt, brandFlow, segment });

    const origin = req.headers.origin || '';
    const baseUrl = origin.includes('localhost') ? 'http://localhost:3031' : 'https://teamfeed.co';
    const magicLink = `${baseUrl}?token=${token}`;

    const htmlTemplate = `
      <!DOCTYPE html>
      <html>
        <body style="margin: 0; padding: 40px; background-color: #ffffff; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #111111; text-align: center;">
          <h2>Sign in to Teamfeed</h2>
          <p>This one-time link is valid for the next <strong>15 minutes</strong>.</p>
          <p>
            <a href="${magicLink}" style="display: inline-block; margin: 20px 0; padding: 12px 24px; background-color: #111111; color: #ffffff; text-decoration: none; font-weight: bold; border-radius: 6px;">
              Sign In
            </a>
          </p>
          <p>If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="word-break: break-all; font-size: 14px;">${magicLink}</p>
          <p style="margin-top: 40px; font-size: 12px; color: #888888;">© 2025 Teamfeed</p>
        </body>
      </html>
    `;

    const msg = {
      to: email,
      from: 'noreply@aply.com',
      subject: 'Sign in to Teamfeed',
      html: htmlTemplate,
      text: `Click to sign in: ${magicLink}`,
    };

    console.log('SENDGRID_API_KEY is:', process.env.SENDGRID_API_KEY?.slice(0, 5));
    await sgMail.send(msg);
    res.json({ success: true });
  } catch (err) {
    console.error('Create Magic Link Error:', err);
    res.status(500).json({ error: 'Failed to create magic link' });
  }
});


// ===============================
// TEAMFEED — VERIFY TOKEN
// ===============================
app.post('/verify-token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  try {
    const tokenRef = db.collection('magicLinks').doc(token);
    const tokenDoc = await tokenRef.get();

    if (!tokenDoc.exists) return res.status(400).json({ error: 'Invalid or expired token' });

    const { email, createdAt, brandFlow = false, segment = null } = tokenDoc.data();
    const ageMinutes = (Date.now() - createdAt) / 60000;

    if (ageMinutes > 15) {
      await tokenRef.delete();
      return res.status(400).json({ error: 'Token expired' });
    }

    await tokenRef.delete();

    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        userRecord = await admin.auth().createUser({ email });
      } else {
        return res.status(500).json({ error: 'Failed to retrieve or create user' });
      }
    }

    const userRef = db.collection('creators').doc(userRecord.uid);
    await userRef.set(
      { email, brandFlow, segment, createdAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    const firebaseToken = await admin.auth().createCustomToken(userRecord.uid);
    return res.json({ uid: userRecord.uid, email, firebaseToken, brandFlow, segment });
  } catch (err) {
    console.error('Verify Token Error:', err);
    return res.status(500).json({ error: 'Failed to verify token' });
  }
});


// ===============================
// TEAMFEED — NOTIFY TEAM CAMPAIGN
// ===============================
app.post('/notify-team-campaign', async (req, res) => {
  const { uid, hook, idea, dueDate } = req.body;
  if (!uid || !hook || !idea) return res.status(400).json({ error: 'Missing required fields' });

  try {
    const userSnap = await db.collection('creators').doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const userName = userData.firstName || 'Unnamed';
    const profilePic = userData.profilePic || '';

    const teamSnap = await db.collection('teamfeedteam').get();
    const teamEmails = teamSnap.docs
      .map(doc => doc.data())
      .filter(member => !!member.email)
      .map(member => member.email);

    const origin = req.headers.origin || '';
    const baseUrl = origin.includes('localhost') ? 'http://localhost:3031' : 'https://teamfeed.co';

    const html = `
      <div style="font-family: Helvetica, sans-serif; background: #ffffff; padding: 30px; text-align: center;">
        <img src="${profilePic}" alt="${userName}" style="width: 60px; height: 60px; border-radius: 50%; object-fit: cover; margin-bottom: 16px;" />
        <h2 style="margin: 0 0 12px;">${userName} posted a new campaign on Teamfeed</h2>
        <p style="font-size: 15px; margin: 0 0 6px;"><strong>Due:</strong> ${dueDate || 'Not specified'}</p>
        <p style="font-size: 16px; margin: 12px 0;"><strong>${hook}</strong></p>
        <p style="font-size: 14px; color: #444;">${idea}</p>
        <a href="${baseUrl}/content" style="display: inline-block; margin-top: 24px; padding: 12px 24px; background-color: #000000; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold;">View Campaigns</a>
      </div>
    `;

    const msgList = teamEmails.map(email => ({
      to: email,
      from: 'noreply@aply.com',
      subject: 'New Marketing Campaign on Teamfeed',
      html,
    }));

    await sgMail.send(msgList);
    res.json({ success: true });
  } catch (err) {
    console.error('Notify Team Campaign Error:', err);
    res.status(500).json({ error: 'Failed to send campaign email' });
  }
});


// ===============================
// STRIPE — CREATE CHECKOUT SESSION
// ===============================
app.post('/create-checkout-session', async (req, res) => {
  try {
    const origin = req.headers.origin || '';
    const baseUrl = origin.includes('localhost') ? 'http://localhost:3031' : 'https://teamfeed.co';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card', 'us_bank_account'],
      payment_method_options: {
        us_bank_account: { verification_method: 'automatic' },
      },
      line_items: [{ price: 'price_1RdQGVDjlFghA01sSq8lnWO6', quantity: 1 }],
      success_url: `${baseUrl}/feed`,
      cancel_url: `${baseUrl}/feed`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe Error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});


// ===============================
// STRIPE — /api/stripe/create-checkout-session  (Phase 3a)
// Aply Specialist Program — $99 application deposit.
// Called by teamfeed-web's /pay/:slug page. No webhook in this phase.
// ===============================

// Handle CORS preflight + main request through the same allowlist.
app.options('/api/stripe/*', stripeCors);

app.post('/api/stripe/create-checkout-session', stripeCors, async (req, res) => {
  try {
    const { pipelineId, applicationData } = req.body || {};

    if (!pipelineId || typeof pipelineId !== 'string') {
      return res.status(400).json({ error: 'Missing pipelineId' });
    }

    if (!(pipelineId in PIPELINE_PRICE_KEYS)) {
      return res.status(400).json({ error: 'Unsupported pipeline' });
    }

    const priceId = getPriceIdForPipeline(pipelineId);
    if (!priceId) {
      console.error(
        `[stripe] No price ID configured for pipeline "${pipelineId}". ` +
        `Set ${PIPELINE_PRICE_KEYS[pipelineId]} in .env.`
      );
      return res.status(500).json({ error: 'Pipeline price not configured' });
    }

    const successUrl = process.env.STRIPE_SUCCESS_URL;
    const cancelUrl = process.env.STRIPE_CANCEL_URL;
    if (!successUrl || !cancelUrl) {
      console.error('[stripe] STRIPE_SUCCESS_URL or STRIPE_CANCEL_URL missing in .env');
      return res.status(500).json({ error: 'Checkout redirect URLs not configured' });
    }

    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      // Force a Customer to be created and save the payment method for
      // off-session reuse, so we can charge the $350 balance automatically
      // when an admin accepts the application later.
      customer_creation: 'always',
      payment_intent_data: {
        setup_future_usage: 'off_session',
      },
      // Metadata is here for Phase 3c webhook handling. Stripe rejects metadata
      // values longer than 500 chars per key, so we truncate the JSON blob if
      // it's huge — the full data should be persisted by the caller separately.
      metadata: {
        pipelineId,
        applicationData: applicationData
          ? JSON.stringify(applicationData).slice(0, 500)
          : '',
      },
    });

    return res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('[stripe] create-checkout-session error:', err);
    return res.status(500).json({
      error: err?.message || 'Failed to create checkout session',
    });
  }
});


// ===============================
// STRIPE — /api/stripe/charge-balance  (Phase 4a)
// Admin-triggered: charges the $350 balance off-session against the saved
// Customer + payment method, then flips the Application to accepted.
// ===============================
app.post('/api/stripe/charge-balance', stripeCors, async (req, res) => {
  // TODO: gate behind admin auth before public launch
  try {
    const { applicationId } = req.body || {};
    if (!applicationId || typeof applicationId !== 'string') {
      return res.status(400).json({ error: 'Missing applicationId' });
    }

    const ref = db.collection('Applications').doc(applicationId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Application not found' });
    }
    const appDoc = snap.data();

    if (appDoc.paymentStatus !== 'deposit_paid') {
      return res.status(400).json({
        error: `Cannot charge balance — paymentStatus is "${appDoc.paymentStatus}", expected "deposit_paid".`,
      });
    }
    if (appDoc.decisionStatus !== 'pending') {
      return res.status(400).json({
        error: `Cannot charge balance — decisionStatus is "${appDoc.decisionStatus}", expected "pending".`,
      });
    }
    if (!appDoc.stripeCustomerId) {
      return res.status(400).json({ error: 'Application has no stripeCustomerId on file.' });
    }

    const stripeClient = getStripe();
    const pms = await stripeClient.customers.listPaymentMethods(appDoc.stripeCustomerId, {
      type: 'card',
    });
    if (!pms.data || pms.data.length === 0) {
      return res.status(400).json({ error: 'No saved payment method on customer.' });
    }
    const paymentMethodId = pms.data[0].id;

    let pi;
    try {
      pi = await stripeClient.paymentIntents.create({
        amount: 35000,
        currency: 'usd',
        customer: appDoc.stripeCustomerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description: `Sorority Cert balance — ${applicationId}`,
        metadata: { applicationId, pipelineId: appDoc.pipelineId || '' },
      });
    } catch (e) {
      // Off-session declines and 3DS challenges land here. Don't update the
      // Application doc — admin can retry after asking applicant to update
      // their payment method or complete the auth challenge.
      console.error('[stripe] charge-balance PaymentIntent failed:', {
        applicationId,
        message: e.message,
        code: e.code,
        declineCode: e.decline_code,
        paymentIntentId: e.payment_intent?.id,
      });
      return res.status(400).json({
        error: e.message,
        code: e.code || null,
        declineCode: e.decline_code || null,
        paymentIntentId: e.payment_intent?.id || null,
      });
    }

    if (pi.status !== 'succeeded') {
      // PI created but not yet succeeded (e.g. requires_action). Treat as a
      // failure for this synchronous flow — admin retries.
      console.error('[stripe] charge-balance PI not succeeded:', {
        applicationId,
        status: pi.status,
        paymentIntentId: pi.id,
      });
      return res.status(400).json({
        error: `PaymentIntent status is "${pi.status}", expected "succeeded".`,
        paymentIntentId: pi.id,
      });
    }

    await ref.update({
      paymentStatus: 'balance_paid',
      decisionStatus: 'accepted',
      balancePaidAt: admin.firestore.FieldValue.serverTimestamp(),
      decidedAt: admin.firestore.FieldValue.serverTimestamp(),
      balancePaymentIntentId: pi.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log('[stripe] charge-balance success:', { applicationId, paymentIntentId: pi.id });
    return res.json({ ok: true, paymentIntentId: pi.id });
  } catch (err) {
    console.error('[stripe] charge-balance error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to charge balance' });
  }
});


// ===============================
// STRIPE — /api/stripe/refund-deposit  (Phase 4a)
// Admin-triggered: full refund of the $99 deposit and flips the Application
// to rejected.
// ===============================
app.post('/api/stripe/refund-deposit', stripeCors, async (req, res) => {
  // TODO: gate behind admin auth before public launch
  try {
    const { applicationId, reason } = req.body || {};
    if (!applicationId || typeof applicationId !== 'string') {
      return res.status(400).json({ error: 'Missing applicationId' });
    }

    const ref = db.collection('Applications').doc(applicationId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Application not found' });
    }
    const appDoc = snap.data();

    if (appDoc.paymentStatus !== 'deposit_paid') {
      return res.status(400).json({
        error: `Cannot refund — paymentStatus is "${appDoc.paymentStatus}", expected "deposit_paid".`,
      });
    }
    if (appDoc.decisionStatus !== 'pending') {
      return res.status(400).json({
        error: `Cannot refund — decisionStatus is "${appDoc.decisionStatus}", expected "pending".`,
      });
    }
    if (!appDoc.stripeCheckoutSessionId) {
      return res.status(400).json({ error: 'Application has no stripeCheckoutSessionId on file.' });
    }

    const stripeClient = getStripe();
    let refund;
    try {
      const session = await stripeClient.checkout.sessions.retrieve(
        appDoc.stripeCheckoutSessionId
      );
      if (!session.payment_intent) {
        return res.status(400).json({
          error: 'Checkout session has no payment_intent — cannot refund.',
        });
      }
      refund = await stripeClient.refunds.create({
        payment_intent: session.payment_intent,
        reason: 'requested_by_customer',
        metadata: { applicationId, adminReason: reason || '' },
      });
    } catch (e) {
      console.error('[stripe] refund-deposit failed:', {
        applicationId,
        message: e.message,
        code: e.code,
      });
      return res.status(400).json({ error: e.message });
    }

    await ref.update({
      paymentStatus: 'refunded',
      decisionStatus: 'rejected',
      refundedAt: admin.firestore.FieldValue.serverTimestamp(),
      decidedAt: admin.firestore.FieldValue.serverTimestamp(),
      rejectionReason: reason || null,
      refundId: refund.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log('[stripe] refund-deposit success:', { applicationId, refundId: refund.id });
    return res.json({ ok: true, refundId: refund.id });
  } catch (err) {
    console.error('[stripe] refund-deposit error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to refund deposit' });
  }
});


// ===============================
// ALIX — AI CHAT ENDPOINT
// ===============================
app.post('/alix', async (req, res) => {
  const { phase, userInput, memory, followUpId } = req.body;
  const locationPath = req.headers.referer || req.path;

  if (!userInput && phase !== 'askHighlights' && phase !== 'askExperience') {
    return res.status(400).json({ error: 'Missing userInput' });
  }

  try {
    const aiData = await generateAlixResponse({ phase, userInput, memory, locationPath, followUpId });
    return res.json(aiData);
  } catch (err) {
    console.error('Alix endpoint error:', err);
    return res.status(500).json({ error: 'AI response failed' });
  }
});


// ===============================
// TEAMFEED — DAILY STANDUP CRON
// Runs every weekday at 8am ET
// ===============================
cron.schedule('0 8 * * 1-5', async () => {
  console.log('[CRON] Running daily standup...');
  const today = new Date();
  const todayStr = localDateStr(today);
  const dayOfWeek = today.toLocaleDateString('en-US', { weekday: 'long' });

  try {
    const teamsSnap = await db.collection('tfTeams').get();

    for (const teamDoc of teamsSnap.docs) {
      const teamId = teamDoc.id;
      const data = teamDoc.data();
      const members = data.members || {};
      const standupConfig = data.standupConfig || {};

      for (const [userId, memberInfo] of Object.entries(members)) {
        if (standupConfig[userId] === false) continue;
        if (!memberInfo.approved || memberInfo.active === false) continue;

        const scheduleId = `${teamId}_${userId}`;
        const scheduleDoc = await db.collection('tfWorkSchedules').doc(scheduleId).get();

        if (scheduleDoc.exists) {
          const schedule = scheduleDoc.data();
          const mondayStr = getMonday(today);
          if (schedule.weekOf === mondayStr) {
            if (!(schedule.days || []).includes(dayOfWeek)) continue;
          }
        }

        const standupDoc = await db.collection('tfStandups').doc(scheduleId).get();
        if (standupDoc.exists && standupDoc.data().lastPromptedDate === todayStr) continue;

        // Delete any existing unread standup for this user
        const existingSnap = await db.collection('tfNotifications')
          .where('userId', '==', userId)
          .where('teamId', '==', teamId)
          .where('type', '==', 'standup')
          .where('read', '==', false)
          .get();
        const batch = db.batch();
        existingSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();

        await db.collection('tfNotifications').add({
          teamId, userId, type: 'standup', read: false, date: todayStr,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await db.collection('tfStandups').doc(scheduleId).set(
          { teamId, userId, lastPromptedDate: todayStr },
          { merge: true },
        );

        try {
          const userDoc = await db.collection('tfUsers').doc(userId).get();
          const fcmToken = userDoc.data()?.fcmToken;
          if (fcmToken) {
            await admin.messaging().send({
              token: fcmToken,
              notification: { title: '🎙️ Daily Standup', body: 'What are you working on today?' },
              apns: { payload: { aps: { sound: 'default', badge: 1 } } },
            });
          }
        } catch (e) {
          console.log(`[CRON] Standup FCM failed for ${userId}:`, e.message);
        }

        console.log(`[CRON] Standup notification created for ${userId}`);
      }
    }
    console.log('[CRON] Daily standup complete.');
  } catch (e) {
    console.error('[CRON] Standup error:', e);
  }
}, { timezone: 'America/New_York' });


// ===============================
// TEAMFEED — WEEKLY WORK SCHEDULE CRON
// Runs every Monday at 7:45am ET
// ===============================
cron.schedule('45 7 * * 1', async () => {
  console.log('[CRON] Running weekly work schedule prompt...');
  const today = new Date();
  const mondayStr = getMonday(today);

  try {
    const teamsSnap = await db.collection('tfTeams').get();

    for (const teamDoc of teamsSnap.docs) {
      const teamId = teamDoc.id;
      const data = teamDoc.data();
      const members = data.members || {};
      const scheduleConfig = data.scheduleConfig || {};

      for (const [userId, memberInfo] of Object.entries(members)) {
        if (!scheduleConfig[userId]) continue;
        if (!memberInfo.approved || memberInfo.active === false) continue;

        const scheduleId = `${teamId}_${userId}`;
        const scheduleDoc = await db.collection('tfWorkSchedules').doc(scheduleId).get();
        if (scheduleDoc.exists && scheduleDoc.data().lastPromptedDate === mondayStr) continue;

        // Delete any existing unread work_schedule for this user
        const existingSnap = await db.collection('tfNotifications')
          .where('userId', '==', userId)
          .where('teamId', '==', teamId)
          .where('type', '==', 'work_schedule')
          .where('read', '==', false)
          .get();
        const batch = db.batch();
        existingSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();

        await db.collection('tfNotifications').add({
          teamId, userId, type: 'work_schedule', read: false, date: mondayStr,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await db.collection('tfWorkSchedules').doc(scheduleId).set(
          { teamId, userId, lastPromptedDate: mondayStr },
          { merge: true },
        );

        try {
          const userDoc = await db.collection('tfUsers').doc(userId).get();
          const fcmToken = userDoc.data()?.fcmToken;
          if (fcmToken) {
            await admin.messaging().send({
              token: fcmToken,
              notification: { title: '📅 Work Schedule', body: 'Log your hours for this week.' },
              apns: { payload: { aps: { sound: 'default', badge: 1 } } },
            });
          }
        } catch (e) {
          console.log(`[CRON] Work schedule FCM failed for ${userId}:`, e.message);
        }

        console.log(`[CRON] Work schedule notification created for ${userId}`);
      }
    }
    console.log('[CRON] Weekly work schedule complete.');
  } catch (e) {
    console.error('[CRON] Work schedule error:', e);
  }
}, { timezone: 'America/New_York' });


// ===============================
// TEAMFEED — MANUAL CRON TRIGGERS
// ===============================
app.post('/crons/trigger-standup', async (req, res) => {
  console.log('[MANUAL] Triggering standup cron...');
  try {
    const today = new Date();
    const todayStr = localDateStr(today);
    const teamsSnap = await db.collection('tfTeams').get();
    let count = 0;

    for (const teamDoc of teamsSnap.docs) {
      const teamId = teamDoc.id;
      const data = teamDoc.data();
      const members = data.members || {};
      const standupConfig = data.standupConfig || {};

      for (const [userId, memberInfo] of Object.entries(members)) {
        if (standupConfig[userId] === false) continue;
        if (!memberInfo.approved || memberInfo.active === false) continue;

        const standupId = `${teamId}_${userId}`;
        const standupDoc = await db.collection('tfStandups').doc(standupId).get();
        if (standupDoc.exists && standupDoc.data().lastPromptedDate === todayStr) continue;

        // Delete any existing unread standup for this user
        const existingSnap = await db.collection('tfNotifications')
          .where('userId', '==', userId)
          .where('teamId', '==', teamId)
          .where('type', '==', 'standup')
          .where('read', '==', false)
          .get();
        const batch = db.batch();
        existingSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();

        await db.collection('tfNotifications').add({
          teamId, userId, type: 'standup', read: false, date: todayStr,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await db.collection('tfStandups').doc(standupId).set(
          { teamId, userId, lastPromptedDate: todayStr },
          { merge: true },
        );

        try {
          const userDoc = await db.collection('tfUsers').doc(userId).get();
          const fcmToken = userDoc.data()?.fcmToken;
          if (fcmToken) {
            await admin.messaging().send({
              token: fcmToken,
              notification: { title: '🎙️ Daily Standup', body: 'What are you working on today?' },
              apns: { payload: { aps: { sound: 'default', badge: 1 } } },
            });
          }
        } catch (e) {
          console.log(`[MANUAL] Standup FCM failed for ${userId}:`, e.message);
        }

        count++;
      }
    }

    res.json({ success: true, notificationsCreated: count });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to trigger standup cron' });
  }
});

app.post('/crons/trigger-work-schedule', async (req, res) => {
  console.log('[MANUAL] Triggering work schedule cron...');
  try {
    const mondayStr = getMonday(new Date());
    const teamsSnap = await db.collection('tfTeams').get();
    let count = 0;

    for (const teamDoc of teamsSnap.docs) {
      const teamId = teamDoc.id;
      const data = teamDoc.data();
      const members = data.members || {};
      const scheduleConfig = data.scheduleConfig || {};

      for (const [userId, memberInfo] of Object.entries(members)) {
        if (!scheduleConfig[userId]) continue;
        if (!memberInfo.approved || memberInfo.active === false) continue;

        const scheduleId = `${teamId}_${userId}`;
        const scheduleDoc = await db.collection('tfWorkSchedules').doc(scheduleId).get();
        if (scheduleDoc.exists && scheduleDoc.data().lastPromptedDate === mondayStr) continue;

        // Delete any existing unread work_schedule for this user
        const existingSnap = await db.collection('tfNotifications')
          .where('userId', '==', userId)
          .where('teamId', '==', teamId)
          .where('type', '==', 'work_schedule')
          .where('read', '==', false)
          .get();
        const batch = db.batch();
        existingSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();

        await db.collection('tfNotifications').add({
          teamId, userId, type: 'work_schedule', read: false, date: mondayStr,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await db.collection('tfWorkSchedules').doc(scheduleId).set(
          { teamId, userId, lastPromptedDate: mondayStr },
          { merge: true },
        );

        try {
          const userDoc = await db.collection('tfUsers').doc(userId).get();
          const fcmToken = userDoc.data()?.fcmToken;
          if (fcmToken) {
            await admin.messaging().send({
              token: fcmToken,
              notification: { title: '📅 Work Schedule', body: 'Log your hours for this week.' },
              apns: { payload: { aps: { sound: 'default', badge: 1 } } },
            });
          }
        } catch (e) {
          console.log(`[MANUAL] Work schedule FCM failed for ${userId}:`, e.message);
        }

        count++;
      }
    }

    res.json({ success: true, notificationsCreated: count });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to trigger work schedule cron' });
  }
});


// ===============================
// SHARED HELPERS
// ===============================
function localDateStr(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  if (day === 0) {
    d.setDate(d.getDate() + 1);
  } else {
    d.setDate(d.getDate() - day + 1);
  }
  return localDateStr(d);
}


// ===============================
// TEAMFEED — DAILY PULSE CRON
// Runs every day at 8am ET
// ===============================
cron.schedule('0 8 * * *', async () => {
  console.log('[CRON] Running daily pulse...');
  const today = new Date();
  const todayStr = localDateStr(today);

  try {
    const teamsSnap = await db.collection('tfTeams').get();

    for (const teamDoc of teamsSnap.docs) {
      const teamId = teamDoc.id;
      const data = teamDoc.data();
      const pulseCategories = data.pulseCategories || [];

      for (const category of pulseCategories) {
        if (!category.isActive) continue;

        for (const userId of (category.assignedIds || [])) {
          const members = data.members || {};
          const memberInfo = members[userId];
          if (!memberInfo?.approved || memberInfo?.active === false) continue;

          const notifId = `${teamId}_${category.id}_${userId}_${todayStr}`;
          const existing = await db.collection('tfNotifications').doc(notifId).get();
          if (existing.exists) continue;

          // Delete any existing unread pulse for this user + category
          const existingSnap = await db.collection('tfNotifications')
            .where('userId', '==', userId)
            .where('teamId', '==', teamId)
            .where('type', '==', 'pulse')
            .where('categoryId', '==', category.id)
            .where('read', '==', false)
            .get();
          const batch = db.batch();
          existingSnap.docs.forEach(d => batch.delete(d.ref));
          await batch.commit();

          await db.collection('tfNotifications').doc(notifId).set({
            teamId, userId, type: 'pulse',
            categoryId: category.id,
            categoryName: category.name,
            categoryDescription: category.description,
            read: false, date: todayStr,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          try {
            const userDoc = await db.collection('tfUsers').doc(userId).get();
            const fcmToken = userDoc.data()?.fcmToken;
            if (fcmToken) {
              await admin.messaging().send({
                token: fcmToken,
                notification: {
                  title: `📊 ${category.name}`,
                  body: category.description || 'Fill out your daily update.',
                },
                apns: { payload: { aps: { sound: 'default', badge: 1 } } },
              });
            }
          } catch (e) {
            console.log(`[CRON] Pulse FCM failed for ${userId}:`, e.message);
          }

          console.log(`[CRON] Pulse notification created for ${userId} — ${category.name}`);
        }
      }
    }
    console.log('[CRON] Daily pulse complete.');
  } catch (e) {
    console.error('[CRON] Pulse error:', e);
  }
}, { timezone: 'America/New_York' });


// ===============================
// TEAMFEED — MANUAL PULSE TRIGGER
// ===============================
app.post('/crons/trigger-pulse', async (req, res) => {
  console.log('[MANUAL] Triggering pulse cron...');
  try {
    const today = new Date();
    const todayStr = localDateStr(today);
    const teamsSnap = await db.collection('tfTeams').get();
    let count = 0;

    for (const teamDoc of teamsSnap.docs) {
      const teamId = teamDoc.id;
      const data = teamDoc.data();
      const pulseCategories = data.pulseCategories || [];

      for (const category of pulseCategories) {
        if (!category.isActive) continue;

        for (const userId of (category.assignedIds || [])) {
          const members = data.members || {};
          const memberInfo = members[userId];
          if (!memberInfo?.approved || memberInfo?.active === false) continue;

          const notifId = `${teamId}_${category.id}_${userId}_${todayStr}`;
          const existing = await db.collection('tfNotifications').doc(notifId).get();
          if (existing.exists) continue;

          // Delete any existing unread pulse for this user + category
          const existingSnap = await db.collection('tfNotifications')
            .where('userId', '==', userId)
            .where('teamId', '==', teamId)
            .where('type', '==', 'pulse')
            .where('categoryId', '==', category.id)
            .where('read', '==', false)
            .get();
          const batch = db.batch();
          existingSnap.docs.forEach(d => batch.delete(d.ref));
          await batch.commit();

          await db.collection('tfNotifications').doc(notifId).set({
            teamId, userId, type: 'pulse',
            categoryId: category.id,
            categoryName: category.name,
            categoryDescription: category.description,
            read: false, date: todayStr,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          try {
            const userDoc = await db.collection('tfUsers').doc(userId).get();
            const fcmToken = userDoc.data()?.fcmToken;
            if (fcmToken) {
              await admin.messaging().send({
                token: fcmToken,
                notification: {
                  title: `📊 ${category.name}`,
                  body: category.description || 'Fill out your daily update.',
                },
                apns: { payload: { aps: { sound: 'default', badge: 1 } } },
              });
            }
          } catch (e) {
            console.log(`[MANUAL] Pulse FCM failed for ${userId}:`, e.message);
          }

          count++;
        }
      }
    }

    res.json({ success: true, notificationsCreated: count });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to trigger pulse cron' });
  }
});

app.post('/notify/dm', async (req, res) => {
  const { recipientId, senderName, message } = req.body;
  try {
    const userDoc = await db.collection('tfUsers').doc(recipientId).get();
    if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
    
    const fcmToken = userDoc.data().fcmToken;
    if (!fcmToken) return res.json({ success: false, reason: 'No token' });

    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title: senderName,
        body: message.length > 100 ? message.substring(0, 97) + '...' : message,
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    });

    res.json({ success: true });
  } catch (e) {
    console.error('[notify/dm]', e);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});


// ===============================
// COMPANY IMAGE — UPLOAD FROM URL
// ===============================
// VA pastes an arbitrary image URL → server fetches it (avoids browser CORS),
// uploads to Firebase Storage via Admin SDK, optionally updates the Brand doc,
// and returns the permanent firebasestorage.googleapis.com download URL.
//
// Body: { imageUrl: string, brandId: string, kind?: 'logo' | 'background' }
// kind defaults to 'logo'. When kind is provided, the matching field on the
// Brand doc (logo | backgroundImage) is updated server-side.
app.post('/upload-logo-from-url', async (req, res) => {
  const { imageUrl, brandId, kind = 'logo' } = req.body || {};

  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.trim()) {
    return res.status(400).json({ error: 'Missing imageUrl' });
  }
  if (!brandId || typeof brandId !== 'string' || !brandId.trim()) {
    return res.status(400).json({ error: 'Missing brandId' });
  }
  if (!['logo', 'background'].includes(kind)) {
    return res.status(400).json({ error: 'kind must be "logo" or "background"' });
  }

  try {
    // Server-side fetch — no CORS constraints. Follow redirects (default fetch).
    const fetchRes = await fetch(imageUrl);
    if (!fetchRes.ok) {
      return res.status(502).json({
        error: `Source URL returned ${fetchRes.status}`,
        status: fetchRes.status,
      });
    }

    const contentType = fetchRes.headers.get('content-type') || 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
      return res.status(415).json({
        error: `Source URL did not return an image (content-type: ${contentType})`,
      });
    }

    const arrayBuffer = await fetchRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 5MB cap — enough for logos and reasonable backgrounds.
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(413).json({
        error: `Image too large (${buffer.length} bytes, max 5MB)`,
      });
    }

    const ext = (contentType.split('/')[1] || 'jpg').split(';')[0];
    const folder = kind === 'background' ? 'brandBackgrounds' : 'brandLogos';
    const path = `${folder}/${brandId}_${Date.now()}.${ext}`;

    // Token-based public download URL — matches what the client SDK's
    // getDownloadURL produces, so existing readers don't care which source
    // wrote the file.
    const downloadToken = crypto.randomUUID();
    const file = bucket.file(path);
    await file.save(buffer, {
      contentType,
      metadata: {
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          uploadedBy: 'aply-server/upload-logo-from-url',
          sourceUrl: imageUrl,
        },
      },
    });

    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
      path
    )}?alt=media&token=${downloadToken}`;

    // Update brand doc unless caller opts out (via kind).
    const fieldName = kind === 'background' ? 'backgroundImage' : 'logo';
    await db
      .collection('Brands')
      .doc(brandId)
      .set(
        {
          [fieldName]: url,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    return res.json({ success: true, url, path, kind });
  } catch (e) {
    console.error('[upload-logo-from-url]', e);
    return res.status(500).json({ error: 'Upload failed', details: e.message });
  }
});


// ===============================
// STRIP IMAGE — UPLOAD FROM URL
// ===============================
// Operator pastes an arbitrary image URL → server fetches it, validates
// content-type + size, uploads to Firebase Storage, optionally writes the URL
// onto a Strip doc field, and returns the permanent download URL.
//
// Body: { imageUrl: string, stripId?: string, field?: string }
// - field defaults to 'bannerImage'. Forward-compat: future strip-level images
//   (hero overrides, etc.) can use this same endpoint by passing a different
//   field name.
// - If stripId is omitted (e.g. uploading before a new strip is saved),
//   server uploads + returns the URL only; client persists the URL on save.
app.post('/upload-strip-image', async (req, res) => {
  const { imageUrl, stripId, field = 'bannerImage' } = req.body || {};

  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.trim()) {
    return res.status(400).json({ error: 'Missing imageUrl' });
  }
  if (typeof field !== 'string' || !field.trim()) {
    return res.status(400).json({ error: 'field must be a non-empty string' });
  }

  try {
    const fetchRes = await fetch(imageUrl);
    if (!fetchRes.ok) {
      return res.status(502).json({
        error: `Source URL returned ${fetchRes.status}`,
        status: fetchRes.status,
      });
    }

    const contentType = fetchRes.headers.get('content-type') || 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
      return res.status(415).json({
        error: `Source URL did not return an image (content-type: ${contentType})`,
      });
    }

    const arrayBuffer = await fetchRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(413).json({
        error: `Image too large (${buffer.length} bytes, max 5MB)`,
      });
    }

    const ext = (contentType.split('/')[1] || 'jpg').split(';')[0];
    const fileKey = stripId || `pending_${crypto.randomUUID()}`;
    const path = `stripImages/${fileKey}_${field}_${Date.now()}.${ext}`;

    const downloadToken = crypto.randomUUID();
    const file = bucket.file(path);
    await file.save(buffer, {
      contentType,
      metadata: {
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          uploadedBy: 'aply-server/upload-strip-image',
          sourceUrl: imageUrl,
          stripField: field,
        },
      },
    });

    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
      path
    )}?alt=media&token=${downloadToken}`;

    if (stripId) {
      await db
        .collection('Strips')
        .doc(stripId)
        .set(
          {
            [field]: url,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
    }

    return res.json({ success: true, url, path, field, stripId: stripId || null });
  } catch (e) {
    console.error('[upload-strip-image]', e);
    return res.status(500).json({ error: 'Upload failed', details: e.message });
  }
});


// ===============================
// START SERVER
// ===============================
app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});