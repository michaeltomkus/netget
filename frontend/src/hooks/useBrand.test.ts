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

const { useBrand } = await import("./useBrand");

beforeEach(() => {
  getBrandOverride.mockReset();
  mockExperimentVariant = "control";
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
});
