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

// Plan registry: display metadata lives here, actual prices/amounts live in
// Stripe (fetched live in routes/billing.ts) — never hardcoded, so changing
// a price in the Stripe dashboard doesn't require a deploy. Each plan's
// Stripe Price id comes from its own env var; a plan is only "configured"
// (offered at checkout, matched against subscriptions) once that env var is
// set — same graceful-degradation posture as the rest of this file.
export interface PlanDefinition {
  id: "pro" | "premium";
  name: string;
  tagline: string;
}

const PLAN_DEFINITIONS: PlanDefinition[] = [
  { id: "pro", name: "Pro", tagline: "Unlimited mock interviews, every month." },
  {
    id: "premium",
    name: "Premium",
    tagline: "Everything in Pro, plus a personalized AI practice plan after every session.",
  },
];

const PLAN_PRICE_ENV_VARS: Record<PlanDefinition["id"], string> = {
  pro: "STRIPE_PRICE_ID_PRO",
  premium: "STRIPE_PRICE_ID_PREMIUM",
};

export interface ConfiguredPlan extends PlanDefinition {
  priceId: string;
}

/** Plans with a Stripe Price id actually configured — what checkout offers. */
export function listConfiguredPlans(): ConfiguredPlan[] {
  return PLAN_DEFINITIONS.flatMap((plan) => {
    const priceId = process.env[PLAN_PRICE_ENV_VARS[plan.id]];
    return priceId ? [{ ...plan, priceId }] : [];
  });
}

export function getConfiguredPlan(planId: string): ConfiguredPlan | undefined {
  return listConfiguredPlans().find((p) => p.id === planId);
}

/** Reverse lookup — which plan (if any) a subscription's stripePriceId corresponds to. */
export function getPlanByPriceId(priceId: string): PlanDefinition | undefined {
  return PLAN_DEFINITIONS.find((plan) => process.env[PLAN_PRICE_ENV_VARS[plan.id]] === priceId);
}

export function getFrontendBaseUrl(): string {
  // CORS_ORIGIN can be a comma-separated list (see index.ts) — the first
  // entry is treated as the canonical frontend origin for Stripe redirects.
  const origin = (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",")[0].trim();
  return origin;
}
