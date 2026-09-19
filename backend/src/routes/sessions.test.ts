import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobRole, QuestionSet, Session } from "../types.js";

const FAKE_USER = { id: "user_1", clerkUserId: "clerk_1", email: "candidate@example.com", role: "user" as const, createdAt: new Date().toISOString() };

const getSession = vi.fn<(id: string) => Promise<Session | undefined>>();
const createSession = vi.fn();
const updateSession = vi.fn();
const getQuestionsBySet = vi.fn<(id: string) => Promise<unknown[]>>();
const getJobRoleById = vi.fn<(id: string) => Promise<JobRole | undefined>>();
const incrementJobRoleUsage = vi.fn();
const checkFreeTierLimit = vi.fn();
const ensureBankSeeded = vi.fn();
const maybeGrowBank = vi.fn();
const assembleSessionQuestionSet = vi.fn<(params: unknown) => Promise<QuestionSet>>();

vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => (req: Request, _res: Response, next: NextFunction) => {
    req.appUser = FAKE_USER;
    next();
  },
}));

vi.mock("../db/store.js", () => ({
  getSession: (...args: [string]) => getSession(...args),
  createSession: (...args: unknown[]) => createSession(...args),
  updateSession: (...args: unknown[]) => updateSession(...args),
  deleteSession: vi.fn(),
  getQuestionsBySet: (...args: [string]) => getQuestionsBySet(...args),
  getQuestion: vi.fn(),
  getResponsesBySession: vi.fn(),
  saveResponse: vi.fn(),
  getGradingResultBySession: vi.fn(),
  listSessionsForUser: vi.fn(),
  getJobRoleById: (...args: [string]) => getJobRoleById(...args),
  incrementJobRoleUsage: (...args: [string]) => incrementJobRoleUsage(...args),
}));

vi.mock("./jobRoles.js", () => ({
  ensureBankSeeded: (...args: unknown[]) => ensureBankSeeded(...args),
  maybeGrowBank: (...args: unknown[]) => maybeGrowBank(...args),
}));
vi.mock("../services/questionGeneration.js", async () => {
  const actual = await vi.importActual<typeof import("../services/questionGeneration.js")>(
    "../services/questionGeneration.js",
  );
  return {
    ...actual,
    assembleSessionQuestionSet: (...args: [unknown]) => assembleSessionQuestionSet(...args),
  };
});
vi.mock("../services/grading/gradingPipeline.js", () => ({ runGradingPipeline: vi.fn() }));
vi.mock("../services/media.js", () => ({ savePresentationFrames: vi.fn() }));
vi.mock("./billing.js", () => ({ checkFreeTierLimit: (...args: [string]) => checkFreeTierLimit(...args) }));

const { sessionsRouter } = await import("./sessions.js");
const { MIN_BANK_SIZE, SESSION_DRAW_TARGET } = await import("../services/questionGeneration.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/sessions", sessionsRouter);
  return app;
}

const APPROVED_JOB_ROLE: JobRole = {
  id: "role_1",
  title: "Backend Engineer",
  normalizedKey: "backend engineer",
  seniority: "mid",
  status: "approved",
  saturationScore: 85,
  saturationRationale: "Very common role.",
  createdAt: new Date().toISOString(),
  usageCount: 3,
  bankSize: 0,
};

const FAKE_SESSION: Session = {
  id: "session_1",
  userId: FAKE_USER.id,
  createdAt: new Date().toISOString(),
  role: "Backend Engineer",
  seniority: "mid",
  stressIntensity: "medium",
  status: "in_progress",
  scheduledDurationMinutes: 30,
  recordingConsent: false,
};

beforeEach(() => {
  getSession.mockReset();
  createSession.mockReset();
  updateSession.mockReset();
  getQuestionsBySet.mockReset();
  getJobRoleById.mockReset();
  incrementJobRoleUsage.mockReset();
  checkFreeTierLimit.mockReset();
  ensureBankSeeded.mockReset();
  maybeGrowBank.mockReset();
  assembleSessionQuestionSet.mockReset();
  checkFreeTierLimit.mockResolvedValue({ allowed: true, used: 0, limit: 3, window: "month" });
});

