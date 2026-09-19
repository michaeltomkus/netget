import { Router, type Request, type Response as ExpressResponse } from "express";
import { v4 as uuidv4 } from "uuid";
import * as store from "../db/store.js";
import { requireAuth } from "../middleware/auth.js";
import { createSessionLimiter, gradeSessionLimiter } from "../middleware/rateLimit.js";
import { checkFreeTierLimit } from "./billing.js";
import { generateQuestionSet } from "../services/questionGeneration.js";
import { runGradingPipeline } from "../services/grading/gradingPipeline.js";
import { savePresentationFrames } from "../services/media.js";
import { captureException } from "../services/sentry.js";
import type {
  DynamicFollowUp,
  PresentationSignals,
  Question,
  Response,
  Session,
  Seniority,
  StressIntensity,
} from "../types.js";

export const sessionsRouter = Router();

// Every route below needs an authenticated, provisioned req.appUser — a
// mock-interview session is personal data tied to one candidate.
sessionsRouter.use(requireAuth());

const SENIORITIES: Seniority[] = ["junior", "mid", "senior", "staff", "exec"];
const STRESS_LEVELS: StressIntensity[] = ["low", "medium", "high"];

// Never send idealAnswerCriteria / followUpTriggers to the candidate before
// (or during) the session — that's the grading rubric.
function toCandidateFacingQuestion(q: Question) {
  return {
    id: q.id,
    order: q.order,
    type: q.type,
    text: q.text,
    expectedStructure: q.expectedStructure,
    ttsAudioBlobRef: q.ttsAudioBlobRef,
  };
}

// Loads a session and 404s (rather than 403s — avoids confirming to a caller
// that a given session id exists at all) if it isn't owned by req.appUser.
async function loadOwnedSession(req: Request, res: ExpressResponse): Promise<Session | undefined> {
  const session = await store.getSession(req.params.id);
  if (!session || session.userId !== req.appUser!.id) {
    res.status(404).json({ error: "Session not found" });
    return undefined;
  }
  return session;
}

const HISTORY_DEFAULT_LIMIT = 20;
const HISTORY_MAX_LIMIT = 50;

// Session history — newest first. Kept lightweight (no questions/responses,
// just enough for a list row) since a Pro/Premium candidate can accumulate
// an unbounded number of sessions over time.
sessionsRouter.get("/", async (req, res) => {
  const rawLimit = Number(req.query.limit ?? HISTORY_DEFAULT_LIMIT);
  const rawOffset = Number(req.query.offset ?? 0);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, Math.trunc(rawLimit)), HISTORY_MAX_LIMIT) : HISTORY_DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;

  const { sessions, total } = await store.listSessionsForUser(req.appUser!.id, { limit, offset });
  res.json({ sessions, total, limit, offset });
});

sessionsRouter.post("/", createSessionLimiter, async (req, res) => {
  const { role, seniority, companyContext, stressIntensity, scheduledDurationMinutes } =
    req.body ?? {};

  if (typeof role !== "string" || role.trim().length === 0) {
    return res.status(400).json({ error: "role is required" });
  }
  if (!SENIORITIES.includes(seniority)) {
    return res.status(400).json({ error: `seniority must be one of ${SENIORITIES.join(", ")}` });
  }
  if (!STRESS_LEVELS.includes(stressIntensity)) {
    return res
      .status(400)
      .json({ error: `stressIntensity must be one of ${STRESS_LEVELS.join(", ")}` });
  }
  if (
    typeof scheduledDurationMinutes !== "number" ||
    !Number.isFinite(scheduledDurationMinutes) ||
    scheduledDurationMinutes < 5 ||
    scheduledDurationMinutes > 180
  ) {
    return res.status(400).json({ error: "scheduledDurationMinutes must be a number between 5 and 180" });
  }

  const limit = await checkFreeTierLimit(req.appUser!.id);
  if (!limit.allowed) {
    const message =
      limit.window === "day"
        ? `Daily fair-use limit reached (${limit.used}/${limit.limit} sessions today) — resets tomorrow.`
        : `Free tier limit reached (${limit.used}/${limit.limit} sessions this month). Subscribe to continue.`;
    return res.status(402).json({ error: message, usage: limit });
  }

  const trimmedRole = role.trim();
  const trimmedCompanyContext = typeof companyContext === "string" ? companyContext.trim() : undefined;

  // The Session row is created first (status: in_progress) so the
  // QuestionSet row generated below has something to carry its FK to;
  // cleaned up on failure so a bad Claude call never leaves an orphaned,
  // permanently-stuck-without-questions session behind.
  const session = await store.createSession({
    userId: req.appUser!.id,
    role: trimmedRole,
    seniority,
    companyContext: trimmedCompanyContext,
    stressIntensity,
    scheduledDurationMinutes,
  });

  try {
    const questionSet = await generateQuestionSet({
      sessionId: session.id,
      role: trimmedRole,
      seniority,
      companyContext: trimmedCompanyContext,
      stressIntensity,
    });
    const updated = await store.updateSession(session.id, { questionSetId: questionSet.id });
    const questions = await store.getQuestionsBySet(questionSet.id);

    res.status(201).json({
      session: updated,
      questions: questions.map(toCandidateFacingQuestion),
    });
  } catch (err) {
    console.error("Failed to create session:", err);
    captureException(err, { route: "POST /api/sessions", userId: req.appUser!.id });
    await store.deleteSession(session.id);
    res.status(502).json({ error: "Failed to generate question set", detail: String(err) });
  }
});

