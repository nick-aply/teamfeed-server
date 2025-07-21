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

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});


// server.js
import admin from 'firebase-admin';
import cors from 'cors';
import express from 'express';
import dotenv from 'dotenv';
import sgMail from '@sendgrid/mail';
import { v4 as uuidv4 } from 'uuid';
import { generateAlixResponse } from './AlixAIProfile.js';

import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

dotenv.config();

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const db = admin.firestore();
const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// ✅ Universal request logger
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  next();
});

// ✅ Browser check route
app.get('/', (req, res) => {
  res.send('✅ Teamfeed backend is live.');
});

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
sgMail.setApiKey(SENDGRID_API_KEY);

// 🔐 Create and send magic login link
app.post('/create-magic-link', async (req, res) => {
  const { email, brandFlow = false } = req.body;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  try {
    const token = uuidv4();
    const createdAt = Date.now();

    await db.collection('magicLinks').doc(token).set({
      email,
      createdAt,
      brandFlow,
    });

    const origin = req.headers.origin || '';
    const baseUrl = origin.includes('localhost')
      ? 'http://localhost:3031'
      : 'https://teamfeed.co';

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

// 🔓 Verify token and issue Firebase custom token
app.post('/verify-token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  try {
    const tokenDoc = await db.collection('magicLinks').doc(token).get();

    if (!tokenDoc.exists) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const { email, createdAt, brandFlow = false } = tokenDoc.data();

    const now = Date.now();
    const ageMinutes = (now - createdAt) / 60000;

    if (ageMinutes > 15) {
      await db.collection('magicLinks').doc(token).delete();
      return res.status(400).json({ error: 'Token expired' });
    }

    await db.collection('magicLinks').doc(token).delete();

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
      {
        email,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        brandFlow,
      },
      { merge: true }
    );

    const firebaseToken = await admin.auth().createCustomToken(userRecord.uid);

    return res.json({
      uid: userRecord.uid,
      email,
      firebaseToken,
      brandFlow,
    });
  } catch (err) {
    console.error('Verify Token Error:', err);
    return res.status(500).json({ error: 'Failed to verify token' });
  }
});

// 💳 Stripe checkout session
app.post('/create-checkout-session', async (req, res) => {
  try {
    const origin = req.headers.origin || '';
    const baseUrl = origin.includes('localhost')
      ? 'http://localhost:3031'
      : 'https://teamfeed.co';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card', 'us_bank_account'],
      payment_method_options: {
        us_bank_account: {
          verification_method: 'automatic',
        },
      },
      line_items: [
        {
          price: 'price_1RdQGVDjlFghA01sSq8lnWO6',
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/feed`,
      cancel_url: `${baseUrl}/feed`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe Error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// 🤖 Alix chat endpoint
app.post('/alix', async (req, res) => {
  const { phase, userInput, memory, followUpId } = req.body;
  const locationPath = req.headers.referer || req.path;

  if (!userInput && phase !== 'askHighlights' && phase !== 'askExperience') {
    return res.status(400).json({ error: 'Missing userInput' });
  }

  try {
    const aiData = await generateAlixResponse({
      phase,
      userInput,
      memory,
      locationPath,
      followUpId,
    });
    return res.json(aiData);
  } catch (err) {
    console.error('Alix endpoint error:', err);
    return res.status(500).json({ error: 'AI response failed' });
  }
});

app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});