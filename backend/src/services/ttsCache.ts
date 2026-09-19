import { AzureNeuralTts } from "./tts/azureNeuralTts.js";
import { saveQuestionAudio } from "./media.js";

const tts = new AzureNeuralTts();

/** Structural, not the full Question/BankQuestion shape — this only ever reads id/text and writes ttsAudioBlobRef. */
export interface Synthesizable {
  id: string;
  text: string;
  ttsAudioBlobRef?: string;
}

/**
 * Synthesizes and caches TTS audio for each item, mutating
 * item.ttsAudioBlobRef in place. Failures (including "not configured") are
 * logged and swallowed per-item — the session still works in captions-only
 * mode without a voice, same graceful-degradation pattern as question
 * generation working with only ANTHROPIC_API_KEY set. Used for both a
 * session's live Question rows and a role's cached BankQuestion rows (see
 * questionGeneration.ts) — audio is synthesized once per bank question and
 * reused, never per session.
 */
export async function attachQuestionAudio(questions: Synthesizable[]): Promise<void> {
  await Promise.allSettled(
    questions.map(async (question) => {
      const audio = await tts.synthesize(question.text);
      question.ttsAudioBlobRef = saveQuestionAudio(question.id, audio.buffer, audio.fileExtension);
    }),
  ).then((results) => {
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        console.warn(
          `TTS synthesis skipped for question ${questions[i].id}: ${result.reason instanceof Error ? result.reason.message : result.reason}`,
        );
      }
    });
  });
}
