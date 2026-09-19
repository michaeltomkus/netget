import { describe, expect, it, vi } from "vitest";

const create = vi.fn();

vi.mock("./anthropicClient.js", () => ({
  getAnthropicClient: () => ({ messages: { create: (...args: unknown[]) => create(...args) } }),
  MODELS: { live: "test-haiku", bulk: "test-sonnet", synthesis: "test-opus" },
}));

const { classifyJobRole, normalizeKey, SATURATION_APPROVAL_THRESHOLD } = await import("./jobRoleClassifier.js");

function toolUseResponse(input: Record<string, unknown>) {
  return { content: [{ type: "tool_use", name: "emit_classification", input }] };
}

describe("normalizeKey", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeKey("  Backend   Engineer ")).toBe("backend engineer");
  });

  it("is stable for already-normalized input", () => {
    expect(normalizeKey("backend engineer")).toBe("backend engineer");
  });
});

describe("classifyJobRole", () => {
  it("returns the classification from Claude's tool_use response", async () => {
    create.mockResolvedValueOnce(
      toolUseResponse({ normalizedTitle: "Backend Engineer", saturationScore: 85, rationale: "Very common." }),
    );

    const result = await classifyJobRole("backend eng", "mid");

    expect(result).toEqual({ normalizedTitle: "Backend Engineer", saturationScore: 85, rationale: "Very common." });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-haiku",
        tool_choice: { type: "tool", name: "emit_classification" },
      }),
    );
  });

  it("clamps a score above 100", async () => {
    create.mockResolvedValueOnce(toolUseResponse({ normalizedTitle: "X", saturationScore: 140, rationale: "r" }));
    const result = await classifyJobRole("x", "mid");
    expect(result.saturationScore).toBe(100);
  });

  it("clamps a negative score", async () => {
    create.mockResolvedValueOnce(toolUseResponse({ normalizedTitle: "X", saturationScore: -10, rationale: "r" }));
    const result = await classifyJobRole("x", "mid");
    expect(result.saturationScore).toBe(0);
  });

  it("rounds a fractional score", async () => {
    create.mockResolvedValueOnce(toolUseResponse({ normalizedTitle: "X", saturationScore: 72.6, rationale: "r" }));
    const result = await classifyJobRole("x", "mid");
    expect(result.saturationScore).toBe(73);
  });

  it("throws if Claude doesn't return a tool_use block", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "oops" }] });
    await expect(classifyJobRole("x", "mid")).rejects.toThrow(/did not return a tool_use block/i);
  });
});

describe("SATURATION_APPROVAL_THRESHOLD", () => {
  it("is a score between 0 and 100", () => {
    expect(SATURATION_APPROVAL_THRESHOLD).toBeGreaterThan(0);
    expect(SATURATION_APPROVAL_THRESHOLD).toBeLessThan(100);
  });
});
