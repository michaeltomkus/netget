// Pluggable TTS provider contract, per docs/ARCHITECTURE.md §2.2.
// V1 default implementation is Azure Neural TTS (azureNeuralTts.ts); swap in
// a different implementation (e.g. ElevenLabs for V2, once viseme/phoneme
// timing data is needed to drive a video avatar) without touching callers.

export interface SynthesizedAudio {
  buffer: Buffer;
  contentType: string; // e.g. "audio/mpeg"
  fileExtension: string; // e.g. "mp3"
}

export interface ITextToSpeech {
  synthesize(text: string): Promise<SynthesizedAudio>;
}
