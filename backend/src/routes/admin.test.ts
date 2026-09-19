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
const listCommunicationTemplates = vi.fn();
const listCommunicationSends = vi.fn();
const getCommunicationVariantCounts = vi.fn();
const getBrandOverride = vi.fn<() => Promise<string | null>>();
const setBrandOverride = vi.fn<(variantKey: string | null, updatedByUserId: string) => Promise<void>>();

vi.mock("../db/store.js", () => ({
  countUsers: vi.fn().mockResolvedValue(0),
  listActiveSubscriptions: vi.fn().mockResolvedValue([]),
  countSessionsSinceAllUsers: vi.fn().mockResolvedValue(0),
  countAllSessions: vi.fn().mockResolvedValue(0),
  getExperimentExposureCounts: (...args: [string]) => getExperimentExposureCounts(...args),
  getExperimentConversionCounts: (...args: [string]) => getExperimentConversionCounts(...args),
  listCommunicationTemplates: (...args: []) => listCommunicationTemplates(...args),
  listCommunicationSends: (...args: [number?]) => listCommunicationSends(...args),
  getCommunicationVariantCounts: (...args: [string, string]) => getCommunicationVariantCounts(...args),
  getBrandOverride: (...args: []) => getBrandOverride(...args),
  setBrandOverride: (...args: [string | null, string]) => setBrandOverride(...args),
}));

vi.mock("../services/stripe.js", () => ({
  isStripeConfigured: () => false,
  getStripeClient: vi.fn(),
  getPlanByPriceId: vi.fn(),
}));

const seedCommunicationTemplates = vi.fn<() => Promise<number>>();
vi.mock("../services/communications/seedTemplates.js", () => ({
  seedCommunicationTemplates: (...args: []) => seedCommunicationTemplates(...args),
}));

const sendCommunication = vi.fn();
vi.mock("../services/communications/send.js", () => ({
  sendCommunication: (...args: [unknown]) => sendCommunication(...args),
}));

const isChannelConfigured = vi.fn<(channel: string) => boolean>().mockReturnValue(false);
vi.mock("../services/communications/providers.js", () => ({
  isChannelConfigured: (...args: [string]) => isChannelConfigured(...args),
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
  listCommunicationTemplates.mockReset();
  listCommunicationSends.mockReset();
  getCommunicationVariantCounts.mockReset();
  getBrandOverride.mockReset();
  setBrandOverride.mockReset();
  seedCommunicationTemplates.mockReset();
  sendCommunication.mockReset();
  isChannelConfigured.mockReset().mockReturnValue(false);
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

describe("GET /api/admin/communications/templates", () => {
  it("returns templates plus per-channel configured status", async () => {
    listCommunicationTemplates.mockResolvedValue([{ id: "t1", typeName: "Welcome", channel: "email" }]);
    isChannelConfigured.mockImplementation((c: string) => c === "email");

    const app = buildApp();
    const res = await request(app).get("/api/admin/communications/templates");

    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(1);
    expect(res.body.channelStatus).toEqual({ email: true, sms: false, push: false });
  });
});

describe("POST /api/admin/communications/templates/seed", () => {
  it("seeds and reports the count", async () => {
    seedCommunicationTemplates.mockResolvedValue(150);
    const app = buildApp();
    const res = await request(app).post("/api/admin/communications/templates/seed");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ seeded: 150 });
  });
});

describe("GET /api/admin/communications/history", () => {
  it("returns recent sends", async () => {
    listCommunicationSends.mockResolvedValue([{ id: "s1" }]);
    const app = buildApp();
    const res = await request(app).get("/api/admin/communications/history");
    expect(res.status).toBe(200);
    expect(res.body.sends).toEqual([{ id: "s1" }]);
    expect(listCommunicationSends).toHaveBeenCalledWith(100);
  });
});

describe("GET /api/admin/communications/variant-counts", () => {
  it("400s when typeName or channel is missing/invalid", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/admin/communications/variant-counts?typeName=Welcome");
    expect(res.status).toBe(400);
  });

  it("returns counts for a valid query", async () => {
    getCommunicationVariantCounts.mockResolvedValue([{ variant: "A", status: "sent", count: 5 }]);
    const app = buildApp();
    const res = await request(app).get(
      "/api/admin/communications/variant-counts?typeName=Welcome&channel=email",
    );
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual([{ variant: "A", status: "sent", count: 5 }]);
  });
});

