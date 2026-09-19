import { getAnthropicClient, MODELS } from "./anthropicClient.js";
import type { RoleClassification, Seniority } from "../types.js";

// A role's saturation score decides whether a freshly-requested (title,
// seniority) combo gets added to the schedulable catalog — see
// routes/jobRoles.ts. This is a single Claude judgment call against its own
// training knowledge, not a real labor-market data source: no such provider
// (BLS, Lightcast, a job-postings API, etc.) is integrated in this app.
// Treat the score as "how confidently does this look like a real,
// commonly-interviewed-for role at this seniority," not an actual
// posting-volume statistic.
export const SATURATION_APPROVAL_THRESHOLD = 60;

const CLASSIFY_TOOL = {
  name: "emit_classification",
  description: "Return the normalized role title and market-saturation assessment.",
  input_schema: {
    type: "object" as const,
    properties: {
      normalizedTitle: {
        type: "string" as const,
        description:
          "The candidate's typed text, standardized to a clean, canonical job-title form (fix casing/typos/abbreviations, drop seniority words already captured separately, e.g. 'sr backend eng' -> 'Backend Engineer'). Same input should always normalize to the same output.",
      },
      saturationScore: {
        type: "integer" as const,
        minimum: 0,
        maximum: 100,
        description:
          "0-100 estimate of how common and interview-relevant this normalized role is at the given seniority, from your own knowledge — how confident are you real candidates regularly interview for this. 0 = nonsense/not a real job. 100 = extremely common (e.g. 'Software Engineer').",
      },
      rationale: {
        type: "string" as const,
        description:
          "One or two sentences explaining the score — shown to the candidate if the request is rejected, so write it for them, not as internal notes.",
      },
    },
    required: ["normalizedTitle", "saturationScore", "rationale"],
  },
};

function systemPrompt(): string {
  return `You standardize free-typed job-role text for a mock-interview scheduling tool and judge whether it's popular/real enough to add to the schedulable catalog.

Normalize the title: fix casing and obvious typos, expand abbreviations, and produce the clean canonical form a job board would use. Don't include the seniority level in the title — that's tracked separately.

Score how common and interview-relevant this role is at the stated seniority, purely from your own knowledge of the job market — you have no live data source, so this is an estimate, not a statistic. Score low for gibberish, jokes, or absurdly narrow/fictional titles; score high for roles that are genuinely common to interview for.

Use the emit_classification tool to return your result — no other output.`;
}

/** Lowercase, whitespace-collapsed form of a title — the actual (title, seniority) matching/dedup key (see JobRole.normalizedKey). */
export function normalizeKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Normalizes a candidate's free-typed role text and scores how "real and
 * common" it is, in one call. Called once per distinct (title, seniority)
 * combo that doesn't already have a catalog entry — see
 * routes/jobRoles.ts POST /request.
 */
export async function classifyJobRole(title: string, seniority: Seniority): Promise<RoleClassification> {
  const client = getAnthropicClient();

  const message = await client.messages.create({
    model: MODELS.live,
    max_tokens: 512,
    system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "emit_classification" },
    messages: [{ role: "user", content: `Candidate-typed role: "${title}"\nSeniority: ${seniority}` }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a tool_use block for emit_classification");
  }
  const result = toolUse.input as RoleClassification;

  // Defense in depth against the model drifting outside the declared
  // schema bounds (tool schemas constrain shape, not always numeric range
  // in practice) — clamp rather than trust blindly, since this score
  // directly gates auto-approval.
  return {
    ...result,
    saturationScore: Math.max(0, Math.min(100, Math.round(result.saturationScore))),
  };
}
