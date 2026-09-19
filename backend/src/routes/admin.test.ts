import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

let currentUser = { id: "admin_1", clerkUserId: "clerk_1", email: "admin@example.com", role: "admin" as const, createdAt: new Date().toISOString() };

vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => (req: Request, _res: Response, next: NextFunction) => {
    req.appUser = currentUser;
    next();
  },
}));

const getExperimentExposureCounts = vi.fn<(key: string) => Promise<Record<string, number>>>();
const getExperimentConversionCounts = vi.fn<(key: string) => Promise<{ variant: string; goal: string; count: number }[]>>();

vi.mock("../db/store.js", () => ({
  countUsers: vi.fn().mockResolvedValue(0),
  listActiveSubscriptions: vi.fn().mockResolvedValue([]),
  countSessionsSinceAllUsers: vi.fn().mockResolvedValue(0),
  countAllSessions: vi.fn().mockResolvedValue(0),
  getExperimentExposureCounts: (...args: [string]) => getExperimentExposureCounts(...args),
  getExperimentConversionCounts: (...args: [string]) => getExperimentConversionCounts(...args),
}));

vi.mock("../services/stripe.js", () => ({
  isStripeConfigured: () => false,
  getStripeClient: vi.fn(),
  getPlanByPriceId: vi.fn(),
}));

const { adminRouter } = await import("./admin.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter);
  return app;
}

beforeEach(() => {
  currentUser = { ...currentUser, role: "admin" };
  getExperimentExposureCounts.mockReset();
  getExperimentConversionCounts.mockReset();
});

describe("GET /api/admin/experiments", () => {
  it("404s for a non-admin (same posture as /metrics)", async () => {
    currentUser = { ...currentUser, role: "user" as unknown as "admin" };
    const app = buildApp();
    const res = await request(app).get("/api/admin/experiments");
    expect(res.status).toBe(404);
  });

  it("lists the registered experiments for an admin", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/admin/experiments");
    expect(res.status).toBe(200);
    expect(res.body.experiments).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "landing-hero-copy" })]),
    );
  });
});

describe("GET /api/admin/experiments/:key/results", () => {
  it("404s for an unknown experiment key", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/admin/experiments/not-real/results");
    expect(res.status).toBe(404);
  });

  it("returns exposure and conversion counts for a known experiment", async () => {
    getExperimentExposureCounts.mockResolvedValueOnce({ control: 10, direct: 8 });
    getExperimentConversionCounts.mockResolvedValueOnce([{ variant: "direct", goal: "hero_cta_click", count: 3 }]);

    const app = buildApp();
    const res = await request(app).get("/api/admin/experiments/landing-hero-copy/results");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      experimentKey: "landing-hero-copy",
      description: expect.any(String),
      variants: ["control", "direct"],
      exposures: { control: 10, direct: 8 },
      conversions: [{ variant: "direct", goal: "hero_cta_click", count: 3 }],
    });
  });
});