sessionsRouter.get("/:id", async (req, res) => {
  const session = await loadOwnedSession(req, res);
  if (!session) return;

  const questions = session.questionSetId ? await store.getQuestionsBySet(session.questionSetId) : [];
  const responses = await store.getResponsesBySession(session.id);

  res.json({
    session,
    questions: questions.map(toCandidateFacingQuestion),
    responses,
  });
});

sessionsRouter.post("/:id/responses", async (req, res) => {
  const session = await loadOwnedSession(req, res);
  if (!session) return;

  const { questionId, transcript, dynamicFollowUps } = req.body ?? {};
  if (typeof questionId !== "string" || typeof transcript !== "string") {
    return res.status(400).json({ error: "questionId and transcript are required" });
  }
  const question = await store.getQuestion(questionId);
  if (!question || question.questionSetId !== session.questionSetId) {
    return res.status(400).json({ error: "questionId does not belong to this session" });
  }

  let validatedFollowUps: DynamicFollowUp[] | undefined;
  if (dynamicFollowUps !== undefined) {
    if (
      !Array.isArray(dynamicFollowUps) ||
      !dynamicFollowUps.every(
        (f) => f && f.triggerType === "live_interruption" && typeof f.text === "string",
      )
    ) {
      return res.status(400).json({ error: "dynamicFollowUps must be an array of {triggerType, text}" });
    }
    validatedFollowUps = dynamicFollowUps;
  }

  const response: Response = {
    id: uuidv4(),
    sessionId: session.id,
    questionId,
    transcript,
    createdAt: new Date().toISOString(),
    dynamicFollowUps: validatedFollowUps,
  };
  await store.saveResponse(response);

  res.status(201).json({ response });
});

const DATA_URL_PATTERN = /^data:image\/jpeg;base64,(.+)$/;
const MAX_FRAMES = 10;

// Submitted once, in a batch, at "Finish" — not incrementally per frame.
// Requires recordingConsent on the session (defense in depth: the frontend
// already gates camera access behind consent, this just refuses to store
// frames for a session that never opted in).
sessionsRouter.post("/:id/presentation", async (req, res) => {
  const session = await loadOwnedSession(req, res);
  if (!session) return;
  if (!session.recordingConsent) {
    return res.status(403).json({ error: "Session does not have recording consent" });
  }

  const { frames, signals } = req.body ?? {};
  if (!Array.isArray(frames) || frames.length === 0) {
    return res.status(400).json({ error: "frames must be a non-empty array of JPEG data URLs" });
  }
  if (frames.length > MAX_FRAMES) {
    return res.status(400).json({ error: `at most ${MAX_FRAMES} frames per session` });
  }
  if (!signals || typeof signals.avgBrightness !== "number" || typeof signals.frameCount !== "number") {
    return res.status(400).json({ error: "signals with at least avgBrightness and frameCount is required" });
  }

  let buffers: Buffer[];
  try {
    buffers = frames.map((dataUrl: unknown) => {
      if (typeof dataUrl !== "string") throw new Error("each frame must be a data URL string");
      const match = DATA_URL_PATTERN.exec(dataUrl);
      if (!match) throw new Error("each frame must be a data:image/jpeg;base64,... URL");
      return Buffer.from(match[1], "base64");
    });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "invalid frame data" });
  }

  const frameRefs = savePresentationFrames(session.id, buffers);
  const presentationSignals: PresentationSignals = {
    frameCount: signals.frameCount,
    faceDetectedRatio:
      typeof signals.faceDetectedRatio === "number" ? signals.faceDetectedRatio : undefined,
    avgOffCenterRatio:
      typeof signals.avgOffCenterRatio === "number" ? signals.avgOffCenterRatio : undefined,
    avgBrightness: signals.avgBrightness,
  };

  await store.updateSession(session.id, {
    presentationFrameRefs: frameRefs,
    presentationSignals,
  });

  res.status(201).json({ ok: true, frameCount: frameRefs.length });
});

sessionsRouter.post("/:id/grade", gradeSessionLimiter, async (req, res) => {
  const session = await loadOwnedSession(req, res);
  if (!session) return;

  try {
    const existing = await store.getGradingResultBySession(session.id);
    if (existing) return res.json({ result: existing });

    const result = await runGradingPipeline(session.id);
    res.json({ result });
  } catch (err) {
    console.error("Failed to grade session:", err);
    captureException(err, { route: "POST /api/sessions/:id/grade", sessionId: session.id });
    res.status(502).json({ error: "Failed to grade session", detail: String(err) });
  }
});

sessionsRouter.get("/:id/report", async (req, res) => {
  const session = await loadOwnedSession(req, res);
  if (!session) return;

  const result = await store.getGradingResultBySession(session.id);
  if (!result) return res.status(404).json({ error: "Session has not been graded yet" });

  const questions = session.questionSetId ? await store.getQuestionsBySet(session.questionSetId) : [];
  const responses = await store.getResponsesBySession(session.id);

  res.json({ session, questions: questions.map(toCandidateFacingQuestion), responses, result });
});
