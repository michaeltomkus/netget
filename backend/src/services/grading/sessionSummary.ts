import { getAnthropicClient, MODELS } from "../anthropicClient.js";
import type { PerQuestionGrade, Question, Response } from "../../types.js";

const SUMMARY_TOOL = {
  name: "emit_summary",
  description: "Return the overall session summary for this mock interview.",
  input_schema: {
    type: "object" as const,
    properties: {
      overallScore: { type: "integer" as const, minimum: 0, maximum: 100 },
      overallSummary: {
        type: "string" as const,
        description: "2-4 sentence narrative summary of how the session went overall.",
      },
      topStrengths: {
        type: "array" as const,
        items: { type: "string" as const },
        minItems: 2,
        maxItems: 4,
      },
      topGrowthAreas: {
        type: "array" as const,
        items: { type: "string" as const },
        minItems: 2,
        maxItems: 4,
      },
    },
    required: ["overallScore", "overallSummary", "topStrengths", "topGrowthAreas"],
  },
};

const SYSTEM_PROMPT = `You are synthesizing a final report-card summary for a candidate's self-practice mock interview session, based on per-question grades already computed. Be specific and actionable, not generic. Use the emit_summary tool to return your result — no other output.`;

export async function synthesizeSessionSummary(
  questions: Question[],
  responses: Response[],
  perQuestion: PerQuestionGrade[],
): Promise<{
  overallScore: number;
  overallSummary: string;
  topStrengths: string[];
  topGrowthAreas: string[];
}> {
  const client = getAnthropicClient();

  const byQuestionId = new Map(questions.map((q) => [q.id, q]));
  const byResponseQuestionId = new Map(responses.map((r) => [r.questionId, r]));

  const transcript = perQuestion
    .map((grade) => {
      const q = byQuestionId.get(grade.questionId);
      const r = byResponseQuestionId.get(grade.questionId);
      return `Q (${q?.type ?? "unknown"}): ${q?.text ?? "?"}
A: ${r?.transcript ?? "(no answer)"}
Content score: ${grade.contentScore} — ${grade.contentFeedback}
Structure score: ${grade.structureScore} — ${grade.structureFeedback}`;
    })
    .join("\n\n");

  const message = await client.messages.create({
    model: MODELS.synthesis,
    max_tokens: 1024,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    tools: [SUMMARY_TOOL],
    tool_choice: { type: "tool", name: "emit_summary" },
    messages: [{ role: "user", content: transcript }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a tool_use block for emit_summary");
  }
  return toolUse.input as {
    overallScore: number;
    overallSummary: string;
    topStrengths: string[];
    topGrowthAreas: string[];
  };
}
