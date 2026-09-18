import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.",
      );
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

// Three-tier model strategy per docs/ARCHITECTURE.md §5.2:
// Haiku for live/latency-critical generation (Phase 5), Sonnet for bulk
// async question-generation and per-response grading, Opus for the
// once-per-session highest-value synthesis.
export const MODELS = {
  bulk: "claude-sonnet-5",
  synthesis: "claude-opus-5",
  live: "claude-haiku-4-5-20251001",
} as const;
