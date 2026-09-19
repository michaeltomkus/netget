import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScheduledWaitRoom from "./ScheduledWaitRoom";
import type { Session } from "../api/types";

const beginSession = vi.fn();
vi.mock("../api/client", () => ({ beginSession: (...args: [string]) => beginSession(...args) }));

const BASE_SESSION: Session = {
  id: "session_1",
  createdAt: new Date().toISOString(),
  role: "Backend Engineer",
  seniority: "mid",
  stressIntensity: "medium",
  status: "scheduled",
  recordingConsent: false,
  scheduledDurationMinutes: 30,
};

beforeEach(() => {
  beginSession.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ScheduledWaitRoom", () => {
  it("shows a minutes:seconds countdown before scheduledFor arrives", () => {
    const scheduledFor = new Date(Date.now() + 65_000).toISOString();
    render(<ScheduledWaitRoom session={{ ...BASE_SESSION, scheduledFor }} onReady={vi.fn()} />);
    expect(screen.getByText("1:05")).toBeInTheDocument();
    expect(beginSession).not.toHaveBeenCalled();
  });

  it("calls beginSession once the countdown elapses, and onReady on success", async () => {
    const scheduledFor = new Date(Date.now() + 2000).toISOString();
    const onReady = vi.fn();
    const startedSession = { ...BASE_SESSION, status: "in_progress" };
    const startedQuestions = [{ id: "q1", order: 0, type: "behavioral" as const, text: "Tell me about yourself" }];
    beginSession.mockResolvedValueOnce({ session: startedSession, questions: startedQuestions });

    render(<ScheduledWaitRoom session={{ ...BASE_SESSION, scheduledFor }} onReady={onReady} />);

    await vi.advanceTimersByTimeAsync(2100);

    expect(beginSession).toHaveBeenCalledWith("session_1");
    expect(onReady).toHaveBeenCalledWith(startedSession, startedQuestions);
  });

  it("retries automatically if begin isn't ready yet (425)", async () => {
    const scheduledFor = new Date(Date.now() + 1000).toISOString();
    const onReady = vi.fn();
    beginSession.mockRejectedValueOnce(new Error("Still preparing your questions"));
    beginSession.mockResolvedValueOnce({ session: { ...BASE_SESSION, status: "in_progress" }, questions: [] });

    render(<ScheduledWaitRoom session={{ ...BASE_SESSION, scheduledFor }} onReady={onReady} />);

    await vi.advanceTimersByTimeAsync(1100);
    expect(beginSession).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3000);
    expect(beginSession).toHaveBeenCalledTimes(2);
    expect(onReady).toHaveBeenCalled();
  });
});
