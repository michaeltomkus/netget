import Stripe from "stripe";

// Same graceful-degradation pattern as every other provider integration in
// this app (Anthropic/Azure/Deepgram): billing routes check isStripeConfigured()
// and respond clearly instead of the app crashing on a missing key. Stripe
// holds all card data and the customer/subscription lifecycle — this
// backend only ever stores the resulting ids/status (see
// db/store.ts Subscription + User.stripeCustomerId).
let client: Stripe | undefined;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripeClient(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  if (!client) {
    client = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return client;
}

/** The single paid plan's Stripe Price id — see .env.example. Multiple tiers can be added later as a lookup table keyed by a plan id from the request. */
export function getPaidPriceId(): string {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) throw new Error("STRIPE_PRICE_ID is not configured");
  return priceId;
}

export function getFrontendBaseUrl(): string {
  // CORS_ORIGIN can be a comma-separated list (see index.ts) — the first
  // entry is treated as the canonical frontend origin for Stripe redirects.
  const origin = (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",")[0].trim();
  return origin;
}
