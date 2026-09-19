import { beforeEach, describe, expect, it, vi } from "vitest";

const getBrandOverride = vi.fn<() => Promise<string | null>>();

vi.mock("../db/store.js", () => ({
  getBrandOverride: (...args: []) => getBrandOverride(...args),
}));

const { getEffectiveBrandVariant } = await import("./brand.js");

beforeEach(() => {
  getBrandOverride.mockReset();
});

describe("getEffectiveBrandVariant", () => {
  it("returns the default variant when no override is set", async () => {
    getBrandOverride.mockResolvedValue(null);
    const brand = await getEffectiveBrandVariant();
    expect(brand.name).toBe("InterviewAI");
  });

  it("returns the overridden variant when one is set", async () => {
    getBrandOverride.mockResolvedValue("alt");
    const brand = await getEffectiveBrandVariant();
    expect(brand.name).toBe("PrepPilot");
  });

  it("falls back to the default variant, without throwing, when the store call fails", async () => {
    getBrandOverride.mockRejectedValue(new Error("Can't reach database server"));
    const brand = await getEffectiveBrandVariant();
    expect(brand.name).toBe("InterviewAI");
  });
});
