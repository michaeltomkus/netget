import { getAnthropicClient, MODELS } from "../anthropicClient.js";
import type { PerQuestionGrade, Question, Response } from "../../types.js";

const GRADE_TOOL = {
  name: "emit_grade",
  description: "Return the grade for this single interview answer.",
  input_schema: {
    type: "object" as const,
    properties: {
      contentScore: {
        type: "integer" as const,
        minimum: 0,
        maximum: 100,
        description: "How well the answer covers idealAnswerCriteria.",
      },
      contentFeedback: { type: "string" as const },
      structureScore: {
        type: "integer" as const,
        minimum: 0,
        maximum: 100,
        description:
          "How well the answer follows expectedStructure (e.g. STAR components all present and clear). If no structure was expected, grade general coherence/organization instead.",
      },
      structureFeedback: { type: "string" as const },
    },
    required: ["contentScore", "contentFeedback", "structureScore", "structureFeedback"],
  },
};

const SYSTEM_PROMPT = `You are grading a candidate's answer in a self-practice mock interview tool. Be honest, specific, and constructive — this is training feedback, not a pass/fail gate. Cite concrete details from the answer in your feedback rather than generic praise or criticism. Use the emit_grade tool to return your result — no other output.`;

export async function gradeResponse(
  question: Question,
  response: Response,
): Promise<PerQuestionGrade> {
  const client = getAnthropicClient();

  const userPrompt = `QUESTION (${question.type}):
${question.text}

WHAT A STRONG ANSWER COVERS:
${question.idealAnswerCriteria}

EXPECTED STRUCTURE: ${question.expectedStructure ?? "none specified"}

CANDIDATE'S ANSWER:
${response.transcript}`;

  const message = await client.messages.create({
    model: MODELS.bulk,
    max_tokens: 1024,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    tools: [GRADE_TOOL],
    tool_choice: { type: "tool", name: "emit_grade" },
    messages: [{ role: "user", content: userPrompt }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a tool_use block for emit_grade");
  }
  const graded = toolUse.input as Omit<PerQuestionGrade, "questionId">;

  return { questionId: question.id, ...graded };
}
