import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createSessionLimiter } from "./rateLimit.js";

function buildApp() {
  const app = express();
  app.post("/api/sessions", createSessionLimiter, (_req, res) => {
    res.status(201).json({ ok: true });
  });
  return app;
}

describe("createSessionLimiter", () => {
  it("allows requests under the limit and blocks the one that exceeds it", async () => {
    const app = buildApp();

    // The real limiter allows 10 requests per window; supertest requests
    // share one IP (127.0.0.1) and there's no req.appUser here, so they
    // all land in the same IP-keyed bucket.
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post("/api/sessions");
      expect(res.status).toBe(201);
    }

    const blocked = await request(app).post("/api/sessions");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many sessions/i);
  });
});
