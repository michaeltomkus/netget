import { getAnthropicClient, MODELS } from "../anthropicClient.js";
import type { ComposureGrade, DynamicFollowUp, Question, Response } from "../../types.js";

const GRADE_TOOL = {
  name: "emit_composure_grade",
  description: "Return the composure-under-stress grade for this mock interview session.",
  input_schema: {
    type: "object" as const,
    properties: {
      perStressQuestion: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            questionId: { type: "string" as const },
            recoveryScore: {
              type: "integer" as const,
              minimum: 0,
              maximum: 100,
              description: "How well the candidate held their ground / recovered after being interrupted.",
            },
            feedback: { type: "string" as const },
          },
          required: ["questionId", "recoveryScore", "feedback"],
        },
      },
      overallNarrative: {
        type: "string" as const,
        description: "2-4 sentences on how the candidate handled being challenged across the session.",
      },
    },
    required: ["perStressQuestion", "overallNarrative"],
  },
};

const SYSTEM_PROMPT = `You are grading how a candidate handled being interrupted with tough pushback during a self-practice mock interview. For each stress question that was interrupted, judge whether their continued answer held its ground, addressed the challenge directly, and stayed composed rather than becoming defensive or capitulating without substance. Be specific and constructive. Use the emit_composure_grade tool to return your result — no other output.`;

interface StressItem {
  question: Question;
  response: Response;
}

/**
 * Once-per-session, Opus-tier synthesis, per docs/ARCHITECTURE.md §5.2/§4.3
 * — only called when at least one live interruption actually fired (see
 * gradingPipeline.ts), since there's nothing to grade "recovery" on
 * otherwise.
 */
export async function gradeComposure(items: StressItem[]): Promise<ComposureGrade> {
  const client = getAnthropicClient();

  const transcript = items
    .map(({ question, response }) => {
      const interruptions = (response.dynamicFollowUps ?? [])
        .map((f: DynamicFollowUp) => `  [interviewer interrupts]: ${f.text}`)
        .join("\n");
      return `QUESTION (${question.id}): ${question.text}
CANDIDATE'S FULL ANSWER (interruptions happened partway through, noted below): ${response.transcript}
${interruptions}`;
    })
    .join("\n\n");

  const message = await client.messages.create({
    model: MODELS.synthesis,
    max_tokens: 1024,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    tools: [GRADE_TOOL],
    tool_choice: { type: "tool", name: "emit_composure_grade" },
    messages: [{ role: "user", content: transcript }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a tool_use block for emit_composure_grade");
  }
  return toolUse.input as ComposureGrade;
}
