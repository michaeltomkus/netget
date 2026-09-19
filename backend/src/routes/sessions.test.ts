import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../types.js";

const FAKE_USER = { id: "user_1", clerkUserId: "clerk_1", email: "candidate@example.com", role: "user" as const, createdAt: new Date().toISOString() };

const getSession = vi.fn<(id: string) => Promise<Session | undefined>>();

vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => (req: Request, _res: Response, next: NextFunction) => {
    req.appUser = FAKE_USER;
    next();
  },
}));

vi.mock("../db/store.js", () => ({
  getSession: (...args: [string]) => getSession(...args),
  // Not exercised by the tests below (they all 400/404 before reaching
  // these), but sessions.ts references them at call time in other routes —
  // present so an accidental hit fails loudly with "not a function" rather
  // than a confusing undefined-property error deep in a route handler.
  createSession: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
  getQuestionsBySet: vi.fn(),
  getQuestion: vi.fn(),
  getResponsesBySession: vi.fn(),
  saveResponse: vi.fn(),
  getGradingResultBySession: vi.fn(),
  listSessionsForUser: vi.fn(),
}));

vi.mock("../services/questionGeneration.js", () => ({ generateQuestionSet: vi.fn() }));
vi.mock("../services/grading/gradingPipeline.js", () => ({ runGradingPipeline: vi.fn() }));
vi.mock("../services/media.js", () => ({ savePresentationFrames: vi.fn() }));
vi.mock("./billing.js", () => ({ checkFreeTierLimit: vi.fn() }));

const { sessionsRouter } = await import("./sessions.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/sessions", sessionsRouter);
  return app;
}

beforeEach(() => {
  getSession.mockReset();
});

describe("POST /api/sessions validation", () => {
  const VALID_BODY = {
    role: "Backend Engineer",
    seniority: "mid",
    stressIntensity: "medium",
    scheduledDurationMinutes: 30,
  };

  it("400s when role is missing", async () => {
    const app = buildApp();
    const { role: _role, ...body } = VALID_BODY;
    const res = await request(app).post("/api/sessions").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/role is required/i);
  });

  it("400s when role is blank", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/sessions").send({ ...VALID_BODY, role: "   " });
    expect(res.status).toBe(400);
  });

  it("400s on an invalid seniority", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/sessions").send({ ...VALID_BODY, seniority: "intern" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/seniority must be one of/i);
  });

  it("400s on an invalid stressIntensity", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/sessions").send({ ...VALID_BODY, stressIntensity: "extreme" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stressIntensity must be one of/i);
  });

  it("400s when scheduledDurationMinutes is out of range", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/sessions").send({ ...VALID_BODY, scheduledDurationMinutes: 500 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/scheduledDurationMinutes/i);
  });

  it("400s when scheduledDurationMinutes isn't a number", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/sessions").send({ ...VALID_BODY, scheduledDurationMinutes: "thirty" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/sessions/:id ownership", () => {
  it("404s when the session doesn't exist", async () => {
    getSession.mockResolvedValueOnce(undefined);
    const app = buildApp();
    const res = await request(app).get("/api/sessions/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("404s (not 403) when the session belongs to a different user", async () => {
    getSession.mockResolvedValueOnce({
      id: "session_1",
      userId: "someone_else",
      createdAt: new Date().toISOString(),
      role: "Backend Engineer",
      seniority: "mid",
      stressIntensity: "medium",
      status: "in_progress",
      scheduledDurationMinutes: 30,
      recordingConsent: false,
    });
    const app = buildApp();
    const res = await request(app).get("/api/sessions/session_1");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
