import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Subscription, User } from "../types.js";

const FAKE_USER: User = {
  id: "user_1",
  clerkUserId: "clerk_1",
  email: "candidate@example.com",
  role: "user",
  createdAt: new Date().toISOString(),
  stripeCustomerId: "cus_1",
};

vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => (req: Request, _res: Response, next: NextFunction) => {
    req.appUser = FAKE_USER;
    next();
  },
}));

const getActiveSubscriptionForUser = vi.fn<(userId: string) => Promise<Subscription | undefined>>();
const getFullUserExport = vi.fn();
const deleteUserAndAllData = vi.fn();

vi.mock("../db/store.js", () => ({
  getActiveSubscriptionForUser: (...args: [string]) => getActiveSubscriptionForUser(...args),
  getFullUserExport: (...args: [string]) => getFullUserExport(...args),
  deleteUserAndAllData: (...args: [string]) => deleteUserAndAllData(...args),
}));

const deletePresentationFrames = vi.fn();
vi.mock("../services/media.js", () => ({
  deletePresentationFrames: (...args: [string[]]) => deletePresentationFrames(...args),
}));

const cancelSubscription = vi.fn();
const isStripeConfigured = vi.fn();
vi.mock("../services/stripe.js", () => ({
  isStripeConfigured: () => isStripeConfigured(),
  getStripeClient: () => ({ subscriptions: { cancel: (...args: [string]) => cancelSubscription(...args) } }),
}));

const deleteClerkUser = vi.fn();
vi.mock("@clerk/express", () => ({
  clerkClient: { users: { deleteUser: (...args: [string]) => deleteClerkUser(...args) } },
}));

vi.mock("../services/sentry.js", () => ({ captureException: vi.fn() }));

const { meRouter } = await import("./me.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/me", meRouter);
  return app;
}

let savedClerkKey: string | undefined;

beforeEach(() => {
  savedClerkKey = process.env.CLERK_SECRET_KEY;
  process.env.CLERK_SECRET_KEY = "sk_test_clerk";
  getActiveSubscriptionForUser.mockReset();
  getFullUserExport.mockReset();
  deleteUserAndAllData.mockReset();
  deletePresentationFrames.mockReset();
  cancelSubscription.mockReset();
  isStripeConfigured.mockReset();
  deleteClerkUser.mockReset();
});

afterEach(() => {
  if (savedClerkKey === undefined) delete process.env.CLERK_SECRET_KEY;
  else process.env.CLERK_SECRET_KEY = savedClerkKey;
});

describe("GET /api/me/export", () => {
  it("returns everything the store has for the caller", async () => {
    getFullUserExport.mockResolvedValueOnce({ user: FAKE_USER, sessions: [], subscriptions: [] });
    const app = buildApp();
    const res = await request(app).get("/api/me/export");
    expect(res.status).toBe(200);
    expect(getFullUserExport).toHaveBeenCalledWith("user_1");
    expect(res.body.sessions).toEqual([]);
  });
});

describe("DELETE /api/me", () => {
  it("cancels an active subscription, deletes local data and frames, then the Clerk identity", async () => {
    isStripeConfigured.mockReturnValue(true);
    getActiveSubscriptionForUser.mockResolvedValueOnce({ stripeSubscriptionId: "sub_1" } as Subscription);
    deleteUserAndAllData.mockResolvedValueOnce({ presentationFrameRefs: ["/tmp/frame1.jpg"] });

    const app = buildApp();
    const res = await request(app).delete("/api/me");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(cancelSubscription).toHaveBeenCalledWith("sub_1");
    expect(deleteUserAndAllData).toHaveBeenCalledWith("user_1");
    expect(deletePresentationFrames).toHaveBeenCalledWith(["/tmp/frame1.jpg"]);
    expect(deleteClerkUser).toHaveBeenCalledWith("clerk_1");
  });

  it("skips Stripe entirely when billing isn't configured", async () => {
    isStripeConfigured.mockReturnValue(false);
    deleteUserAndAllData.mockResolvedValueOnce({ presentationFrameRefs: [] });

    const app = buildApp();
    const res = await request(app).delete("/api/me");

    expect(res.status).toBe(200);
    expect(cancelSubscription).not.toHaveBeenCalled();
    expect(getActiveSubscriptionForUser).not.toHaveBeenCalled();
  });

  it("aborts without touching local data if cancelling the subscription fails", async () => {
    isStripeConfigured.mockReturnValue(true);
    getActiveSubscriptionForUser.mockResolvedValueOnce({ stripeSubscriptionId: "sub_1" } as Subscription);
    cancelSubscription.mockRejectedValueOnce(new Error("stripe down"));

    const app = buildApp();
    const res = await request(app).delete("/api/me");

    expect(res.status).toBe(502);
    expect(deleteUserAndAllData).not.toHaveBeenCalled();
  });

  it("reports failure and skips Clerk deletion if local data deletion fails", async () => {
    isStripeConfigured.mockReturnValue(false);
    deleteUserAndAllData.mockRejectedValueOnce(new Error("db down"));

    const app = buildApp();
    const res = await request(app).delete("/api/me");

    expect(res.status).toBe(502);
    expect(deleteClerkUser).not.toHaveBeenCalled();
  });

  it("still reports success if Clerk deletion fails after local data is already gone", async () => {
    isStripeConfigured.mockReturnValue(false);
    deleteUserAndAllData.mockResolvedValueOnce({ presentationFrameRefs: [] });
    deleteClerkUser.mockRejectedValueOnce(new Error("clerk down"));

    const app = buildApp();
    const res = await request(app).delete("/api/me");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