describe("POST /api/admin/communications/send", () => {
  it("400s on a missing typeName", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/admin/communications/send")
      .send({ channel: "email", audience: { kind: "all" } });
    expect(res.status).toBe(400);
    expect(sendCommunication).not.toHaveBeenCalled();
  });

  it("400s on an invalid channel", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/admin/communications/send")
      .send({ typeName: "Welcome", channel: "carrier-pigeon", audience: { kind: "all" } });
    expect(res.status).toBe(400);
  });

  it("400s on a malformed audience", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/admin/communications/send")
      .send({ typeName: "Welcome", channel: "email", audience: { kind: "single" } });
    expect(res.status).toBe(400);
    expect(sendCommunication).not.toHaveBeenCalled();
  });

  it("sends with the admin's own id and returns the summary", async () => {
    sendCommunication.mockResolvedValue({ batchId: "b1", configured: false, results: [] });
    const app = buildApp();
    const res = await request(app)
      .post("/api/admin/communications/send")
      .send({ typeName: "Welcome", channel: "email", audience: { kind: "all" } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ batchId: "b1", configured: false, results: [] });
    expect(sendCommunication).toHaveBeenCalledWith(
      expect.objectContaining({ typeName: "Welcome", channel: "email", sentByUserId: "admin_1" }),
    );
  });

  it("404s for a non-admin", async () => {
    currentUser = { ...currentUser, role: "user" as unknown as "admin" };
    const app = buildApp();
    const res = await request(app)
      .post("/api/admin/communications/send")
      .send({ typeName: "Welcome", channel: "email", audience: { kind: "all" } });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/admin/brand", () => {
  it("returns every configured variant plus the current override", async () => {
    getBrandOverride.mockResolvedValue("alt");
    const app = buildApp();
    const res = await request(app).get("/api/admin/brand");

    expect(res.status).toBe(200);
    expect(res.body.overrideVariant).toBe("alt");
    expect(res.body.variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "control", name: "InterviewAI" }),
        expect.objectContaining({ key: "alt", name: "PrepPilot" }),
      ]),
    );
  });

  it("returns overrideVariant: null rather than failing when the store call errors", async () => {
    getBrandOverride.mockRejectedValue(new Error("Can't reach database server"));
    const app = buildApp();
    const res = await request(app).get("/api/admin/brand");
    expect(res.status).toBe(200);
    expect(res.body.overrideVariant).toBeNull();
  });

  it("404s for a non-admin", async () => {
    currentUser = { ...currentUser, role: "user" as unknown as "admin" };
    const res = await request(buildApp()).get("/api/admin/brand");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/admin/brand/override", () => {
  it("sets the override with the admin's own id and echoes it back", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/admin/brand/override").send({ variantKey: "alt" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ overrideVariant: "alt" });
    expect(setBrandOverride).toHaveBeenCalledWith("alt", "admin_1");
  });

  it("clears the override with variantKey: null", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/admin/brand/override").send({ variantKey: null });
    expect(res.status).toBe(200);
    expect(setBrandOverride).toHaveBeenCalledWith(null, "admin_1");
  });

  it("400s on an unknown variant key", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/admin/brand/override").send({ variantKey: "not-a-real-variant" });
    expect(res.status).toBe(400);
    expect(setBrandOverride).not.toHaveBeenCalled();
  });

  it("502s when the store write fails", async () => {
    setBrandOverride.mockRejectedValue(new Error("Can't reach database server"));
    const app = buildApp();
    const res = await request(app).post("/api/admin/brand/override").send({ variantKey: "alt" });
    expect(res.status).toBe(502);
  });

  it("404s for a non-admin", async () => {
    currentUser = { ...currentUser, role: "user" as unknown as "admin" };
    const res = await request(buildApp()).post("/api/admin/brand/override").send({ variantKey: "alt" });
    expect(res.status).toBe(404);
  });
});
