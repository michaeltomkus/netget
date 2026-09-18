import { useCallback, useEffect, useRef, useState } from "react";
import { WS_BASE } from "../api/client";

export type SttStatus = "idle" | "connecting" | "recording" | "stopped" | "error";

interface TranscriptMessage {
  type: "transcript";
  text: string;
  isFinal: boolean;
}
interface ErrorMessage {
  type: "error";
  message: string;
}
type ServerMessage = TranscriptMessage | ErrorMessage;

// Chrome/Firefox/Edge support audio/webm;codecs=opus, which Deepgram
// auto-detects and streams directly (see backend deepgramStt.ts). Safari/iOS
// support here is a known gap — see docs/ARCHITECTURE.md §7 risk #4 — and is
// flagged for Phase 6 hardening rather than solved here; when no candidate is
// supported, callers fall back to typing.
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export interface UseSpeechToTextResult {
  status: SttStatus;
  finalText: string;
  interimText: string;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
}

export function useSpeechToText(sessionId: string | undefined): UseSpeechToTextResult {
  const [status, setStatus] = useState<SttStatus>("idle");
  const [finalText, setFinalText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const teardown = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "stop" }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    if (!sessionId) return;
    setError(null);
    setInterimText("");
    setStatus("connecting");

    const mimeType = pickSupportedMimeType();
    if (!mimeType) {
      setError("Voice recording isn't supported in this browser. Type your answer instead.");
      setStatus("error");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access was denied. Type your answer instead.");
      setStatus("error");
      return;
    }
    streamRef.current = stream;

    const ws = new WebSocket(`${WS_BASE}/ws/stt`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start", sessionId }));

      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          e.data.arrayBuffer().then((buf) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(buf);
          });
        }
      };
      recorder.start(250);
      setStatus("recording");
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === "transcript") {
        if (msg.isFinal) {
          setFinalText((prev) => (prev ? `${prev} ${msg.text}` : msg.text));
          setInterimText("");
        } else {
          setInterimText(msg.text);
        }
      } else if (msg.type === "error") {
        setError(msg.message);
        setStatus("error");
      }
    };

    ws.onerror = () => {
      setError("Connection to the transcription service failed.");
      setStatus("error");
    };

    ws.onclose = () => {
      setStatus((prev) => (prev === "error" ? prev : "stopped"));
    };
  }, [sessionId]);

  const stop = useCallback(() => {
    teardown();
    setStatus("stopped");
  }, [teardown]);

  const reset = useCallback(() => {
    setFinalText("");
    setInterimText("");
    setError(null);
    setStatus("idle");
  }, []);

  return { status, finalText, interimText, error, start, stop, reset };
}
