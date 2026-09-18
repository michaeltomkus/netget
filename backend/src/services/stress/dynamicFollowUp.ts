import { getAnthropicClient, MODELS } from "../anthropicClient.js";

const FOLLOW_UP_TOOL = {
  name: "emit_follow_up",
  description: "Return the interviewer's brief spoken interruption/challenge.",
  input_schema: {
    type: "object" as const,
    properties: {
      text: {
        type: "string" as const,
        description: "1-2 sentences, spoken tone, in character as a tough interviewer.",
      },
    },
    required: ["text"],
  },
};

const SYSTEM_PROMPT = `You are a tough interviewer conducting a stress-test moment in a self-practice mock interview tool. You're interrupting the candidate mid-answer with a brief, pointed challenge or pushback, using the suggested angle below as a starting point. Speak the way a real person would interrupt in conversation — brief, direct, spoken tone, not written prose. Never break character and never mention that you are an AI. Use the emit_follow_up tool to return your result — no other output.`;

/**
 * Live/latency-critical path: Haiku 4.5, not Sonnet or Opus, per
 * docs/ARCHITECTURE.md §5.2's three-tier model strategy. This is called
 * synchronously mid-conversation from the STT gateway while the candidate is
 * still speaking, so it needs to be fast, not maximally deep.
 */
export async function generateFollowUp(params: {
  questionText: string;
  followUpTrigger: string;
  transcriptSoFar: string;
}): Promise<string> {
  const client = getAnthropicClient();

  const userPrompt = `QUESTION: ${params.questionText}

SUGGESTED PUSHBACK ANGLE: ${params.followUpTrigger}

CANDIDATE'S ANSWER SO FAR (incomplete — you're interrupting): ${params.transcriptSoFar}`;

  const message = await client.messages.create({
    model: MODELS.live,
    max_tokens: 200,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    tools: [FOLLOW_UP_TOOL],
    tool_choice: { type: "tool", name: "emit_follow_up" },
    messages: [{ role: "user", content: userPrompt }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a tool_use block for emit_follow_up");
  }
  return (toolUse.input as { text: string }).text;
}
