import { getAnthropicClient, MODELS } from "../anthropicClient.js";
import type { ImprovementPlan, PerQuestionGrade, Question, Response } from "../../types.js";

const PLAN_TOOL = {
  name: "emit_improvement_plan",
  description: "Return a personalized practice plan for the candidate's next mock interview session.",
  input_schema: {
    type: "object" as const,
    properties: {
      focusAreas: {
        type: "array" as const,
        minItems: 3,
        maxItems: 5,
        items: { type: "string" as const },
        description:
          "3-5 concrete, specific practice actions for the candidate to work on before their next session, each tied to something that actually happened in this session — never generic interview advice.",
      },
      suggestedNextSessionFocus: {
        type: "string" as const,
        description:
          "1-2 sentences recommending what kind of session (role angle, stress intensity, question mix) to schedule next given this session's results.",
      },
    },
    required: ["focusAreas", "suggestedNextSessionFocus"],
  },
};

const SYSTEM_PROMPT = `You are a career coach creating a personalized practice plan for a candidate after a mock interview, based on per-question grades and an overall summary already computed for this session. Be specific and reference what actually happened in this session — never generic interview advice. Use the emit_improvement_plan tool to return your result — no other output.`;

// A paid-tier-exclusive feature (Premium only — see gradingPipeline.ts) —
// deliberately its own Opus call rather than folded into
// sessionSummary.ts's synthesis call, so non-Premium sessions never pay for
// tokens they don't get shown.
export async function synthesizeImprovementPlan(
  questions: Question[],
  responses: Response[],
  perQuestion: PerQuestionGrade[],
  summary: { overallSummary: string; topGrowthAreas: string[] },
): Promise<ImprovementPlan> {
  const client = getAnthropicClient();

  const byQuestionId = new Map(questions.map((q) => [q.id, q]));
  const byResponseQuestionId = new Map(responses.map((r) => [r.questionId, r]));

  const qaTranscript = perQuestion
    .map((grade) => {
      const q = byQuestionId.get(grade.questionId);
      const r = byResponseQuestionId.get(grade.questionId);
      return `Q (${q?.type ?? "unknown"}): ${q?.text ?? "?"}
A: ${r?.transcript ?? "(no answer)"}
Feedback: ${grade.contentFeedback} ${grade.structureFeedback}`;
    })
    .join("\n\n");

  const userPrompt = `SESSION SUMMARY: ${summary.overallSummary}
GROWTH AREAS: ${summary.topGrowthAreas.join("; ")}

${qaTranscript}`;

  const message = await client.messages.create({
    model: MODELS.synthesis,
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: [PLAN_TOOL],
    tool_choice: { type: "tool", name: "emit_improvement_plan" },
    messages: [{ role: "user", content: userPrompt }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a tool_use block for emit_improvement_plan");
  }
  return toolUse.input as ImprovementPlan;
}
