import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Subscription } from "../types.js";

const getActiveSubscriptionForUser = vi.fn<(userId: string) => Promise<Subscription | undefined>>();
const countSessionsSince = vi.fn<(userId: string, since: Date) => Promise<number>>();

vi.mock("../db/store.js", () => ({
  getActiveSubscriptionForUser: (...args: [string]) => getActiveSubscriptionForUser(...args),
  countSessionsSince: (...args: [string, Date]) => countSessionsSince(...args),
}));

const { checkFreeTierLimit, FREE_TIER_SESSIONS_PER_MONTH } = await import("./billing.js");

const FAKE_SUB: Subscription = {
  id: "sub_row_1",
  userId: "user_1",
  stripeSubscriptionId: "sub_stripe_1",
  stripePriceId: "price_pro_1",
  status: "active",
  currentPeriodEnd: new Date().toISOString(),
  cancelAtPeriodEnd: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("checkFreeTierLimit", () => {
  beforeEach(() => {
    getActiveSubscriptionForUser.mockReset();
    countSessionsSince.mockReset();
  });

  it("is unlimited for a user with an active subscription, regardless of usage", async () => {
    getActiveSubscriptionForUser.mockResolvedValueOnce(FAKE_SUB);
    countSessionsSince.mockResolvedValueOnce(999); // should never even be consulted

    const result = await checkFreeTierLimit("user_1");

    expect(result).toEqual({ allowed: true, used: 0, limit: Infinity });
    expect(countSessionsSince).not.toHaveBeenCalled();
  });

  it("allows a free user under the monthly limit", async () => {
    getActiveSubscriptionForUser.mockResolvedValueOnce(undefined);
    countSessionsSince.mockResolvedValueOnce(FREE_TIER_SESSIONS_PER_MONTH - 1);

    const result = await checkFreeTierLimit("user_2");

    expect(result).toEqual({
      allowed: true,
      used: FREE_TIER_SESSIONS_PER_MONTH - 1,
      limit: FREE_TIER_SESSIONS_PER_MONTH,
    });
  });

  it("blocks a free user who has hit the monthly limit", async () => {
    getActiveSubscriptionForUser.mockResolvedValueOnce(undefined);
    countSessionsSince.mockResolvedValueOnce(FREE_TIER_SESSIONS_PER_MONTH);

    const result = await checkFreeTierLimit("user_3");

    expect(result.allowed).toBe(false);
    expect(result.used).toBe(FREE_TIER_SESSIONS_PER_MONTH);
  });

  it("blocks a free user who has somehow exceeded the monthly limit", async () => {
    getActiveSubscriptionForUser.mockResolvedValueOnce(undefined);
    countSessionsSince.mockResolvedValueOnce(FREE_TIER_SESSIONS_PER_MONTH + 5);

    const result = await checkFreeTierLimit("user_4");

    expect(result.allowed).toBe(false);
  });
});
