import { useEffect, useMemo, useRef, useState } from "react";

// Live nudges are delivery/behavior signals only — pacing, filler words,
// silence — computed cheaply on-device with zero LLM involvement, per the
// hard boundary set for this project: a nudge is never free text and never
// carries answer content, only ever one of the fixed NudgeKind values below,
// mapped through NUDGE_COPY. There is no code path that could smuggle model
// output or arbitrary text into a nudge.
export type NudgeKind = "pace_fast" | "pace_slow" | "filler_words" | "long_silence";

export interface ActiveNudge {
  kind: NudgeKind;
  message: string;
}

const NUDGE_COPY: Record<NudgeKind, string> = {
  pace_fast: "Slow down a little",
  pace_slow: "Take your time, no rush",
  filler_words: "Try trimming filler words",
  long_silence: "Take your time — jump back in whenever",
};

const FILLER_WORD_PATTERN = /\b(um+|uh+|like|you know|sort of|kind of|basically|actually)\b/gi;
const FAST_WPM_THRESHOLD = 175;
const SLOW_WPM_THRESHOLD = 85;
const MIN_WORDS_FOR_PACE_NUDGE = 12; // avoid noisy pace nudges on very short answers
const FILLER_COUNT_THRESHOLD = 3;
const SILENCE_THRESHOLD_MS = 5000;
const TICK_MS = 1000;

/**
 * Computed entirely client-side from the live transcript stream the
 * frontend already receives over the STT WebSocket (see useSpeechToText) —
 * no extra backend round trip, no LLM call, never touches the grading path.
 */
export function useLiveNudges(
  recording: boolean,
  finalText: string,
  interimText: string,
): ActiveNudge[] {
  const [nudgeKinds, setNudgeKinds] = useState<Set<NudgeKind>>(new Set());
  const startedAtRef = useRef<number | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  // Any new transcript activity (interim included) resets the silence clock.
  useEffect(() => {
    if (recording) lastActivityRef.current = Date.now();
  }, [recording, finalText, interimText]);

  useEffect(() => {
    if (!recording) {
      startedAtRef.current = null;
      setNudgeKinds(new Set());
      return;
    }
    if (startedAtRef.current === null) startedAtRef.current = Date.now();

    const interval = setInterval(() => {
      const now = Date.now();
      const next = new Set<NudgeKind>();

      const words = finalText.trim();
      const wordCount = words.length === 0 ? 0 : words.split(/\s+/).length;
      if (wordCount >= MIN_WORDS_FOR_PACE_NUDGE) {
        const elapsedMin = Math.max((now - (startedAtRef.current ?? now)) / 60000, 1 / 60);
        const wpm = wordCount / elapsedMin;
        if (wpm > FAST_WPM_THRESHOLD) next.add("pace_fast");
        else if (wpm < SLOW_WPM_THRESHOLD) next.add("pace_slow");
      }

      const fillerMatches = finalText.match(FILLER_WORD_PATTERN);
      if ((fillerMatches?.length ?? 0) >= FILLER_COUNT_THRESHOLD) {
        next.add("filler_words");
      }

      if (now - lastActivityRef.current > SILENCE_THRESHOLD_MS) {
        next.add("long_silence");
      }

      setNudgeKinds(next);
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [recording, finalText]);

  return useMemo(
    () => Array.from(nudgeKinds).map((kind) => ({ kind, message: NUDGE_COPY[kind] })),
    [nudgeKinds],
  );
}
