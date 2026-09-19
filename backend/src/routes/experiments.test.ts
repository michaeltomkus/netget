import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const recordExperimentExposure = vi.fn();
const recordExperimentConversion = vi.fn();
const captureException = vi.fn();

vi.mock("../db/store.js", () => ({
  recordExperimentExposure: (...args: [unknown]) => recordExperimentExposure(...args),
  recordExperimentConversion: (...args: [unknown]) => recordExperimentConversion(...args),
}));

vi.mock("../services/sentry.js", () => ({
  captureException: (...args: [unknown, unknown?]) => captureException(...args),
}));

const { experimentsRouter } = await import("./experiments.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/experiments", experimentsRouter);
  return app;
}

beforeEach(() => {
  recordExperimentExposure.mockReset();
  recordExperimentConversion.mockReset();
  captureException.mockReset();
});

describe("POST /api/experiments/exposure", () => {
  it("works signed-out (no auth middleware in front of it)", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/experiments/exposure")
      .send({ experimentKey: "landing-hero-copy", variant: "control", subjectId: "anon-1" });
    expect(res.status).toBe(204);
    expect(recordExperimentExposure).toHaveBeenCalledWith({
      experimentKey: "landing-hero-copy",
      variant: "control",
      subjectId: "anon-1",
    });
  });

  it("400s on an unknown experimentKey", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/experiments/exposure")
      .send({ experimentKey: "not-a-real-experiment", variant: "control", subjectId: "anon-1" });
    expect(res.status).toBe(400);
    expect(recordExperimentExposure).not.toHaveBeenCalled();
  });

  it("400s on a variant not in that experiment's registry", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/experiments/exposure")
      .send({ experimentKey: "landing-hero-copy", variant: "not-a-real-variant", subjectId: "anon-1" });
    expect(res.status).toBe(400);
  });

  it("400s when subjectId is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/experiments/exposure")
      .send({ experimentKey: "landing-hero-copy", variant: "control" });
    expect(res.status).toBe(400);
  });

  it("400s when subjectId is too long", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/experiments/exposure")
      .send({ experimentKey: "landing-hero-copy", variant: "control", subjectId: "x".repeat(200) });
    expect(res.status).toBe(400);
  });

  it("still responds 204 when the store write throws — a DB hiccup on this pre-auth, high-traffic route must never surface to the caller or crash the process", async () => {
    recordExperimentExposure.mockRejectedValueOnce(new Error("Can't reach database server"));
    const app = buildApp();
    const res = await request(app)
      .post("/api/experiments/exposure")
      .send({ experimentKey: "landing-hero-copy", variant: "control", subjectId: "anon-1" });
    expect(res.status).toBe(204);
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ route: "POST /api/experiments/exposure" }),
    );
  });
});

describe("POST /api/experiments/conversion", () => {
  it("records a valid conversion", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/experiments/conversion")
      .send({ experimentKey: "landing-hero-copy", variant: "direct", subjectId: "anon-1", goal: "hero_cta_click" });
    expect(res.status).toBe(204);
    expect(recordExperimentConversion).toHaveBeenCalledWith({
      experimentKey: "landing-hero-copy",
      variant: "direct",
      subjectId: "anon-1",
      goal: "hero_cta_click",
    });
  });

  it("400s when goal is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/experiments/conversion")
      .send({ experimentKey: "landing-hero-copy", variant: "direct", subjectId: "anon-1" });
    expect(res.status).toBe(400);
    expect(recordExperimentConversion).not.toHaveBeenCalled();
  });

  it("400s on an unknown experiment before even checking goal", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/experiments/conversion")
      .send({ experimentKey: "nope", variant: "x", subjectId: "anon-1", goal: "hero_cta_click" });
    expect(res.status).toBe(400);
  });

  it("still responds 204 when the store write throws", async () => {
    recordExperimentConversion.mockRejectedValueOnce(new Error("Can't reach database server"));
    const app = buildApp();
    const res = await request(app)
      .post("/api/experiments/conversion")
      .send({ experimentKey: "landing-hero-copy", variant: "direct", subjectId: "anon-1", goal: "hero_cta_click" });
    expect(res.status).toBe(204);
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ route: "POST /api/experiments/conversion" }),
    );
  });
});
