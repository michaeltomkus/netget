import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobRole, RoleClassification } from "../types.js";

const FAKE_USER = { id: "user_1", clerkUserId: "clerk_1", email: "candidate@example.com", role: "user" as const, createdAt: new Date().toISOString() };

vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => (req: Request, _res: Response, next: NextFunction) => {
    req.appUser = FAKE_USER;
    next();
  },
}));

const searchApprovedJobRoles = vi.fn<(q: string, seniority: string) => Promise<JobRole[]>>();
const getJobRoleByKey = vi.fn<(key: string, seniority: string) => Promise<JobRole | undefined>>();
const createJobRole = vi.fn<(params: unknown) => Promise<JobRole>>();
const getBankQuestionsForRole = vi.fn<(jobRoleId: string) => Promise<unknown[]>>();

vi.mock("../db/store.js", () => ({
  searchApprovedJobRoles: (...args: [string, string]) => searchApprovedJobRoles(...args),
  getJobRoleByKey: (...args: [string, string]) => getJobRoleByKey(...args),
  createJobRole: (...args: [unknown]) => createJobRole(...args),
  getBankQuestionsForRole: (...args: [string]) => getBankQuestionsForRole(...args),
}));

const classifyJobRole = vi.fn<(title: string, seniority: string) => Promise<RoleClassification>>();
vi.mock("../services/jobRoleClassifier.js", async () => {
  const actual = await vi.importActual<typeof import("../services/jobRoleClassifier.js")>(
    "../services/jobRoleClassifier.js",
  );
  return {
    ...actual,
    classifyJobRole: (...args: [string, string]) => classifyJobRole(...args),
  };
});

const growQuestionBank = vi.fn();
vi.mock("../services/questionGeneration.js", async () => {
  const actual = await vi.importActual<typeof import("../services/questionGeneration.js")>(
    "../services/questionGeneration.js",
  );
  return {
    ...actual,
    growQuestionBank: (...args: [unknown]) => growQuestionBank(...args),
  };
});
vi.mock("../services/sentry.js", () => ({ captureException: vi.fn() }));

const { jobRolesRouter, ensureBankSeeded, maybeGrowBank } = await import("./jobRoles.js");
const { MIN_BANK_SIZE, BANK_CEILING } = await import("../services/questionGeneration.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/job-roles", jobRolesRouter);
  return app;
}

const APPROVED_ROLE: JobRole = {
  id: "role_1",
  title: "Backend Engineer",
  normalizedKey: "backend engineer",
  seniority: "mid",
  status: "approved",
  saturationScore: 85,
  saturationRationale: "Common role.",
  createdAt: new Date().toISOString(),
  usageCount: 2,
  bankSize: 0,
};

beforeEach(() => {
  searchApprovedJobRoles.mockReset();
  getJobRoleByKey.mockReset();
  createJobRole.mockReset();
  classifyJobRole.mockReset();
  growQuestionBank.mockReset();
  getBankQuestionsForRole.mockReset();
});

describe("GET /api/job-roles", () => {
  it("400s without a seniority", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/job-roles?q=backend");
    expect(res.status).toBe(400);
  });

  it("400s on an invalid seniority", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/job-roles?q=backend&seniority=intern");
    expect(res.status).toBe(400);
  });

  it("searches with the trimmed query and seniority, adding readyToScheduleNow", async () => {
    searchApprovedJobRoles.mockResolvedValueOnce([{ ...APPROVED_ROLE, bankSize: MIN_BANK_SIZE }]);
    const app = buildApp();
    const res = await request(app).get("/api/job-roles?q=%20backend%20&seniority=mid");
    expect(res.status).toBe(200);
    expect(res.body.roles).toEqual([{ ...APPROVED_ROLE, bankSize: MIN_BANK_SIZE, readyToScheduleNow: true }]);
    expect(searchApprovedJobRoles).toHaveBeenCalledWith("backend", "mid");
  });

  it("marks an under-seeded role as not ready to schedule now", async () => {
    searchApprovedJobRoles.mockResolvedValueOnce([{ ...APPROVED_ROLE, bankSize: 2 }]);
    const app = buildApp();
    const res = await request(app).get("/api/job-roles?seniority=mid");
    expect(res.body.roles[0].readyToScheduleNow).toBe(false);
  });
});

