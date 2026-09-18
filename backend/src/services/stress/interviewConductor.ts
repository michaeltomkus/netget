import { generateFollowUp } from "./dynamicFollowUp.js";
import { AzureNeuralTts } from "../tts/azureNeuralTts.js";
import type { Question, Session } from "../../types.js";

const tts = new AzureNeuralTts();

// "Roughly 1 in 3 answers" at medium intensity, per docs/ARCHITECTURE.md §5.2 —
// applied as a single per-answer probability check, not re-rolled per segment.
const STRESS_PROBABILITY: Record<Session["stressIntensity"], number> = {
  low: 0.15,
  medium: 0.35,
  high: 0.6,
};

const MIN_WORDS_BEFORE_INTERRUPT = 25;

export interface InterruptPayload {
  text: string;
  /** Omitted if TTS isn't configured — the frontend still shows the caption without audio. */
  audioDataUrl?: string;
}

/**
 * Per-connection (per answer-in-progress) stress-tactic state. One instance
 * lives for the duration of a single question's recording; it checks
 * exactly once, at the point the cumulative final transcript first crosses
 * a length threshold, whether to inject a live interruption — capping at
 * one interruption per answer regardless of outcome.
 */
export class StressTrigger {
  private fired = false;
  private wordCount = 0;

  constructor(
    private readonly session: Session,
    private readonly question: Question,
  ) {}

  private get eligible(): boolean {
    return (
      this.question.type === "stress" &&
      Boolean(this.question.followUpTriggers?.length) &&
      !this.fired
    );
  }

  async onFinalSegment(segmentText: string, transcriptSoFar: string): Promise<InterruptPayload | null> {
    if (!this.eligible) return null;

    this.wordCount += segmentText.trim().split(/\s+/).filter(Boolean).length;
    if (this.wordCount < MIN_WORDS_BEFORE_INTERRUPT) return null;

    this.fired = true; // one check per answer, win or lose

    const probability = STRESS_PROBABILITY[this.session.stressIntensity];
    if (Math.random() >= probability) return null;

    const triggers = this.question.followUpTriggers!;
    const trigger = triggers[Math.floor(Math.random() * triggers.length)];

    let text: string;
    try {
      text = await generateFollowUp({
        questionText: this.question.text,
        followUpTrigger: trigger,
        transcriptSoFar,
      });
    } catch (err) {
      console.warn(
        `Live follow-up generation skipped for question ${this.question.id}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }

    let audioDataUrl: string | undefined;
    try {
      const audio = await tts.synthesize(text);
      audioDataUrl = `data:${audio.contentType};base64,${audio.buffer.toString("base64")}`;
    } catch (err) {
      console.warn(
        `Interruption TTS skipped, falling back to text-only: ${err instanceof Error ? err.message : err}`,
      );
    }

    return { text, audioDataUrl };
  }
}
