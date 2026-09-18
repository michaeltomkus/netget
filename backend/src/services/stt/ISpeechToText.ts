// Pluggable STT provider contract, per docs/ARCHITECTURE.md §2.1.
// V1 default implementation is Deepgram (deepgramStt.ts) — the spec
// recommends prototyping against Deepgram first for developer velocity
// (clean WebSocket API, no native SDK), keeping Azure Speech as the later
// "default enterprise" swap-in once hand-rolling its streaming protocol is
// worth the effort.

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
}

export interface SttStream {
  sendAudio(chunk: Buffer): void;
  close(): void;
}

export interface ISpeechToText {
  /** Opens a live streaming session. Throws synchronously if the provider isn't configured. */
  openStream(
    onTranscript: (event: TranscriptEvent) => void,
    onError: (err: Error) => void,
  ): SttStream;
}
