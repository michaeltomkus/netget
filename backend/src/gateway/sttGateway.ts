import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { DeepgramStt } from "../services/stt/deepgramStt.js";
import type { SttStream } from "../services/stt/ISpeechToText.js";
import { StressTrigger } from "../services/stress/interviewConductor.js";
import { verifyWsToken } from "../middleware/auth.js";
import * as store from "../db/store.js";

interface ClientMessage {
  type: "start" | "stop";
  sessionId?: string;
  questionId?: string;
  /** Short-lived Clerk session token — see middleware/auth.ts verifyWsToken for why this can't just ride on cookies/headers here. */
  token?: string;
}

// The Interview Conductor lives here: this gateway is still primarily an
// audio-in -> transcript-out proxy (responses are persisted via the REST
// route, same as Phase 1-2), but it now also watches the live transcript for
// stress-tagged questions and can inject a spoken interruption mid-answer —
// see services/stress/interviewConductor.ts.
export function attachSttGateway(server: Server): void {
  const wss = new WebSocketServer({ server, path: "/ws/stt" });

  wss.on("connection", (ws) => {
    let sttStream: SttStream | undefined;
    let started = false;
    let stressTrigger: StressTrigger | undefined;
    let finalTranscript = "";

    ws.on("message", (data, isBinary) => {
      if (!isBinary) {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }

        if (msg.type === "start" && !started) {
          void handleStart(msg);
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

    async function handleStart(msg: ClientMessage) {
      if (!msg.token) {
        ws.send(JSON.stringify({ type: "error", message: "Sign in required" }));
        ws.close();
        return;
      }
      const user = await verifyWsToken(msg.token);
      if (!user) {
        ws.send(JSON.stringify({ type: "error", message: "Sign in required" }));
        ws.close();
        return;
      }

      const session = msg.sessionId ? await store.getSession(msg.sessionId) : undefined;
      if (!session || session.userId !== user.id) {
        ws.send(JSON.stringify({ type: "error", message: "Unknown session" }));
        ws.close();
        return;
      }

      const question = msg.questionId ? await store.getQuestion(msg.questionId) : undefined;
      if (question && question.questionSetId === session.questionSetId) {
        stressTrigger = new StressTrigger(session, question);
      }

      try {
        sttStream = new DeepgramStt().openStream(
          (event) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "transcript", ...event }));
            }
            if (event.isFinal) {
              finalTranscript = finalTranscript ? `${finalTranscript} ${event.text}` : event.text;
              stressTrigger?.onFinalSegment(event.text, finalTranscript).then((payload) => {
                if (payload && ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "interrupt", ...payload }));
                }
              });
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
    }

    ws.on("close", () => {
      sttStream?.close();
    });
  });
}
