import { v4 as uuidv4 } from "uuid";
import { store } from "../../db/store.js";
import { deletePresentationFrames } from "../media.js";
import type { ComposureGrade, GradingResult, PresentationGrade, Question } from "../../types.js";
import { gradeResponse } from "./contentGrading.js";
import { gradePresentation } from "./presentationGrading.js";
import { gradeComposure } from "./composureGrading.js";
import { synthesizeSessionSummary } from "./sessionSummary.js";

// Phase 1: synchronous, in-process grading. Later phases move this behind a
// queue (per docs/ARCHITECTURE.md §1.2 step 9) once sessions include
// audio/video and grading calls get heavier (presentation, composure).
export async function runGradingPipeline(sessionId: string): Promise<GradingResult> {
  const session = store.getSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const questions = store.getQuestionsBySet(session.questionSetId);
  const responses = store.getResponsesBySession(sessionId);

  if (responses.length === 0) {
    throw new Error("Cannot grade a session with no responses");
  }

  const byQuestionId = new Map(questions.map((q) => [q.id, q]));

  const perQuestion = await Promise.all(
    responses.map((response) => {
      const question = byQuestionId.get(response.questionId);
      if (!question) {
        throw new Error(`Question ${response.questionId} not found for response ${response.id}`);
      }
      return gradeResponse(question, response);
    }),
  );

  const summary = await synthesizeSessionSummary(questions, responses, perQuestion);

  // Presentation grading only runs if the candidate consented and frames
  // were actually captured — same graceful-degradation pattern as TTS/STT.
  // Frames are deleted from disk immediately after grading regardless of
  // outcome (success or failure): the raw images are never worth keeping
  // once the derived score/feedback exists, per docs/ARCHITECTURE.md §7
  // risk #1's privacy-safer default.
  let presentation: PresentationGrade | undefined;
  if (session.presentationFrameRefs?.length && session.presentationSignals) {
    try {
      presentation = await gradePresentation(session.presentationFrameRefs, session.presentationSignals);
    } catch (err) {
      console.warn(`Presentation grading skipped for session ${sessionId}: ${err instanceof Error ? err.message : err}`);
    } finally {
      deletePresentationFrames(session.presentationFrameRefs);
    }
  }

  // Composure grading only runs if a live interruption actually fired during
  // the session (see gateway/sttGateway.ts + services/stress) — without one,
  // there's nothing to grade "recovery" on. Same graceful-optional pattern
  // as presentation grading above.
  let composureUnderStress: ComposureGrade | undefined;
  const stressItems: { question: Question; response: (typeof responses)[number] }[] = [];
  for (const response of responses) {
    const question = byQuestionId.get(response.questionId);
    if (question && response.dynamicFollowUps?.length) {
      stressItems.push({ question, response });
    }
  }
  if (stressItems.length > 0) {
    try {
      composureUnderStress = await gradeComposure(stressItems);
    } catch (err) {
      console.warn(`Composure grading skipped for session ${sessionId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const result: GradingResult = {
    id: uuidv4(),
    sessionId,
    generatedAt: new Date().toISOString(),
    perQuestion,
    presentation,
    composureUnderStress,
    ...summary,
  };

  store.saveGradingResult(result);
  store.saveSession({
    ...session,
    status: "graded",
    endedAt: new Date().toISOString(),
    presentationFrameRefs: undefined,
  });

  return result;
}
