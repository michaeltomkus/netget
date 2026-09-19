import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AvatarRenderer from "./AvatarRenderer";

describe("AvatarRenderer", () => {
  it("shows the idle indicator and no speaking glow when idle", () => {
    render(<AvatarRenderer state="idle" />);
    expect(screen.getByLabelText("Interviewer idle")).toBeInTheDocument();
    expect(screen.getByLabelText("Interviewer idle").closest(".avatar")).not.toHaveClass("avatar-speaking");
  });

  it("shows the speaking indicator and glow when speaking", () => {
    render(<AvatarRenderer state="speaking" />);
    expect(screen.getByLabelText("Interviewer speaking")).toBeInTheDocument();
    expect(screen.getByLabelText("Interviewer speaking").closest(".avatar")).toHaveClass("avatar-speaking");
  });

  it("renders without crashing when given audioRefs, even though jsdom has no Web Audio API", () => {
    // The exact scenario the component is meant to degrade gracefully
    // from — window.AudioContext is undefined in jsdom, so the wiring
    // effect should bail out early (see AvatarRenderer's own guard)
    // rather than throwing.
    const audioRef = createRef<HTMLAudioElement>();
    expect(() => render(<AvatarRenderer state="speaking" audioRefs={[audioRef]} />)).not.toThrow();
  });
});