describe("POST /api/job-roles/request", () => {
  const VALID_BODY = { title: "Backend Engineer", seniority: "mid" };

  it("400s when title is missing", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/job-roles/request").send({ seniority: "mid" });
    expect(res.status).toBe(400);
  });

  it("400s when title is too long", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/job-roles/request")
      .send({ title: "x".repeat(200), seniority: "mid" });
    expect(res.status).toBe(400);
  });

  it("400s on an invalid seniority", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/job-roles/request").send({ title: "Backend Engineer", seniority: "guru" });
    expect(res.status).toBe(400);
  });

  it("returns an existing role by raw key without calling the classifier", async () => {
    getJobRoleByKey.mockResolvedValueOnce(APPROVED_ROLE);
    const app = buildApp();
    const res = await request(app).post("/api/job-roles/request").send(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body.jobRole).toEqual({ ...APPROVED_ROLE, readyToScheduleNow: false });
    expect(classifyJobRole).not.toHaveBeenCalled();
    expect(createJobRole).not.toHaveBeenCalled();
  });

  it("creates an approved role when the saturation score clears the threshold", async () => {
    getJobRoleByKey.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    classifyJobRole.mockResolvedValueOnce({
      normalizedTitle: "Backend Engineer",
      saturationScore: 90,
      rationale: "Extremely common.",
    });
    createJobRole.mockResolvedValueOnce({ ...APPROVED_ROLE, status: "approved" });

    const app = buildApp();
    const res = await request(app).post("/api/job-roles/request").send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.jobRole.status).toBe("approved");
    expect(createJobRole).toHaveBeenCalledWith(expect.objectContaining({ status: "approved" }));
  });

  it("creates a rejected role when the saturation score misses the threshold", async () => {
    getJobRoleByKey.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    classifyJobRole.mockResolvedValueOnce({
      normalizedTitle: "Dog Walker Wizard",
      saturationScore: 5,
      rationale: "Not a real interview role.",
    });
    createJobRole.mockResolvedValueOnce({
      ...APPROVED_ROLE,
      title: "Dog Walker Wizard",
      status: "rejected",
      saturationScore: 5,
    });

    const app = buildApp();
    const res = await request(app).post("/api/job-roles/request").send({ title: "dog walker wizard", seniority: "mid" });

    expect(res.status).toBe(200);
    expect(res.body.jobRole.status).toBe("rejected");
    expect(createJobRole).toHaveBeenCalledWith(expect.objectContaining({ status: "rejected" }));
  });

  it("dedupes on the classifier's normalized key instead of creating a duplicate", async () => {
    getJobRoleByKey.mockResolvedValueOnce(undefined); // no match on raw key
    classifyJobRole.mockResolvedValueOnce({
      normalizedTitle: "Backend Engineer",
      saturationScore: 90,
      rationale: "Common.",
    });
    getJobRoleByKey.mockResolvedValueOnce(APPROVED_ROLE); // match on normalized key

    const app = buildApp();
    const res = await request(app).post("/api/job-roles/request").send({ title: "sr backend eng", seniority: "mid" });

    expect(res.status).toBe(200);
    expect(res.body.jobRole).toEqual({ ...APPROVED_ROLE, readyToScheduleNow: false });
    expect(createJobRole).not.toHaveBeenCalled();
  });

  it("502s if classification fails", async () => {
    getJobRoleByKey.mockResolvedValueOnce(undefined);
    classifyJobRole.mockRejectedValueOnce(new Error("Anthropic is down"));

    const app = buildApp();
    const res = await request(app).post("/api/job-roles/request").send(VALID_BODY);

    expect(res.status).toBe(502);
  });
});

describe("ensureBankSeeded", () => {
  it("skips generation if a concurrent request already seeded the bank", async () => {
    getBankQuestionsForRole.mockResolvedValueOnce(Array(MIN_BANK_SIZE).fill({ text: "x" }));

    await ensureBankSeeded("role_1", "Backend Engineer", "mid");

    expect(growQuestionBank).not.toHaveBeenCalled();
  });

  it("generates the initial batch when the bank is empty", async () => {
    getBankQuestionsForRole.mockResolvedValueOnce([]);
    growQuestionBank.mockResolvedValueOnce(24);

    await ensureBankSeeded("role_1", "Backend Engineer", "mid");

    expect(growQuestionBank).toHaveBeenCalledWith(expect.objectContaining({ jobRoleId: "role_1" }));
  });
});

describe("maybeGrowBank", () => {
  it("never grows once at the ceiling", async () => {
    await maybeGrowBank("role_1", "Backend Engineer", "mid", BANK_CEILING);
    expect(growQuestionBank).not.toHaveBeenCalled();
  });

  it("always grows below the healthy watermark", async () => {
    getBankQuestionsForRole.mockResolvedValueOnce([]);
    await maybeGrowBank("role_1", "Backend Engineer", "mid", 5);
    expect(growQuestionBank).toHaveBeenCalled();
  });
});
