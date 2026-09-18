import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { DeepgramStt } from "../services/stt/deepgramStt.js";
import type { SttStream } from "../services/stt/ISpeechToText.js";
import { store } from "../db/store.js";

interface ClientMessage {
  type: "start" | "stop";
  sessionId?: string;
}

// Phase 2 scope: pure audio-in -> transcript-out. Deliberately does NOT
// persist responses itself — the frontend accumulates the live transcript
// into an editable field and submits it through the existing REST
// POST /api/sessions/:id/responses route, same as Phase 1. This keeps the
// gateway a thin STT proxy rather than duplicating session-state logic that
// belongs to the Interview Conductor (Phase 5).
export function attachSttGateway(server: Server): void {
  const wss = new WebSocketServer({ server, path: "/ws/stt" });

  wss.on("connection", (ws) => {
    let sttStream: SttStream | undefined;
    let started = false;

    ws.on("message", (data, isBinary) => {
      if (!isBinary) {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }

        if (msg.type === "start" && !started) {
          const session = msg.sessionId ? store.getSession(msg.sessionId) : undefined;
          if (!session) {
            ws.send(JSON.stringify({ type: "error", message: "Unknown session" }));
            ws.close();
            return;
          }
          try {
            sttStream = new DeepgramStt().openStream(
              (event) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "transcript", ...event }));
                }
              },
              (err) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "error", message: err.message }));
                }
              },
            );
            started = true;
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: err instanceof Error ? err.message : "STT is not configured",
              }),
            );
            ws.close();
          }
        } else if (msg.type === "stop") {
          sttStream?.close();
          ws.close();
        }
        return;
      }

      if (started && sttStream) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        sttStream.sendAudio(buf);
      }
    });

    ws.on("close", () => {
      sttStream?.close();
    });
  });
}
