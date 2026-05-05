// Configured Stripe client.
//
// IMPORTANT: this module is imported before dotenv.config() runs in server.js
// (ES module imports are hoisted, dotenv.config() is a runtime statement).
// To avoid initializing the Stripe SDK with an undefined STRIPE_SECRET_KEY,
// we lazily construct the client on first access.

import Stripe from 'stripe';

let _client = null;

export const getStripe = () => {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set. Cannot create Stripe client.');
  }
  _client = new Stripe(key);
  return _client;
};

// Allowlist of supported pipelines for create-checkout-session.
// Map slug → name of the env var holding the Stripe Price ID for that pipeline.
// Adding a new pipeline = one line here + one env var.
export const PIPELINE_PRICE_KEYS = {
  'sorority-rush-specialists': 'STRIPE_PRICE_ID_DEPOSIT',
};

export const getPriceIdForPipeline = (pipelineId) => {
  const envKey = PIPELINE_PRICE_KEYS[pipelineId];
  if (!envKey) return null;
  return process.env[envKey] || null;
};
