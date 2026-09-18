import WebSocket from "ws";
import type { ISpeechToText, SttStream, TranscriptEvent } from "./ISpeechToText.js";

// interim_results: live partials for the editable-transcript UX.
// smart_format + punctuate: readable text without extra client-side cleanup.
// Browser MediaRecorder's webm/opus chunks are streamed straight through —
// Deepgram auto-detects the container, no explicit encoding/sample_rate
// params needed for that path (see docs/ARCHITECTURE.md §2.1 discussion).
const DEEPGRAM_URL =
  "wss://api.deepgram.com/v1/listen?interim_results=true&smart_format=true&punctuate=true&model=nova-2";

interface DeepgramMessage {
  is_final?: boolean;
  channel?: { alternatives?: { transcript?: string }[] };
}

export class DeepgramStt implements ISpeechToText {
  openStream(
    onTranscript: (event: TranscriptEvent) => void,
    onError: (err: Error) => void,
  ): SttStream {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error("DEEPGRAM_API_KEY is not set");
    }

    const upstream = new WebSocket(DEEPGRAM_URL, {
      headers: { Authorization: `Token ${apiKey}` },
    });

    upstream.on("message", (data) => {
      let msg: DeepgramMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return; // keepalive / non-JSON frames
      }
      const transcript = msg.channel?.alternatives?.[0]?.transcript;
      if (transcript) {
        onTranscript({ text: transcript, isFinal: Boolean(msg.is_final) });
      }
    });

    upstream.on("error", (err) => {
      onError(err instanceof Error ? err : new Error(String(err)));
    });

    let open = false;
    const pending: Buffer[] = [];
    upstream.on("open", () => {
      open = true;
      for (const chunk of pending.splice(0)) upstream.send(chunk);
    });

    return {
      sendAudio(chunk: Buffer) {
        if (open) upstream.send(chunk);
        else pending.push(chunk);
      },
      close() {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(JSON.stringify({ type: "CloseStream" }));
        }
        upstream.close();
      },
    };
  }
}
