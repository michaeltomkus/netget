import { AzureNeuralTts } from "./tts/azureNeuralTts.js";
import { saveQuestionAudio } from "./media.js";
import type { Question } from "../types.js";

const tts = new AzureNeuralTts();

/**
 * Synthesizes and caches TTS audio for each question, mutating
 * question.ttsAudioBlobRef in place. Failures (including "not configured")
 * are logged and swallowed per-question — the session still works in
 * captions-only mode without a voice, same graceful-degradation pattern as
 * question generation working with only ANTHROPIC_API_KEY set.
 */
export async function attachQuestionAudio(questions: Question[]): Promise<void> {
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
