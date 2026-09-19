import { useEffect, useRef, type RefObject } from "react";

export type AvatarState = "idle" | "speaking";

interface AvatarRendererProps {
  state: AvatarState;
  /**
   * The actual <audio> elements this avatar's voice plays through (question
   * audio + live-interruption audio, in SessionPage). When given, the
   * avatar's speaking pulse is driven by the real playback amplitude via the
   * Web Audio API — reacting to the actual loudness/cadence of what's being
   * said — instead of just the fixed CSS glow from `state` alone. Omit for a
   * purely illustrative context with no real audio (e.g. the landing page's
   * hero mock), which keeps the static `state`-only look.
   */
  audioRefs?: RefObject<HTMLAudioElement | null>[];
}

// V1 was a static image + a boolean speaking/idle glow. This adds a second,
// continuous layer on top — a ring that pulses in real time with actual
// audio amplitude — without touching the boolean glow, so callers that
// don't pass audioRefs (or whose browser lacks Web Audio) still get exactly
// the old look. A full generated talking-head video (Phase 7, out of scope)
// would replace the <img> itself behind this same `state` prop later.
export default function AvatarRenderer({ state, audioRefs }: AvatarRendererProps) {
  const speaking = state === "speaking";
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!audioRefs || audioRefs.length === 0) return;

    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return; // graceful: avatar just keeps its static speaking look

    let ctx: AudioContext | undefined;
    let analyser: AnalyserNode | undefined;
    const wired = new WeakSet<HTMLAudioElement>();
    const data = new Uint8Array(128);
    let raf = 0;
    let cancelled = false;

    function tick() {
      if (cancelled) return;

      // Elements can mount after this effect runs (SessionPage's
      // interruption-audio element only exists once a question's block
      // renders) — checking every frame, rather than only once on mount,
      // picks those up as soon as they appear. createMediaElementSource can
      // only ever be called once per <audio> element for its whole
      // lifetime, so wiring is tracked in a WeakSet and never repeated.
      for (const ref of audioRefs!) {
        const el = ref.current;
        if (el && !wired.has(el)) {
          try {
            if (!ctx) {
              ctx = new AudioContextCtor();
              analyser = ctx.createAnalyser();
              analyser.fftSize = 256;
              analyser.smoothingTimeConstant = 0.65;
            }
            const source = ctx.createMediaElementSource(el);
            // Must reconnect to destination — createMediaElementSource
            // otherwise silently reroutes the element's audio into the
            // graph and away from actual playback output.
            source.connect(analyser!);
            source.connect(ctx.destination);
            wired.add(el);
          } catch {
            // Not attached to the DOM yet, or already wired — safe to retry next frame.
          }
        }
      }

      if (analyser && rootRef.current) {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const level = sum / data.length / 255;
        // Direct DOM write, not React state: this runs ~60x/sec, and a full
        // component re-render at that rate would be wasteful on a page
        // that's also streaming a live transcript.
        rootRef.current.style.setProperty("--avatar-level", level.toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // audioRefs are stable useRef objects from the caller; this wires once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`avatar ${speaking ? "avatar-speaking" : ""}`} ref={rootRef}>
      <img src="/avatar-placeholder.svg" alt="Interviewer avatar" />
      <span className="avatar-pulse-ring" aria-hidden="true" />
      <span
        className={`avatar-indicator ${speaking ? "on" : ""}`}
        aria-label={speaking ? "Interviewer speaking" : "Interviewer idle"}
      />
    </div>
  );
}
