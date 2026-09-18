import { v4 as uuidv4 } from "uuid";
import { store } from "../../db/store.js";
import type { GradingResult } from "../../types.js";
import { gradeResponse } from "./contentGrading.js";
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

  const result: GradingResult = {
    id: uuidv4(),
    sessionId,
    generatedAt: new Date().toISOString(),
    perQuestion,
    ...summary,
  };

  store.saveGradingResult(result);
  store.saveSession({ ...session, status: "graded", endedAt: new Date().toISOString() });

  return result;
}
