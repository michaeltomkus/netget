import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getConfiguredPlan,
  getFrontendBaseUrl,
  getPlanByPriceId,
  isStripeConfigured,
  listConfiguredPlans,
} from "./stripe.js";

const ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_PRICE_ID_PRO", "STRIPE_PRICE_ID_PREMIUM", "CORS_ORIGIN"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("isStripeConfigured", () => {
  it("is false without a secret key", () => {
    expect(isStripeConfigured()).toBe(false);
  });

  it("is true once a secret key is set", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    expect(isStripeConfigured()).toBe(true);
  });
});

describe("listConfiguredPlans", () => {
  it("is empty when neither plan has a price id set", () => {
    expect(listConfiguredPlans()).toEqual([]);
  });

  it("only includes plans whose price env var is set", () => {
    process.env.STRIPE_PRICE_ID_PRO = "price_pro_123";
    const plans = listConfiguredPlans();
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ id: "pro", priceId: "price_pro_123" });
  });

  it("includes both plans once both price env vars are set", () => {
    process.env.STRIPE_PRICE_ID_PRO = "price_pro_123";
    process.env.STRIPE_PRICE_ID_PREMIUM = "price_premium_456";
    const plans = listConfiguredPlans();
    expect(plans.map((p) => p.id).sort()).toEqual(["premium", "pro"]);
  });
});

describe("getConfiguredPlan", () => {
  it("returns undefined for an unconfigured or unknown plan id", () => {
    expect(getConfiguredPlan("pro")).toBeUndefined();
    expect(getConfiguredPlan("nonexistent")).toBeUndefined();
  });

  it("returns the matching plan once configured", () => {
    process.env.STRIPE_PRICE_ID_PREMIUM = "price_premium_456";
    expect(getConfiguredPlan("premium")).toMatchObject({ id: "premium", priceId: "price_premium_456" });
  });
});

describe("getPlanByPriceId", () => {
  it("reverse-looks-up a plan by its configured Stripe price id", () => {
    process.env.STRIPE_PRICE_ID_PRO = "price_pro_123";
    expect(getPlanByPriceId("price_pro_123")).toMatchObject({ id: "pro" });
  });

  it("returns undefined for a price id that matches no configured plan", () => {
    process.env.STRIPE_PRICE_ID_PRO = "price_pro_123";
    expect(getPlanByPriceId("price_totally_unknown")).toBeUndefined();
  });
});

describe("getFrontendBaseUrl", () => {
  it("defaults to localhost:5173 when CORS_ORIGIN isn't set", () => {
    expect(getFrontendBaseUrl()).toBe("http://localhost:5173");
  });

  it("takes the first origin when CORS_ORIGIN is a comma-separated list", () => {
    process.env.CORS_ORIGIN = "https://app.example.com, https://staging.example.com";
    expect(getFrontendBaseUrl()).toBe("https://app.example.com");
  });
});
