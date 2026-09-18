import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { store } from "../db/store.js";
import { generateQuestionSet } from "../services/questionGeneration.js";
import { runGradingPipeline } from "../services/grading/gradingPipeline.js";
import type { Question, Session, Seniority, StressIntensity } from "../types.js";

export const sessionsRouter = Router();

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

sessionsRouter.post("/", async (req, res) => {
  const { role, seniority, companyContext, stressIntensity } = req.body ?? {};

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

  const sessionId = uuidv4();

  try {
    const questionSet = await generateQuestionSet({
      sessionId,
      role: role.trim(),
      seniority,
      companyContext: typeof companyContext === "string" ? companyContext.trim() : undefined,
      stressIntensity,
    });

    const session: Session = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      role: role.trim(),
      seniority,
      companyContext: typeof companyContext === "string" ? companyContext.trim() : undefined,
      stressIntensity,
      status: "in_progress",
      questionSetId: questionSet.id,
      startedAt: new Date().toISOString(),
    };
    store.saveSession(session);

    const questions = store.getQuestionsBySet(questionSet.id);
    res.status(201).json({
      session,
      questions: questions.map(toCandidateFacingQuestion),
    });
  } catch (err) {
    console.error("Failed to create session:", err);
    res.status(502).json({ error: "Failed to generate question set", detail: String(err) });
  }
});

sessionsRouter.get("/:id", (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  const questions = store.getQuestionsBySet(session.questionSetId);
  const responses = store.getResponsesBySession(session.id);

  res.json({
    session,
    questions: questions.map(toCandidateFacingQuestion),
    responses,
  });
});

sessionsRouter.post("/:id/responses", (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  const { questionId, transcript } = req.body ?? {};
  if (typeof questionId !== "string" || typeof transcript !== "string") {
    return res.status(400).json({ error: "questionId and transcript are required" });
  }
  const question = store.getQuestion(questionId);
  if (!question || question.questionSetId !== session.questionSetId) {
    return res.status(400).json({ error: "questionId does not belong to this session" });
  }

  const response = {
    id: uuidv4(),
    sessionId: session.id,
    questionId,
    transcript,
    createdAt: new Date().toISOString(),
  };
  store.saveResponse(response);

  res.status(201).json({ response });
});

sessionsRouter.post("/:id/grade", async (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  try {
    const existing = store.getGradingResultBySession(session.id);
    if (existing) return res.json({ result: existing });

    const result = await runGradingPipeline(session.id);
    res.json({ result });
  } catch (err) {
    console.error("Failed to grade session:", err);
    res.status(502).json({ error: "Failed to grade session", detail: String(err) });
  }
});

sessionsRouter.get("/:id/report", (req, res) => {
  const session = store.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  const result = store.getGradingResultBySession(session.id);
  if (!result) return res.status(404).json({ error: "Session has not been graded yet" });

  const questions = store.getQuestionsBySet(session.questionSetId);
  const responses = store.getResponsesBySession(session.id);

  res.json({ session, questions: questions.map(toCandidateFacingQuestion), responses, result });
});
