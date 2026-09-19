import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getBrandOverride = vi.fn<() => Promise<string | null>>();

vi.mock("../db/store.js", () => ({
  getBrandOverride: (...args: []) => getBrandOverride(...args),
}));

const { brandRouter } = await import("./brand.js");

function buildApp() {
  const app = express();
  app.use("/api/brand", brandRouter);
  return app;
}

beforeEach(() => {
  getBrandOverride.mockReset();
});

describe("GET /api/brand/override", () => {
  it("works signed-out and returns the current override", async () => {
    getBrandOverride.mockResolvedValue("alt");
    const res = await request(buildApp()).get("/api/brand/override");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ overrideVariant: "alt" });
  });

  it("returns null when nothing is overridden", async () => {
    getBrandOverride.mockResolvedValue(null);
    const res = await request(buildApp()).get("/api/brand/override");
    expect(res.body).toEqual({ overrideVariant: null });
  });

  it("still responds 200 with null when the store call fails — a DB hiccup on this pre-auth, every-page-load route must never surface to the caller or crash the process", async () => {
    getBrandOverride.mockRejectedValue(new Error("Can't reach database server"));
    const res = await request(buildApp()).get("/api/brand/override");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ overrideVariant: null });
  });
});
