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

// Each plan can have a monthly price id and, optionally, a separate annual
// one — annual is only offered once its env var is set, same
// graceful-degradation posture as the rest of this file. Both map to the
// same plan/tier; a subscriber just picks how often they're billed.
const PLAN_PRICE_ENV_VARS: Record<PlanDefinition["id"], { monthly: string; annual: string }> = {
  pro: { monthly: "STRIPE_PRICE_ID_PRO", annual: "STRIPE_PRICE_ID_PRO_ANNUAL" },
  premium: { monthly: "STRIPE_PRICE_ID_PREMIUM", annual: "STRIPE_PRICE_ID_PREMIUM_ANNUAL" },
};

export type BillingInterval = "monthly" | "annual";

export interface ConfiguredPlan extends PlanDefinition {
  /** Monthly price id — the primary/default one; a plan needs at least this to be offered at all. */
  priceId: string;
  /** Annual price id, if configured. */
  annualPriceId?: string;
}

/** Plans with at least a monthly Stripe Price id configured — what checkout offers. */
export function listConfiguredPlans(): ConfiguredPlan[] {
  return PLAN_DEFINITIONS.flatMap((plan) => {
    const envVars = PLAN_PRICE_ENV_VARS[plan.id];
    const priceId = process.env[envVars.monthly];
    if (!priceId) return [];
    const annualPriceId = process.env[envVars.annual] || undefined;
    return [{ ...plan, priceId, annualPriceId }];
  });
}

export function getConfiguredPlan(planId: string): ConfiguredPlan | undefined {
  return listConfiguredPlans().find((p) => p.id === planId);
}

/** Which Stripe Price id checkout should use for a plan + billing interval. */
export function resolvePriceId(plan: ConfiguredPlan, interval: BillingInterval): string | undefined {
  return interval === "annual" ? plan.annualPriceId : plan.priceId;
}

/** Reverse lookup — which plan (if any) a subscription's stripePriceId corresponds to, monthly or annual. */
export function getPlanByPriceId(priceId: string): PlanDefinition | undefined {
  return PLAN_DEFINITIONS.find((plan) => {
    const envVars = PLAN_PRICE_ENV_VARS[plan.id];
    return process.env[envVars.monthly] === priceId || process.env[envVars.annual] === priceId;
  });
}

/**
 * Optional trial length applied to every new subscription's Checkout
 * Session, off by default (undefined — no trial). A plain env var rather
 * than per-plan since Stripe Checkout only supports one trial length per
 * session; set STRIPE_TRIAL_PERIOD_DAYS to turn it on globally.
 */
export function getTrialPeriodDays(): number | undefined {
  const raw = process.env.STRIPE_TRIAL_PERIOD_DAYS;
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function getFrontendBaseUrl(): string {
  // CORS_ORIGIN can be a comma-separated list (see index.ts) — the first
  // entry is treated as the canonical frontend origin for Stripe redirects.
  const origin = (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",")[0].trim();
  return origin;
}
