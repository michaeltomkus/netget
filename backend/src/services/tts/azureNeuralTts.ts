import type { ITextToSpeech, SynthesizedAudio } from "./ITextToSpeech.js";

const DEFAULT_VOICE = "en-US-AriaNeural";

function escapeSsml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// REST-based, not the native Speech SDK — deliberately, per docs/ARCHITECTURE.md
// §2.1's note on avoiding the SDK's native-binary container weight where a
// plain HTTPS call does the job. This endpoint is a single-shot synthesis
// call (no streaming, no word-boundary events), which is exactly what's
// needed for pre-caching fixed question audio at schedule time.
export class AzureNeuralTts implements ITextToSpeech {
  async synthesize(text: string): Promise<SynthesizedAudio> {
    const key = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;
    if (!key || !region) {
      throw new Error("AZURE_SPEECH_KEY / AZURE_SPEECH_REGION are not set");
    }

    const voice = process.env.AZURE_SPEECH_VOICE ?? DEFAULT_VOICE;
    const ssml = `<speak version="1.0" xml:lang="en-US"><voice name="${voice}">${escapeSsml(text)}</voice></speak>`;

    const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "interviewai-mock",
      },
      body: ssml,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Azure TTS request failed: ${res.status} ${detail}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: "audio/mpeg",
      fileExtension: "mp3",
    };
  }
}