describe("POST /api/sessions validation", () => {
  const VALID_BODY = {
    jobRoleId: "role_1",
    stressIntensity: "medium",
    scheduledDurationMinutes: 30,
  };

  it("400s when jobRoleId is missing", async () => {
    const app = buildApp();
    const { jobRoleId: _jobRoleId, ...body } = VALID_BODY;
    const res = await request(app).post("/api/sessions").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/jobRoleId is required/i);
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

  it("400s when jobRoleId doesn't resolve to an approved role", async () => {
    getJobRoleById.mockResolvedValueOnce(undefined);
    const app = buildApp();
    const res = await request(app).post("/api/sessions").send(VALID_BODY);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown or unapproved/i);
  });

  it("400s when the jobRoleId resolves to a rejected role", async () => {
    getJobRoleById.mockResolvedValueOnce({ ...APPROVED_JOB_ROLE, status: "rejected" });
    const app = buildApp();
    const res = await request(app).post("/api/sessions").send(VALID_BODY);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/sessions scheduling", () => {
  const VALID_BODY = {
    jobRoleId: "role_1",
    stressIntensity: "medium",
    scheduledDurationMinutes: 30,
  };

  it("schedules immediately and samples a fresh draw when the bank is big enough", async () => {
    getJobRoleById.mockResolvedValueOnce({ ...APPROVED_JOB_ROLE, bankSize: MIN_BANK_SIZE });
    createSession.mockResolvedValueOnce({ ...FAKE_SESSION, jobRoleId: "role_1" });
    assembleSessionQuestionSet.mockResolvedValueOnce({ id: "qs_1", sessionId: "session_1" });
    updateSession.mockResolvedValueOnce({ ...FAKE_SESSION, jobRoleId: "role_1", questionSetId: "qs_1" });
    getQuestionsBySet.mockResolvedValueOnce([{ id: "q1", order: 0, type: "behavioral", text: "Tell me about yourself" }]);

    const app = buildApp();
    const res = await request(app).post("/api/sessions").send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.scheduling).toEqual({ status: "ready" });
    expect(res.body.questions).toHaveLength(1);
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ status: "in_progress" }));
    expect(assembleSessionQuestionSet).toHaveBeenCalledWith({ sessionId: "session_1", jobRoleId: "role_1" });
    expect(ensureBankSeeded).not.toHaveBeenCalled();
    expect(maybeGrowBank).toHaveBeenCalledWith("role_1", "Backend Engineer", "mid", MIN_BANK_SIZE);
    expect(incrementJobRoleUsage).toHaveBeenCalledWith("role_1");
  });

  it("buffers 5 minutes out and seeds the bank when it's under the threshold", async () => {
    getJobRoleById.mockResolvedValueOnce({ ...APPROVED_JOB_ROLE, bankSize: 0 });
    createSession.mockResolvedValueOnce({ ...FAKE_SESSION, jobRoleId: "role_1", status: "scheduled", startedAt: undefined });

    const app = buildApp();
    const res = await request(app).post("/api/sessions").send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.scheduling.status).toBe("buffered");
    expect(res.body.questions).toEqual([]);
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled" }));
    expect(ensureBankSeeded).toHaveBeenCalledWith("role_1", "Backend Engineer", "mid");
    expect(assembleSessionQuestionSet).not.toHaveBeenCalled();

    const scheduledFor = new Date(res.body.scheduling.scheduledFor);
    const deltaMinutes = (scheduledFor.getTime() - Date.now()) / 60000;
    expect(deltaMinutes).toBeGreaterThan(4);
    expect(deltaMinutes).toBeLessThanOrEqual(5);
  });

  it("402s when the free tier limit is reached, without touching the job role", async () => {
    checkFreeTierLimit.mockResolvedValueOnce({ allowed: false, used: 3, limit: 3, window: "month" });
    getJobRoleById.mockResolvedValueOnce({ ...APPROVED_JOB_ROLE, bankSize: MIN_BANK_SIZE });

    const app = buildApp();
    const res = await request(app).post("/api/sessions").send(VALID_BODY);

    expect(res.status).toBe(402);
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe("POST /api/sessions/:id/begin", () => {
  it("404s when the session doesn't exist", async () => {
    getSession.mockResolvedValueOnce(undefined);
    const app = buildApp();
    const res = await request(app).post("/api/sessions/session_1/begin");
    expect(res.status).toBe(404);
  });

  it("409s when the session isn't in a scheduled state", async () => {
    getSession.mockResolvedValueOnce({ ...FAKE_SESSION, status: "in_progress" });
    const app = buildApp();
    const res = await request(app).post("/api/sessions/session_1/begin");
    expect(res.status).toBe(409);
  });

  it("425s when the scheduled time hasn't arrived yet", async () => {
    getSession.mockResolvedValueOnce({
      ...FAKE_SESSION,
      status: "scheduled",
      scheduledFor: new Date(Date.now() + 60_000).toISOString(),
    });
    const app = buildApp();
    const res = await request(app).post("/api/sessions/session_1/begin");
    expect(res.status).toBe(425);
  });

  it("425s when the time has arrived but the bank isn't seeded enough for one draw", async () => {
    getSession.mockResolvedValueOnce({
      ...FAKE_SESSION,
      status: "scheduled",
      jobRoleId: "role_1",
      scheduledFor: new Date(Date.now() - 1000).toISOString(),
    });
    getJobRoleById.mockResolvedValueOnce({ ...APPROVED_JOB_ROLE, bankSize: SESSION_DRAW_TARGET - 1 });
    const app = buildApp();
    const res = await request(app).post("/api/sessions/session_1/begin");
    expect(res.status).toBe(425);
    expect(assembleSessionQuestionSet).not.toHaveBeenCalled();
  });

  it("starts the session once the wait is over and the bank has enough for a draw", async () => {
    getSession.mockResolvedValueOnce({
      ...FAKE_SESSION,
      status: "scheduled",
      jobRoleId: "role_1",
      scheduledFor: new Date(Date.now() - 1000).toISOString(),
    });
    getJobRoleById.mockResolvedValueOnce({ ...APPROVED_JOB_ROLE, bankSize: SESSION_DRAW_TARGET });
    assembleSessionQuestionSet.mockResolvedValueOnce({ id: "qs_1", sessionId: "session_1" });
    updateSession.mockResolvedValueOnce({ ...FAKE_SESSION, status: "in_progress", questionSetId: "qs_1" });
    getQuestionsBySet.mockResolvedValueOnce([{ id: "q1", order: 0, type: "behavioral", text: "Tell me about yourself" }]);

    const app = buildApp();
    const res = await request(app).post("/api/sessions/session_1/begin");

    expect(res.status).toBe(200);
    expect(assembleSessionQuestionSet).toHaveBeenCalledWith({ sessionId: "session_1", jobRoleId: "role_1" });
    expect(updateSession).toHaveBeenCalledWith(
      "session_1",
      expect.objectContaining({ status: "in_progress", questionSetId: "qs_1" }),
    );
    expect(res.body.questions).toHaveLength(1);
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
    getSession.mockResolvedValueOnce({ ...FAKE_SESSION, userId: "someone_else" });
    const app = buildApp();
    const res = await request(app).get("/api/sessions/session_1");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
