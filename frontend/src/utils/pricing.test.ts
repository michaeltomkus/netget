import { describe, expect, it } from "vitest";
import { formatPlanPrice } from "./pricing";
import type { Plan } from "../api/types";

const BASE_PLAN: Plan = {
  id: "pro",
  name: "Pro",
  tagline: "Unlimited mock interviews, every month.",
  amountCents: 1900,
  currency: "usd",
  interval: "month",
};

describe("formatPlanPrice", () => {
  it("formats a monthly USD price", () => {
    expect(formatPlanPrice(BASE_PLAN)).toBe("$19.00/month");
  });

  it("formats without an interval when the price has none", () => {
    expect(formatPlanPrice({ ...BASE_PLAN, interval: undefined })).toBe("$19.00");
  });

  it("respects a different currency", () => {
    expect(formatPlanPrice({ ...BASE_PLAN, amountCents: 1500, currency: "eur" })).toMatch(/15[.,]00/);
  });

  it("falls back to 'Contact us' when Stripe hasn't set a price yet", () => {
    expect(formatPlanPrice({ ...BASE_PLAN, amountCents: null })).toBe("Contact us");
  });
});
