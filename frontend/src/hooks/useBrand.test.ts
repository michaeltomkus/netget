import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getBrandOverride = vi.fn<() => Promise<{ overrideVariant: string | null }>>();
vi.mock("../api/client", () => ({
  getBrandOverride: (...args: []) => getBrandOverride(...args),
}));

let mockExperimentVariant = "control";
vi.mock("../experiments/useExperiment", () => ({
  useExperiment: () => ({ variant: mockExperimentVariant, logConversion: vi.fn() }),
}));

const { useBrand, __resetBrandOverrideCacheForTests } = await import("./useBrand");

beforeEach(() => {
  getBrandOverride.mockReset();
  mockExperimentVariant = "control";
  // The hook caches the override fetch at module scope (across mounts) —
  // reset it so each test starts from a clean slate instead of reusing a
  // previous test's cached promise.
  __resetBrandOverrideCacheForTests();
});

describe("useBrand", () => {
  it("uses the experiment's variant when no override is set", async () => {
    getBrandOverride.mockResolvedValue({ overrideVariant: null });
    const { result } = renderHook(() => useBrand());

    await waitFor(() => expect(getBrandOverride).toHaveBeenCalled());
    expect(result.current.name).toBe("InterviewAI");
  });

  it("uses the experiment's variant when it's 'alt' and there's no override", async () => {
    mockExperimentVariant = "alt";
    getBrandOverride.mockResolvedValue({ overrideVariant: null });
    const { result } = renderHook(() => useBrand());

    await waitFor(() => expect(result.current.name).toBe("PrepPilot"));
  });

  it("prefers an admin override over the experiment's own variant", async () => {
    mockExperimentVariant = "control";
    getBrandOverride.mockResolvedValue({ overrideVariant: "alt" });
    const { result } = renderHook(() => useBrand());

    await waitFor(() => expect(result.current.name).toBe("PrepPilot"));
  });

  it("falls back to the experiment's variant if the override lookup fails", async () => {
    getBrandOverride.mockRejectedValue(new Error("network error"));
    const { result } = renderHook(() => useBrand());

    // Give the rejected promise a tick to settle; the hook should stay on
    // the experiment variant throughout, never throwing.
    await waitFor(() => expect(getBrandOverride).toHaveBeenCalled());
    expect(result.current.name).toBe("InterviewAI");
  });

  it("reuses a single in-flight/settled override fetch across remounts instead of re-requesting it", async () => {
    getBrandOverride.mockResolvedValue({ overrideVariant: "alt" });
    const first = renderHook(() => useBrand());
    await waitFor(() => expect(first.result.current.name).toBe("PrepPilot"));

    const second = renderHook(() => useBrand());
    await waitFor(() => expect(second.result.current.name).toBe("PrepPilot"));

    expect(getBrandOverride).toHaveBeenCalledTimes(1);
  });

  it("clears the cache and retries on the next mount after a failed fetch", async () => {
    getBrandOverride.mockRejectedValueOnce(new Error("network error"));
    const first = renderHook(() => useBrand());
    await waitFor(() => expect(getBrandOverride).toHaveBeenCalledTimes(1));
    expect(first.result.current.name).toBe("InterviewAI");

    getBrandOverride.mockResolvedValueOnce({ overrideVariant: "alt" });
    const second = renderHook(() => useBrand());
    await waitFor(() => expect(second.result.current.name).toBe("PrepPilot"));
    expect(getBrandOverride).toHaveBeenCalledTimes(2);
  });
});
