import { readFileSync } from "node:fs";
import { getAnthropicClient, MODELS } from "../anthropicClient.js";
import type { PresentationGrade, PresentationSignals } from "../../types.js";

const GRADE_TOOL = {
  name: "emit_presentation_grade",
  description: "Return the visual-presentation grade for this mock interview session.",
  input_schema: {
    type: "object" as const,
    properties: {
      attireScore: { type: "integer" as const, minimum: 0, maximum: 100 },
      attireFeedback: { type: "string" as const },
      framingLightingScore: { type: "integer" as const, minimum: 0, maximum: 100 },
      framingLightingFeedback: { type: "string" as const },
      eyeContactScore: { type: "integer" as const, minimum: 0, maximum: 100 },
      eyeContactFeedback: { type: "string" as const },
    },
    required: [
      "attireScore",
      "attireFeedback",
      "framingLightingScore",
      "framingLightingFeedback",
      "eyeContactScore",
      "eyeContactFeedback",
    ],
  },
};

const SYSTEM_PROMPT = `You are grading the visual presentation of a candidate in a self-practice mock interview tool, based on a handful of frames sampled from their webcam during the session plus some coarse numeric signals computed on-device. Be constructive and specific — this is training feedback for how the candidate comes across on camera, not a pass/fail gate. Cover:
- attire: does clothing read as interview-appropriate for a professional video call
- framingLighting: is the candidate well-framed (not too close/far, roughly centered) and adequately lit
- eyeContact: does the candidate appear to be engaging with the camera rather than looking away for extended stretches — use the numeric signals as supporting evidence alongside what you see in the frames, and note explicitly that this is an approximation, not precise gaze tracking

The numeric signals are rough on-device proxies, not ground truth — weigh the actual images more heavily. Use the emit_presentation_grade tool to return your result — no other output.`;

export async function gradePresentation(
  framePaths: string[],
  signals: PresentationSignals,
): Promise<PresentationGrade> {
  const client = getAnthropicClient();

  const imageBlocks = framePaths.map((path) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: "image/jpeg" as const,
      data: readFileSync(path).toString("base64"),
    },
  }));

  const signalsText = `On-device numeric signals across ${signals.frameCount} sampled frames:
- face detected in frame: ${signals.faceDetectedRatio !== undefined ? `${Math.round(signals.faceDetectedRatio * 100)}%` : "unavailable"}
- average off-center proxy (0 = centered, higher = looking away): ${signals.avgOffCenterRatio !== undefined ? signals.avgOffCenterRatio.toFixed(2) : "unavailable"}
- average brightness (0-255): ${Math.round(signals.avgBrightness)}`;

  const message = await client.messages.create({
    model: MODELS.bulk,
    max_tokens: 1024,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    tools: [GRADE_TOOL],
    tool_choice: { type: "tool", name: "emit_presentation_grade" },
    messages: [
      {
        role: "user",
        content: [...imageBlocks, { type: "text", text: signalsText }],
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a tool_use block for emit_presentation_grade");
  }
  return toolUse.input as PresentationGrade;
}
